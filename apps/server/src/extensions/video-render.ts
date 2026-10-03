import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, realpath, readdir, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, relative, sep, join } from "node:path";
import { z } from "zod";
import { hyperframesStudioPort } from "@ipollowork/types/hyperframes";
import { ApiError } from "../errors.js";
import { uiControlRequest } from "../ui-control-client.js";
import { resolveWorkspaceFile } from "./storage.js";
import { attribute, numberAttribute, openingTags } from "./video-components.js";

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
  issues: z.array(z.object({ sceneId: z.string(), code: z.string(), time: z.number() })).optional(),
  scope: z.literal("rendered-motion-health-not-semantic-approval").optional(),
  scenes: z.array(z.object({ sceneId: z.string(), sampleTimes: z.array(z.number()), contrast: z.array(z.number()), change: z.array(z.number()) })),
  runtimeReview: z.object({ valid: z.boolean(), scope: z.literal("runtime-timing-and-layout-not-semantic-approval"), sampledFrameCount: z.number().positive(), issues: z.array(z.object({ sceneId: z.string(), code: z.string(), time: z.number(), detail: z.string() })) }).optional(),
  evidence: z.object({ videoPath: z.string(), frames: z.array(z.object({ sceneId: z.string(), frame: z.number(), path: z.string() })), resolution: z.enum(["draft", "export"]), expression: z.literal("unverified"), audibleSync: z.literal("unverified") }).optional(),
  audioReview: z.object({ valid: z.boolean(), scope: z.literal("decoded-mix-health-not-audible-sync-approval"), required: z.boolean(), peakDb: z.number().nullable(), issues: z.array(z.string()), warnings: z.array(z.string()) }).optional(),
});
const receiptSchema = z.object({
  status: z.enum(["preparing", "rendering", "complete", "failed"]),
  startedAt: z.number(), jobId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  studioPort: z.number().int().min(1).max(65_535).optional(),
  progress: z.number().optional(), stage: z.string().optional(), error: z.string().optional(),
  outputPath: z.string().optional(), size: z.number().optional(),
  pixelReview: pixelReviewSchema.optional(),
  sourceHash: z.string().optional(),
});
type Receipt = z.infer<typeof receiptSchema>;
const preparing = new Map<string, Receipt>();
const RENDER_TIMEOUT_MS = 3 * 60 * 60_000;

/** Snapshot the bounded project, including nested composition/media dependencies, not its generated renders. */
export async function videoProjectFingerprint(directory: string) {
  const root = await realpath(directory), hash = createHash("sha256");
  let files = 0, bytes = 0;
  const visit = async (path: string, depth: number) => {
    if (depth > 12) throw new Error("Video project exceeds dependency depth limit");
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", ".DS_Store", "renders", "node_modules"].includes(entry.name)) continue;
      const absolute = join(path, entry.name), actual = await realpath(absolute);
      if (!actual.startsWith(root + sep)) throw new Error("Video dependency escapes project");
      if (entry.isSymbolicLink()) throw new Error("Video dependency symlinks require a project-local copy");
      if (entry.isDirectory()) await visit(absolute, depth + 1);
      else if (entry.isFile()) {
        bytes += (await stat(absolute)).size;
        if (++files > 2048 || bytes > 512 * 1024 * 1024) throw new Error("Video dependency snapshot exceeds 2048 files or 512MB");
        hash.update(JSON.stringify(relative(root, absolute))).update("\0");
        const content = createHash("sha256");
        for await (const chunk of createReadStream(absolute)) content.update(chunk);
        hash.update(content.digest());
      }
    }
  };
  await visit(root, 0);
  return hash.digest("hex");
}

