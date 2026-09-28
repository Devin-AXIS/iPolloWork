import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, realpath, rm, stat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { z } from "zod";
import { hyperframesStudioPort } from "@ipollowork/types/hyperframes";
import { ApiError } from "../errors.js";
import { uiControlRequest } from "../ui-control-client.js";
import { resolveWorkspaceFile } from "./storage.js";

export const videoRenderInput = z.object({
  sourcePath: z.string().regex(/^video\/[A-Za-z0-9_-]+\/index\.html$/),
  operationKey: z.string().trim().min(1).max(160),
  review: z.boolean().optional(),
  reviewOnly: z.boolean().optional(),
}).strict();
const pixelReviewSchema = z.object({
  valid: z.boolean(),
  sampledFrameCount: z.number(),
  blankSceneIds: z.array(z.string()),
  scenes: z.array(z.object({ sceneId: z.string(), sampleTimes: z.array(z.number()), contrast: z.array(z.number()), change: z.array(z.number()) })),
});
const receiptSchema = z.object({
  status: z.enum(["preparing", "rendering", "complete", "failed"]),
  startedAt: z.number(), jobId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  progress: z.number().optional(), stage: z.string().optional(), error: z.string().optional(),
  outputPath: z.string().optional(), size: z.number().optional(),
  pixelReview: pixelReviewSchema.optional(),
});
type Receipt = z.infer<typeof receiptSchema>;
const preparing = new Set<string>();

async function studioJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(15000),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Studio HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);
  return response.json();
}

