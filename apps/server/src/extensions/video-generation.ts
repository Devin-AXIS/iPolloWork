import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, posix } from "node:path";
import { z } from "zod";
import { avatarBackgroundForPrompt, AVATAR_STANDARD_VIDEO, MAX_AVATAR_SEGMENTS, type AvatarSegment } from "@ipollowork/types/video-generation";
import { prepareAvatarSegments, sliceAvatarAudio, joinAvatarSegments, inspectAvatarStability } from "./video-avatar-segments.js";
import { avatarCutoutCli, avatarCutoutTimeout, removeAvatarBackground } from "./video-local-edit.js";
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
import { avatarTimelineContext } from "./media-center.js";
import { inspectLocalVideo, localVideoEditSchema, inspectNarrationDuration, mixAvatarNarration, saveLocalVideo } from "./video-local-edit.js";

export const VIDEO_GENERATION_EXTENSION_ID = "video-generation";
const ARK = "https://ark.cn-beijing.volces.com/api/v3";
const RH = "https://www.runninghub.cn";
const H3_WORKFLOW = "2097511747551842305";
const AVATAR_WORKFLOW = "2099368776771919873";
const MAX_OUTPUT = 256 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const operations = z.enum(["text", "first", "first-last", "reference", "edit", "extend", "regenerate"]);
const modelId = z.enum(["seedance-2.5", "minimax-h3", "minimax-h3-avatar"]);
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
  {
    id: "minimax-h3-avatar", label: "数字人 · MiniMax H3 lightx2v", service: "runninghub-video", key: "RUNNINGHUB_API_KEY",
    upstream: AVATAR_WORKFLOW, resolutions: [AVATAR_STANDARD_VIDEO.resolution, "0.589824MP"], defaultResolution: AVATAR_STANDARD_VIDEO.resolution,
    ratios: ["9:16", "16:9"], durations: Array.from({ length: 11 }, (_, i) => String(i + 5)),
    operations: ["reference"], imageLimit: 1, videoLimit: 0, audioLimit: 1, referenceSeconds: 15,
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
  avatarSource: z.enum(["video-audio", "video-content"]).optional(),
  generateAudio: z.enum(["true", "false"]).optional(), watermark: z.enum(["true", "false"]).optional(),
}).strict();
type Submission = z.infer<typeof submissionSchema>;
function fail(message: string): never { throw new ApiError(400, "video_invalid_parameters", message); }
function lines(text: string) { return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean); }
function isReference(operation: string) { return ["reference", "edit", "extend", "regenerate"].includes(operation); }
export function validateVideoSubmission(input: unknown): Submission {
  const selection = z.object({ model: z.string().trim().min(1) }).passthrough().safeParse(input);
  if (!selection.success) {
    throw new ApiError(400, "video_model_selection_required", "请先让用户从已配置的视频模型中选择一个，再提交生成或编辑。");
  }
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) fail("视频参数无效，请检查提示词和参数类型。");
  const args = parsed.data;
  const model = videoModelDefinition(args.model);
  if (!model.operations.includes(args.operation)) fail("当前模型不支持此操作。");
  const allowedRatios = ["first", "first-last", "edit", "extend"].includes(args.operation) ? ["adaptive"] : model.ratios;
  if (!model.resolutions.includes(args.resolution) || !(model.durations.includes(args.duration) || args.model === "minimax-h3-avatar" && args.avatarSource && Number.isFinite(Number(args.duration)) && Number(args.duration) > 0) || !allowedRatios.includes(args.ratio)) fail("所选分辨率、时长或画幅不受当前模型支持。");
  if (args.model === "minimax-h3-avatar" && Math.ceil(Number(args.duration) / 10) > MAX_AVATAR_SEGMENTS) fail("数字人任务片段过多，请分成多个任务生成。");
  if (["first", "first-last", "edit", "extend"].includes(args.operation) && args.ratio !== "adaptive") fail("首帧、编辑和延长操作的画幅必须跟随输入素材。");
  if (args.operation === "edit" && args.duration !== "-1") fail("Seedance 视频编辑的时长必须跟随原视频。");
  if (["first", "first-last"].includes(args.operation) !== Boolean(args.firstFrame.trim())) fail("首帧模式需要首帧图片；其他模式请使用参考素材。");
  if ((args.operation === "first-last") !== Boolean(args.lastFrame.trim())) fail("首尾帧模式需要尾帧图片；其他模式不支持尾帧。");
  const images = lines(args.imageRefs), videos = lines(args.videoRefs), audio = lines(args.audioRefs);
  if (args.model === "minimax-h3-avatar") {
    if (images.length !== 1 || audio.length !== (args.avatarSource === "video-content" ? 0 : 1)) fail("数字人需要一张人物图片和一段配音。");
    if (audio[0]?.startsWith("https://")) fail("请上传音频或选择工作区中的配音文件。");
    if (args.generateAudio !== undefined || args.watermark !== undefined) fail("数字人保留上传的配音，不支持音频或水印开关。");
  }
  if (args.avatarSource && args.model !== "minimax-h3-avatar") fail("配音来源仅适用于数字人。 ");
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
  { action: "avatar-context", title: "Read current video narration and content", effect: "read", properties: {} },
  { action: "jobs", title: "Session video tasks", effect: "read", properties: { before: { type: "number" } } },
  { action: "submit", title: "Generate or edit video", effect: "write", properties: Object.fromEntries(Object.keys(submissionSchema.shape).map(key => [key, stringProperty])) },
  { action: "recover", title: "Resume an existing video task without resubmitting", effect: "write", properties: { id: stringProperty, upstreamId: stringProperty } },
  { action: "retry-segment", title: "Retry one failed avatar segment", effect: "write", properties: { id: stringProperty, index: { type: "integer" } } },
  { action: "import", title: "Import video console media", effect: "write", properties: { filename: stringProperty, dataUrl: stringProperty } },
  { action: "read", title: "Read a bounded workspace media chunk", effect: "read", properties: { path: stringProperty, offset: { type: "number" } } },
  { action: "inspect", title: "Inspect a local video for toolbar editing", effect: "read", properties: { path: stringProperty } },
  { action: "local-edit", title: "Save local toolbar video edits without AI", effect: "write", properties: z.toJSONSchema(localVideoEditSchema).properties ?? {} },
].map(action => ({ extensionId: VIDEO_GENERATION_EXTENSION_ID, action: action.action, title: action.title,
  description: action.action === "status"
    ? "List the configured video models the user can choose from. Do not treat the first result as consent."
    : action.action === "submit"
      ? "Generate or edit standalone video footage with the configured model explicitly selected by the user. Use only for explicit plugin/model or raw video asset requests; ordinary video creation belongs to editable HTML in Video Studio. Never choose or infer a model for them."
      : action.title,
  effect: action.effect === "read" ? "read" as const : "write" as const,
  inputSchema: {
    type: "object",
    properties: action.properties,
    ...(action.action === "submit" ? { required: ["requestId", "model", "operation", "prompt", "resolution", "duration", "ratio"] } : {}),
    additionalProperties: false,
  } }));

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