/** Decode the actual output mix. Silence/peak checks cannot prove speech recognition or perceptual synchronization. */
export async function reviewRenderedAudio(videoPath: string, html: string) {
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // A timeline-owned fade may legitimately start at zero; inspect its decoded track anyway.
  const required = openingTags(markup).some(tag => /^<audio\b/i.test(tag) && !/\bmuted(?:\s|=|>)/i.test(tag));
  if (!required) return { valid: true, scope: "decoded-mix-health-not-audible-sync-approval", required, peakDb: null, issues: [], warnings: [] };
  const result = await new Promise<{ error: Error | null; log: string }>(resolve => {
    execFile(process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg", ["-hide_banner", "-nostats", "-i", videoPath, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"],
      { timeout: 120000, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => resolve({ error, log: stderr }));
  });
  const peak = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(result.log)?.[1];
  const peakDb = peak && peak !== "-inf" ? Number(peak) : null;
  const issues = result.error || !peak ? ["required-output-audio-unavailable"] : peakDb === null || peakDb < -60 ? ["required-output-audio-silent"] : [];
  const warnings = peakDb !== null && peakDb >= -.1 ? ["output-peak-near-full-scale-check-clipping"] : [];
  return { valid: issues.length === 0, scope: "decoded-mix-health-not-audible-sync-approval", required, peakDb, issues, warnings };
}

async function saveReviewFrames(videoPath: string, html: string, root: string) {
  const directory = `${videoPath}.review`;
  await mkdir(directory, { recursive: true });
  if (!(await realpath(directory)).startsWith(root + sep)) throw new Error("Review evidence escaped workspace");
  const selected = renderedSceneWindows(html).flatMap(scene => {
    const action = scene.motion[0];
    const times = [action ? scene.start + (action.start + action.end) / 2 : scene.start + scene.duration * .5,
      ...scene.motion.map(event => scene.start + Math.min(event.end, event.start + 1 / 30)),
      scene.start + scene.duration - 1 / 30,
      ...(scene.transitionDuration ? [Math.max(0, scene.start - 1 / 30), scene.start + scene.transitionDuration / 2] : [])];
    return times.map(time => ({ sceneId: scene.sceneId, frame: Math.max(0, Math.round(time * 30)) }));
  });
  const numbers = [...new Set(selected.map(sample => sample.frame))].sort((a, b) => a - b);
  if (!numbers.length || numbers.length > 768) throw new Error("Review requires 1–768 evidence frames");
  await new Promise<void>((resolve, reject) => {
    execFile(process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg", ["-n", "-v", "error", "-i", videoPath, "-vf", `select='${numbers.map(frame => `eq(n\\,${frame})`).join("+")}'`, "-vsync", "0", "-start_number", "0", join(directory, "frame-%03d.png")],
      { timeout: 120000, maxBuffer: 1024 * 1024 }, error => error ? reject(error) : resolve());
  });
  const paths = await Promise.all(numbers.map(async (_frame, index) => {
    const path = join(directory, `frame-${String(index).padStart(3, "0")}.png`);
    if (!(await realpath(path)).startsWith(root + sep) || !(await stat(path)).size) throw new Error("Review frame missing or escaped workspace");
    return relative(root, path).replaceAll(sep, "/");
  }));
  return selected.map(sample => ({ ...sample, path: paths[numbers.indexOf(sample.frame)]! }));
}

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
  return openingTags(html).filter(tag => attribute(tag, "class").split(/\s+/).includes("scene") || /\sdata-scene(?:\s*=|\s|\/?>)/i.test(tag)).flatMap((tag, index) => {
    const start = numberAttribute(tag, "data-start");
    const duration = numberAttribute(tag, "data-duration");
    if (start === null || duration === null || duration <= 0) return [];
    const sceneId = attribute(tag, "id") || `scene-${index + 1}`;
    let rawBeats: unknown = [];
    try { rawBeats = JSON.parse(attribute(tag, "data-ipw-beats") || "[]"); } catch { /* Structure gate reports malformed metadata. */ }
    const beats = z.array(z.object({ animation: z.string(), motion: z.object({ start: z.number().nonnegative(), end: z.number().positive() }) })).max(12).safeParse(rawBeats);
    const motion = beats.success ? beats.data.filter(beat => !beat.animation.startsWith("hold:") && beat.motion.end > beat.motion.start && beat.motion.end <= duration).map(beat => beat.motion) : [];
    return [{ sceneId, start, duration, motion, transitionDuration: Number(attribute(tag, "data-ipw-transition-duration")) || 0 }];
  });
}

