import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { ApiError } from "../errors.js";
import { resolveWorkspaceFile } from "./storage.js";

const execute = promisify(execFile);
const inputSchema = z.object({
  sourcePath: z.string().regex(/^video\/[A-Za-z0-9_-]+\/index\.html$/u),
}).strict();
const beatFilePathSchema = z.string()
  .min(1)
  .refine((value) => {
    const normalized = value.replaceAll("\\", "/");
    return normalized.startsWith("beats/")
      && normalized.endsWith(".json")
      && posix.normalize(normalized) === normalized
      && normalized.split("/").every(segment => segment !== "." && segment !== "..");
  });
const cliResultSchema = z.object({ ok: z.literal(true), file: beatFilePathSchema, count: z.number().int().positive(), bpm: z.number().positive().nullable() });
const beatCueSchema = z.object({ time: z.number().nonnegative(), strength: z.number().min(0).max(1) }).strict();
const beatFileSchema = z.object({
  version: z.literal(1),
  audio: z.string().min(1),
  beats: z.array(beatCueSchema).min(1).superRefine((beats, context) => {
    for (let index = 1; index < beats.length; index += 1) {
      const previous = beats[index - 1];
      const current = beats[index];
      if (previous && current && current.time <= previous.time) {
        context.addIssue({ code: "custom", message: "Beat cues must be strictly increasing", path: [index, "time"] });
      }
    }
  }),
}).strict();

export async function analyzeVideoMusic(workspace: { id: string; path: string }, raw: unknown) {
  const input = inputSchema.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  if (!(await stat(source.absolutePath).catch(() => null))?.isFile()) {
    throw new ApiError(404, "video_source_not_found", "The active video index.html does not exist");
  }
  const cli = process.env.HYPERFRAMES_CLI_PATH?.trim();
  if (!cli || !(await stat(cli).catch(() => null))?.isFile()) {
    throw new ApiError(503, "video_audio_analysis_unavailable", "The bundled HyperFrames audio analyzer is unavailable. Restart the complete iPolloWork client before retrying.");
  }
  const projectDirectory = dirname(source.absolutePath);
  let stdout: string;
  try {
    const result = await execute(process.execPath, [cli, "beats", projectDirectory, "--json"], {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    stdout = result.stdout;
  } catch (error) {
    const rawDetail = error instanceof Error ? error.message : String(error);
    const detail = rawDetail.replaceAll(projectDirectory, "<video-project>").replaceAll(workspace.path, "<workspace>");
    throw new ApiError(422, "video_audio_analysis_failed", `HyperFrames could not detect usable music beats: ${detail.slice(0, 500)}`);
  }
  const parsed = cliResultSchema.parse(JSON.parse(stdout));
  const beatPath = posix.join(posix.dirname(input.sourcePath), parsed.file.replaceAll("\\", "/"));
  const beatFile = resolveWorkspaceFile(workspace.path, beatPath);
  const analysis = beatFileSchema.parse(JSON.parse(await readFile(beatFile.absolutePath, "utf8")));
  if (parsed.count !== analysis.beats.length) {
    throw new ApiError(422, "video_audio_analysis_count_mismatch", "The saved beat analysis does not match the analyzer result. Run the analysis again.");
  }
  return {
    sourcePath: input.sourcePath,
    beatPath: beatFile.relativePath,
    audioPath: analysis.audio,
    bpm: parsed.bpm,
    cues: analysis.beats,
    instruction: "For an audio-reactive scene, copy only meaningful saved cues into data-ipw-audio-cues, quantize them to project frames, bind each cue to a concrete visual beat, and keep data-ipw-timing-source=music. Do not animate every detected beat.",
  };
}
