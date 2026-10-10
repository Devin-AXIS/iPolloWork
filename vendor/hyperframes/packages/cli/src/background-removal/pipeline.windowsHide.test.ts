import { EventEmitter } from "node:events";
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { Readable, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, processFrameMock, closeSessionMock, metadataMock, remuxMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  processFrameMock: vi.fn(async () => ({ fg: Buffer.alloc(4) })),
  closeSessionMock: vi.fn(async () => undefined),
  metadataMock: vi.fn(),
  remuxMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("../utils/cancellableProcess.js", () => ({ runCancellableProcess: remuxMock }));
vi.mock("../browser/ffmpeg.js", () => ({
  findFFmpeg: () => "/fake/bin/ffmpeg",
  findFFprobe: () => "/fake/bin/ffprobe",
  getFFmpegInstallHint: () => "install ffmpeg",
}));
vi.mock("./inference.js", () => ({
  createSession: async () => ({
    provider: "test",
    process: processFrameMock,
    close: closeSessionMock,
  }),
}));
vi.mock("@hyperframes/engine", () => ({
  DEFAULT_VP9_CPU_USED: 4,
  renderProvenanceArgs: () => [],
  extractMediaMetadata: metadataMock,
}));

import { render } from "./pipeline.js";

function fakeFfmpeg(stdout: Readable, output?: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: EventEmitter;
    stdin: Writable;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  let exited = false;
  const exit = (code: number | null, signal: string | null) => {
    if (exited) return;
    exited = true;
    proc.emit("exit", code, signal);
  };
  proc.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      queueMicrotask(callback);
    },
    final(callback) {
      callback();
      queueMicrotask(() => exit(0, null));
    },
  });
  proc.kill = vi.fn(() => exit(null, "SIGKILL"));
  if (output) writeFileSync(output, "rendered");
  else stdout.once("end", () => exit(0, null));
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  metadataMock.mockReset().mockResolvedValue({ width: 1, height: 1, fps: 1, durationSeconds: 1 });
  remuxMock.mockReset();
});

