// fallow-ignore-file complexity
/**
 * Background-removal rendering pipeline.
 *
 * Decode source frames via ffmpeg → run inference per frame → encode the RGBA
 * stream via a second ffmpeg process. Output formats:
 *   .webm → VP9 with alpha (HTML5-native, ~1 MB / 4s @ 1080p)
 *   .mov  → ProRes 4444 with alpha (editing round-trip)
 *   .png  → single RGBA still (only when input is also a single image)
 *
 * The encode flags for VP9-with-alpha mirror the `chunkEncoder.ts` pattern in
 * @hyperframes/engine — `-pix_fmt yuva420p` plus the
 * `-metadata:s:v:0 alpha_mode=1` tag are what make Chrome's `<video>` element
 * decode the alpha plane.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join, toNamespacedPath } from "node:path";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";
import { createSession, type Session } from "./inference.js";
import { type Device, type ModelId } from "./manager.js";
import { DEFAULT_VP9_CPU_USED, renderProvenanceArgs } from "@hyperframes/engine";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

export type OutputFormat = "webm" | "mov" | "png";

const QUALITY_CRF = {
  fast: 30,
  balanced: 18,
  best: 12,
} as const;

export type Quality = keyof typeof QUALITY_CRF;

export const QUALITIES = Object.keys(QUALITY_CRF) as readonly Quality[];

export const DEFAULT_QUALITY: Quality = "balanced";

export const isQuality = (v: unknown): v is Quality =>
  typeof v === "string" && (QUALITIES as readonly string[]).includes(v);

export interface RenderOptions {
  inputPath: string;
  outputPath: string;
  /** Completed smart-cutout foreground, reused when removing the original backdrop. */
  foregroundPath?: string;
  /**
   * Optional second output: an inverse-alpha background plate (same source
   * RGB, transparent where the subject was). Only valid for video inputs and
   * .webm/.mov outputs — not allowed alongside a .png output. The plate's
   * format is inferred from this path independently of the foreground's.
   *
   * NOTE: this is a hole-cut plate, not an inpainted clean plate. Composite
   * something opaque (graphics, blur, scene) under it to fill the hole.
   */
  backgroundOutputPath?: string;
  device?: Device;
  model?: ModelId;
  /** Encoder CRF preset for `.webm`. See `QUALITY_CRF`. Ignored for `.mov`/`.png`. */
  quality?: Quality;
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: "info"; message: string }
  | {
      kind: "metadata";
      width: number;
      height: number;
      fps: number;
      frameCount: number;
    }
  | { kind: "frame"; index: number; total: number; avgMsPerFrame: number };

