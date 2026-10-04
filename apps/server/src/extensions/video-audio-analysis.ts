import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, posix } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { ApiError } from "../errors.js";
import { resolveWithinRoot } from "../paths.js";
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

const seconds = z.number().finite().nonnegative().max(3600);
const windowSchema = z.object({ start: seconds, end: seconds }).strict().refine(value => value.end > value.start);
export const videoSoundtrackInput = inputSchema.extend({
  durationSeconds: seconds.positive(),
  events: z.array(z.object({
    eventId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u), time: seconds,
    kind: z.enum(["air", "contact", "resolve"]), strength: z.number().min(0).max(1),
    pan: z.number().min(-1).max(1), assetPath: z.string().min(1).optional(),
  }).strict()).max(128),
  speechWindows: z.array(windowSchema).max(256).default([]),
  musicVolume: z.number().min(0).max(1).default(.25),
}).strict();

async function projectAsset(workspace: { path: string }, sourcePath: string, assetPath: string) {
  const file = resolveWorkspaceFile(workspace.path, assetPath);
  const metadata = await stat(file.absolutePath).catch(() => null);
  if (!file.relativePath.startsWith(`${posix.dirname(sourcePath)}/assets/`)
    || !metadata?.isFile() || metadata.size > 100 * 1024 * 1024) {
    throw new ApiError(400, "invalid_video_audio_asset", "Audio and timing assets must be existing files under 100 MiB in this video's assets directory.");
  }
  await resolveWithinRoot(dirname(resolveWorkspaceFile(workspace.path, sourcePath).absolutePath), posix.relative(posix.dirname(sourcePath), file.relativePath));
  return file;
}

// One piecewise linear envelope feeds the existing preview/probe/export volume path.
function musicEnvelope(duration: number, volume: number, windows: { start: number; end: number; factor: number }[]) {
  const ramps = windows.map(window => [
    { time: Math.max(0, window.start - .08), volume },
    { time: window.start, volume: volume * window.factor },
    { time: window.end, volume: volume * window.factor },
    { time: Math.min(duration, window.end + .18), volume },
  ]);
  const valueAt = (points: { time: number; volume: number }[], time: number) => {
    if (time < points[0]!.time || time > points[3]!.time) return volume;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!, b = points[index]!;
      if (time <= b.time) return b.time === a.time ? b.volume : a.volume + (b.volume - a.volume) * (time - a.time) / (b.time - a.time);
    }
    return volume;
  };
  // Include intersections: overlapping attack/release ramps must not unduck midway.
  const times = new Set([0, duration, ...ramps.flatMap(points => points.map(point => point.time))]);
  const ordered = [...times].sort((a, b) => a - b);
  for (let index = 1; index < ordered.length; index++) {
    const a = ordered[index - 1]!, b = ordered[index]!;
    const slopes = new Map<string, { a: number; b: number }>();
    for (const ramp of ramps) {
      const start = valueAt(ramp, a), end = valueAt(ramp, b), slope = ((end - start) / (b - a)).toFixed(9);
      if (!slopes.has(slope) || start < slopes.get(slope)!.a) slopes.set(slope, { a: start, b: end });
    }
    const lines = [...slopes.values()];
    for (let first = 0; first < lines.length; first++) for (let second = first + 1; second < lines.length; second++) {
      const da = lines[first]!.a - lines[second]!.a;
      const db = lines[first]!.b - lines[second]!.b;
      if (da * db < 0) times.add(a + (b - a) * da / (da - db));
    }
  }
  return [...times].sort((a, b) => a - b).map(time => ({ time, volume: Math.min(volume, ...ramps.map(points => valueAt(points, time))) }));
}

