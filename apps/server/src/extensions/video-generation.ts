import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import { classifyProviderFailure, serviceErrorMessage } from "@ipollowork/types/provider-errors";
import { ApiError, providerApiError } from "../errors.js";
import { createAuthorizationAccess, type AuthorizationAccess } from "../authorization-center.js";
import { resolveWithinRoot } from "../paths.js";
import { readLimitedRequestBody } from "../limited-request-body.js";
import { workspaceIdForPluginContext } from "../plugin-service-runtime.js";
import { providerFetch } from "../provider-fetch.js";
import { recordSessionArtifact, sessionArtifactOwner } from "../session-artifacts.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { claimVideoJobs, createVideoJob, getVideoJob, listVideoJobs, updateVideoJob, type VideoJob } from "./video-jobs.js";
import { storageStatus, uploadWorkspaceFile } from "./storage.js";
import { inspectLocalVideo, localVideoEditSchema, saveLocalVideo } from "./video-local-edit.js";

export const VIDEO_GENERATION_EXTENSION_ID = "video-generation";
const ARK = "https://ark.cn-beijing.volces.com/api/v3";
const RH = "https://www.runninghub.ai";
const H3_WORKFLOW = "2097511747551842305";
const MAX_OUTPUT = 256 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const operations = z.enum(["text", "first", "first-last", "reference", "edit", "extend", "regenerate"]);
const modelId = z.enum(["seedance-2.5", "minimax-h3"]);
const ratios = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const catalog = [
  {
    id: "seedance-2.5", label: "Seedance 2.5 · 火山引擎 Ark", service: "volcengine-video", key: "ARK_API_KEY",
    upstream: "doubao-seedance-2-5-260628", resolutions: ["480p", "720p", "1080p"], defaultResolution: "720p",
    ratios,
    durations: ["-1", ...Array.from({ length: 27 }, (_, i) => String(i + 4))],
    operations: ["text", "first", "first-last", "reference", "edit", "extend"],
    imageLimit: 30, videoLimit: 10, audioLimit: 10, referenceSeconds: 30,
  },
  {
    id: "minimax-h3", label: "MiniMax H3 · RunningHub 工作流", service: "runninghub-video", key: "RUNNINGHUB_API_KEY",
    upstream: H3_WORKFLOW, resolutions: ["0.5MP", "1MP"], defaultResolution: "0.5MP",
    ratios: ratios.filter(ratio => ratio !== "adaptive"),
    durations: Array.from({ length: 11 }, (_, i) => String(i + 5)),
    operations: ["text", "first", "first-last"],
    imageLimit: 0, videoLimit: 0, audioLimit: 0, referenceSeconds: 0,
  },
];
// Source of truth for both the inspector and validation. Do not send unsupported knobs.
// Ark: https://www.volcengine.com/docs/82379/1520757
// H3: https://www.runninghub.cn/post/2097511747551842305 (native 25-step workflow).
export function videoModelDefinition(id: string) {
  const model = catalog.find(item => item.id === id);
  if (!model) throw new ApiError(400, "video_model_invalid", "请选择已支持的视频模型。");
  return model;
}