export interface RenderResult {
  outputPath: string;
  /** Present only when `backgroundOutputPath` was set. */
  backgroundOutputPath?: string;
  framesProcessed: number;
  durationSeconds: number;
  avgMsPerFrame: number;
  provider: string;
  format: OutputFormat;
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

interface MediaInfo {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSeconds: number;
  hasAlpha?: boolean;
  videoCodec?: string;
}

export function inferOutputFormat(outputPath: string): OutputFormat {
  const ext = extname(outputPath).toLowerCase();
  if (ext === ".webm") return "webm";
  if (ext === ".mov") return "mov";
  if (ext === ".png") return "png";
  throw new Error(
    `Unsupported output extension: ${ext}. Use .webm (VP9 alpha), .mov (ProRes 4444), or .png.`,
  );
}

export function inferInputKind(inputPath: string): "video" | "image" {
  const ext = extname(inputPath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  throw new Error(
    `Unsupported input: ${ext}. Use a video (mp4/mov/webm/mkv/avi) or image (jpg/png/webp).`,
  );
}

interface EngineMetadata {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  hasAlpha?: boolean;
  videoCodec?: string;
}

async function probeMedia(inputPath: string): Promise<MediaInfo> {
  const isImage = inferInputKind(inputPath) === "image";
  const engine = (await import("@hyperframes/engine")) as {
    extractMediaMetadata: (path: string) => Promise<EngineMetadata>;
  };
  const meta = await engine.extractMediaMetadata(inputPath);

  if (isImage) {
    return { width: meta.width, height: meta.height, fps: 0, frameCount: 1, durationSeconds: 0 };
  }

  const fps = meta.fps || 30;
  const frameCount = meta.durationSeconds ? Math.round(meta.durationSeconds * fps) : 0;
  return { ...meta, fps, frameCount };
}

export function buildEncoderArgs(
  format: OutputFormat,
  width: number,
  height: number,
  fps: number,
  outputPath: string,
  quality: Quality = DEFAULT_QUALITY,
  audioInputPath?: string,
): string[] {
  const base = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${width}x${height}`,
    "-r",
    String(fps || 30),
    "-i",
    "-",
    ...(audioInputPath && format !== "png" ? ["-i", audioInputPath] : []),
  ];
  // A transparent replacement must retain the source voice. Smart-cutout
  // overlays explicitly mute their foreground, so they still play audio once.
  const audioArgs = audioInputPath
    ? ["-map", "0:v:0", "-map", "1:a:0?", "-c:a", format === "webm" ? "libopus" : "pcm_s16le"]
    : ["-an"];

  if (format === "webm") {
    return [
      ...base,
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      String(QUALITY_CRF[quality]),
      "-deadline",
      "good",
      "-row-mt",
      "1",
      "-cpu-used",
      String(DEFAULT_VP9_CPU_USED),
      "-auto-alt-ref",
      "0",
      "-pix_fmt",
      "yuva420p",
      // Tag the output as BT.709 limited range so browsers use the same
      // YUV→RGB matrix the source video was encoded with. Without these tags
      // ffmpeg's default RGB→YUV conversion is BT.601, which causes a visible
      // color shift (red/skin tones in particular) when the matted overlay is
      // composited over the original mp4.
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "tv",
      "-metadata:s:v:0",
      "alpha_mode=1",
      ...audioArgs,
      ...renderProvenanceArgs(outputPath),
      outputPath,
    ];
  }
  if (format === "mov") {
    return [
      ...base,
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4444",
      "-vendor",
      "apl0",
      "-pix_fmt",
      "yuva444p10le",
      ...audioArgs,
      ...renderProvenanceArgs(outputPath),
      outputPath,
    ];
  }
  return [...base, "-frames:v", "1", "-pix_fmt", "rgba", "-update", "1", outputPath];
}

async function* readFrames(
  stream: NodeJS.ReadableStream,
  frameBytes: number,
): AsyncGenerator<Buffer> {
  let buffered: Buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffered =
      buffered.length === 0 ? (chunk as Buffer) : Buffer.concat([buffered, chunk as Buffer]);
    while (buffered.length >= frameBytes) {
      // Copy because the next concat would clobber the underlying memory.
      yield Buffer.from(buffered.subarray(0, frameBytes));
      buffered = buffered.subarray(frameBytes);
    }
  }
}

export interface RenderTargets {
  format: OutputFormat;
  inputKind: "video" | "image";
  bgFormat: OutputFormat | undefined;
}

/**
 * Resolve and validate the input/output combination before any I/O. Pure;
 * exported so unit tests can pin the error messages without spawning ffmpeg.
 */
export function resolveRenderTargets(
  inputPath: string,
  outputPath: string,
  backgroundOutputPath?: string,
): RenderTargets {
  const format = inferOutputFormat(outputPath);
  const inputKind = inferInputKind(inputPath);

  if (inputKind === "image" && format !== "png") {
    throw new Error(
      `Image input requires a .png output (got ${extname(outputPath)}). Use a video input for .webm/.mov.`,
    );
  }
  if (inputKind === "video" && format === "png") {
    throw new Error(
      `Video input requires a .webm or .mov output (got .png). Use an image input for .png.`,
    );
  }

  let bgFormat: OutputFormat | undefined;
  if (backgroundOutputPath) {
    if (inputKind === "image") {
      throw new Error(
        "--background-output is not supported for image inputs. Use a video input (mp4/mov/webm) to produce both a cutout and a background plate.",
      );
    }
    bgFormat = inferOutputFormat(backgroundOutputPath);
    if (bgFormat === "png") {
      throw new Error(
        "--background-output must be .webm or .mov; .png is only valid for single-image inputs.",
      );
    }
  }

  return { format, inputKind, bgFormat };
}

export async function render(options: RenderOptions): Promise<RenderResult> {
  const ffmpegPath = findFFmpeg();
  if (!ffmpegPath || !findFFprobe()) {
    throw new Error(`ffmpeg and ffprobe are required. Install: ${getFFmpegInstallHint()}`);
  }

  const { format, bgFormat } = resolveRenderTargets(
    options.inputPath,
    options.outputPath,
    options.backgroundOutputPath,
  );

  const media = await probeMedia(options.inputPath);

  options.onProgress?.({
    kind: "metadata",
    width: media.width,
    height: media.height,
    fps: media.fps,
    frameCount: media.frameCount,
  });

  // The smart-cutout already paid the per-frame inference cost. Reuse only a
  // matching alpha stream; stale/trimmed/opaque foregrounds go through inference.
  if (options.foregroundPath && format === "webm" && !bgFormat) {
    const foreground = await probeMedia(options.foregroundPath);
    if (foreground.hasAlpha && foreground.videoCodec === "vp9" &&
      foreground.width === media.width && foreground.height === media.height &&
      Math.abs(foreground.fps - media.fps) < 0.01 &&
      Math.abs(foreground.durationSeconds - media.durationSeconds) <= Math.max(0.25, 3 / media.fps)) {
      options.onProgress?.({ kind: "info", message: "Reusing completed foreground and preserving source audio" });
      const output = tempBeside(options.outputPath);
      const start = Date.now();
      try {
        await runCancellableProcess(ffmpegPath, [
          "-v", "error", "-y", "-i", toNamespacedPath(options.foregroundPath),
          "-i", toNamespacedPath(options.inputPath),
          "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy", "-c:a", "libopus",
          "-metadata:s:v:0", "alpha_mode=1", ...renderProvenanceArgs(options.outputPath),
          toNamespacedPath(output),
        ], { timeoutMs: 120_000, maxBufferBytes: 16_384 });
        renameSync(output, options.outputPath);
        return {
          outputPath: options.outputPath, framesProcessed: media.frameCount,
          durationSeconds: (Date.now() - start) / 1000, avgMsPerFrame: 0,
          provider: "reused-foreground", format,
        };
      } finally {
        rmSync(output, { force: true, maxRetries: 3 });
      }
    }
    options.onProgress?.({ kind: "info", message: "Foreground no longer matches source; regenerating" });
  }

  const session = await createSession({
    model: options.model,
    device: options.device,
    onProgress: (msg) => options.onProgress?.({ kind: "info", message: msg }),
  });

  const output = tempBeside(options.outputPath);
  const background = options.backgroundOutputPath && tempBeside(options.backgroundOutputPath);
  try {
    const start = Date.now();
    const framesProcessed = await runPipeline(
      { ...options, outputPath: output, backgroundOutputPath: background },
      session,
      media,
      format,
      bgFormat,
      ffmpegPath,
    );
    renameSync(output, options.outputPath);
    if (background) renameSync(background, options.backgroundOutputPath!);
    const durationSeconds = (Date.now() - start) / 1000;
    const avgMsPerFrame = framesProcessed ? (durationSeconds * 1000) / framesProcessed : 0;

    return {
      outputPath: options.outputPath,
      backgroundOutputPath: options.backgroundOutputPath,
      framesProcessed,
      durationSeconds,
      avgMsPerFrame,
      provider: session.provider,
      format,
    };
  } finally {
    await session.close();
    rmSync(output, { force: true, maxRetries: 3 });
    if (background) rmSync(background, { force: true, maxRetries: 3 });
  }
}

/** ffmpeg follows a link planted at its output mid-job; a fresh unguessable name renamed over the output cannot. */
function tempBeside(path: string): string {
  return join(dirname(path), `.tmp-${randomUUID()}-${basename(path)}`);
}

const RECENT_WINDOW = 30;

interface FfmpegProc {
  proc: ReturnType<typeof spawn>;
  exit: Promise<void>;
  /** Tail of stderr, captured for inclusion in error messages. */
  getStderr: () => string;
}

type StdioFd = "ignore" | "pipe";
type StdioTuple = [StdioFd, StdioFd, StdioFd];

function spawnFfmpeg(
  ffmpegPath: string,
  args: string[],
  label: string,
  stdio: StdioTuple,
): FfmpegProc {
  const proc = spawn(ffmpegPath, args, { stdio, windowsHide: true });
  let stderrBuf = "";
  proc.stderr?.on("data", (d: Buffer) => {
    stderrBuf = (stderrBuf + d.toString()).slice(-4000);
  });
  // If the encoder dies mid-render, the next .write() to its stdin emits an
  // 'error' event on the writable. Without a listener, Node treats it as
  // unhandled and crashes the CLI before waitForExit's reject path can
  // surface the real cause (encoder stderr tail). Swallowing here is safe —
  // the process exit is the source of truth.
  proc.stdin?.on("error", () => {});
  const exit = waitForExit(proc, label, () => stderrBuf);
  return { proc, exit, getStderr: () => stderrBuf };
}

async function runPipeline(
  options: RenderOptions,
  session: Session,
  media: MediaInfo,
  format: OutputFormat,
  bgFormat: OutputFormat | undefined,
  ffmpegPath: string,
): Promise<number> {
  const { inputPath, outputPath, backgroundOutputPath } = options;
  const { width, height, fps, frameCount } = media;
  const frameBytes = width * height * 3;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const decoder = spawnFfmpeg(
    ffmpegPath,
    [
      "-loglevel",
      "error",
      "-i",
      toNamespacedPath(inputPath),
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-an",
      "-",
    ],
    "ffmpeg decoder",
    ["ignore", "pipe", "pipe"],
  );

  const fg = spawnFfmpeg(
    ffmpegPath,
    buildEncoderArgs(
      format, width, height, fps || 30, toNamespacedPath(outputPath), quality,
      inferInputKind(inputPath) === "video" ? toNamespacedPath(inputPath) : undefined,
    ),
    "ffmpeg encoder",
    ["pipe", "ignore", "pipe"],
  );

  const bg =
    backgroundOutputPath && bgFormat
      ? spawnFfmpeg(
          ffmpegPath,
          buildEncoderArgs(
            bgFormat,
            width,
            height,
            fps || 30,
            toNamespacedPath(backgroundOutputPath),
            quality,
          ),
          "ffmpeg background encoder",
          ["pipe", "ignore", "pipe"],
        )
      : null;

  const processes = bg ? [decoder, fg, bg] : [decoder, fg];
  let processError: Error | undefined;
  const stopProcesses = () => {
    for (const { proc } of processes) {
      proc.kill("SIGKILL");
      proc.stdout?.destroy();
      proc.stdin?.destroy();
    }
  };
  // Observe failures immediately, including while decoding or writing a frame.
  // A dead encoder will never emit 'drain'; leaving the decoder alive fills its
  // stdout pipe and makes the entire job wait forever.
  for (const { exit } of processes) {
    void exit.catch((error: Error) => {
      processError ??= error;
      stopProcesses();
    });
  }

  let processed = 0;
  const total = frameCount;

  const recentMs = new Array<number>(RECENT_WINDOW).fill(0);
  let recentSum = 0;
  let recentSlot = 0;
  let recentCount = 0;

  try {
    for await (const rgb of readFrames(decoder.proc.stdout!, frameBytes)) {
      const t0 = Date.now();
      const result = await session.process(rgb, width, height, bg !== null);
      const elapsed = Date.now() - t0;

      recentSum += elapsed - recentMs[recentSlot]!;
      recentMs[recentSlot] = elapsed;
      recentSlot = (recentSlot + 1) % RECENT_WINDOW;
      if (recentCount < RECENT_WINDOW) recentCount++;

      if (processError) throw processError;
      // The callback witnesses the completed write (or EPIPE/stream closure),
      // so session-owned buffers are never reused while libuv still holds them.
      const writes = [{ proc: fg.proc, frame: result.fg }];
      if (bg && result.bg) writes.push({ proc: bg.proc, frame: result.bg });
      await Promise.all(
        writes.map(
          ({ proc, frame }) =>
            new Promise<void>((resolve, reject) => {
              proc.stdin!.write(frame, (error) => (error ? reject(error) : resolve()));
            }),
        ),
      );

      processed++;
      options.onProgress?.({
        kind: "frame",
        index: processed,
        total,
        avgMsPerFrame: recentSum / recentCount,
      });
    }
    fg.proc.stdin!.end();
    bg?.proc.stdin!.end();
    await Promise.all(processes.map(({ exit }) => exit));
  } catch (err) {
    stopProcesses();
    await Promise.allSettled(processes.map(({ exit }) => exit));
    throw processError ?? err;
  }

  if (processed === 0) {
    throw new Error(
      `No frames produced from ${inputPath}. Decoder stderr:\n${decoder.getStderr().slice(-400)}`,
    );
  }

  return processed;
}

export function waitForExit(
  proc: ReturnType<typeof spawn>,
  label: string,
  getStderr: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    // Per Node docs the exit callback is (code, signal): on a normal exit
    // `code` is the numeric exit status and `signal` is null; on a
    // signal-killed exit `code` is null and `signal` is the signal name.
    // Treating null-code as success would silently report SIGTERM/SIGKILL
    // as a successful render.
    proc.on("exit", (code, signal) => {
      if (code === 0 && !signal) {
        resolve();
        return;
      }
      const cause = signal ? `killed by ${signal}` : `exited with code ${code}`;
      reject(new Error(`${label} ${cause}: ${getStderr().slice(-400)}`));
    });
  });
}
