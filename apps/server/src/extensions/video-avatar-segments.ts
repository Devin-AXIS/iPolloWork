import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_AVATAR_SECONDS, type AvatarSegment } from "@ipollowork/types/video-generation";
import { MAX_VIDEO_MEDIA_BYTES } from "@ipollowork/types/video-image-workbench";
import { ApiError } from "../errors.js";
import { resolveWithinRoot } from "../paths.js";
import type { WorkspaceInfo } from "../types.js";

const execute = promisify(execFile);
const FPS = 24;
const frame = (seconds: number) => Math.round(seconds * FPS) / FPS;
const binary = () => process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg";
const codec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "24", "-threads", "2"];
async function ffmpeg(args: string[], signal?: AbortSignal) {
  return execute(binary(), ["-nostdin", "-hide_banner", ...args], { windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024, signal });
}

/** The overlap belongs to the same narration timestamps, never duplicated speech. */
export function planAvatarSegments(duration: number, silences: number[] = []): AvatarSegment[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AVATAR_SECONDS) throw new ApiError(400, "avatar_duration", `配音需在 ${MAX_AVATAR_SECONDS / 60} 分钟以内。`);
  const boundaries = [0];
  while (duration - boundaries[boundaries.length - 1] > 14) {
    const start = boundaries[boundaries.length - 1];
    const target = start + 12;
    const candidates = silences.filter(time => time >= start + 10 && time <= start + 13);
    boundaries.push(frame(candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target));
  }
  boundaries.push(duration);
  return boundaries.slice(1).map((end, index) => ({
    start: Math.max(0, boundaries[index] - (index ? .5 : 0)),
    end: Math.min(duration, end + (index < boundaries.length - 2 ? .5 : 0)),
    status: "pending", upstreamId: "", path: "", attempt: 0,
  }));
}

export async function prepareAvatarSegments(workspace: WorkspaceInfo, audioPath: string, duration: number) {
  const input = await resolveWithinRoot(workspace.path, audioPath);
  const { stderr } = await ffmpeg(["-v", "info", "-i", input, "-af", "silencedetect=noise=-35dB:d=0.15", "-f", "null", "-"]);
  const silences: number[] = [];
  let start = 0;
  for (const match of stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    if (match[1] === "start") start = Number(match[2]);
    else silences.push((start + Number(match[2])) / 2);
  }
  return planAvatarSegments(duration, silences);
}

