import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, realpath, stat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { z } from "zod";
import { hyperframesStudioPort } from "@ipollowork/types/hyperframes";
import { ApiError } from "../errors.js";
import { uiControlRequest } from "../ui-control-client.js";
import { resolveWorkspaceFile } from "./storage.js";

export const videoRenderInput = z.object({
  sourcePath: z.string().regex(/^video\/[A-Za-z0-9_-]+\/index\.html$/),
  operationKey: z.string().trim().min(1).max(160),
}).strict();
const receiptSchema = z.object({
  status: z.enum(["preparing", "rendering", "complete", "failed"]),
  startedAt: z.number(), jobId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  progress: z.number().optional(), stage: z.string().optional(), error: z.string().optional(),
  outputPath: z.string().optional(), size: z.number().optional(),
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
        const job = z.object({ jobId: z.string().regex(/^[A-Za-z0-9_-]+$/) }).parse(await studioJson(`${base}/projects/${project}/render`, { format: "mp4", quality: "high", fps: 30 }));
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
        receipt = { ...receipt, status: "complete", progress: 100, outputPath: relative(root, output).replaceAll(sep, "/"), size };
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
        receipt = { ...receipt, outputPath: relative(root, output).replaceAll(sep, "/"), size };
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