function extractRawReviewFrames(videoPath: string, frameNumbers: number[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const select = frameNumbers.map((frame) => `eq(n\\,${frame})`).join("+");
    execFile(process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg", [
      "-v", "error", "-i", videoPath, "-vf", `select='${select}',scale=96:54,format=rgb24`,
      "-vsync", "0", "-f", "rawvideo", "pipe:1",
    ], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 120000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function frameDifference(left: Uint8Array, right: Uint8Array) {
  let difference = 0;
  for (let offset = 0; offset < left.length; offset++) difference += Math.abs(left[offset]! - right[offset]!);
  return difference / left.length / 255;
}

export async function reviewRenderedPixels(videoPath: string, html: string): Promise<z.infer<typeof pixelReviewSchema>> {
  const scenes = renderedSceneWindows(html);
  if (scenes.length > 48) throw new Error("Pixel review supports at most 48 scenes per render.");
  const requests = scenes.flatMap((scene) => [0.15, 0.5, 0.85, ...scene.motion.flatMap(window => [
    Math.max(0, window.start - 1 / 30) / scene.duration, (window.start + window.end) / 2 / scene.duration, Math.min(scene.duration - 1 / 30, window.end) / scene.duration,
  ]), ...(scene.transitionDuration > 0 ? [1 / 30 / scene.duration, scene.transitionDuration / 2 / scene.duration, (scene.transitionDuration + 1 / 30) / scene.duration] : [])].map((position) => ({
    sceneId: scene.sceneId,
    time: Math.max(0, scene.start + scene.duration * position),
  })));
  if (!requests.length) throw new Error("Pixel review could not find timed scenes in the saved composition.");
  const frameNumbers = [...new Set(requests.map((request) => Math.max(0, Math.round(request.time * 30))))].sort((a, b) => a - b);
  const frameIndices = new Map(frameNumbers.map((number, index) => [number, index]));
  const raw = await extractRawReviewFrames(videoPath, frameNumbers);
  const frameBytes = 96 * 54 * 3;
  if (raw.byteLength !== frameNumbers.length * frameBytes) throw new Error(`Pixel review expected ${frameNumbers.length} frames but decoded ${Math.floor(raw.byteLength / frameBytes)}.`);
  const metrics = requests.map((request) => {
    const index = frameIndices.get(Math.max(0, Math.round(request.time * 30)))!;
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
    const samples = metrics.filter((metric) => metric.sceneId === scene.sceneId).sort((a, b) => a.time - b.time);
    const change = samples.slice(1).map((sample, index) => Math.round(frameDifference(sample.frame, samples[index]!.frame) * 10_000) / 10_000);
    return {
      sceneId: scene.sceneId,
      sampleTimes: samples.map((sample) => Math.round(sample.time * 1_000) / 1_000),
      contrast: samples.map((sample) => Math.round(sample.contrast * 100) / 100),
      change,
    };
  });
  const blankSceneIds = reviewedScenes.filter((scene) => scene.contrast.every((contrast) => contrast < 1.5)).map((scene) => scene.sceneId);
  const issues = scenes.flatMap(scene => {
    const samples = metrics.filter(metric => metric.sceneId === scene.sceneId);
    const motionIssues = scene.motion.flatMap((window, index) => {
      const before = samples[3 + index * 3]!;
      const differences = [samples[4 + index * 3]!, samples[5 + index * 3]!].map(sample => frameDifference(before.frame, sample.frame));
      return differences.every(difference => difference < .0005) ? [{ sceneId: scene.sceneId, code: "declared-motion-not-visible", time: scene.start + window.start }] : [];
    });
    const transitionSamples = scene.transitionDuration > 0 ? samples.slice(-3) : [];
    const transitionIssues = transitionSamples.length && transitionSamples.some(sample => sample.contrast < 1.5)
      ? [{ sceneId: scene.sceneId, code: "blank-transition-sample", time: scene.start }] : [];
    return [...motionIssues, ...transitionIssues];
  });
  return { valid: blankSceneIds.length === 0 && issues.length === 0, scope: "rendered-motion-health-not-semantic-approval", sampledFrameCount: frameNumbers.length, blankSceneIds, issues, scenes: reviewedScenes };
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
  const active = preparing.get(receiptPath);
  if (active) return { ...active, operationKey: input.operationKey, pollAfterMs: 2000 };
  const readReceipt = async () => {
    if (!(await realpath(receiptPath)).startsWith(root + sep)) throw new ApiError(400, "path_escape", "Export receipt escapes workspace");
    const text = await readFile(receiptPath, "utf8");
    const active = preparing.get(receiptPath);
    if (active) return active;
    try { return receiptSchema.parse(JSON.parse(text)); }
    catch (error) {
      // A read may have captured the exclusive initial write before it finished.
      if (!(error instanceof SyntaxError)) throw error;
      return receiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
    }
  };
  const save = async (receipt: Receipt) => {
    const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(receipt), "utf8");
      await rename(temporaryPath, receiptPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  };
  const review = async (output: string, studioPort: number, sourceHash?: string) => {
    const base = `http://127.0.0.1:${studioPort}/api`;
    const html = await readFile(actual, "utf8");
    if (!sourceHash || await videoProjectFingerprint(directory) !== sourceHash) throw new Error("Video source changed (including dependencies) during rendering; this output cannot pass delivery review.");
    const response = await fetch(`${base}/projects/${project}/thumbnail/index.html?review=runtime`, { signal: AbortSignal.timeout(60000) }).catch(error => { throw new Error(`Video runtime inspection unavailable; delivery remains a draft: ${error instanceof Error ? error.message : String(error)}`); });
    if (!response.ok) throw new Error(`Video runtime inspection unavailable (HTTP ${response.status}); delivery remains a draft.`);
    const runtimeReview = pixelReviewSchema.shape.runtimeReview.unwrap().parse(await response.json());
    const pixels = await reviewRenderedPixels(output, html);
    const audioReview = await reviewRenderedAudio(output, html);
    const frames = await saveReviewFrames(output, html, root);
    if (await videoProjectFingerprint(directory) !== sourceHash) throw new Error("Video source changed during review; retry acceptance of the saved draft.");
    const issues = [...pixels.issues ?? [], ...runtimeReview.issues, ...audioReview.issues.map(code => ({ sceneId: "mix", code, time: 0 }))];
    return { ...pixelReviewSchema.parse({ ...pixels, valid: pixels.valid && runtimeReview.valid && audioReview.valid, runtimeReview, audioReview,
      evidence: { videoPath: relative(root, output).replaceAll(sep, "/"), frames, resolution: input.reviewOnly ? "draft" : "export", expression: "unverified", audibleSync: "unverified" },
      issues }), issues };
  };
  const completedReceipt = async (receipt: Receipt, studioPort: number): Promise<Receipt> => {
    const output = `${renders}/${receipt.jobId}.mp4`;
    if (!(await realpath(output)).startsWith(root + sep)) throw new Error("Export escaped workspace");
    const size = (await stat(output)).size;
    if (size === 0) throw new Error("Completed export is empty");
    const pixelReview = input.review || input.reviewOnly ? await review(output, studioPort, receipt.sourceHash) : undefined;
    return { ...receipt, ...(pixelReview?.valid === false ? { status: "failed", error: `Video remains a draft: ${pixelReview.issues.map(issue => `${issue.sceneId}: ${issue.code}`).join(", ")}` } : !input.reviewOnly ? { outputPath: relative(root, output).replaceAll(sep, "/"), size } : {}), ...(pixelReview ? { pixelReview } : {}) };
  };
  let receipt: Receipt;
  try { receipt = await readReceipt(); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    const active = preparing.get(receiptPath);
    if (active) return { ...active, operationKey: input.operationKey, pollAfterMs: 2000 };
    if (action !== "video_render_start") throw new ApiError(404, "render_not_found", "No export exists for this operationKey");
    if (preparing.size >= 16) throw new ApiError(429, "render_busy", "Too many exports are preparing");
    receipt = { status: "preparing", startedAt: Date.now(), progress: 0, stage: "Starting bundled Studio" };
    preparing.set(receiptPath, receipt);
    // Exclusive creation makes retries and concurrent requests reuse one job.
    try { await writeFile(receiptPath, JSON.stringify(receipt), { flag: "wx" }); }
    catch (error) {
      preparing.delete(receiptPath);
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return { ...await readReceipt(), operationKey: input.operationKey };
      throw error;
    }
    const initial = receipt;
    void (async () => {
      try {
        const ready = await uiControlRequest("/video/ensure-studio", { method: "POST", timeoutMs: 100000,
          body: { workspaceId: workspace.id, projectId: project } });
        const studio = z.object({ ok: z.literal(true), port: z.number().int().min(1).max(65_535).optional() }).parse(ready);
        const studioPort = studio.port ?? hyperframesStudioPort(project);
        const base = `http://127.0.0.1:${studioPort}/api`;
        const sourceHash = await videoProjectFingerprint(directory);
        const job = z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]+$/) }).parse(await studioJson(`${base}/projects/${project}/render`, {
          format: "mp4",
          quality: input.reviewOnly ? "draft" : "high",
          fps: 30,
          ...(input.reviewOnly ? { captureSize: { width: 640, height: 360 } } : {}),
        }));
        await save({ ...initial, ...job, studioPort, sourceHash, status: "rendering", stage: "Rendering MP4" });
      } catch (error) {
        await save({ ...initial, status: "failed", error: error instanceof Error ? error.message : String(error) });
        await uiControlRequest("/video/ensure-studio", { method: "POST", body: { workspaceId: workspace.id, projectId: project, release: true } });
      } finally { preparing.delete(receiptPath); }
    })().catch(error => console.error("[video-render] receipt persistence failed", error instanceof Error ? error.message : String(error)));
    return { ...receipt, operationKey: input.operationKey, pollAfterMs: 2000 };
  }
  if (receipt.status === "preparing" && !preparing.has(receiptPath)) {
    // The owner can finish while a status read still holds its preparing snapshot.
    receipt = await readReceipt();
    if (receipt.status === "preparing" && !preparing.has(receiptPath)) {
      receipt = { ...receipt, status: "failed", error: "Export preparation was interrupted by a service restart. No automatic duplicate was submitted." };
      await save(receipt);
    }
  }
  if (receipt.status === "complete" && (input.review || input.reviewOnly) && (!receipt.pixelReview?.evidence || receipt.sourceHash !== await videoProjectFingerprint(directory))) {
    receipt = { ...receipt, status: "failed", outputPath: undefined, error: "The saved source changed or this older export has no runtime acceptance evidence; review the current draft again." };
    await save(receipt);
  }
  if (receipt.status === "rendering" && receipt.jobId) {
    const studioPort = receipt.studioPort ?? hyperframesStudioPort(project);
    const base = `http://127.0.0.1:${studioPort}/api`;
    if ((input.review || input.reviewOnly) && receipt.sourceHash
      && await videoProjectFingerprint(directory) !== receipt.sourceHash) {
      receipt = { ...receipt, status: "failed", outputPath: undefined,
        error: "Video source changed (including dependencies) during rendering; this output cannot pass delivery review." };
      await save(receipt);
      await uiControlRequest("/video/ensure-studio", { method: "POST", body: { workspaceId: workspace.id, projectId: project, release: true } });
      return { ...receipt, operationKey: input.operationKey };
    }
    try {
      // Studio removes completed jobs from memory after five minutes. Its
      // persisted metadata remains authoritative after a long continuation.
      const meta = await readFile(`${renders}/${receipt.jobId}.meta.json`, "utf8").then(text => JSON.parse(text)).catch(() => null);
      if (meta?.status === "complete") {
        receipt = await completedReceipt({ ...receipt, status: "complete", progress: 100 }, studioPort);
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
      if (receipt.status === "complete") receipt = await completedReceipt(receipt, studioPort);
      if (Date.now() - receipt.startedAt > RENDER_TIMEOUT_MS && receipt.status === "rendering") throw new Error("Export exceeded the 3-hour limit; check the existing Studio job before retrying.");
    } catch (error) {
      const withinDeadline = Date.now() - receipt.startedAt < RENDER_TIMEOUT_MS;
      const message = error instanceof Error ? error.message : String(error);
      receipt = { ...receipt, status: withinDeadline && !message.includes("source changed") ? "rendering" : "failed", error: message };
    }
    await save(receipt);
    if (receipt.status === "complete" || receipt.status === "failed") await uiControlRequest("/video/ensure-studio", { method: "POST", body: { workspaceId: workspace.id, projectId: project, release: true } });
  }
  return { ...receipt, operationKey: input.operationKey, ...(receipt.status === "preparing" || receipt.status === "rendering" ? { pollAfterMs: 2000 } : {}) };
}