export async function sliceAvatarAudio(workspace: WorkspaceInfo, audioPath: string, segment: AvatarSegment, output: string, signal?: AbortSignal) {
  const input = await resolveWithinRoot(workspace.path, audioPath);
  const destination = await resolveWithinRoot(workspace.path, output);
  const partial = `${destination}.${randomUUID()}.wav`;
  try {
    await ffmpeg(["-v", "error", "-ss", String(segment.start), "-i", input, "-t", String(segment.end - segment.start), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", partial], signal);
    await rename(partial, destination);
  } finally { await unlink(partial).catch(() => undefined); }
  return output;
}

type AvatarSeam = { time: number; difference: number; blend: number };

/** Compare only corresponding timestamps; center crop gives the person more weight than scenery. */
export function chooseAvatarSeam(left: Uint8Array, right: Uint8Array, start: number, size = 96 * 96): AvatarSeam {
  const count = Math.min(Math.floor(left.length / size), Math.floor(right.length / size));
  if (count < 6) throw new ApiError(422, "avatar_overlap_missing", "生成片段缺少完整重叠画面，请重试该片段。");
  let best = Infinity, bestIndex = 2, difference = 1;
  for (let index = 2; index < count - 2; index++) {
    let mismatch = 0, motion = 0;
    for (let pixel = 0; pixel < size; pixel++) {
      const offset = index * size + pixel;
      mismatch += Math.abs(left[offset] - right[offset]);
      motion += Math.abs(left[offset] - left[offset - size]) + Math.abs(right[offset] - right[offset - size]);
    }
    const error = mismatch / (size * 255);
    const score = error + .25 * motion / (size * 255);
    if (score < best) { best = score; bestIndex = index; difference = error; }
  }
  // A short dissolve is reserved for near-aligned images; larger differences need review.
  return { time: frame(start + bestIndex / FPS), difference, blend: difference < .045 ? 4 / FPS : 0 };
}

async function overlapFrames(path: string, start: number, duration: number, signal?: AbortSignal) {
  const { stdout } = await execute(binary(), ["-nostdin", "-v", "error", "-ss", String(start), "-i", path, "-t", String(duration), "-an", "-vf", "fps=24,crop=iw*0.7:ih*0.85:iw*0.15:ih*0.05,scale=96:96,format=gray", "-threads", "1", "-f", "rawvideo", "pipe:1"],
    { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: "buffer", signal });
  return stdout;
}

/** Small independent encodes keep memory bounded even for ten-minute narration. */
export async function joinAvatarSegments(workspace: WorkspaceInfo, segments: AvatarSegment[], audioPath: string, duration: number, output: string, signal?: AbortSignal) {
  const paths = await Promise.all(segments.map(segment => resolveWithinRoot(workspace.path, segment.path)));
  const destination = await resolveWithinRoot(workspace.path, output);
  const audio = await resolveWithinRoot(workspace.path, audioPath);
  const seams: AvatarSeam[] = [];
  for (let index = 1; index < segments.length; index++) {
    const start = segments[index].start, overlap = segments[index - 1].end - start;
    const [left, right] = await Promise.all([
      overlapFrames(paths[index - 1], start - segments[index - 1].start, overlap, signal),
      overlapFrames(paths[index], 0, overlap, signal),
    ]);
    seams.push(chooseAvatarSeam(left, right, start));
  }
  const rejected = seams.findIndex(seam => seam.difference > .12);
  if (rejected >= 0) throw new ApiError(422, "avatar_seam_mismatch", `第 ${rejected + 2} 段与前段人物差异较大，请重试此片段后再拼接。`);
  const temporary: string[] = [], parts: string[] = [];
  const prefix = join(dirname(destination), `.avatar-${randomUUID()}`);
  const makePath = (suffix: string) => { const path = `${prefix}-${suffix}`; temporary.push(path); return path; };
  try {
    for (let index = 0; index < segments.length; index++) {
      const previous = seams[index - 1], next = seams[index];
      const start = previous ? previous.time + previous.blend / 2 : 0;
      const end = next ? next.time - next.blend / 2 : duration;
      const part = makePath(`body-${index}.mp4`);
      await ffmpeg(["-v", "error", "-ss", String(start - segments[index].start), "-i", paths[index], "-t", String(end - start), "-an", "-vf", "fps=24,setsar=1,setpts=PTS-STARTPTS", ...codec, part], signal);
      parts.push(part);
      if (next?.blend) {
        const transition = makePath(`seam-${index}.mp4`), at = next.time - next.blend / 2;
        await ffmpeg(["-v", "error", "-ss", String(at - segments[index].start), "-i", paths[index], "-ss", String(at - segments[index + 1].start), "-i", paths[index + 1],
          "-filter_complex", `[0:v]fps=24,setsar=1,settb=1/24,setpts=PTS-STARTPTS[a];[1:v]fps=24,setsar=1,settb=1/24,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=${next.blend}:offset=0[out]`,
          "-map", "[out]", "-t", String(next.blend), "-an", "-filter_complex_threads", "1", ...codec, transition], signal);
        parts.push(transition);
      }
    }
    const list = makePath("concat.txt"), result = makePath("result.mp4");
    await writeFile(list, parts.map(path => `file '${basename(path)}'`).join("\n"));
    await ffmpeg(["-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-t", String(duration), "-movflags", "+faststart", result], signal);
    const info = await stat(result);
    if (!info.size || info.size > MAX_VIDEO_MEDIA_BYTES) throw new ApiError(413, "avatar_output_size", "长数字人视频超过素材大小限制，请缩短配音。已生成片段仍然保留。");
    await rename(result, destination);
    return { path: output, seams };
  } finally { await Promise.all(temporary.map(path => unlink(path).catch(() => undefined))); }
}