const submissionSchema = z.object({
  requestId: z.uuid(), model: modelId, operation: operations, prompt: z.string().trim().min(1).max(8000),
  resolution: z.string(), duration: z.string(), ratio: z.string(),
  firstFrame: z.string().max(4096).default(""), lastFrame: z.string().max(4096).default(""),
  imageRefs: z.string().max(125000).default(""), videoRefs: z.string().max(42000).default(""), audioRefs: z.string().max(42000).default(""),
  generateAudio: z.enum(["true", "false"]).optional(), watermark: z.enum(["true", "false"]).optional(),
}).strict();
type Submission = z.infer<typeof submissionSchema>;
function fail(message: string): never { throw new ApiError(400, "video_invalid_parameters", message); }
function lines(text: string) { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean); }
function isReference(operation: string) { return ["reference", "edit", "extend", "regenerate"].includes(operation); }
export function validateVideoSubmission(input: unknown): Submission {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) fail("视频参数无效，请检查提示词和参数类型。");
  const args = parsed.data;
  const model = videoModelDefinition(args.model);
  if (!model.operations.includes(args.operation)) fail("当前模型不支持此操作。");
  const allowedRatios = ["first", "first-last", "edit", "extend"].includes(args.operation) ? ["adaptive"] : model.ratios;
  if (!model.resolutions.includes(args.resolution) || !model.durations.includes(args.duration) || !allowedRatios.includes(args.ratio)) fail("所选分辨率、时长或画幅不受当前模型支持。");
  if (["first", "first-last", "edit", "extend"].includes(args.operation) && args.ratio !== "adaptive") fail("首帧、编辑和延长操作的画幅必须跟随输入素材。");
  if (args.operation === "edit" && args.duration !== "-1") fail("Seedance 视频编辑的时长必须跟随原视频。");
  if (["first", "first-last"].includes(args.operation) !== Boolean(args.firstFrame.trim())) fail("首帧模式需要首帧图片；其他模式请使用参考素材。");
  if ((args.operation === "first-last") !== Boolean(args.lastFrame.trim())) fail("首尾帧模式需要尾帧图片；其他模式不支持尾帧。");
  const images = lines(args.imageRefs), videos = lines(args.videoRefs), audio = lines(args.audioRefs);
  if (images.length > model.imageLimit || videos.length > model.videoLimit || audio.length > model.audioLimit) fail("参考素材数量超过当前模型限制。");
  if (!isReference(args.operation) && images.length + videos.length + audio.length) fail("当前操作不接受多模态参考素材。");
  if (isReference(args.operation) && !images.length && !videos.length && !audio.length) fail("请先添加参考素材。");
  if (["edit", "extend", "regenerate"].includes(args.operation) && !videos.length) fail("请添加原视频作为参考视频。");
  if (args.model === "minimax-h3" && args.generateAudio !== undefined) fail("H3 工作流不提供音频开关参数。");
  if (args.model === "minimax-h3" && args.watermark !== undefined) fail("H3 工作流不提供水印开关参数。");
  return args;
}

const stringProperty = { type: "string" };
export const VIDEO_GENERATION_EXTENSION_ACTIONS = [
  { action: "status", title: "Video models", effect: "read", properties: {} },
  { action: "jobs", title: "Session video tasks", effect: "read", properties: { before: { type: "number" } } },
  { action: "submit", title: "Generate or edit video", effect: "write", properties: Object.fromEntries(Object.keys(submissionSchema.shape).map(key => [key, stringProperty])) },
  { action: "recover", title: "Resume an existing video task without resubmitting", effect: "write", properties: { id: stringProperty, upstreamId: stringProperty } },
  { action: "import", title: "Import video console media", effect: "write", properties: { filename: stringProperty, dataUrl: stringProperty } },
  { action: "read", title: "Read a bounded workspace media chunk", effect: "read", properties: { path: stringProperty, offset: { type: "number" } } },
  { action: "inspect", title: "Inspect a local video for toolbar editing", effect: "read", properties: { path: stringProperty } },
  { action: "local-edit", title: "Save local toolbar video edits without AI", effect: "write", properties: z.toJSONSchema(localVideoEditSchema).properties ?? {} },
].map(action => ({ extensionId: VIDEO_GENERATION_EXTENSION_ID, action: action.action, title: action.title,
  description: action.title, effect: action.effect === "read" ? "read" as const : "write" as const,
  inputSchema: { type: "object", properties: action.properties, additionalProperties: false } }));