const mimeTypes: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
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
  const response = await providerFetch(`${RH}/openapi/v2/media/upload/binary`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  const payload = JSON.parse(new TextDecoder().decode(await readLimitedRequestBody(response, 64 * 1024)));
  if (!response.ok) throw providerApiError(payload, response.status);
  const uploaded = z.object({ fileName: z.string().regex(/^[a-zA-Z0-9_/-]+\.(png|jpe?g|webp|mp3|wav)$/i) }).parse(workflowData(payload)).fileName;
  if (!mimeTypes[extname(uploaded).toLowerCase()]?.startsWith(`${kind}/`)) fail("上传服务返回了不匹配的素材类型。");
  return uploaded;
}

async function avatarWorkflow(args: Submission, key: string, image: string, audio: string, signal: AbortSignal) {
  const data = workflowData(await jsonRequest(`${RH}/api/openapi/getJsonApiFormat`, key, { apiKey: key, workflowId: AVATAR_WORKFLOW }, signal));
  const { prompt } = z.object({ prompt: z.string() }).parse(data);
  const graph = z.record(z.string(), z.object({ class_type: z.string(), inputs: z.record(z.string(), z.unknown()) }).passthrough()).parse(JSON.parse(prompt));
  const node = (id: string, type: string) => {
    if (graph[id]?.class_type !== type) throw new ApiError(400, "video_workflow_changed", "数字人工作流节点已变化，尚未提交生成。");
    return graph[id].inputs;
  };
  const reference = node("136", "MiniMaxH3ReferenceToVideo");
  const drive = node("172", "VRGDG_MiniMaxH3AudioDrive");
  const output = node("142", "VHS_VideoCombine");
  const audioInput = node("171", "LoadAudio");
  const crop = node("199", "TrimAudioDuration");
  const scheduler = node("124", "BasicScheduler");
  node("137", "LoadImage");
  const imageKey = Object.keys(reference).find(name => name === "ref_image_0" || name === "ref_images.ref_image_0");
  const audioKey = Object.keys(reference).find(name => name === "ref_audio_0" || name === "ref_audios.ref_audio_0");
  if (!imageKey || !audioKey || JSON.stringify(node("125", "SamplerCustomAdvanced").latent_image) !== '["172",0]'
    || JSON.stringify(node("126", "BasicGuider").conditioning) !== '["136",0]'
    || JSON.stringify(output.images) !== '["122",0]' || JSON.stringify(drive.av_latent) !== '["136",1]'
    || node("174", "UNETLoader").unet_name !== "minimax_h3_ref2va_int8_convrot.safetensors"
    || node("196", "LoraLoaderModelOnly").lora_name !== "minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors") {
    throw new ApiError(400, "video_workflow_changed", "数字人音频或视频连接已变化，尚未提交生成。");
  }
  graph["137"] = { class_type: image.startsWith("https://") ? "LoadImageFromUrl" : "LoadImage", inputs: { image } };
  audioInput.audio = audio;
  crop.audio = ["171", 0]; crop.start_index = 0; crop.duration = Number(args.duration);
  drive.source_audio = ["199", 0];
  const standard = args.resolution === AVATAR_STANDARD_VIDEO.resolution;
  const shortEdge = standard ? AVATAR_STANDARD_VIDEO.shortEdge : 576, longEdge = standard ? AVATAR_STANDARD_VIDEO.longEdge : 1024;
  const width = args.ratio === "9:16" ? shortEdge : longEdge, height = args.ratio === "9:16" ? longEdge : shortEdge;
  if (graph["avatar_frame"]) fail("数字人工作流节点编号已变化，尚未提交。");
  graph["avatar_frame"] = { class_type: "ImageScale", inputs: { image: ["137", 0], width, height, upscale_method: "lanczos", crop: "center" } };
  // H3's FL2VA checkpoint binds actual endpoint frames; REF2VA only provides appearance references.
  // Keep the existing audio-drive latent, VAE, lightx2v LoRA and output workflow.
  node("174", "UNETLoader").unet_name = "minimax_h3_fl2va_int8_convrot.safetensors";
  const target: Record<string, unknown> = { clip: reference.clip, vae: reference.vae, width, height,
    first_frame: ["avatar_frame", 0], last_frame: ["avatar_frame", 0],
    prompt: `One continuous fixed-camera shot of a calm, candid everyday conversation. Preserve the first frame's identity, visual style, facial texture, natural asymmetry, clothing, body size, framing and background. The person has a warm, attentive resting expression, relaxed cheeks and eyebrows, and relaxed lips between spoken phrases. Follow the supplied speech with comfortable, proportionate lip and jaw articulation. A gentle smile appears briefly when the voice calls for it, then settles back into a relaxed expression. Allow brief natural blinks at irregular moments, a soft gaze toward the camera, subtle breathing and occasional tiny, nonrepeating head adjustments. The expression feels spontaneous and understated, with the person remaining in the same position. No camera movement, zoom, cuts, extra people, props or scene changes. ${args.prompt}` };
  graph["136"] = { class_type: "MiniMaxH3ImageToVideo", inputs: target };
  const frames = Math.max(120, Math.ceil(Number(args.duration) * 24));
  target.length = frames + (5 - frames % 17 + 17) % 17;
  // Endpoint frames alone can still produce a zoom/cut in the middle of a long shot.
  // H3 image guides keep the original composition anchored every three seconds.
  let conditioning: [string, number] = ["136", 0];
  for (let frame = 72; frame < frames - 24; frame += 72) {
    const id = `avatar_guide_${frame}`;
    if (graph[id]) fail("数字人工作流节点编号已变化，尚未提交。");
    graph[id] = { class_type: "MiniMaxH3AddGuide", inputs: { positive: conditioning, latent: ["136", 1],
      image: ["avatar_frame", 0], vae: reference.vae, frame_idx: frame } };
    conditioning = [id, 0];
  }
  node("126", "BasicGuider").conditioning = conditioning;
  scheduler.steps = 6;
  node("129", "RandomNoise").noise_seed = Number.parseInt(args.requestId.replaceAll("-", "").slice(0, 12), 16);
  output.audio = ["199", 0]; output.frame_rate = 24; output.trim_to_audio = true;
  output.format = "video/h264-mp4"; output.save_output = true;
  const reachable = new Set<string>();
  const visit = (id: string) => {
    if (reachable.has(id)) return;
    if (!graph[id]) throw new ApiError(400, "video_workflow_changed", "数字人缺少生成节点，尚未提交。");
    reachable.add(id);
    for (const value of Object.values(graph[id].inputs)) if (Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number") visit(value[0]);
  };
  visit("142");
  if (!reachable.has("136") || !reachable.has("171")) fail("数字人输出缺少图片或音频生成链路。");
  return { url: `${RH}/task/openapi/create`, body: { apiKey: key, workflowId: AVATAR_WORKFLOW,
    workflow: JSON.stringify(Object.fromEntries(Object.entries(graph).filter(([id]) => reachable.has(id)))),
    // No instanceType means RunningHub's standard 24GB instance, never Plus.
    nodeInfoList: [{ nodeId: "136", fieldName: "prompt", fieldValue: target.prompt }], addMetadata: false } };
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
    if (args.model === "minimax-h3-avatar") {
      const standard = args.resolution === AVATAR_STANDARD_VIDEO.resolution;
      const shortEdge = standard ? AVATAR_STANDARD_VIDEO.shortEdge : 576, longEdge = standard ? AVATAR_STANDARD_VIDEO.longEdge : 1024;
      const width = args.ratio === "9:16" ? shortEdge : longEdge, height = args.ratio === "9:16" ? longEdge : shortEdge;
      graph["300"] = { class_type: "ImageScale", inputs: { image: ["24", 0], width, height, upscale_method: "lanczos", crop: "center" } };
      target.width = width; target.height = height;
    }
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
  // Omit instanceType for the standard 24GB instance in every RunningHub mode.
  return { url: `${RH}/task/openapi/create`, body: { apiKey: key, workflowId: H3_WORKFLOW, workflow: JSON.stringify(workflow), nodeInfoList, addMetadata: false } };
}
export async function videoRequest(workspace: WorkspaceInfo, args: Submission, key: string, config: ServerConfig, authorization: AuthorizationAccess, signal = AbortSignal.timeout(120_000)) {
  if (args.model === "minimax-h3-avatar" && Number(args.duration) > 15) fail("长数字人需要通过分段任务提交，单段最多 15 秒。");
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
  if (args.model === "minimax-h3-avatar" && args.avatarSource === "video-content") return h3Workflow(args, key, images[0], "", signal);
  return args.model === "minimax-h3-avatar" ? avatarWorkflow(args, key, images[0], audio[0], signal) : h3Workflow(args, key, first, last, signal);
}

async function saveOutput(config: ServerConfig, workspace: WorkspaceInfo, job: VideoJob, url: string, signal: AbortSignal, segmentId?: string) {
  const parsed = new URL(httpsUrl(url));
  const domains = job.model === "seedance-2.5" ? ["volces.com", "volccdn.com", "byteimg.com"] : ["myqcloud.com", "runninghub.ai", "runninghub.cn", "aliyuncs.com", "rh-images.xiaoyaoyou.com", "rh-images-tos.xiaoyaoyou.com"];
  if (!domains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) throw new Error("服务商返回了未受信任的视频下载域名，请联系管理员检查接口。");
  const cutout = !segmentId && job.model === "minimax-h3-avatar" && job.avatarBackground === "transparent";
  let path = `${await sessionDirectory(workspace, job.sessionId, !segmentId && job.model === "minimax-h3-avatar" && !cutout ? "assets" : "renders")}/${segmentId ?? job.id}.mp4`;
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
  if (segmentId) return path;
  if (cutout) {
    const outputPath = `${await sessionDirectory(workspace, job.sessionId, "assets")}/avatar-${job.id}.webm`;
    const output = await resolveWithinRoot(workspace.path, outputPath);
    if (!(await stat(output).catch(() => null))?.size) await removeAvatarBackground(destination, output, signal);
    path = outputPath;
  }
  // Optional inspection must not turn an already saved provider result into a failed job.
  const media = await inspectLocalVideo(workspace, path).catch(() => null);
  await recordSessionArtifact(config, workspace, job.sessionId, path, undefined, {
    id: job.id, kind: "video", model: job.model, completedAt: Date.now(),
    ...(media ? { width: media.width, height: media.height, duration: media.duration } : {}),
  });
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
  const outputNode = [AVATAR_WORKFLOW, "2099699508878860290", "2084814218431385601"].includes(job.workflowId ?? "") ? "142" : [H3_WORKFLOW, "2084511826766811137"].includes(job.workflowId ?? "") ? "7" : "92";
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
      if (job.avatarSequence) {
        await advanceAvatarSequence(config, workspace, job, key, authorization, signal);
        return;
      }
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
        await updateVideoJob(config, job, { status: "saving", message: job.avatarBackground === "transparent" ? "视频已生成，正在提取透明人物…" : "正在保存视频…", nextPoll: Date.now() + 35 * 60_000 });
        const url = job.model === "seedance-2.5"
          ? z.object({ video_url: z.string() }).parse(data.content).video_url
          : z.array(z.object({ url: z.string() })).min(1).parse(data.results)[0].url;
        const path = await saveOutput(config, workspace, job, url, signal);
        await updateVideoJob(config, job, { status: "succeeded", path, message: job.model === "minimax-h3-avatar" ? "已自动加入当前 Video Studio 素材库，可拖入时间线。" : "已保存到本会话的产出文件。" });
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

async function advanceAvatarSequence(config: ServerConfig, workspace: WorkspaceInfo, job: VideoJob, key: string, authorization: AuthorizationAccess, signal: AbortSignal) {
  const sequence = job.avatarSequence;
  if (!sequence) return;
  const index = sequence.segments.findIndex(segment => segment.status !== "succeeded");
  const persist = (patch: Partial<VideoJob>, segment?: Partial<AvatarSegment>) => {
    if (segment && index >= 0) sequence.segments[index] = { ...sequence.segments[index], ...segment };
    return updateVideoJob(config, job, { avatarSequence: sequence, nextPoll: Date.now() + 10_000, ...patch });
  };
  if (index < 0) {
    await persist({ status: "saving", nextPoll: Date.now() + avatarCutoutTimeout(sequence.duration) + 5 * 60_000, message: "全部片段已生成，正在检查接缝并拼接…" });
    try {
      const output = `video/${job.sessionId}/renders/avatar-long-${job.id}.mp4`;
      const joined = await joinAvatarSegments(workspace, sequence.segments, sequence.audioPath, sequence.duration, output, signal);
      sequence.seams = joined.seams;
      let path = joined.path;
      if (job.avatarBackground === "transparent") {
        path = `video/${job.sessionId}/assets/avatar-long-${job.id}.webm`;
        await removeAvatarBackground(await resolveWithinRoot(workspace.path, output), await resolveWithinRoot(workspace.path, path), signal, sequence.duration);
      }
      const media = await inspectLocalVideo(workspace, path);
      if (Math.abs(media.duration - sequence.duration) > .15) throw new Error("拼接结果与目标时间线不一致，片段已保留，请重试拼接。");
      await recordSessionArtifact(config, workspace, job.sessionId, path, undefined, { id: job.id, kind: "video", model: job.model, completedAt: Date.now(), width: media.width, height: media.height, duration: media.duration });
      await persist({ status: "succeeded", path, message: `${sequence.segments.length} 段已拼接为 ${sequence.duration.toFixed(1)} 秒数字人${sequence.audioPath ? "，完整配音已保留" : ""}。` });
    } catch (error) {
      await persist({ status: "save_failed", message: safeError(error, key) });
    }
    return;
  }
  const segment = sequence.segments[index], label = `第 ${index + 1}/${sequence.segments.length} 段`;
  if (["submitting", "uncertain", "failed", "save_failed"].includes(segment.status)) {
    await persist({ status: segment.status === "failed" ? "failed" : segment.status === "save_failed" ? "save_failed" : "uncertain", message: `${label}需要处理；已完成片段保留。提交结果不明确时，请填写该段已有任务 ID 恢复查询。` });
    return;
  }
  if (segment.status === "pending") {
    let submitted = false;
    try {
      const audioPath = sequence.audioPath ? `video/${job.sessionId}/renders/avatar-${job.id}-${index}.wav` : "";
      await sessionDirectory(workspace, job.sessionId, "renders");
      if (audioPath) await sliceAvatarAudio(workspace, sequence.audioPath, segment, audioPath, signal);
      const args = validateVideoSubmission({ requestId: job.id, model: job.model, operation: "reference", prompt: `${job.prompt}\n固定镜头与构图，保持人物大小、位置、光线稳定。允许自然眨眼、轻微呼吸和小幅头部调整；表情随语气柔和变化，避免持续露齿笑、机械点头、转身或大幅挥手。`,
        resolution: AVATAR_STANDARD_VIDEO.resolution, duration: String(segment.end - segment.start), ratio: sequence.ratio, imageRefs: sequence.imagePath, audioRefs: audioPath, avatarSource: audioPath ? "video-audio" : "video-content" });
      // Keep one identity seed across segments; an explicit retry gets a new seed.
      if (segment.attempt) args.requestId = createHash("sha256").update(`${job.id}:${index}:${segment.attempt}`).digest("hex").slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
      const request = await videoRequest(workspace, args, key, config, authorization, signal);
      await persist({ status: "running", nextPoll: Date.now() + 300_000, message: `${label}正在提交…` }, { status: "submitting" });
      submitted = true;
      const result = await jsonRequest(request.url, key, request.body, signal);
      const upstreamId = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).parse(object.parse(workflowData(result)).taskId);
      await persist({ status: "running", message: `${label}正在生成，已完成 ${index} 段。` }, { status: "running", upstreamId });
    } catch (error) {
      if (signal.aborted) return;
      if (!submitted) {
        await persist({ status: "save_failed", message: `${label}准备未完成，尚未提交生成任务：${safeError(error, key)}` }, { status: "save_failed" });
        return;
      }
      const definite = error instanceof ApiError && error.status < 500 && error.status !== 408;
      await persist({ status: definite ? "failed" : "uncertain", message: `${label}：${safeError(error, key)}` }, { status: definite ? "failed" : "uncertain" });
    }
    return;
  }
  const result = await pollH3Workflow({ ...job, upstreamId: segment.upstreamId }, key, signal);
  if (result.status === "failed") {
    await persist({ status: "failed", message: `${label}生成失败，可只重试这一段。` }, { status: "failed" });
  } else if (result.status === "success" && result.results) {
    try {
      const path = await saveOutput(config, workspace, job, result.results[0].url, signal, `avatar-${job.id}-${index}-${segment.attempt}`);
      const media = await inspectLocalVideo(workspace, path);
      if (media.duration + .08 < segment.end - segment.start) {
        await persist({ status: "failed", message: `${label}已返回，但视频未覆盖目标片段，请重试此片段。` }, { status: "failed", path });
        return;
      }
      const stability = await inspectAvatarStability(workspace, path, signal);
      if (stability.difference > .1 || stability.jump > .08) {
        await persist({ status: "failed", message: `${label}画面连续性检查未通过，已暂停后续生成。请预览并重试此片段；长片段重复失败时会拆短重试，其余结果保留。` }, { status: "failed", path });
        return;
      }
      await persist({ status: "running", nextPoll: 0, message: `${label}已保存。` }, { status: "succeeded", path });
    } catch (error) {
      await persist({ status: "save_failed", message: `${label}：${safeError(error, key)}` }, { status: "save_failed" });
    }
  } else await persist({ status: "running", message: `${label}正在生成，已完成 ${index} 段。` });
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

async function avatarContext(workspace: WorkspaceInfo, sessionId: string) {
  const directory = `video/${sessionId}`;
  const path = await resolveWithinRoot(workspace.path, `${directory}/index.html`);
  const metadata = await stat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!metadata) return { content: "", audioCount: 0, audioDuration: 0, audioIssue: "当前视频没有配音素材。", clips: [] };
  if (!metadata.isFile() || metadata.size > 2 * 1024 * 1024) fail("当前视频工程内容过大，暂时无法读取。 ");
  const parsed = avatarTimelineContext(await readFile(path, "utf8"));
  const clips: Array<{ path: string; start: number; duration: number; offset: number; volume: number }> = [];
  let audioIssue = parsed.clips.length ? "" : "当前视频没有配音素材。";
  if (parsed.clips.length > 24) audioIssue = "配音片段过多，请先合并配音后重试。";
  const durations = new Map<string, number>();
  for (const clip of parsed.clips.slice(0, 24)) {
    if (!clip.src || clip.start == null || clip.duration == null || clip.duration <= 0 || clip.volume > 2) {
      audioIssue = "视频配音的时间线信息不完整，请先修复配音片段。"; continue;
    }
    if (/^(?:[a-z]+:|[/\\])/i.test(clip.src)) { audioIssue = "请先把配音素材保存到当前视频工程。"; continue; }
    const path = posix.normalize(posix.join(directory, clip.src));
    if (!path.startsWith(`${directory}/`)) { audioIssue = "配音素材必须位于当前视频工程。"; continue; }
    try {
      const file = await mediaFile(workspace, path);
      if (!file.mime.startsWith("audio/") || file.size > 15 * 1024 * 1024) throw new Error("invalid audio");
      const duration = durations.get(path) ?? await inspectNarrationDuration(workspace, path);
      durations.set(path, duration);
      const effectiveDuration = Math.min(clip.duration, duration - clip.offset);
      if (effectiveDuration <= 0) throw new Error("empty audio window");
      clips.push({ path, start: clip.start, duration: effectiveDuration, offset: clip.offset, volume: clip.volume });
    } catch { audioIssue = "无法读取配音素材，请检查文件是否存在、格式及大小是否有效，并确认 FFprobe 已安装。"; }
  }
  const audioDuration = clips.length ? Math.max(...clips.map(clip => clip.start + clip.duration)) : 0;
  return { content: parsed.content, audioCount: clips.length, audioDuration, audioIssue, clips };
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
  if (!["jobs", "read", "inspect", "avatar-context"].includes(action) && config.readOnly) throw new ApiError(403, "read_only", "当前工作区为只读，不能创建视频任务或保存素材。");
  if (action === "avatar-context") {
    const { clips, ...result } = await avatarContext(workspace, sessionId);
    return { ok: true, result };
  }
  if (action === "inspect") return { ok: true, result: await inspectLocalVideo(workspace, z.object({ path: z.string() }).strict().parse(input).path) };
  if (action === "local-edit") return { ok: true, result: await saveLocalVideo(config, workspace, sessionId, input) };
  if (action === "jobs") {
    const args = z.object({ before: z.number().int().positive().optional() }).parse(input);
    return { ok: true, result: { jobs: await listVideoJobs(config, workspace.id, sessionId, args.before) } };
  }
  if (action === "submit") {
    const draft = submissionSchema.parse(input);
    const avatarBackground = draft.model === "minimax-h3-avatar" ? avatarBackgroundForPrompt(draft.prompt) : undefined;
    const source = draft.model === "minimax-h3-avatar" && draft.avatarSource ? await avatarContext(workspace, sessionId) : null;
    if (source && draft.avatarSource === "video-audio") {
      if (source.audioIssue || !source.clips.length) fail(source.audioIssue || "当前视频没有配音素材。");
      draft.duration = String(source.audioDuration);
      draft.audioRefs = `video/${sessionId}/assets/avatar-voice-${draft.requestId}.wav`;
    }
    if (source && draft.avatarSource === "video-content") {
      if (!source.content.trim()) fail("当前视频没有可参考的内容，请先完善视频。 ");
      draft.audioRefs = "";
    }
    if (source) draft.prompt = `保持参考人物图片的视觉风格、身份、服装、色彩和光线；插画保持插画风格，写实照片保持写实风格。${draft.avatarSource === "video-content" ? "参考以下视频内容设计自然动作，不使用视频配音，不要求对口型。" : "严格跟随视频配音对口型。"}\n${draft.prompt}\n视频内容：${source.content}`.slice(0, 8000);
    const args = validateVideoSubmission(draft);
    if (avatarBackground === "transparent") await avatarCutoutCli();
    const key = await credential(authorization, args.model);
    const now = Date.now();
    const fingerprint = createHash("sha256").update(JSON.stringify(args)).digest("hex");
    const created = await createVideoJob(config, { id: args.requestId, workspaceId: workspace.id, sessionId, fingerprint,
      ...(avatarBackground ? { avatarBackground } : {}),
      ...(args.model === "minimax-h3-avatar" ? { workflowId: args.avatarSource === "video-content" ? H3_WORKFLOW : AVATAR_WORKFLOW } : args.model === "minimax-h3" ? { workflowId: H3_WORKFLOW } : {}),
      model: args.model, operation: args.operation, prompt: args.prompt, status: "submitting", upstreamId: "", path: "", message: "准备并提交素材…",
      createdAt: now, updatedAt: now, nextPoll: now + 15 * 60_000 });
    if (!created.created) return { ok: true, result: { job: created.job } };
    let submitted = false;
    try {
      if (source && args.avatarSource === "video-audio") {
        await sessionDirectory(workspace, sessionId, "assets");
        await mixAvatarNarration(workspace, source.clips, args.audioRefs, source.audioDuration);
      }
      if (args.model === "minimax-h3-avatar" && args.avatarSource && Number(args.duration) > 15) {
        const segments = await prepareAvatarSegments(workspace, args.audioRefs, Number(args.duration));
        await sessionDirectory(workspace, sessionId, "assets");
        // Freeze the user's uploaded picture so later edits cannot alter an in-flight sequence.
        const image = await mediaFile(workspace, args.imageRefs);
        const imagePath = `video/${sessionId}/assets/avatar-reference-${args.requestId}${extname(args.imageRefs)}`;
        if (image.size > 30 * 1024 * 1024) fail("人物图片最多 30 MB。");
        await writeFile(await resolveWithinRoot(workspace.path, imagePath), await readFile(image.absolute), { flag: "wx" });
        const ratio = args.ratio === "9:16" ? "9:16" : "16:9";
        const job = await updateVideoJob(config, created.job, { status: "running", nextPoll: 0,
          avatarSequence: { duration: Number(args.duration), audioPath: args.audioRefs, imagePath, ratio, segments },
          message: `已分为 ${segments.length} 段，开始生成。` });
        return { ok: true, result: { job } };
      }
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
    const unsubmitted = job.avatarSequence?.segments.find(segment => ["failed", "save_failed"].includes(segment.status) && !segment.upstreamId && !segment.path);
    if (!["uncertain", "save_failed"].includes(job.status) && !(job.status === "failed" && unsubmitted)) fail("只有待确认或保存失败的任务需要恢复。");
    if (job.avatarSequence) {
      const sequence = job.avatarSequence;
      const index = sequence.segments.findIndex(segment => segment === unsubmitted || ["uncertain", "submitting", "save_failed"].includes(segment.status));
      if (index >= 0) {
        const segment = sequence.segments[index];
        if (segment === unsubmitted) {
          // No create request was accepted. Resume preparation with the same
          // attempt/seed; successful earlier segments remain untouched.
          sequence.segments[index] = { ...segment, status: "pending" };
        } else {
          const upstreamId = segment.upstreamId || args.upstreamId;
          if (!upstreamId) fail("请填写这一片段在服务商控制台中的已有任务 ID，避免重复计费。");
          sequence.segments[index] = { ...segment, upstreamId, status: "running" };
        }
      }
      return { ok: true, result: { job: await updateVideoJob(config, job, { avatarSequence: sequence, status: "running", nextPoll: 0, message: unsubmitted ? "恢复本地准备后继续首次生成，按服务商实际用量计费；已完成片段保留。" : "继续已有片段和拼接，不重新生成已完成内容。" }) } };
    }
    if (!job.upstreamId && !args.upstreamId) fail("请填写服务商控制台中的已有任务 ID。");
    return { ok: true, result: { job: await updateVideoJob(config, job, { status: "running", upstreamId: job.upstreamId || args.upstreamId || "", nextPoll: 0, message: "恢复查询已有任务，不会重新生成。" }) } };
  }
  if (action === "retry-segment") {
    const args = z.object({ id: z.uuid(), index: z.number().int().min(0).max(127) }).strict().parse(input);
    const job = await getVideoJob(config, args.id, workspace.id, sessionId);
    const sequence = job.avatarSequence, segment = sequence?.segments[args.index];
    if (segment?.status === "failed" && !segment.upstreamId && !segment.path) fail("这一段尚未提交生成，请使用恢复准备并继续生成，无需增加重试次数。");
    const seamRetry = job.status === "save_failed" && sequence?.segments.every(item => item.status === "succeeded");
    if (!sequence || !segment || !["failed", "save_failed"].includes(job.status) || !(segment.status === "failed" || seamRetry)) fail("只能重试已确认失败的片段，或拼接检查未通过的已完成片段。");
    const retry: AvatarSegment = { ...segment, status: "pending", path: "", upstreamId: "", attempt: segment.attempt + 1 };
    const split = segment.status === "failed" && Boolean(segment.path) && segment.attempt > 0 && segment.end - segment.start > 10 && sequence.segments.length < MAX_AVATAR_SEGMENTS;
    if (split) {
      const middle = Math.round((segment.start + segment.end) / 2 * 24) / 24;
      // Preserve both outer boundaries and the original audio clock; only this failed window is replaced.
      sequence.segments.splice(args.index, 1, { ...retry, end: middle + .5 }, { ...retry, start: middle - .5 });
    } else sequence.segments[args.index] = retry;
    sequence.seams = undefined;
    return { ok: true, result: { job: await updateVideoJob(config, job, { avatarSequence: sequence, status: "running", nextPoll: 0, message: split ? `第 ${args.index + 1} 段已拆成两个较短片段重试，按各段实际用量计费；其余片段保留。` : `仅重新生成第 ${args.index + 1} 段，其余片段保留。` }) } };
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