export function renderedSceneWindows(html: string) {
  return Array.from(html.matchAll(/<[^>]+\b(?:class=["'][^"']*\bscene\b[^"']*["']|data-scene(?:=["'][^"']*["'])?(?=\s|\/?>))[^>]*>/gi)).flatMap((match, index) => {
    const tag = match[0];
    const start = Number(/\bdata-start=["']([^"']+)["']/i.exec(tag)?.[1]);
    const duration = Number(/\bdata-duration=["']([^"']+)["']/i.exec(tag)?.[1]);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
    const sceneId = /\bid=["']([^"']+)["']/i.exec(tag)?.[1]?.trim() || `scene-${index + 1}`;
    return [{ sceneId, start, duration }];
  });
}

function extractRawReviewFrames(videoPath: string, frameNumbers: number[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const select = frameNumbers.map((frame) => `eq(n\\,${frame})`).join("+");
    execFile(process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg", [
      "-v", "error", "-i", videoPath, "-vf", `select='${select}',scale=96:54,format=rgb24`,
      "-vsync", "0", "-f", "rawvideo", "pipe:1",
    ], { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function reviewRenderedPixels(videoPath: string, html: string) {
  const scenes = renderedSceneWindows(html);
  const requests = scenes.flatMap((scene) => [0.15, 0.5, 0.85].map((position) => ({
    sceneId: scene.sceneId,
    time: Math.max(0, scene.start + scene.duration * position),
  })));
  if (!requests.length) throw new Error("Pixel review could not find timed scenes in the saved composition.");
  const frameNumbers = requests.map((request) => Math.max(0, Math.round(request.time * 30)));
  const raw = await extractRawReviewFrames(videoPath, frameNumbers);
  const frameBytes = 96 * 54 * 3;
  if (raw.byteLength !== requests.length * frameBytes) throw new Error(`Pixel review expected ${requests.length} frames but decoded ${Math.floor(raw.byteLength / frameBytes)}.`);
  const metrics = requests.map((request, index) => {
    const frame = raw.subarray(index * frameBytes, (index + 1) * frameBytes);
    let sum = 0;
    let sumSquares = 0;
    for (let offset = 0; offset < frame.length; offset += 3) {
      const luma = frame[offset]! * 0.2126 + frame[offset + 1]! * 0.7152 + frame[offset + 2]! * 0.0722;
      sum += luma;
      sumSquares += luma * luma;
    }
    const count = frame.length / 3;
    const mean = sum / count;
    return { ...request, contrast: Math.sqrt(Math.max(0, sumSquares / count - mean * mean)), frame };
  });
  const reviewedScenes = scenes.map((scene) => {
    const samples = metrics.filter((metric) => metric.sceneId === scene.sceneId);
    const change = samples.slice(1).map((sample, index) => {
      const previous = samples[index]!.frame;
      let difference = 0;
      for (let offset = 0; offset < sample.frame.length; offset += 1) difference += Math.abs(sample.frame[offset]! - previous[offset]!);
      return Math.round((difference / sample.frame.length / 255) * 10_000) / 10_000;
    });
    return {
      sceneId: scene.sceneId,
      sampleTimes: samples.map((sample) => Math.round(sample.time * 1_000) / 1_000),
      contrast: samples.map((sample) => Math.round(sample.contrast * 100) / 100),
      change,
    };
  });
  const blankSceneIds = reviewedScenes.filter((scene) => scene.contrast.every((contrast) => contrast < 1.5)).map((scene) => scene.sceneId);
  return { valid: blankSceneIds.length === 0, sampledFrameCount: requests.length, blankSceneIds, scenes: reviewedScenes };
}

/** Owns the durable export receipt; Studio remains the only render engine. */
export async function videoRenderAction(workspace: { id: string; path: string }, action: string, raw: unknown) {
  const input = videoRenderInput.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  const root = await realpath(workspace.path);
  const actual = await realpath(source.absolutePath);
  if (!actual.startsWith(root + sep)) throw new ApiError(400, "path_escape", "Video source escapes workspace");
  const project = input.sourcePath.split("/")[1]!;
  const directory = dirname(actual);
  const renders = `${directory}/renders`;
  await mkdir(renders, { recursive: true });
  if (!(await realpath(renders)).startsWith(root + sep)) throw new ApiError(400, "path_escape", "Render directory escapes workspace");
  const receiptPath = `${renders}/.export-${createHash("sha256").update(input.operationKey).digest("hex")}.json`;
  const base = `http://127.0.0.1:${hyperframesStudioPort(project)}/api`;
  const save = (receipt: Receipt) => writeFile(receiptPath, JSON.stringify(receipt), "utf8");
  let receipt: Receipt;
  try {
    if (!(await realpath(receiptPath)).startsWith(root + sep)) throw new ApiError(400, "path_escape", "Export receipt escapes workspace");
    receipt = receiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
  }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    if (action !== "video_render_start") throw new ApiError(404, "render_not_found", "No export exists for this operationKey");
    if (preparing.size >= 16) throw new ApiError(429, "render_busy", "Too many exports are preparing");
    receipt = { status: "preparing", startedAt: Date.now(), progress: 0, stage: "Starting bundled Studio" };
    // Exclusive creation makes retries and concurrent requests reuse one job.
    try { await writeFile(receiptPath, JSON.stringify(receipt), { flag: "wx" }); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return { ...receiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8"))), operationKey: input.operationKey };
      throw error;
    }
    preparing.add(receiptPath);
    const initial = receipt;
    void (async () => {
      try {
        const ready = await uiControlRequest("/video/ensure-studio", { method: "POST", timeoutMs: 100000,
          body: { workspaceId: workspace.id, projectId: project } });
        if (!ready || typeof ready !== "object" || !("ok" in ready) || ready.ok !== true) {
          throw new Error(`Cannot start bundled Studio: ${JSON.stringify(ready)}`);
        }
        const job = z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]+$/) }).parse(await studioJson(`${base}/projects/${project}/render`, {
          format: "mp4",
          quality: input.reviewOnly ? "draft" : "high",
          fps: 30,
          ...(input.reviewOnly ? { captureSize: { width: 640, height: 360 } } : {}),
        }));
        await save({ ...initial, ...job, status: "rendering", stage: "Rendering MP4" });
      } catch (error) {
        await save({ ...initial, status: "failed", error: error instanceof Error ? error.message : String(error) });
      } finally { preparing.delete(receiptPath); }
    })().catch(error => console.error("[video-render] receipt persistence failed", error instanceof Error ? error.message : String(error)));
    return { ...receipt, operationKey: input.operationKey, pollAfterMs: 2000 };
  }
  if (receipt.status === "preparing" && !preparing.has(receiptPath)) {
    receipt = { ...receipt, status: "failed", error: "Export preparation was interrupted by a service restart. No automatic duplicate was submitted." };
    await save(receipt);
  }
  if (receipt.status === "rendering" && receipt.jobId) {
    try {
      // Studio removes completed jobs from memory after five minutes. Its
      // persisted metadata remains authoritative after a long continuation.
      const meta = await readFile(`${renders}/${receipt.jobId}.meta.json`, "utf8").then(text => JSON.parse(text)).catch(() => null);
      if (meta?.status === "complete") {
        const output = `${renders}/${receipt.jobId}.mp4`;
        if (!(await realpath(output)).startsWith(root + sep)) throw new Error("Export escaped workspace");
        const size = (await stat(output)).size;
        if (!size) throw new Error("Completed export is empty");
        const pixelReview = input.review || input.reviewOnly ? await reviewRenderedPixels(output, await readFile(actual, "utf8")) : undefined;
        if (input.reviewOnly) await rm(output, { force: true });
        receipt = { ...receipt, status: "complete", progress: 100, ...(!input.reviewOnly ? { outputPath: relative(root, output).replaceAll(sep, "/"), size } : {}), ...(pixelReview ? { pixelReview } : {}) };
        await save(receipt);
        await uiControlRequest("/video/ensure-studio", { method: "POST", body: { workspaceId: workspace.id, projectId: project, release: true } });
        return { ...receipt, operationKey: input.operationKey };
      }
      const response = await fetch(`${base}/render/${receipt.jobId}/progress`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok || !response.body) throw new Error(`Render progress unavailable (HTTP ${response.status}); do not resubmit this export.`);
      const reader = response.body.getReader();
      let text = "";
      try {
        const decoder = new TextDecoder();
        while (!text.includes("\n\n") && text.length < 65536) {
          const chunk = await reader.read(); if (chunk.done) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
      } finally { await reader.cancel(); }
      const line = text.split("\n").find(line => line.startsWith("data: "));
      if (!line) throw new Error("Render returned no progress event");
      const progress = z.object({ status: z.enum(["rendering", "complete", "failed", "cancelled"]), progress: z.number().optional(), stage: z.string().optional(), error: z.string().optional() }).parse(JSON.parse(line.slice(6)));
      receipt = { ...receipt, ...progress, status: progress.status === "cancelled" ? "failed" : progress.status };
      if (receipt.status === "complete") {
        const output = `${renders}/${receipt.jobId}.mp4`;
        if (!(await realpath(output)).startsWith(root + sep)) throw new Error("Export escaped workspace");
        const size = (await stat(output)).size;
        if (size === 0) throw new Error("Completed export is empty");
        const pixelReview = input.review || input.reviewOnly ? await reviewRenderedPixels(output, await readFile(actual, "utf8")) : undefined;
        if (input.reviewOnly) await rm(output, { force: true });
        receipt = { ...receipt, ...(!input.reviewOnly ? { outputPath: relative(root, output).replaceAll(sep, "/"), size } : {}), ...(pixelReview ? { pixelReview } : {}) };
      }
      if (Date.now() - receipt.startedAt > 1800000 && receipt.status === "rendering") throw new Error("Export exceeded the 30-minute limit; check the existing Studio job before retrying.");
    } catch (error) {
      const transient = error instanceof Error && ["TimeoutError", "AbortError", "TypeError"].includes(error.name);
      receipt = { ...receipt, status: transient && Date.now() - receipt.startedAt < 1800000 ? "rendering" : "failed", error: error instanceof Error ? error.message : String(error) };
    }
    await save(receipt);
    if (receipt.status === "complete" || receipt.status === "failed") await uiControlRequest("/video/ensure-studio", { method: "POST", body: { workspaceId: workspace.id, projectId: project, release: true } });
  }
  return { ...receipt, operationKey: input.operationKey, ...(receipt.status === "preparing" || receipt.status === "rendering" ? { pollAfterMs: 2000 } : {}) };
}