async function credential(authorization: AuthorizationAccess, model: string) {
  const values = await authorization.read(model === "seedance-2.5" ? "volcengine-video" : "runninghub-video");
  const key = values[videoModelDefinition(model).key]?.trim();
  if (!key) throw new ApiError(400, "video_not_authorized", "请先在授权中心绑定该模型的服务。");
  return key;
}
const object = z.record(z.string(), z.unknown());
function workflowData(value: unknown): unknown {
  const result = z.object({ code: z.number(), msg: z.string().optional(), data: z.unknown().optional() }).parse(value);
  if (result.code !== 0) {
    throw new ApiError(400, "video_workflow_rejected", `RunningHub 工作流请求被拒绝（${result.code}）：${result.msg || "请检查账户权限、余额和工作流可用性。"}`);
  }
  return result.data;
}
function safeError(value: unknown, key = "") {
  let message = classifyProviderFailure(value)?.message ?? (value instanceof z.ZodError
    ? "第三方服务暂时不可用，请稍后重试。" : serviceErrorMessage(value, "第三方服务暂时不可用，请稍后重试。"));
  if (key) message = message.replaceAll(key, "[redacted]");
  return message.replace(/https?:\/\/[^\s"<>]+/g, "[服务链接]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 700);
}
async function jsonRequest(url: string, key: string, body?: unknown, signal?: AbortSignal) {
  const response = await providerFetch(url, { method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) });
  const bytes = await readLimitedRequestBody(response, 2 * 1024 * 1024, { code: "video_response_too_large", message: "视频接口响应过大，请从服务商控制台检查任务。" });
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw providerApiError({}, response.ok ? 502 : response.status); }
  const validated = object.safeParse(parsed);
  if (!validated.success) throw providerApiError({}, response.ok ? 502 : response.status);
  const data = validated.data;
  if (!response.ok) {
    const error = object.safeParse(data.error);
    throw providerApiError(error.success ? error.data : data, response.status);
  }
  return data;
}

const mimeTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
async function mediaFile(workspace: WorkspaceInfo, path: string) {
  if (!path || path.includes(":") || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) fail("素材路径必须是当前工作区内的相对路径。");
  const mime = mimeTypes[extname(path).toLowerCase()];
  if (!mime) fail("素材格式不受支持。请使用 PNG/JPG/WebP、MP4/MOV 或 MP3/WAV。");
  const absolute = await resolveWithinRoot(workspace.path, path);
  const info = await stat(absolute);
  if (!info.isFile() || info.size === 0) fail("素材必须是非空文件。");
  return { absolute, mime, size: info.size };
}
async function sessionDirectory(workspace: WorkspaceInfo, sessionId: string, kind: "assets" | "renders") {
  // Resolve each existing parent before creating children; a symlinked ancestor may not escape.
  let path = "";
  for (const component of ["video", sessionId, kind]) {
    path += `${path ? "/" : ""}${component}`;
    await mkdir(await resolveWithinRoot(workspace.path, path), { recursive: false }).catch(error => {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    });
    await resolveWithinRoot(workspace.path, path);
  }
  return path;
}
function httpsUrl(value: string) {
  const parsed = z.url().safeParse(value);
  if (!parsed.success) fail("请输入公开 HTTPS 素材链接，或工作区相对路径。");
  const url = new URL(parsed.data);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || /^\d|^\[/.test(url.hostname) || /\.(local|localhost|internal)$/.test(url.hostname)) fail("素材链接必须是公开 HTTPS 地址。");
  return url.toString();
}
async function sourceUrl(workspace: WorkspaceInfo, source: string, kind: "image" | "video" | "audio", model: string, key: string, consume: (bytes: number) => void, config: ServerConfig, authorization: AuthorizationAccess, signal: AbortSignal) {
  if (model === "seedance-2.5" && /^asset:\/\/[a-zA-Z0-9_-]+$/.test(source)) return source;
  if (source.startsWith("https://")) return httpsUrl(source);
  const file = await mediaFile(workspace, source);
  if (!file.mime.startsWith(`${kind}/`)) fail("参考素材的文件类型不匹配。");
  if (file.size > (kind === "image" ? 30 : kind === "audio" ? 15 : 50) * 1024 * 1024) fail("素材太大：图片最多 30 MB，音频 15 MB，视频 50 MB。");
  if (model === "seedance-2.5" && kind === "video") {
    if (!(await storageStatus(authorization)).defaultProvider) fail("Ark 本地视频参考需要授权中心配置默认 OSS/Wasabi 存储，或改用公开 HTTPS 链接 / asset://素材ID。");
    const uploaded = await uploadWorkspaceFile(config, authorization, { sourcePath: source, objectKey: `ipollowork/video-references/${workspace.id}/${randomUUID()}${extname(source)}` }, { directory: workspace.path }, 86400);
    if (!uploaded.signedReadUrl) throw new Error("无法获取参考视频的授权读取链接。");
    return uploaded.signedReadUrl;
  }
  if (model === "seedance-2.5") consume(file.size);
  const bytes = await readFile(file.absolute);
  if (model === "seedance-2.5") return `data:${file.mime};base64,${bytes.toString("base64")}`;
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: file.mime }), basename(source));
  form.set("apiKey", key); form.set("fileType", "input");
  const response = await providerFetch(`${RH}/task/openapi/upload`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  const payload = JSON.parse(new TextDecoder().decode(await readLimitedRequestBody(response, 64 * 1024)));
  if (!response.ok) throw providerApiError(payload, response.status);
  return z.object({ fileName: z.string().regex(/^[a-zA-Z0-9_/-]+\.(png|jpe?g|webp)$/i) }).parse(workflowData(payload)).fileName;
}

