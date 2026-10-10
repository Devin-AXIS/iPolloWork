import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  VIDEO_ENHANCEMENT_MAX_SECONDS, VIDEO_ENHANCEMENT_MAX_BYTES, videoEnhancementApplySchema, videoEnhancementJobInputSchema,
  videoEnhancementJobSchema, videoEnhancementReadSchema, videoEnhancementResultSchema,
  videoEnhancementStartSchema, type VideoEnhancementJob,
} from "@ipollowork/types/video-enhancement";
import { ApiError } from "../errors.js";
import { resolveWithinRoot } from "../paths.js";
import { resolveBundledTemplatesRoot } from "../templates.js";
import type { ServerConfig } from "../types.js";
import { inspectLocalVideo } from "./video-local-edit.js";
import { workspaceForContext } from "./storage.js";
import { enhancementHtml, placeEnhancementCues } from "./video-enhancement-layout.js";
import models from "./video-enhancement-models.json" with { type: "json" };

export const VIDEO_ENHANCEMENT_EXTENSION_ID = "video-enhancement";
export const VIDEO_ENHANCEMENT_ACTIONS = ["status", "start", "read", "cancel", "apply", "undo"].map(action => ({
  extensionId: VIDEO_ENHANCEMENT_EXTENSION_ID, action, title: `Local video enhancement: ${action}`,
  description: "Offline speech-based video elements with conservative person avoidance; no remote inference or runtime downloads.",
  inputSchema: z.toJSONSchema(action === "start" ? videoEnhancementStartSchema
    : action === "read" ? videoEnhancementReadSchema : action === "apply" ? videoEnhancementApplySchema
      : action === "status" ? z.object({}).strict() : videoEnhancementJobInputSchema),
}));
const live = new Map<string, { job: VideoEnhancementJob; controller: AbortController }>();
const saving = new Set<string>();
let starting = false;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const modelRoot = () => process.env.IPOLLOWORK_VIDEO_MODELS_PATH || fileURLToPath(new URL("../../models/", import.meta.url));
export async function localEnhancementStatus() {
  const available = await Promise.all(models.map(async model => {
    const files = await Promise.all(model.files.map(file => stat(join(modelRoot(), model.id, file.path)).then(value => value.isFile() && value.size > 0).catch(() => false)));
    return { capability: model.capability, ready: files.every(Boolean) };
  }));
  const ready = available.filter(model => model.capability === "speech" || model.capability === "people").every(model => model.ready);
  const gesturesReady = available.some(model => model.capability === "gestures" && model.ready);
  const segmentationReady = available.some(model => model.capability === "segmentation" && model.ready);
  return { ready, gesturesReady, segmentationReady, message: ready
    ? `本地语音与人物模型已就绪，可断网分析。${gesturesReady ? "手势模型已就绪。" : "缺少手势模型，可关闭手势定位继续。"}${segmentationReady ? "人物分割模型已就绪。" : "缺少分割模型，可关闭精细避让继续。"}${gesturesReady && segmentationReady ? "" : "开发环境运行 pnpm --filter ipollowork-server prepare:video-models。"}`
    : "缺少本地语音或人物模型。请安装含模型的完整版本；开发环境运行 pnpm --filter ipollowork-server prepare:video-models。分析不会联网下载或调用云端 API。" };
}
async function save(path: string, value: VideoEnhancementJob) {
  const partial = path + "." + randomUUID() + ".partial";
  try { await writeFile(partial, JSON.stringify(value), { flag: "wx" }); await rename(partial, path); }
  finally { await rm(partial, { force: true }); }
}
async function run(jobPath: string, job: VideoEnhancementJob, input: string, directory: string, language: string, useGestures: boolean, useSegmentation: boolean, controller: AbortController) {
  const item = { job, controller };
  live.set(jobPath, item);
  const timer = setTimeout(() => controller.abort(), 30 * 60_000);
  try {
    const worker = fileURLToPath(new URL(`./video-enhancement-worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url));
    const child = spawn(process.execPath, [worker, input, directory, modelRoot(), language, useGestures ? "gestures" : "speech", useSegmentation ? "contour" : "boxes"], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    // Stop decoding children as well, so cancellation releases CPU and files.
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === "win32") execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, timeout: 5000 }, error => { if (error) child.kill(); });
      else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); } }
    };
    controller.signal.addEventListener("abort", stop, { once: true });
    child.once("close", () => controller.signal.removeEventListener("abort", stop));
    let output: unknown;
    let protocolError = false;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", line => {
      try {
        // 721 fixed 64x64 masks plus bounded hand/person samples fit below 4 MiB.
        if (line.length > 4 * 1024 * 1024) throw new Error("Output too large");
        const data = z.object({ progress: z.number().min(0).max(100).optional(), message: z.string().max(300).optional(), result: videoEnhancementResultSchema.optional() }).parse(JSON.parse(line));
        if (data.result) output = data.result;
        if (data.progress !== undefined) item.job = { ...item.job, progress: data.progress, message: data.message ?? item.job.message };
      } catch { protocolError = true; child.kill(); }
    });
    let diagnostic = "";
    child.stderr.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-8192); });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 && !protocolError ? resolve() : reject(new Error(diagnostic || `Analysis process exited with code ${code}; invalid output: ${protocolError}`)));
    });
    const result = videoEnhancementResultSchema.parse(output);
    item.job = { ...item.job, result, status: "ready", progress: 100, message: "本地分析完成，请检查建议后应用。" };
  } catch (error) {
    if (!controller.signal.aborted) {
      const diagnostic = (error instanceof Error ? error.message : String(error)).slice(-8192);
      await writeFile(join(directory, "diagnostic.txt"), diagnostic).catch(() => undefined);
      console.warn("[video-enhancement] Analysis failed", job.id, diagnostic);
    }
    item.job = { ...item.job, status: controller.signal.aborted ? "cancelled" : "failed", message: controller.signal.aborted
      ? "分析已取消或超时，原视频与当前时间轴未更改。" : `本地分析在“${item.job.message}”阶段失败，错误记录保留在任务目录；原视频与当前时间轴未更改。` };
  } finally {
    clearTimeout(timer);
    // Intermediate decoded media is not a deliverable, including on cancellation.
    const names = await readdir(directory).catch(() => []);
    await Promise.all(names.filter(name => name === "audio.f32" || /^frame-\d{4}\.jpg$/.test(name)).map(name => rm(join(directory, name), { force: true })));
    try { await save(jobPath, item.job); }
    finally { live.delete(jobPath); }
  }
}

export async function callVideoEnhancementAction(config: ServerConfig, action: string, raw: unknown, context: Record<string, unknown>) {
  if (action === "status") return { ok: true, result: await localEnhancementStatus() };
  if (!["start", "read", "cancel", "apply", "undo"].includes(action)) throw new ApiError(404, "enhancement_action", "未知增强操作。");
  if (config.readOnly && action !== "read") throw new ApiError(403, "read_only", "当前工作区为只读。");
  if (typeof context.workspaceId !== "string" || !context.workspaceId) throw new ApiError(400, "workspace_required", "请选择当前工作区。");
  const workspace = workspaceForContext(config, context, { strictWorkspaceId: true });
  const input = action === "start" ? videoEnhancementStartSchema.parse(raw)
    : action === "apply" ? videoEnhancementApplySchema.parse(raw) : videoEnhancementReadSchema.parse(raw);
  if (context.sessionId !== input.sessionId) throw new ApiError(403, "enhancement_session", "增强操作必须属于当前视频会话。");
  const project = `video/${input.sessionId}`;
  await resolveWithinRoot(workspace.path, project);
  const directory = await resolveWithinRoot(workspace.path, project, "enhancement");
  if (action === "start") {
    if (starting || live.size >= 1) throw new ApiError(409, "enhancement_busy", "已有本地分析正在运行，请等待完成或取消。");
    starting = true;
    try {
    const start = videoEnhancementStartSchema.parse(raw);
    if (!start.sourcePath.startsWith(`${project}/assets/`) || !/^video\/[\w-]+\/assets\/[\w.-]+\.(mp4|mov|webm)$/i.test(start.sourcePath)) throw new ApiError(400, "enhancement_source", "请选择当前视频会话上传的视频。");
    const modelStatus = await localEnhancementStatus();
    if (!modelStatus.ready || start.useGestures && !modelStatus.gesturesReady || start.useSegmentation && !modelStatus.segmentationReady) throw new ApiError(503, "enhancement_models_missing", modelStatus.message);
    if (live.size >= 1) throw new ApiError(409, "enhancement_busy", "已有本地分析正在运行，请等待完成或取消。");
    const source = await resolveWithinRoot(workspace.path, start.sourcePath);
    const info = await inspectLocalVideo(workspace, start.sourcePath, VIDEO_ENHANCEMENT_MAX_BYTES);
    if (!info.hasAudio) throw new ApiError(400, "enhancement_no_audio", "视频没有音轨，无法依据讲话生成元素。");
    if (info.duration > VIDEO_ENHANCEMENT_MAX_SECONDS) throw new ApiError(400, "enhancement_duration", "首版支持 3 分钟以内的视频。");
    const entry = await resolveWithinRoot(workspace.path, project, "index.html");
    const before = await readFile(entry, "utf8");
    const job: VideoEnhancementJob = { id: randomUUID(), sessionId: start.sessionId, sourcePath: start.sourcePath,
      status: "running", progress: 0, message: "准备本地分析", createdAt: Date.now(), baseRevision: hash(before) };
    const jobDirectory = join(directory, job.id);
    await mkdir(jobDirectory, { recursive: true });
    await copyFile(entry, join(jobDirectory, "before.html"));
    await save(join(jobDirectory, "job.json"), job);
    await writeFile(join(directory, "latest.json"), JSON.stringify({ id: job.id }));
    void run(join(jobDirectory, "job.json"), job, source, jobDirectory, start.language, start.useGestures, start.useSegmentation, new AbortController()).catch(() => undefined);
    return { ok: true, result: job };
    } finally { starting = false; }
  }
  let jobId = "jobId" in input ? input.jobId : undefined;
  if (!jobId) {
    const latest = await readFile(join(directory, "latest.json"), "utf8").catch(() => null);
    if (!latest) return { ok: true, result: null };
    jobId = z.object({ id: z.uuid() }).parse(JSON.parse(latest)).id;
  }
  const jobDirectory = await resolveWithinRoot(workspace.path, project, "enhancement", jobId);
  const jobPath = await resolveWithinRoot(workspace.path, project, "enhancement", jobId, "job.json");
  const current = live.get(jobPath);
  const job = current?.job ?? videoEnhancementJobSchema.parse(JSON.parse(await readFile(jobPath, "utf8")));
  if (job.sessionId !== input.sessionId || job.id !== jobId) throw new ApiError(403, "enhancement_owner", "分析结果不属于当前会话。");
  if (!current && job.status === "running") { job.status = "failed"; job.message = "分析因软件退出而中断，请重新分析。"; }
  if (action === "read") return { ok: true, result: job };
  if (action === "cancel") {
    videoEnhancementJobInputSchema.parse(raw);
    current?.controller.abort();
    return { ok: true, result: current ? { ...job, status: "cancelled", message: "正在停止本地分析…" } : job };
  }
  if (saving.has(directory)) throw new ApiError(409, "enhancement_saving", "正在保存当前视频，请稍后重试。");
  saving.add(directory);
  try {
    const entry = await resolveWithinRoot(workspace.path, project, "index.html");
    const source = await readFile(entry, "utf8");
    if (action === "undo") {
      videoEnhancementJobInputSchema.parse(raw);
      if (job.status !== "applied" || hash(source) !== job.appliedRevision) throw new ApiError(409, "enhancement_revision", "时间轴已更改，不能直接恢复覆盖。");
      const before = await readFile(await resolveWithinRoot(workspace.path, project, "enhancement", jobId, "before.html"), "utf8");
      const temporary = join(jobDirectory, "restored.html");
      await writeFile(temporary, before);
      if (hash(await readFile(entry, "utf8")) !== job.appliedRevision) throw new ApiError(409, "enhancement_revision", "时间轴已更改，不能直接恢复覆盖。");
      await rename(temporary, entry);
      job.status = "ready"; delete job.appliedRevision;
      job.message = "已恢复增强前的时间轴。";
    } else {
      const apply = videoEnhancementApplySchema.parse(raw);
      if (job.status === "applied" && hash(source) === job.appliedRevision) return { ok: true, result: job };
      if (job.status !== "ready" || !job.result) throw new ApiError(409, "enhancement_not_ready", "分析尚未完成。");
      if (hash(source) !== job.baseRevision) throw new ApiError(409, "enhancement_revision", "分析后时间轴已更改，请重新分析以保留最新修改。");
      const ids = new Set(job.result.cues.map(cue => cue.id));
      if (new Set(apply.cues.map(cue => cue.id)).size !== apply.cues.length || apply.cues.some(cue => !ids.has(cue.id))) throw new ApiError(400, "enhancement_cues", "元素编号无效或重复。");
      const cues = placeEnhancementCues(apply.cues, job.result);
      if (!cues.some(cue => cue.enabled && cue.rect)) throw new ApiError(422, "enhancement_no_space", "没有可安全应用的元素，请缩短文字或调整展示时间。");
      const html = enhancementHtml({ ...job.result, cues }, `enhancement/${job.id}/original.mp4`);
      const media = await stat(await resolveWithinRoot(workspace.path, project, "enhancement", jobId, "original.mp4"));
      if (!media.isFile() || !media.size) throw new ApiError(422, "enhancement_media_missing", "分析视频已丢失，请重新分析。");
      await copyFile(join(resolveBundledTemplatesRoot(), "ipollowork.hyperframes.course-journey", "assets", "gsap.min.js"), await resolveWithinRoot(workspace.path, project, "assets", "gsap.min.js"));
      // Compare again after I/O; never silently overwrite an intervening edit.
      if (hash(await readFile(entry, "utf8")) !== job.baseRevision) throw new ApiError(409, "enhancement_revision", "时间轴已更改，请重新分析。");
      const temporary = join(jobDirectory, "applied.html");
      await writeFile(temporary, html);
      await rename(temporary, entry);
      job.status = "applied"; job.appliedRevision = hash(html); job.result = { ...job.result, cues };
      job.message = "已应用到时间轴，原视频与增强前时间轴已保留。";
    }
    await save(jobPath, job);
    return { ok: true, result: job };
  } finally { saving.delete(directory); }
}
