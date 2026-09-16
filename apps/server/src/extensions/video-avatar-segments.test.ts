import { test, expect } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseAvatarSeam, joinAvatarSegments, planAvatarSegments, sliceAvatarAudio } from "./video-avatar-segments.js";
import type { WorkspaceInfo } from "../types.js";

test("segment windows cover the original timeline with one-second overlap and obey the 15-second provider limit", () => {
  for (const duration of [15.01, 16, 28, 58.026, 59.999, 60, 599.99, 600]) {
    const segments = planAvatarSegments(duration, [11.7, 24.2, 35.5, 47.25]);
    expect(segments[0].start).toBe(0);
    expect(segments.at(-1)?.end).toBe(duration);
    for (const [index, segment] of segments.entries()) {
      expect(segment.end - segment.start).toBeLessThanOrEqual(15);
      expect(segment.end).toBeGreaterThan(segment.start);
      if (index) expect(segments[index - 1].end - segment.start).toBeCloseTo(1, 5);
    }
  }
  expect(() => planAvatarSegments(601)).toThrow();
  expect(() => planAvatarSegments(NaN)).toThrow();
});

test("seam selection compares matching timestamps and reserves blending for aligned frames", () => {
  const a = new Uint8Array(24 * 4).fill(90), b = new Uint8Array(a.length).fill(160);
  b.fill(90, 12 * 4, 14 * 4);
  const seam = chooseAvatarSeam(a, b, 11, 4);
  expect(seam.time).toBeCloseTo(11 + 13 / 24);
  expect(seam.difference).toBe(0);
  expect(seam.blend).toBeCloseTo(4 / 24);
  expect(chooseAvatarSeam(a, new Uint8Array(a.length).fill(250), 0, 4).difference).toBeGreaterThan(.12);
  expect(() => chooseAvatarSeam(new Uint8Array(1), new Uint8Array(1), 0)).toThrow();
});

test("real FFmpeg stitching preserves all frames and exactly one continuous narration track", async () => {
  const root = await mkdtemp(join(tmpdir(), "avatar-seams-"));
  const workspace: WorkspaceInfo = { id: "test", name: "test", path: root, preset: "starter", workspaceType: "local" };
  const exec = promisify(execFile), ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg", ffprobe = process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
  const run = (args: string[]) => exec(ffmpeg, ["-v", "error", ...args], { windowsHide: true });
  try {
    const duration = 28.125, segments = planAvatarSegments(duration);
    await run(["-f", "lavfi", "-i", `testsrc2=size=160x160:rate=24:duration=${duration}`, "-c:v", "libx264", "-threads", "1", join(root, "source.mp4")]);
    await run(["-f", "lavfi", "-i", `sine=frequency=440:sample_rate=24000:duration=${duration}`, "-c:a", "pcm_s16le", join(root, "voice.wav")]);
    for (const [index, segment] of segments.entries()) {
      segment.path = `part-${index}.mp4`; segment.status = "succeeded";
      await run(["-ss", String(segment.start), "-i", join(root, "source.mp4"), "-t", String(segment.end - segment.start), "-an", "-c:v", "libx264", "-threads", "1", join(root, segment.path)]);
    }
    await sliceAvatarAudio(workspace, "voice.wav", segments[1], "slice.wav");
    const joined = await joinAvatarSegments(workspace, segments, "voice.wav", duration, "result.mp4");
    expect(joined.seams).toHaveLength(2);
    expect(joined.seams.every(seam => seam.difference < .045)).toBe(true);
    const probe = await exec(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", join(root, joined.path)], { windowsHide: true });
    const meta = JSON.parse(probe.stdout);
    expect(meta.streams.filter((stream: { codec_type: string }) => stream.codec_type === "audio")).toHaveLength(1);
    expect(Number(meta.streams.find((stream: { codec_type: string }) => stream.codec_type === "video").nb_frames)).toBe(Math.round(duration * 24));
    expect(Math.abs(Number(meta.format.duration) - duration)).toBeLessThan(.08);
    const decoded = await exec(ffmpeg, ["-v", "error", "-i", join(root, joined.path), "-map", "0:a", "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"], { encoding: "buffer", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    // AAC padding is allowed, missing speech samples are not.
    expect(decoded.stdout.length / 2 / 24000).toBeGreaterThanOrEqual(duration - .03);
    for (const seam of joined.seams) {
      const begin = Math.round((seam.time - .1) * 24000), end = Math.round((seam.time + .1) * 24000);
      let power = 0;
      for (let sample = begin; sample < end; sample++) power += decoded.stdout.readInt16LE(sample * 2) ** 2;
      expect(Math.sqrt(power / (end - begin))).toBeGreaterThan(2000);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