// Fetch the published graph before billing, verify the bindings, and replace only
// the selected inputs. No local model execution or secret is embedded in the graph.
async function h3Workflow(args: Submission, key: string, first: string, last: string, signal: AbortSignal) {
  const data = workflowData(await jsonRequest(`${RH}/api/openapi/getJsonApiFormat`, key, { apiKey: key, workflowId: H3_WORKFLOW }, signal));
  const { prompt } = z.object({ prompt: z.string() }).parse(data);
  const graph = z.record(z.string(), z.object({ class_type: z.string(), inputs: z.record(z.string(), z.unknown()) }).passthrough()).parse(JSON.parse(prompt));
  const node = (id: string, type: string) => {
    if (graph[id]?.class_type !== type) throw new ApiError(400, "video_workflow_changed", "H3 公开工作流的节点已变更，请更新软件后重试；尚未提交生成。");
    return graph[id].inputs;
  };
  const target = node("17", "MiniMaxH3ImageToVideo");
  const output = node("7", "SaveVideo");
  const sampler = node("11", "SamplerCustomAdvanced");
  const guider = node("10", "BasicGuider");
  if (JSON.stringify(sampler.latent_image) !== '["17",1]' || JSON.stringify(guider.conditioning) !== '["17",0]'
    || typeof target.prompt !== "string" || node("3", "CLIPLoader").type !== "minimax"
    || node("9", "BasicScheduler").steps !== 25) {
    throw new ApiError(400, "video_workflow_changed", "H3 工作流的模型或生成连接已变化，已停止提交以避免错误生成。");
  }
  // This published text-to-video graph has no image loaders. Add them only for frame modes.
  if (["24", "25", "300", "301"].some(id => graph[id])) throw new ApiError(400, "video_workflow_changed", "H3 工作流节点编号已变化，请更新软件后重试。");
  target.prompt = args.prompt;
  // Explicit conditioning: never retain the author's prompt, duration or reference images.
  const frames = Math.max(5, Math.round(Number(args.duration) * 24));
  target.length = frames + (5 - frames % 17 + 17) % 17;
  node("16", "RandomNoise").noise_seed = Number.parseInt(args.requestId.replaceAll("-", "").slice(0, 12), 16);
  output.format = "mp4"; output.codec = "h264";
  const megapixels = args.resolution === "1MP" ? 1 : 0.5;
  const imageNode = (id: string, path: string) => {
    // The documented URL loader downloads on RunningHub, never on the local server.
    graph[id] = { class_type: path.startsWith("https://") ? "LoadImageFromUrl" : "LoadImage", inputs: { image: path } };
  };
  if (first) {
    imageNode("24", first);
    graph["300"] = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["24", 0], megapixels, resolution_steps: 32, upscale_method: "nearest-exact" } };
    graph["301"] = { class_type: "GetImageSize", inputs: { image: ["300", 0] } };
    target.first_frame = ["300", 0]; target.width = ["301", 0]; target.height = ["301", 1];
  } else {
    delete target.first_frame;
    const [width, height] = args.ratio.split(":").map(Number);
    target.width = Math.round(Math.sqrt(megapixels * 1_000_000 * width / height) / 32) * 32;
    target.height = Math.round(Math.sqrt(megapixels * 1_000_000 * height / width) / 32) * 32;
  }
  if (last) { imageNode("25", last); target.last_frame = ["25", 0]; }
  else delete target.last_frame;
  // Submit only the selected output's dependency graph; disconnected demo media is excluded.
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    if (!graph[id]) throw new ApiError(400, "video_workflow_changed", "H3 工作流缺少生成节点，尚未提交。");
    reachable.add(id);
    for (const value of Object.values(graph[id].inputs)) if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number") visit(value[0]);
  };
  visit("7");
  if (!reachable.has("17")) throw new ApiError(400, "video_workflow_changed", "H3 输出未连接当前生成节点，尚未提交。");
  const workflow = Object.fromEntries(Object.entries(graph).filter(([id]) => reachable.has(id)));
  const nodeInfoList = [{ nodeId: "17", fieldName: "prompt", fieldValue: args.prompt }];
  return { url: `${RH}/task/openapi/create`, body: { apiKey: key, workflowId: H3_WORKFLOW, workflow: JSON.stringify(workflow), nodeInfoList, instanceType: "plus", addMetadata: false } };
}
export async function videoRequest(workspace: WorkspaceInfo, args: Submission, key: string, config: ServerConfig, authorization: AuthorizationAccess) {
  const signal = AbortSignal.timeout(120_000);
  let inputBytes = 0;
  const consume = (bytes: number) => { inputBytes += bytes; if (inputBytes > 45 * 1024 * 1024) fail("图片和音频参考合计超过 45 MB，请减少素材或改用公开链接。"); };
  const source = async (path: string, kind: "image" | "video" | "audio") => {
    signal.throwIfAborted();
    const url = await sourceUrl(workspace, path, kind, args.model, key, consume, config, authorization, signal);
    signal.throwIfAborted();
    return url;
  };
  const refs = async (text: string, kind: "image" | "video" | "audio") => {
    const urls: string[] = [];
    // Bound memory and upload concurrency for large multimodal requests.
    for (const path of lines(text)) urls.push(await source(path, kind));
    return urls;
  };
  const first = args.firstFrame ? await source(args.firstFrame, "image") : "";
  const last = args.lastFrame ? await source(args.lastFrame, "image") : "";
  const images = await refs(args.imageRefs, "image"), videos = await refs(args.videoRefs, "video"), audio = await refs(args.audioRefs, "audio");
  if (args.model === "seedance-2.5") {
    const content: unknown[] = [{ type: "text", text: args.prompt }];
    if (first) content.push({ type: "image_url", image_url: { url: first }, role: "first_frame" });
    if (last) content.push({ type: "image_url", image_url: { url: last }, role: "last_frame" });
    for (const url of images) content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    for (const url of videos) content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
    for (const url of audio) content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
    return { url: `${ARK}/contents/generations/tasks`, body: { model: videoModelDefinition(args.model).upstream, content,
      resolution: args.resolution, ratio: args.ratio, duration: Number(args.duration), output_format: "mp4",
      generate_audio: args.generateAudio !== "false", watermark: args.watermark !== "false",
      ...(isReference(args.operation) ? { omni_reference_task_type: args.operation } : {}) } };
  }
  return h3Workflow(args, key, first, last, signal);
}