describe("background-removal FFmpeg child-process options", () => {
  it("reuses a matching alpha foreground and maps original audio without running inference", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    const input = join(dir, "voice.mp4");
    const foreground = join(dir, "foreground.webm");
    metadataMock.mockResolvedValueOnce({ width: 384, height: 672, fps: 24, durationSeconds: 36.47 })
      .mockResolvedValueOnce({ width: 384, height: 672, fps: 24, durationSeconds: 36.334, hasAlpha: true, videoCodec: "vp9" });
    remuxMock.mockImplementation(async (_, args: string[]) => writeFileSync(args.at(-1)!, "transparent with audio"));
    try {
      const result = await render({ inputPath: input, outputPath: join(dir, "output.webm"), foregroundPath: foreground });
      expect(result.provider).toBe("reused-foreground");
      expect(spawnMock).not.toHaveBeenCalled();
      expect(processFrameMock).not.toHaveBeenCalled();
      expect(remuxMock.mock.calls[0]![1]).toEqual(expect.arrayContaining([
        toNamespacedPath(input), toNamespacedPath(foreground), "0:v:0", "1:a:0?", "copy", "libopus", "alpha_mode=1",
      ]));
      expect(remuxMock.mock.calls[0]![2]).toEqual({ timeoutMs: 120_000, maxBufferBytes: 16_384 });
      expect(readFileSync(join(dir, "output.webm"), "utf8")).toBe("transparent with audio");
      expect(readdirSync(dir)).toEqual(["output.webm"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([
    { hasAlpha: false, durationSeconds: 1, width: 1 },
    { hasAlpha: true, durationSeconds: 8, width: 1 },
    { hasAlpha: true, durationSeconds: 1, width: 2 },
  ])("regenerates an incompatible foreground: %j", async (cached) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    metadataMock.mockResolvedValueOnce({ width: 1, height: 1, fps: 1, durationSeconds: 1 })
      .mockResolvedValueOnce({ height: 1, fps: 1, videoCodec: "vp9", ...cached });
    spawnMock.mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
      .mockImplementationOnce((_, args: string[]) => fakeFfmpeg(Readable.from([]), args.at(-1)));
    try {
      await render({ inputPath: "/tmp/input.mp4", outputPath: join(dir, "output.webm"), foregroundPath: "/tmp/fg.webm" });
      expect(remuxMock).not.toHaveBeenCalled();
      expect(processFrameMock).toHaveBeenCalledTimes(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("cleans a failed remux and preserves existing media without starting another inference", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    const output = join(dir, "output.webm");
    writeFileSync(output, "existing");
    metadataMock.mockResolvedValue({ width: 1, height: 1, fps: 1, durationSeconds: 1, hasAlpha: true, videoCodec: "vp9" });
    remuxMock.mockImplementation(async (_, args: string[]) => {
      writeFileSync(args.at(-1)!, "partial");
      throw new Error("remux failed");
    });
    try {
      await expect(render({ inputPath: "/tmp/input.mp4", outputPath: output, foregroundPath: "/tmp/fg.webm" })).rejects.toThrow("remux failed");
      expect(readFileSync(output, "utf8")).toBe("existing");
      expect(readdirSync(dir)).toEqual(["output.webm"]);
      expect(processFrameMock).not.toHaveBeenCalled();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("hides every FFmpeg console window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    spawnMock
      .mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
      .mockImplementationOnce((_, args: string[]) => fakeFfmpeg(Readable.from([]), args.at(-1)));

    await render({
      inputPath: "/tmp/input.mp4",
      outputPath: join(dir, "output.webm"),
    });
    rmSync(dir, { recursive: true, force: true });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    for (const call of spawnMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ windowsHide: true }));
    }
  });

  it("passes Windows long-path-safe input and temporary output paths to FFmpeg", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    const input = join(dir, "人物.mp4");
    spawnMock
      .mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
      .mockImplementationOnce((_, args: string[]) => fakeFfmpeg(Readable.from([]), args.at(-1)));
    try {
      await render({ inputPath: input, outputPath: join(dir, "人物.webm") });
      expect(spawnMock.mock.calls[0]![1]).toContain(toNamespacedPath(input));
      const outputArg: string = spawnMock.mock.calls[1]![1].at(-1);
      expect(outputArg).toBe(toNamespacedPath(outputArg));
      if (process.platform === "win32") expect(outputArg.startsWith("\\\\?\\")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails promptly and cleans up when the encoder dies while a frame is being written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    const decoder = fakeFfmpeg(Readable.from([Buffer.alloc(3)]));
    let encoder: ReturnType<typeof fakeFfmpeg>;
    spawnMock
      .mockImplementationOnce(() => decoder)
      .mockImplementationOnce((_, args: string[]) => {
        encoder = fakeFfmpeg(Readable.from([]), args.at(-1));
        encoder.stdin = new Writable({
          write(_chunk, _encoding, callback) {
            queueMicrotask(() => {
              encoder.stderr.emit(
                "data",
                Buffer.from("Cannot open output: No such file or directory"),
              );
              encoder.emit("exit", 1, null);
              callback(new Error("write EPIPE"));
            });
          },
        });
        return encoder;
      });
    try {
      await expect(
        render({
          inputPath: "/tmp/input.mp4",
          outputPath: join(dir, "output.webm"),
        }),
      ).rejects.toThrow(/ffmpeg encoder exited with code 1: Cannot open output/);
      expect(decoder.kill).toHaveBeenCalled();
      expect(closeSessionMock).toHaveBeenCalledOnce();
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unblocks the decoder if an encoder fails before any frame arrives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
    const decoder = fakeFfmpeg(new Readable({ read() {} }));
    spawnMock
      .mockImplementationOnce(() => decoder)
      .mockImplementationOnce(() => {
        const encoder = fakeFfmpeg(Readable.from([]));
        queueMicrotask(() => {
          encoder.stderr.emit("data", Buffer.from("encoder unavailable"));
          encoder.emit("exit", 1, null);
        });
        return encoder;
      });
    try {
      await expect(
        render({
          inputPath: "/tmp/input.mp4",
          outputPath: join(dir, "output.webm"),
        }),
      ).rejects.toThrow(/encoder unavailable/);
      expect(decoder.stdout.destroyed).toBe(true);
      expect(closeSessionMock).toHaveBeenCalledOnce();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("background-removal output", () => {
  it.skipIf(process.platform === "win32")(
    "lands at the output path even when a link is planted there mid-job, leaving its target alone",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-bg-removal-"));
      const outside = join(dir, "outside.webm");
      const output = join(dir, "cutout.webm");
      writeFileSync(outside, "keep");
      spawnMock
        .mockImplementationOnce(() => fakeFfmpeg(Readable.from([Buffer.alloc(3)])))
        .mockImplementationOnce((_, args: string[]) => {
          symlinkSync(outside, output);
          return fakeFfmpeg(Readable.from([]), args.at(-1));
        });
      try {
        await render({ inputPath: "/tmp/input.mp4", outputPath: output });
        expect(readFileSync(outside, "utf-8")).toBe("keep");
        const fd = openSync(output, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          expect(readFileSync(fd, "utf-8")).toBe("rendered");
        } finally {
          closeSync(fd);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