export async function prepareVideoSoundtrack(workspace: { id: string; path: string }, raw: unknown) {
  const input = videoSoundtrackInput.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  await resolveWithinRoot(workspace.path, input.sourcePath);
  if (!(await stat(source.absolutePath).catch(() => null))?.isFile()) throw new ApiError(404, "video_source_not_found", "The active video index.html does not exist");
  if (new Set(input.events.map(event => event.eventId)).size !== input.events.length
    || input.events.some(event => event.time >= input.durationSeconds)
    || input.speechWindows.some(window => window.end > input.durationSeconds)) {
    throw new ApiError(400, "invalid_video_soundtrack", "Events need unique IDs and all locked windows must fit the composition.");
  }
  const prepared = await Promise.all(input.events.map(async event => ({ ...event,
    source: event.assetPath ? await projectAsset(workspace, input.sourcePath, event.assetPath) : null,
  })));
  const outputDirectory = resolveWorkspaceFile(workspace.path, `${posix.dirname(input.sourcePath)}/assets/sfx-${randomUUID()}`);
  await resolveWithinRoot(dirname(source.absolutePath), "assets");
  if (prepared.length) await mkdir(outputDirectory.absolutePath, { recursive: true });
  const clips: { eventId: string; path: string; start: number; duration: number; pan: number; provenance: string; audioElementHtml: string }[] = [];
  try {
    for (const event of prepared) {
      const bodyDuration = event.kind === "air" ? .3 : event.kind === "contact" ? .15 : .55;
      const duration = Math.min(bodyDuration + .16, input.durationSeconds - event.time);
      const path = resolveWorkspaceFile(workspace.path, `${outputDirectory.relativePath}/${event.eventId}.wav`);
      const left = Math.cos((event.pan + 1) * Math.PI / 4).toFixed(8), right = Math.sin((event.pan + 1) * Math.PI / 4).toFixed(8);
      const oscillator = event.kind === "contact"
        ? "0.25*sin(2*PI*165*t)*exp(-32*t)+0.12*sin(2*PI*740*t)*exp(-70*t)"
        : "0.14*(sin(2*PI*440*t)+0.5*sin(2*PI*660*t))*exp(-7*t)";
      const seed = Number.parseInt(createHash("sha256").update(event.eventId).digest("hex").slice(0, 8), 16);
      const generated = event.kind === "air"
        ? `anoisesrc=color=pink:amplitude=0.18:duration=${bodyDuration}:sample_rate=48000:seed=${seed}`
        : `aevalsrc=${oscillator}:s=48000:d=${bodyDuration}`;
      const filters = `aformat=sample_fmts=fltp:channel_layouts=mono,atrim=duration=${bodyDuration},afade=t=in:st=0:d=0.005,afade=t=out:st=${bodyDuration - .04}:d=0.04,volume=${event.strength},aecho=0.8:0.9:25|43:0.08|0.04,apad,atrim=duration=${duration},pan=stereo|c0=${left}*c0|c1=${right}*c0`;
      await execute(process.env.HYPERFRAMES_FFMPEG_PATH?.trim() || "ffmpeg", ["-nostdin", "-v", "error", "-n",
        ...(event.source ? ["-i", event.source.absolutePath] : ["-f", "lavfi", "-i", generated]),
        "-af", filters, "-ar", "48000", "-c:a", "pcm_s16le", path.absolutePath,
      ], { timeout: 15_000, maxBuffer: 512 * 1024, windowsHide: true });
      const relative = posix.relative(posix.dirname(input.sourcePath), path.relativePath);
      const htmlPath = relative.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
      clips.push({ eventId: event.eventId, path: path.relativePath, start: event.time, duration, pan: event.pan,
        provenance: event.source ? `local:${event.source.relativePath}` : "ipollowork-procedural",
        audioElementHtml: `<audio id="sfx-${event.eventId}" class="clip" src="${htmlPath}" data-timeline-role="sfx" data-start="${event.time}" data-duration="${duration}" data-track-index="4" data-volume="1"></audio>`,
      });
    }
  } catch (error) {
    await rm(outputDirectory.absolutePath, { recursive: true, force: true });
    throw new ApiError(422, "video_soundtrack_prepare_failed", `Could not prepare the locked soundtrack: ${String(error).replaceAll(workspace.path, "<workspace>").slice(0, 500)}`);
  }
  const envelope = musicEnvelope(input.durationSeconds, input.musicVolume, [
    ...input.speechWindows.map(window => ({ ...window, factor: .3 })),
    ...clips.map(clip => ({ start: clip.start, end: clip.start + clip.duration, factor: .55 })),
  ]);
  return { sourcePath: input.sourcePath, clips, room: { delaysMs: [25, 43], decays: [.08, .04] }, musicEnvelope: envelope,
    musicTimelineScript: `{const music=document.querySelector('audio[data-timeline-role="music"]');\nif(music){tl.set(music,{volume:${input.musicVolume}},0);\n${envelope.slice(1).map((point, index) => `tl.to(music,{volume:${point.volume},duration:${point.time - envelope[index]!.time},ease:"none"},${envelope[index]!.time});`).join("\n")}\n}}`,
    instruction: "Mount the separate returned clips under the composition root; preserve their source, time and duration. Add musicTimelineScript to the same paused root timeline (tl). Record local sound provenance/license in the storyboard. Retiming a visual event requires regenerating or moving its exact sound clip and re-probing the envelope.",
  };
}