async function saveOutput(config: ServerConfig, workspace: WorkspaceInfo, job: VideoJob, url: string, signal: AbortSignal) {
  const parsed = new URL(httpsUrl(url));
  const domains = job.model === "seedance-2.5" ? ["volces.com", "volccdn.com", "byteimg.com"] : ["myqcloud.com", "runninghub.ai", "runninghub.cn", "aliyuncs.com", "rh-images.xiaoyaoyou.com"];
  if (!domains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) throw new Error("服务商返回了未受信任的视频下载域名，请联系管理员检查接口。");
  const path = `${await sessionDirectory(workspace, job.sessionId, "renders")}/${job.id}.mp4`;
  const destination = await resolveWithinRoot(workspace.path, path);
  const existing = await stat(destination).catch(() => null);
  if (!existing) {
    const response = await providerFetch(parsed, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    if (!response.ok || !response.body) throw new Error(`视频下载失败（HTTP ${response.status}），可以重试保存，无需重新生成。`);
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_OUTPUT) { await response.body.cancel(); throw new Error("视频超过 256 MB，请从服务商控制台下载。"); }
    const partial = `${destination}.${randomUUID()}.partial`;
    const file = await open(partial, "wx");
    let size = 0;
    let header = Buffer.alloc(0);
    try {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_OUTPUT) throw new Error("视频超过 256 MB，请从服务商控制台下载。");
          if (header.length < 12) header = Buffer.concat([header, value.subarray(0, 12 - header.length)]);
          await file.writeFile(value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      if (!size) throw new Error("服务商返回了空视频。");
      if (header.length < 12 || header.subarray(4, 8).toString() !== "ftyp") throw new Error("服务商未返回有效 MP4 视频。");
      await file.sync();
      await file.close();
      await rename(partial, destination);
    } finally { await file.close().catch(() => undefined); await rm(partial, { force: true }); }
  } else if (!existing.isFile() || existing.size === 0) throw new Error("产出路径已存在异常文件，不能覆盖。");
  await recordSessionArtifact(config, workspace, job.sessionId, path);
  return path;
}

