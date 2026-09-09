import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { MAX_VIDEO_MEDIA_BYTES, safeVideoMediaPath } from "@ipollowork/types/video-image-workbench";
import { ApiError } from "../errors.js";
import { resolveWithinRoot } from "../paths.js";
import { runtimeStorageDir } from "../runtime-storage.js";
import { recordSessionArtifact, sessionArtifactOwner } from "../session-artifacts.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

const execute = promisify(execFile);
const MAX_BYTES = MAX_VIDEO_MEDIA_BYTES;
const active = new Set<string>();
const activeRequests = new Set<string>();
const cropSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(.05).max(1), height: z.number().min(.05).max(1) }).strict()
  .refine(crop => crop.x + crop.width <= 1.00001 && crop.y + crop.height <= 1.00001, "裁切范围超出画面。");
export const localVideoEditSchema = z.object({
  requestId: z.uuid(), path: z.string().max(1000), revision: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["copy", "overwrite"]), start: z.number().min(0).max(3600), end: z.number().positive().max(3600),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), flip: z.boolean(),
  speed: z.number().min(.5).max(2), volume: z.number().min(0).max(1), crop: cropSchema,
}).strict().refine(value => value.end - value.start >= .1, "保留时长至少为 0.1 秒。");
type Edit = z.infer<typeof localVideoEditSchema>;
const probeSchema = z.object({ streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional() })), format: z.object({ duration: z.coerce.number().positive().max(3600) }) });
const receiptSchema = z.object({ fingerprint: z.string(), path: z.string(), resultHash: z.string(), completed: z.boolean() });
const binary = (name: "ffmpeg" | "ffprobe") => process.env[name === "ffmpeg" ? "HYPERFRAMES_FFMPEG_PATH" : "HYPERFRAMES_FFPROBE_PATH"]?.trim() || name;
const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function videoFile(workspace: WorkspaceInfo, path: string) {
  if (!safeVideoMediaPath(path) || !/\.(mp4|mov)$/i.test(path)) throw new ApiError(400, "video_invalid_path", "请选择工作区内的 MP4 或 MOV 视频。");
  // Check ancestry as well as the file: a newly created output may not exist yet.
  await resolveWithinRoot(workspace.path, dirname(path));
  const absolute = await realpath(await resolveWithinRoot(workspace.path, path));
  const info = await stat(absolute);
  if (!info.isFile() || !info.size || info.size > MAX_BYTES) throw new ApiError(400, "video_size", "本地编辑支持 100 MB 以内的非空视频。");
  return { absolute, revision: await hashFile(absolute) };
}
async function runBinary(name: "ffmpeg" | "ffprobe", args: string[], timeout: number) {
  try {
    return await execute(binary(name), args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: "utf8" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(503, "video_editor_unavailable", "本地剪辑需要 FFmpeg / FFprobe。请安装视频处理组件后重试；不需要绑定 AI 模型。");
    }
    throw new ApiError(422, "video_encode_failed", "视频处理失败或超时，请检查编码和参数；原文件未被覆盖。");
  }
}
export async function inspectLocalVideo(workspace: WorkspaceInfo, path: string) {
  const source = await videoFile(workspace, path);
  const result = await runBinary("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", source.absolute], 15000);
  const metadata = probeSchema.parse(JSON.parse(result.stdout));
  const video = metadata.streams.find(stream => stream.codec_type === "video");
  if (!video?.width || !video.height || video.width * video.height > 3840 * 2160) throw new ApiError(400, "video_dimensions", "请选择分辨率不超过 4K 的视频。");
  return { path, revision: source.revision, duration: metadata.format.duration, width: video.width, height: video.height, hasAudio: metadata.streams.some(stream => stream.codec_type === "audio") };
}
export function localVideoFilters(edit: Edit) {
  const { crop } = edit;
  const filters = [`crop=trunc(iw*${crop.width}/2)*2:trunc(ih*${crop.height}/2)*2:trunc(iw*${crop.x}/2)*2:trunc(ih*${crop.y}/2)*2`];
  if (edit.rotation === 90) filters.push("transpose=1");
  if (edit.rotation === 180) filters.push("hflip", "vflip");
  if (edit.rotation === 270) filters.push("transpose=2");
  if (edit.flip) filters.push("hflip");
  filters.push(`setpts=(PTS-STARTPTS)/${edit.speed}`, "setsar=1");
  return { video: filters.join(","), audio: `asetpts=PTS-STARTPTS,atempo=${edit.speed},volume=${edit.volume}` };
}
async function writeReceipt(path: string, value: z.infer<typeof receiptSchema>) {
  const temporary = path + "." + randomUUID() + ".partial";
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
export async function saveLocalVideo(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string, input: unknown) {
  if (config.readOnly) throw new ApiError(403, "read_only", "当前工作区为只读。");
  const owner = sessionArtifactOwner(sessionId);
  const edit = localVideoEditSchema.parse(input);
  const source = await videoFile(workspace, edit.path);
  const key = process.platform === "win32" ? source.absolute.toLowerCase() : source.absolute;
  const receiptDir = join(runtimeStorageDir(config), "video-edits", hashText(JSON.stringify([workspace.id, workspace.path, owner])));
  const receiptPath = join(receiptDir, edit.requestId + ".json");
  if (active.has(key) || activeRequests.has(receiptPath) || active.size >= 2) throw new ApiError(409, "video_edit_busy", "正在保存视频，请稍后重试。");
  active.add(key);
  activeRequests.add(receiptPath);
  let temporary = "";
  try {
    await mkdir(receiptDir, { recursive: true });
    const fingerprint = hashText(JSON.stringify(edit));
    const priorText = await readFile(receiptPath, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
    const prior = priorText ? receiptSchema.parse(JSON.parse(priorText)) : null;
    if (prior && prior.fingerprint !== fingerprint) throw new ApiError(409, "video_edit_conflict", "保存请求已变化，请重新预览后保存。");
    if (prior) {
      const saved = await videoFile(workspace, prior.path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (saved?.revision === prior.resultHash) {
        await recordSessionArtifact(config, workspace, owner, edit.path);
        await recordSessionArtifact(config, workspace, owner, prior.path);
        await writeReceipt(receiptPath, { ...prior, completed: true });
        return { path: prior.path, originalPath: edit.path, saveMode: edit.mode, revision: saved.revision };
      }
      if (prior.completed) throw new ApiError(409, "video_result_changed", "已保存的视频后来发生了变化，请重新打开。");
    }
    if (!prior) {
      // Same review window and per-session cap as Image Workbench. No media is deleted.
      let count = 0;
      for (const entry of await readdir(receiptDir)) {
        if (!/^[a-f0-9-]{36}\.json$/.test(entry)) continue;
        const path = join(receiptDir, entry);
        const info = await stat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        if (!info) continue;
        if (Date.now() - info.mtimeMs > 7 * 24 * 60 * 60 * 1000) await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
        else count++;
      }
      if (count >= 512) throw new ApiError(413, "video_edit_capacity", "本会话近期保存记录已达上限，请在新会话中继续编辑。");
    }
    if (source.revision !== edit.revision) throw new ApiError(409, "video_source_changed", "原视频已发生变化，请重新打开后编辑；未执行覆盖。");
    const metadata = await inspectLocalVideo(workspace, edit.path);
    if (edit.end > metadata.duration + .05) throw new ApiError(400, "video_range", "剪辑范围超出原视频时长。");
    // A copy lives beside its source, with a distinct name; overwrite retains the exact reference.
    const extension = extname(edit.path);
    const output = edit.mode === "overwrite" ? edit.path : `${edit.path.slice(0, -extension.length)}-edited-${edit.requestId.slice(0, 8)}${extension}`;
    await resolveWithinRoot(workspace.path, dirname(output));
    const destination = await resolveWithinRoot(workspace.path, output);
    if (edit.mode === "copy" && await stat(destination).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) throw new ApiError(409, "video_output_exists", "输出文件已存在，未覆盖已有文件。");
    temporary = join(dirname(destination), `.${basename(output)}.${randomUUID()}.partial${extension}`);
    const filters = localVideoFilters(edit);
    await runBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe", "-ss", String(edit.start), "-i", source.absolute,
      "-t", String((edit.end - edit.start) / edit.speed), "-map", "0:v:0", ...(metadata.hasAudio && edit.volume ? ["-map", "0:a:0", "-af", filters.audio, "-c:a", "aac"] : ["-an"]),
      "-vf", filters.video, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "2", "-filter_threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-fs", String(MAX_BYTES), temporary], 120000);
    const resultInfo = await stat(temporary);
    if (!resultInfo.size || resultInfo.size >= MAX_BYTES) throw new ApiError(413, "video_output_size", "输出视频超过大小限制，原文件未覆盖。");
    if ((await videoFile(workspace, edit.path)).revision !== edit.revision) throw new ApiError(409, "video_source_changed", "保存期间原视频发生变化，未执行覆盖。");
    const resultHash = await hashFile(temporary);
    const receipt = { fingerprint, path: output, resultHash, completed: false };
    await writeReceipt(receiptPath, receipt);
    if (edit.mode === "copy") { await link(temporary, destination); await unlink(temporary); }
    else await rename(temporary, destination);
    temporary = "";
    await recordSessionArtifact(config, workspace, owner, edit.path);
    await recordSessionArtifact(config, workspace, owner, output);
    await writeReceipt(receiptPath, { ...receipt, completed: true });
    return { path: output, originalPath: edit.path, saveMode: edit.mode, revision: resultHash };
  } finally {
    active.delete(key);
    activeRequests.delete(receiptPath);
    if (temporary) await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