const narrationSchema = z.object({ audioPath: z.string().min(1), timingSourcePath: z.string().min(1), text: z.string().min(1).max(100000) }).strict();
const phraseSchema = z.object({ phrase: z.string().min(1), occurrence: z.number().int().positive().optional() }).strict();
export const videoLanguageTimingInput = inputSchema.extend({
  source: narrationSchema, variant: narrationSchema,
  authorDurationSeconds: seconds.positive(), filmDurationSeconds: seconds.positive(),
  bindings: z.array(z.object({ source: phraseSchema, variant: phraseSchema }).strict()).max(254),
  windows: z.array(windowSchema.extend({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u) })).max(256).default([]),
}).strict();

export async function prepareVideoLanguageTiming(workspace: { id: string; path: string }, raw: unknown) {
  const input = videoLanguageTimingInput.parse(raw);
  const source = resolveWorkspaceFile(workspace.path, input.sourcePath);
  await resolveWithinRoot(workspace.path, input.sourcePath);
  if (!(await stat(source.absolutePath).catch(() => null))?.isFile()) throw new ApiError(404, "video_source_not_found", "The active video index.html does not exist");
  const timingSchema = z.object({ alignment: z.literal("provider"), audioSha256: z.string().optional(), words: z.array(z.object({
    text: z.string(), beginIndex: z.number().int().nonnegative(), endIndex: z.number().int().positive(),
    startSeconds: seconds, endSeconds: seconds,
  })).min(1).max(10000) });
  const narrations = await Promise.all(([input.source, input.variant] as const).map(async (narration, index) => {
    const audio = await projectAsset(workspace, input.sourcePath, narration.audioPath);
    const timing = await projectAsset(workspace, input.sourcePath, narration.timingSourcePath);
    if ((await stat(timing.absolutePath)).size > 4 * 1024 * 1024) throw new ApiError(400, "invalid_video_language_alignment", "Timing sidecars are bounded to 4 MiB.");
    const data = timingSchema.parse(JSON.parse(await readFile(timing.absolutePath, "utf8")));
    const hash = createHash("sha256").update(await readFile(audio.absolutePath)).digest("hex");
    const { stdout } = await execute(process.env.HYPERFRAMES_FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audio.absolutePath], { timeout: 15_000, maxBuffer: 1024 });
    const duration = Number(stdout), fullDuration = index === 0 ? input.authorDurationSeconds : input.filmDurationSeconds;
    const significant = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "");
    if (!Number.isFinite(duration) || duration <= 0 || duration > fullDuration + 1 / 30
      || (data.audioSha256 && data.audioSha256 !== hash)
      || significant(data.words.map(word => word.text).join("")) !== significant(narration.text)
      || data.words.some((word, wordIndex) => word.endSeconds <= word.startSeconds || word.endSeconds > duration + 1 / 30
        || significant(narration.text.slice(word.beginIndex, word.endIndex)) !== significant(word.text)
        || (wordIndex > 0 && (word.startSeconds < data.words[wordIndex - 1]!.endSeconds || word.beginIndex < data.words[wordIndex - 1]!.endIndex)))) {
      throw new ApiError(400, "invalid_video_language_alignment", "Use the exact current audio, complete transcript and ordered measured provider word timing.");
    }
    return { ...narration, ...data, audioDurationSeconds: duration, audioSha256: hash };
  }));
  const anchor = (narration: typeof narrations[number], binding: z.infer<typeof phraseSchema>) => {
    const matches: number[] = [];
    for (let at = narration.text.indexOf(binding.phrase); at >= 0; at = narration.text.indexOf(binding.phrase, at + binding.phrase.length)) matches.push(at);
    const at = matches[(binding.occurrence ?? 1) - 1];
    const word = narration.words.find(word => at !== undefined && word.beginIndex <= at && word.endIndex > at);
    if (!word || (!binding.occurrence && matches.length !== 1)) throw new ApiError(400, "invalid_video_language_alignment", "Semantic phrases need unambiguous measured word anchors; do not infer translation correspondence.");
    return word.startSeconds;
  };
  const anchors = [{ author: 0, film: 0 }, ...input.bindings.map(binding => ({
    author: anchor(narrations[0]!, binding.source), film: anchor(narrations[1]!, binding.variant),
  })).filter(point => point.author !== 0 || point.film !== 0), { author: input.authorDurationSeconds, film: input.filmDurationSeconds }];
  if (anchors.some((point, index) => index > 0 && (point.author <= anchors[index - 1]!.author || point.film <= anchors[index - 1]!.film))) {
    throw new ApiError(400, "invalid_video_language_alignment", "Language anchors must be strictly increasing in both directions, inside complete film boundaries.");
  }
  const map = (time: number, from: "author" | "film", to: "author" | "film") => {
    const index = anchors.findIndex(point => point[from] >= time);
    const b = anchors[Math.max(1, index)]!, a = anchors[Math.max(1, index) - 1]!;
    return a[to] + (b[to] - a[to]) * (time - a[from]) / (b[from] - a[from]);
  };
  const script = (points: typeof anchors) => {
    if (points.every(point => point.author === point.film)) return "";
    // Drive the author after GSAP finishes the film render. A property setter
    // reenters GSAP during zero-time set rendering and can corrupt future values.
    return `{
window.__hfFlushSync?.();
const registered=window.__timelines[compositionId];
const author=registered.__hfReal??registered;
author.parent?.remove(author);author.pause(0);
const cursor={time:0};
const film=gsap.timeline({paused:true});
author.timeScale(${points.at(-1)!.author / points.at(-1)!.film});film.add(author,0);author.pause(0);
film.set(cursor,{time:0},0);
${points.slice(1).map((point, index) => `film.to(cursor,{time:${point.author},duration:${point.film - points[index]!.film},ease:"none"},${points[index]!.film});`).join("\n")}
window.__hfFlushSync?.();
const renderer=film.__hfReal??film,render=renderer.render;
renderer.render=function(time,suppressEvents,force){
  const result=render.call(this,time,suppressEvents,force);
  author.totalTime(cursor.time,suppressEvents);return result;
};
for(const key of Object.keys(window.__timelines)){
  if(window.__timelines[key]===registered||window.__timelines[key]===author)window.__timelines[key]=film;
}
window.__timelines[compositionId]=film;
}`;
  };
  if (new Set(input.windows.map(window => window.id)).size !== input.windows.length || input.windows.some(window => window.end > input.authorDurationSeconds)) throw new ApiError(400, "invalid_video_language_alignment", "Authored clip windows need unique IDs and must fit the author timeline.");
  return { sourcePath: input.sourcePath, anchors, identity: anchors.every(point => point.author === point.film),
    sourceAudioDurationSeconds: narrations[0]!.audioDurationSeconds, variantAudioDurationSeconds: narrations[1]!.audioDurationSeconds,
    rootTimelineScript: script(anchors),
    windows: input.windows.map(window => {
      const start = map(window.start, "author", "film"), end = map(window.end, "author", "film");
      const local = [{ author: window.start, film: start }, ...anchors.filter(point => point.author > window.start && point.author < window.end), { author: window.end, film: end }]
        .map(point => ({ author: point.author - window.start, film: point.film - start }));
      return { id: window.id, start, end, duration: end - start, anchors: local, timelineScript: script(local) };
    }),
    instruction: "Set compositionId to each actual owning composition ID. Wrap its paused author timeline once with the returned root/child timelineScript after construction, then register only the film timeline. Retain one HTML/variables/design system. Remap authored visual/event/caption windows through anchors; native children use returned local anchors and matching host AND child duration. Narration plays its real variant audio at normal speed; do not warp audio playback or measured variant captions. Replace a locale wrapper rather than wrapping it twice. Direct/reverse seeking and original-language identity must pass before delivery.",
  };
}