async function pollH3Workflow(job: VideoJob, key: string, signal: AbortSignal) {
  const request = { apiKey: key, taskId: job.upstreamId };
  const status = z.string().parse(workflowData(await jsonRequest(`${RH}/task/openapi/status`, key, request, signal))).toLowerCase();
  if (!["success", "failed"].includes(status)) return { status };
  const result = await jsonRequest(`${RH}/task/openapi/outputs`, key, request, signal);
  if (status === "failed") return { status, errorCode: result.code, errorMessage: result.msg || "H3 工作流生成失败，请在 RunningHub 查看任务详情。" };
  const outputs = z.array(z.object({ fileUrl: z.string(), fileType: z.string(), nodeId: z.string() })).parse(workflowData(result));
  // Persisted jobs from the previous native workflow still finish on node 7.
  const outputNode = [H3_WORKFLOW, "2084511826766811137"].includes(job.workflowId ?? "") ? "7" : "92";
  const video = outputs.find(item => item.nodeId === outputNode && item.fileType.toLowerCase() === "mp4");
  if (!video) throw new Error("H3 工作流没有返回视频保存节点的 MP4 文件，请在 RunningHub 查看任务详情。");
  return { status, results: [{ url: video.fileUrl }] };
}

export async function pollVideoJobs(config: ServerConfig, authorization: AuthorizationAccess, signal = new AbortController().signal) {
  if (config.readOnly) return;
  await Promise.all((await claimVideoJobs(config)).map(async job => {
    if (signal.aborted) return;
    let key = "", saving = job.status === "saving";
    try {
      const workspace = config.workspaces.find(item => item.id === job.workspaceId);
      if (!workspace) throw new Error("发起任务的工作区已不可用，请恢复工作区后重试查询。");
      key = await credential(authorization, job.model);
      const data = object.parse(job.model === "seedance-2.5"
        ? await jsonRequest(`${ARK}/contents/generations/tasks/${encodeURIComponent(job.upstreamId)}`, key, undefined, signal)
        : job.workflowId ? await pollH3Workflow(job, key, signal)
        : await jsonRequest(`${RH}/openapi/v2/query`, key, { taskId: job.upstreamId }, signal));
      const status = z.string().parse(data.status).toLowerCase();
      if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
        const error = object.safeParse(data.error);
        await updateVideoJob(config, job, { status: "failed", message: safeError(error.success ? `${error.data.code ?? ""} ${error.data.message ?? ""}` : `${data.errorCode ?? ""} ${data.errorMessage ?? "生成失败"}`, key) });
      } else if (["succeeded", "success"].includes(status)) {
        saving = true;
        await updateVideoJob(config, job, { status: "saving", nextPoll: Date.now() + 300_000 });
        const url = job.model === "seedance-2.5"
          ? z.object({ video_url: z.string() }).parse(data.content).video_url
          : z.array(z.object({ url: z.string() })).min(1).parse(data.results)[0].url;
        const path = await saveOutput(config, workspace, job, url, signal);
        await updateVideoJob(config, job, { status: "succeeded", path, message: "已保存到本会话的产出文件。" });
      } else if (["queued", "running", "pending", "processing"].includes(status)) {
        const overdue = Date.now() - job.createdAt > 24 * 60 * 60 * 1000;
        await updateVideoJob(config, job, { status: overdue ? "uncertain" : "running", message: overdue ? "任务超过 24 小时仍未完成，已暂停自动查询。请在服务商控制台检查，也可恢复查询。" : "服务商正在生成，关闭控制台不会中断任务。", nextPoll: Date.now() + 10_000 });
      } else throw new Error("服务商返回未知任务状态，请稍后重试查询。");
    } catch (error) {
      if (signal.aborted) return;
      const expired = Date.now() - job.createdAt > 24 * 60 * 60 * 1000;
      await updateVideoJob(config, job, { status: saving ? "save_failed" : expired ? "uncertain" : "running",
        message: safeError(error, key), nextPoll: Date.now() + 60_000 });
    }
  }));
}

