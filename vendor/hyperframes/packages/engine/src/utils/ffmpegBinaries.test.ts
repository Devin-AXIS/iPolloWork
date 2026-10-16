import { resolve, win32 } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertConfiguredFfmpegBinariesExist,
  getFfmpegBinary,
  getFfprobeBinary,
  ffmpegPathArgument,
} from "./ffmpegBinaries.js";

describe("FFmpeg Windows long paths", () => {
  const originalPlatform = process.platform;
  const source = `C:/用户/video/${"nested/".repeat(36)}avatar-transparent.webm`;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("extends long input, output sequence and UNC paths on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    for (const value of [
      source,
      source.replace("avatar-transparent.webm", "frame_%05d.png"),
      `\\\\server\\share\\${"nested\\".repeat(40)}out.mp4`,
    ]) {
      expect(ffmpegPathArgument(value)).toBe(win32.toNamespacedPath(value));
      expect(ffmpegPathArgument(ffmpegPathArgument(value))).toBe(ffmpegPathArgument(value));
    }
  });

  it("preserves options, filters, pipes, URLs and short paths", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    for (const value of [
      "-i",
      "pipe:0",
      "C:/video/out.mp4",
      "renders/out.mp4",
      `https://example.com/${"video/".repeat(50)}`,
      `scale=1280:720,${"null,".repeat(60)}`,
    ]) {
      expect(ffmpegPathArgument(value)).toBe(value);
    }
  });

  it("preserves paths on other platforms", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(ffmpegPathArgument(source)).toBe(source);
  });
});

describe("ffmpeg binary env resolution", () => {
  const originalFfmpegPath = process.env.HYPERFRAMES_FFMPEG_PATH;
  const originalFfprobePath = process.env.HYPERFRAMES_FFPROBE_PATH;
  const originalPath = process.env.PATH;

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("child_process");
    if (originalFfmpegPath === undefined) delete process.env.HYPERFRAMES_FFMPEG_PATH;
    else process.env.HYPERFRAMES_FFMPEG_PATH = originalFfmpegPath;
    if (originalFfprobePath === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH;
    else process.env.HYPERFRAMES_FFPROBE_PATH = originalFfprobePath;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  it("uses configured absolute paths when env vars are set", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/tools/ffmpeg.exe";
    process.env.HYPERFRAMES_FFPROBE_PATH = "/tools/ffprobe.exe";

    expect(getFfmpegBinary()).toBe(resolve("/tools/ffmpeg.exe"));
    expect(getFfprobeBinary()).toBe(resolve("/tools/ffprobe.exe"));
  });

  it("throws a clear error when a configured FFmpeg path is missing", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(
      /FFmpeg binary not found at HYPERFRAMES_FFMPEG_PATH/,
    );
  });

  it("accepts existing configured paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = process.execPath;
    process.env.HYPERFRAMES_FFPROBE_PATH = process.execPath;

    expect(() => assertConfiguredFfmpegBinariesExist()).not.toThrow();
  });

  it("calls out a mangled replacement character in configured binary paths", () => {
    process.env.HYPERFRAMES_FFMPEG_PATH = "/missing/ffmpeg�.exe";

    expect(() => assertConfiguredFfmpegBinariesExist()).toThrow(/replacement character|mangled/i);
  });
});
