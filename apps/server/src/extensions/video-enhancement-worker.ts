import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { env, pipeline, RawImage } from "@huggingface/transformers";
import { z } from "zod";
import { VIDEO_ENHANCEMENT_MAX_SECONDS, videoEnhancementLayoutSchema, videoEnhancementResultSchema, type VideoEnhancementRect, type VideoEnhancementMask } from "@ipollowork/types/video-enhancement";
import { buildEnhancementCues, enhancementScaleFilter, placeEnhancementCues } from "./video-enhancement-layout.js";
import type { HandSample, createEnhancementHandDetector } from "./video-enhancement-gestures.js";
import type { createEnhancementSegmenter } from "./video-enhancement-segmentation.js";

// This child owns CPU models and media decoding. The only network-capable
// primitive used by Transformers is disabled before any model is constructed.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
globalThis.fetch = Object.assign(async () => { throw new Error("视频智能增强禁止联网。"); }, { preconnect: () => {} });
const execute = promisify(execFile);
const args = z.tuple([z.string(), z.string(), z.string(), z.enum(["zh", "en", "auto"]), z.enum(["gestures", "speech"]), z.enum(["contour", "boxes"])]).parse(process.argv.slice(2));
const [input, directory, modelRoot, language, mode, protection] = args;
env.localModelPath = modelRoot;
const progress = (value: number, message: string) => process.stdout.write(JSON.stringify({ progress: value, message }) + "\n");
const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
try {
  const began = performance.now();
  progress(3, "准备原视频与本地音频");
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-f", extname(input).toLowerCase() === ".webm" ? "matroska" : "mov", "-i", input, "-map", "0:v:0", "-map", "0:a:0",
    "-t", String(VIDEO_ENHANCEMENT_MAX_SECONDS), "-vf", enhancementScaleFilter(1280), "-c:v", "libx264", "-preset", "fast", "-force_key_frames", "expr:gte(t,n_forced*1)", "-crf", "20", "-threads", "2", "-c:a", "aac", "-movflags", "+faststart", join(directory, "original.mp4")], { windowsHide: true, timeout: 180_000 });
  const { stdout } = await execute(ffprobe, ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "json", join(directory, "original.mp4")], { windowsHide: true, timeout: 15_000 });
  const info = z.object({ streams: z.array(z.object({ width: z.number().optional(), height: z.number().optional() })), format: z.object({ duration: z.coerce.number() }) }).parse(JSON.parse(stdout));
  const video = info.streams.find(stream => stream.width && stream.height);
  if (!video?.width || !video.height) throw new Error("视频尺寸不可用。");
  // AAC padding may extend the container slightly beyond the input limit.
  const duration = Math.min(info.format.duration, VIDEO_ENHANCEMENT_MAX_SECONDS);
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", join(directory, "original.mp4"), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", join(directory, "audio.f32")], { windowsHide: true, timeout: 60_000 });
  progress(12, "加载本地 Whisper 语音模型");
  const speechBegan = performance.now();
  const transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", { device: "cpu", dtype: "q8", local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  const bytes = await readFile(join(directory, "audio.f32"));
  const audio = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const transcript = await transcriber(audio, { return_timestamps: true, chunk_length_s: 25, stride_length_s: 4, task: "transcribe",
    ...(language === "auto" ? {} : { language: language === "zh" ? "chinese" : "english" }) });
  await transcriber.dispose();
  const speechMs = Math.round(performance.now() - speechBegan);
  const parsed = z.object({ chunks: z.array(z.object({ text: z.string(), timestamp: z.tuple([z.number().nullable(), z.number().nullable()]) })) }).parse(transcript);
  const segments = parsed.chunks.flatMap(chunk => {
    const start = chunk.timestamp[0], end = chunk.timestamp[1];
    return start !== null && end !== null && end > start && start < duration
      ? [{ text: chunk.text, start: Math.max(0, start), end: Math.min(end, duration) }] : [];
  });
  if (!segments.length) throw new Error("没有识别到带时间的有效讲话，请检查原音频或更换语言。");
  progress(48, "分析人物与手势区域");
  const visionBegan = performance.now();
  const fps = mode === "gestures" || protection === "contour" ? 4 : 2;
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", join(directory, "original.mp4"), "-vf", `fps=${fps},${enhancementScaleFilter(768)}`, "-threads", "1", join(directory, "frame-%04d.jpg")], { windowsHide: true, timeout: 60_000 });
  const detector = await pipeline("object-detection", "Xenova/yolos-tiny", { device: "cpu", dtype: "q8", local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
  const frames = (await readdir(directory)).filter(file => /^frame-\d{4}\.jpg$/.test(file)).sort();
  const people = [];
  const handSamples: HandSample[] = [];
  const masks: VideoEnhancementMask[] = [];
  const handModule = mode === "gestures" ? await import("./video-enhancement-gestures.js") : null;
  let handDetector: Awaited<ReturnType<typeof createEnhancementHandDetector>> | undefined;
  let segmenter: Awaited<ReturnType<typeof createEnhancementSegmenter>> | undefined;
  try {
    handDetector = handModule ? await handModule.createEnhancementHandDetector(modelRoot) : undefined;
    if (protection === "contour") segmenter = await (await import("./video-enhancement-segmentation.js")).createEnhancementSegmenter(modelRoot);
    let boxes: VideoEnhancementRect[] = [];
    for (let index = 0; index < frames.length; index++) {
      const file = join(directory, frames[index]!);
      if (index % (fps / 2) === 0) {
        const image = await RawImage.read(file);
        const detections = await detector(image, { threshold: .35, percentage: true });
        const items = z.array(z.object({ label: z.string(), box: z.object({ xmin: z.number(), ymin: z.number(), xmax: z.number(), ymax: z.number() }) })).parse(detections);
        boxes = items.filter(item => item.label === "person").slice(0, 20).flatMap(({ box }) => {
          const x = Math.max(0, box.xmin), y = Math.max(0, box.ymin), right = Math.min(1, box.xmax), bottom = Math.min(1, box.ymax);
          return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : [];
        });
        people.push({ time: index / fps, boxes });
      }
      if (segmenter) masks.push({ time: index / fps, data: await segmenter.segment(file, boxes) });
      if (handDetector) handSamples.push({ time: index / fps, hands: await handDetector.detect(file) });
      progress(48 + Math.round((index + 1) / frames.length * 45), `分析人物${segmenter ? "轮廓" : ""}${handDetector ? "与手势" : ""} ${index + 1}/${frames.length}`);
    }
  } finally { try { await detector.dispose(); } finally { try { await handDetector?.dispose(); } finally { await segmenter?.dispose(); } } }
  const gestures = handModule ? handModule.buildEnhancementGestures(handSamples, duration) : [];
  const hands = handSamples.map(sample => ({ time: sample.time, boxes: sample.hands.map(hand => hand.box) }));
  const timings = { totalMs: Math.round(performance.now() - began), speechMs, visionMs: Math.round(performance.now() - visionBegan) };
  const base = { duration, width: video.width, height: video.height, segments, people, hands, gestures, masks, timings, layout: videoEnhancementLayoutSchema.parse({}) };
  const cues = placeEnhancementCues(buildEnhancementCues(segments, base.duration), base);
  const warnings = [protection === "contour" ? "按人物轮廓与相邻采样帧避让；快速移动或分割不可靠时采用保守人物框。请预览校对，细小发丝与采样间运动仍可能漏检。" : "当前按人物区域避让；开启精细人物避让可识别轮廓。请预览校对文字与位置。"];
  if (masks.some(mask => !mask.data)) warnings.push("部分画面分割不可靠，相关展示时段已保留人物框保护。");
  if (people.some(sample => !sample.boxes.length)) warnings.push("部分画面未可靠识别人物，已按保守保护区域处理。");
  if (mode === "gestures" && !gestures.length) warnings.push("未识别到稳定指向或张掌手势，已依据音频和安全空白位置生成建议。");
  const result = videoEnhancementResultSchema.parse({ ...base, cues, warnings });
  process.stdout.write(JSON.stringify({ result }) + "\n");
} catch (error) {
  // Preserve the bounded local cause; the server keeps it in the task folder.
  process.stderr.write((error instanceof Error ? error.message : String(error)).slice(-8192) + "\n");
  process.exitCode = 1;
}