export function startVideoJobWorker(config: ServerConfig) {
  const controller = new AbortController();
  let active: Promise<void> | null = null;
  const tick = () => {
    if (active || controller.signal.aborted || config.readOnly) return;
    active = pollVideoJobs(config, createAuthorizationAccess(config), controller.signal)
      .catch(() => console.error("[video-generation] Could not process the video task queue"))
      .finally(() => { active = null; });
  };
  const timer = setInterval(tick, 10_000);
  timer.unref(); tick();
  return { close: async () => { clearInterval(timer); controller.abort(); await active; } };
}

export async function callVideoGenerationAction(config: ServerConfig, authorization: AuthorizationAccess, action: string, input: unknown, context: Record<string, unknown>) {
  if (action === "status") {
    const models = [];
    for (const model of catalog) {
      const values = await authorization.read(model.id === "seedance-2.5" ? "volcengine-video" : "runninghub-video");
      if (values[model.key]?.trim()) models.push({ ...model, key: undefined });
    }
    return { ok: true, result: { models, ratios, localVideoReady: Boolean((await storageStatus(authorization)).defaultProvider) } };
  }
  const workspaceId = typeof context.workspaceId === "string" ? context.workspaceId : workspaceIdForPluginContext(config, context);
  const workspace = config.workspaces.find(item => item.id === workspaceId);
  if (!workspace) throw new ApiError(404, "workspace_not_found", "工作区不存在。");
  const sessionId = sessionArtifactOwner(context.sessionId);
  if (!["jobs", "read", "inspect"].includes(action) && config.readOnly) throw new ApiError(403, "read_only", "当前工作区为只读，不能创建视频任务或保存素材。");
  if (action === "inspect") return { ok: true, result: await inspectLocalVideo(workspace, z.object({ path: z.string() }).strict().parse(input).path) };
  if (action === "local-edit") return { ok: true, result: await saveLocalVideo(config, workspace, sessionId, input) };
  if (action === "jobs") {
    const args = z.object({ before: z.number().int().positive().optional() }).parse(input);
    return { ok: true, result: { jobs: await listVideoJobs(config, workspace.id, sessionId, args.before) } };
  }
  if (action === "submit") {
    const args = validateVideoSubmission(input);
    const key = await credential(authorization, args.model);
    const now = Date.now();
    const fingerprint = createHash("sha256").update(JSON.stringify(args)).digest("hex");
    const created = await createVideoJob(config, { id: args.requestId, workspaceId: workspace.id, sessionId, fingerprint,
      ...(args.model === "minimax-h3" ? { workflowId: H3_WORKFLOW } : {}),
      model: args.model, operation: args.operation, prompt: args.prompt, status: "submitting", upstreamId: "", path: "", message: "准备并提交素材…",
      createdAt: now, updatedAt: now, nextPoll: now + 15 * 60_000 });
    if (!created.created) return { ok: true, result: { job: created.job } };
    let submitted = false;
    try {
      const request = await videoRequest(workspace, args, key, config, authorization);
      submitted = true;
      const result = await jsonRequest(request.url, key, request.body);
      const upstreamId = z.string().min(1).max(200).parse(args.model === "seedance-2.5" ? result.id : object.parse(workflowData(result)).taskId);
      if (!/^[a-zA-Z0-9_-]+$/.test(upstreamId)) throw new Error("服务商返回无效任务 ID。");
      const job = await updateVideoJob(config, created.job, { upstreamId, status: "running", nextPoll: now, message: "任务已提交，正在等待结果。" });
      return { ok: true, result: { job } };
    } catch (error) {
      const definite = !submitted || error instanceof ApiError && error.status < 500 && error.status !== 408;
      const job = await updateVideoJob(config, created.job, { status: definite ? "failed" : "uncertain",
        message: `${safeError(error, key)}${definite ? "" : "\n提交结果未确认，请先在服务商控制台检查任务，勿重复提交。"}` });
      return { ok: true, result: { job } };
    }
  }
  if (action === "recover") {
    const args = z.object({ id: z.uuid(), upstreamId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional() }).parse(input);
    const job = await getVideoJob(config, args.id, workspace.id, sessionId);
    if (!["uncertain", "save_failed"].includes(job.status)) fail("只有待确认或保存失败的任务需要恢复。");
    if (!job.upstreamId && !args.upstreamId) fail("请填写服务商控制台中的已有任务 ID。");
    return { ok: true, result: { job: await updateVideoJob(config, job, { status: "running", upstreamId: job.upstreamId || args.upstreamId || "", nextPoll: 0, message: "恢复查询已有任务，不会重新生成。" }) } };
  }
  if (action === "read") {
    const args = z.object({ path: z.string().max(1000), offset: z.number().int().nonnegative().default(0) }).parse(input);
    const file = await mediaFile(workspace, args.path);
    if (file.size > MAX_OUTPUT || args.offset > file.size) fail("预览文件过大或读取位置无效。");
    const handle = await open(file.absolute, "r");
    try {
      const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, file.size - args.offset));
      const result = await handle.read(buffer, 0, buffer.length, args.offset);
      return { ok: true, result: { path: args.path, mime: file.mime, size: file.size, data: buffer.subarray(0, result.bytesRead).toString("base64"), nextOffset: args.offset + result.bytesRead } };
    } finally { await handle.close(); }
  }
  if (action === "import") {
    const args = z.object({ filename: z.string().max(200), dataUrl: z.string().max(28 * 1024 * 1024) }).parse(input);
    const extension = extname(args.filename).toLowerCase(), mime = mimeTypes[extension];
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(args.dataUrl);
    if (!mime || !match || match[1] !== mime) fail("素材格式与文件名不匹配。");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) fail("从本机导入的单个素材最多 20 MB；较大的视频请使用工作区路径或公开链接。");
    const path = `${await sessionDirectory(workspace, sessionId, "assets")}/${randomUUID()}${extension}`;
    const handle = await open(await resolveWithinRoot(workspace.path, path), "wx");
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    return { ok: true, result: { path, mime, size: bytes.length } };
  }
  throw new ApiError(404, "video_action_not_found", "视频操作不存在。");
}
