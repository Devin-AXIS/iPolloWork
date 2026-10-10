import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { env, pipeline, RawImage } from "@huggingface/transformers";
import { z } from "zod";
import { VIDEO_ENHANCEMENT_MAX_SECONDS, videoEnhancementResultSchema } from "@ipollowork/types/video-enhancement";
import { buildEnhancementCues, placeEnhancementCues } from "./video-enhancement-layout.js";
import type { HandSample } from "./video-enhancement-gestures.js";

// This child owns CPU models and media decoding. The only network-capable
// primitive used by Transformers is disabled before any model is constructed.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
globalThis.fetch = Object.assign(async () => { throw new Error("视频智能增强禁止联网。"); }, { preconnect: () => {} });
const execute = promisify(execFile);
const args = z.tuple([z.string(), z.string(), z.string(), z.enum(["zh", "en", "auto"]), z.enum(["gestures", "speech"])]).parse(process.argv.slice(2));
const [input, directory, modelRoot, language, mode] = args;
env.localModelPath = modelRoot;
const progress = (value: number, message: string) => process.stdout.write(JSON.stringify({ progress: value, message }) + "\n");
const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
try {
  progress(3, "准备原视频与本地音频");
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", extname(input).toLowerCase() === ".webm" ? "matroska" : "mov", "-i", input, "-map", "0:v:0", "-map", "0:a:0",
    "-t", String(VIDEO_ENHANCEMENT_MAX_SECONDS), "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-threads", "2", "-c:a", "aac", "-movflags", "+faststart", join(directory, "original.mp4")], { windowsHide: true, timeout: 180_000 });
  const { stdout } = await execute(ffprobe, ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", join(directory, "original.mp4")], { windowsHide: true, timeout: 15_000 });
  const info = z.object({ streams: z.array(z.object({ width: z.number().optional(), height: z.number().optional() })), format: z.object({ duration: z.coerce.number() }) }).parse(JSON.parse(stdout));
  const video = info.streams.find(stream => stream.width && stream.height);
  if (!video?.width || !video.height) throw new Error("视频尺寸不可用。");
  // AAC padding may extend the container slightly beyond the input limit.
  const duration = Math.min(info.format.duration, VIDEO_ENHANCEMENT_MAX_SECONDS);
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", join(directory, "original.mp4"), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", join(directory, "audio.f32")], { windowsHide: true, timeout: 60_000 });
  progress(12, "加载本地 Whisper 语音模型");
  const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", { device: "cpu", dtype: "q8", local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  const bytes = await readFile(join(directory, "audio.f32"));
  const audio = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const transcript = await transcriber(audio, { return_timestamps: true, chunk_length_s: 25, stride_length_s: 4, task: "transcribe",
    ...(language === "auto" ? {} : { language: language === "zh" ? "chinese" : "english" }) });
  await transcriber.dispose();
  const parsed = z.object({ chunks: z.array(z.object({ text: z.string(), timestamp: z.tuple([z.number().nullable(), z.number().nullable()]) })) }).parse(transcript);
  const segments = parsed.chunks.flatMap(chunk => {
    const start = chunk.timestamp[0], end = chunk.timestamp[1];
    return start !== null && end !== null && end > start && start < duration
      ? [{ text: chunk.text, start: Math.max(0, start), end: Math.min(end, duration) }] : [];
  });
  if (!segments.length) throw new Error("没有识别到带时间的有效讲话，请检查原音频或更换语言。");
  progress(48, "分析人物与手势区域");
  const fps = mode === "gestures" ? 4 : 2;
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", join(directory, "original.mp4"), "-vf", `fps=${fps},scale=w='min(768,iw)':h='min(768,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, "-threads", "1", join(directory, "frame-%04d.jpg")], { windowsHide: true, timeout: 60_000 });
  const detector = await pipeline("object-detection", "Xenova/yolos-tiny", { device: "cpu", dtype: "q8", local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  const frames = (await readdir(directory)).filter(file => /^frame-\d{4}\.jpg$/.test(file)).sort();
  const people = [];
  const handSamples: HandSample[] = [];
  const handModule = mode === "gestures" ? await import("./video-enhancement-gestures.js") : null;
  const handDetector = handModule ? await handModule.createEnhancementHandDetector(modelRoot) : null;
  try {
  for (let index = 0; index < frames.length; index++) {
    const file = join(directory, frames[index]!);
    if (index % (fps / 2) === 0) {
    const image = await RawImage.read(file);
    const detections = await detector(image, { threshold: .35, percentage: true });
    const items = z.array(z.object({ label: z.string(), box: z.object({ xmin: z.number(), ymin: z.number(), xmax: z.number(), ymax: z.number() }) })).parse(detections);
    const boxes = items.filter(item => item.label === "person").slice(0, 20).flatMap(({ box }) => {
      const x = Math.max(0, box.xmin), y = Math.max(0, box.ymin), right = Math.min(1, box.xmax), bottom = Math.min(1, box.ymax);
      return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
    });
    people.push({ time: index / fps, boxes });
    }
    if (handDetector) handSamples.push({ time: index / fps, hands: await handDetector.detect(file) });
    progress(48 + Math.round((index + 1) / frames.length * 45), `分析人物${handDetector ? "与手势" : ""}区域 ${index + 1}/${frames.length}`);
  }
  } finally { try { await detector.dispose(); } finally { await handDetector?.dispose(); } }
  const gestures = handModule ? handModule.buildEnhancementGestures(handSamples, duration) : [];
  const hands = handSamples.map(sample => ({ time: sample.time, boxes: sample.hands.map(hand => hand.box) }));
  const base = { duration, width: video.width, height: video.height, segments, people, hands, gestures };
  const cues = placeEnhancementCues(buildEnhancementCues(segments, base.duration), base);
  const warnings = ["转写与人物检测可能存在误差，请预览后调整；当前为人物区域避让，尚未进行精细分割。"];
  if (people.some(sample => !sample.boxes.length)) warnings.push("部分画面未可靠识别人物，已按保守保护区域处理。");
  if (mode === "gestures" && !gestures.length) warnings.push("未识别到稳定指向或张掌手势，已依据音频和安全空白位置生成建议。");
  const result = videoEnhancementResultSchema.parse({ ...base, cues, warnings });
  process.stdout.write(JSON.stringify({ result }) + "\n");
} catch {
  process.stderr.write("本地分析未完成，请检查音轨、本地模型和视频编解码组件。\n");
  process.exitCode = 1;
}
