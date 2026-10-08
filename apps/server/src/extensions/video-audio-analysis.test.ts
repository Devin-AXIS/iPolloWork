import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { analyzeVideoMusic, prepareVideoLanguageTiming, prepareVideoSoundtrack } from "./video-audio-analysis.js";

const roots: string[] = [];
const originalCli = process.env.HYPERFRAMES_CLI_PATH;

afterEach(async () => {
  if (originalCli === undefined) delete process.env.HYPERFRAMES_CLI_PATH;
  else process.env.HYPERFRAMES_CLI_PATH = originalCli;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("returns persisted HyperFrames music cues for audio-reactive authoring", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-audio-"));
  roots.push(root);
  const project = join(root, "video", "session-one");
  await mkdir(join(project, "assets"), { recursive: true });
  await writeFile(join(project, "index.html"), '<audio data-timeline-role="music" src="assets/score.wav"></audio>');
  const cli = join(root, "hyperframes.mjs");
  await writeFile(cli, `import { mkdir, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    const project = process.argv[3];
    await mkdir(join(project, "beats", "assets"), { recursive: true });
    await writeFile(join(project, "beats", "assets", "score.wav.json"), JSON.stringify({version:1,audio:"assets/score.wav",beats:[{time:0.5,strength:0.8},{time:1.25,strength:0.6}]}));
    console.log(JSON.stringify({ok:true,file:"beats/assets/score.wav.json",count:2,bpm:96}));`);
  process.env.HYPERFRAMES_CLI_PATH = cli;

  const result = await analyzeVideoMusic({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
  expect(result).toMatchObject({
    beatPath: "video/session-one/beats/assets/score.wav.json",
    audioPath: "assets/score.wav",
    bpm: 96,
    cues: [{ time: 0.5, strength: 0.8 }, { time: 1.25, strength: 0.6 }],
  });
});

test("rejects an analyzer result whose saved cue count does not match", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-audio-"));
  roots.push(root);
  const project = join(root, "video", "session-one");
  await mkdir(join(project, "beats", "assets"), { recursive: true });
  await writeFile(join(project, "index.html"), '<audio data-timeline-role="music" src="assets/score.wav"></audio>');
  await writeFile(join(project, "beats", "assets", "score.wav.json"), JSON.stringify({
    version: 1,
    audio: "assets/score.wav",
    beats: [{ time: 0.5, strength: 0.8 }, { time: 1.25, strength: 0.6 }],
  }));
  const cli = join(root, "hyperframes.mjs");
  await writeFile(cli, 'console.log(JSON.stringify({ok:true,file:"beats/assets/score.wav.json",count:3,bpm:96}));');
  process.env.HYPERFRAMES_CLI_PATH = cli;

  await expect(analyzeVideoMusic({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" }))
    .rejects.toMatchObject({ code: "video_audio_analysis_count_mismatch" });
});

test("rejects unordered saved beat cues", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-audio-"));
  roots.push(root);
  const project = join(root, "video", "session-one");
  await mkdir(join(project, "beats", "assets"), { recursive: true });
  await writeFile(join(project, "index.html"), '<audio data-timeline-role="music" src="assets/score.wav"></audio>');
  await writeFile(join(project, "beats", "assets", "score.wav.json"), JSON.stringify({
    version: 1,
    audio: "assets/score.wav",
    beats: [{ time: 1.25, strength: 0.8 }, { time: 0.5, strength: 0.6 }],
  }));
  const cli = join(root, "hyperframes.mjs");
  await writeFile(cli, 'console.log(JSON.stringify({ok:true,file:"beats/assets/score.wav.json",count:2,bpm:96}));');
  process.env.HYPERFRAMES_CLI_PATH = cli;

  await expect(analyzeVideoMusic({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" })).rejects.toThrow();
});

test("accepts one measured cue and a unicode beat filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-video-audio-"));
  roots.push(root);
  const project = join(root, "video", "session-one");
  await mkdir(join(project, "beats", "旁白"), { recursive: true });
  await writeFile(join(project, "index.html"), '<audio data-timeline-role="music" src="assets/夜校.wav"></audio>');
  await writeFile(join(project, "beats", "旁白", "夜校.wav.json"), JSON.stringify({
    version: 1,
    audio: "assets/夜校.wav",
    beats: [{ time: 0.5, strength: 0.8 }],
  }));
  const cli = join(root, "hyperframes.mjs");
  await writeFile(cli, 'console.log(JSON.stringify({ok:true,file:"beats/旁白/夜校.wav.json",count:1,bpm:null}));');
  process.env.HYPERFRAMES_CLI_PATH = cli;

  const result = await analyzeVideoMusic({ id: "workspace", path: root }, { sourcePath: "video/session-one/index.html" });
  expect(result).toMatchObject({ beatPath: "video/session-one/beats/旁白/夜校.wav.json", cues: [{ time: 0.5, strength: 0.8 }] });
});

const exec = promisify(execFile);
const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
async function audioProject() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-soundtrack-"));
  roots.push(root);
  await mkdir(join(root, "video/session-one/assets"), { recursive: true });
  await writeFile(join(root, "video/session-one/index.html"), '<main data-composition-id="main"></main>');
  return root;
}

test("prepares actual stereo event WAVs with room tails and one overlapping native music envelope", async () => {
  const root = await audioProject();
  const result = await prepareVideoSoundtrack({ id: "w", path: root }, {
    sourcePath: "video/session-one/index.html", durationSeconds: 3, musicVolume: .5,
    events: [{ eventId: "impact", time: 1, kind: "contact", strength: 1, pan: -.8 }, { eventId: "land", time: 2, kind: "resolve", strength: .7, pan: .8 }],
    speechWindows: [{ start: .8, end: 1.8 }],
  });
  expect(result.clips).toHaveLength(2);
  for (const clip of result.clips) {
    const decoded = await exec(ffmpeg, ["-v", "error", "-i", join(root, clip.path), "-ar", "48000", "-ac", "2", "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
    const pcm = decoded.stdout, energies = [0, 0];
    for (let at = 0; at < pcm.length; at += 4) for (let channel = 0; channel < 2; channel++) energies[channel]! += pcm.readInt16LE(at + 2 * channel) ** 2;
    expect(Math.abs(pcm.length / (4 * 48000) - clip.duration)).toBeLessThan(1 / 48000);
    expect(clip.pan < 0 ? energies[0]! / energies[1]! : energies[1]! / energies[0]!).toBeGreaterThan(20);
    expect(pcm.subarray(Math.round(.15 * 48000) * 4, Math.round(.19 * 48000) * 4).some(byte => byte !== 0)).toBe(true);
    expect(clip.audioElementHtml).toContain('data-timeline-role="sfx"');
  }
  const speech = result.musicEnvelope.filter(point => point.time >= .8 && point.time <= 1.8);
  expect(speech.every(point => Math.abs(point.volume - .15) < 1e-9)).toBe(true);
  expect(result.musicEnvelope.at(-1)).toEqual({ time: 3, volume: .5 });
  expect(result.musicTimelineScript).toContain('ease:"none"');
});

test("sound events reject duplicate IDs, source escape and windows outside the film", async () => {
  const root = await audioProject(), workspace = { id: "w", path: root };
  const event = { eventId: "hit", time: 1, kind: "contact", strength: 1, pan: 0 };
  const input = { sourcePath: "video/session-one/index.html", durationSeconds: 3, events: [event] };
  await expect(prepareVideoSoundtrack(workspace, { ...input, events: [event, event] })).rejects.toMatchObject({ code: "invalid_video_soundtrack" });
  await expect(prepareVideoSoundtrack(workspace, { ...input, events: [{ ...event, assetPath: "video/other/assets/borrow.wav" }] })).rejects.toMatchObject({ code: "invalid_video_audio_asset" });
  await expect(prepareVideoSoundtrack(workspace, { ...input, speechWindows: [{ start: 2, end: 4 }] })).rejects.toMatchObject({ code: "invalid_video_soundtrack" });
});

async function timingAudio(root: string, filename: string, duration: number, words: { text: string; startSeconds: number; endSeconds: number }[]) {
  const audioPath = `video/session-one/assets/${filename}.wav`, timingSourcePath = `video/session-one/assets/${filename}.timings.json`;
  await exec(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${duration}`, "-c:a", "pcm_s16le", join(root, audioPath)]);
  let offset = 0;
  await writeFile(join(root, timingSourcePath), JSON.stringify({ alignment: "provider", audioSha256: createHash("sha256").update(await readFile(join(root, audioPath))).digest("hex"), words: words.map(word => {
    const beginIndex = offset; offset += word.text.length;
    return { ...word, beginIndex, endIndex: offset };
  }) }));
  return { audioPath, timingSourcePath, text: words.map(word => word.text).join("") };
}

test("language maps real measured files to reversible root and native child timelines; source language is identity", async () => {
  const root = await audioProject();
  const source = await timingAudio(root, "source", 2, [{ text: "动作", startSeconds: .2, endSeconds: .8 }, { text: "完成", startSeconds: 1, endSeconds: 1.8 }]);
  const variant = await timingAudio(root, "variant", 3, [{ text: "Action", startSeconds: .4, endSeconds: 1 }, { text: "Complete", startSeconds: 1.6, endSeconds: 2.8 }]);
  const input = { sourcePath: "video/session-one/index.html", source, variant, authorDurationSeconds: 2, filmDurationSeconds: 3,
    bindings: [{ source: { phrase: "完成" }, variant: { phrase: "Complete" } }], windows: [{ id: "carrier", start: .5, end: 1.5 }] };
  const mapped = await prepareVideoLanguageTiming({ id: "w", path: root }, input);
  expect(mapped.anchors).toEqual([{ author: 0, film: 0 }, { author: 1, film: 1.6 }, { author: 2, film: 3 }]);
  expect(mapped.windows[0]).toMatchObject({ id: "carrier", start: .8, end: 2.3, anchors: [{ author: 0, film: 0 }, { author: .5, film: .8 }, { author: 1, film: 1.4999999999999998 }] });
  expect(mapped.windows[0]!.duration).toBeCloseTo(1.5, 9);
  // Exercise the generated composition wrapper with the renderer's pinned
  // GSAP, including parent renders, suppressed events and exact cue callbacks.
  const module = await import(new URL("../../../../vendor/hyperframes/packages/studio/node_modules/gsap/dist/gsap.min.js", import.meta.url).href);
  const gsap = module.gsap;
  for (const mode of ["normal", "suppressed", "parent"] as const) {
    const events: number[] = [], items = [{ opacity: .18 }, { opacity: .18 }], motion = { x: 0 };
    let camera = 0;
    const author = gsap.timeline({ paused: true });
    author.set(items, { opacity: .18 }, 0);
    author.to(items[0], { opacity: .85, duration: .4, ease: "none" }, 0);
    author.to(items[1], { opacity: .85, duration: .4, ease: "none" }, 1.8);
    author.to(motion, { x: 200, duration: 2, ease: "none", onUpdate: () => { camera = motion.x; } }, 0);
    for (const time of [0, 1, 1.0005]) author.call(() => events.push(time), undefined, time);
    const window = { __timelines: { test: author, alias: author } };
    new Function("window", "gsap", "compositionId", mapped.rootTimelineScript)(window, gsap, "test");
    const film = window.__timelines.test;
    expect(window.__timelines.alias).toBe(film);
    expect(film.duration()).toBeCloseTo(3, 9);
    expect(film.getChildren(true, true, true).some((child: { duration(): number; vars: { onComplete?: unknown } }) => child.duration() === 0 && typeof child.vars.onComplete === "function")).toBe(true);
    const parent = gsap.timeline({ paused: true });
    if (mode === "parent") { film.paused(false); parent.add(film, 0); }
    const seek = (time: number) => (mode === "parent" ? parent : film).totalTime(time, mode === "suppressed");
    seek(.3); seek(1.6); seek(1.7);
    const direct = { items: items.map(item => item.opacity), x: motion.x, camera };
    expect(items[1]!.opacity).toBe(.18);
    expect(motion.x).toBeCloseTo(107.1429, 3);
    if (mode === "suppressed") { expect(events).toEqual([]); expect(camera).toBe(0); }
    else { expect(events).toEqual([0, 1, 1.0005]); expect(camera).toBeCloseTo(motion.x, 9); }
    seek(2.7); seek(1.7);
    expect(items.map(item => item.opacity)).toEqual(direct.items);
    expect(motion.x).toBeCloseTo(direct.x, 9);
    if (mode !== "suppressed") expect(camera).toBeCloseTo(direct.camera, 9);
    parent.kill(); film.kill(); author.kill();
  }
  gsap.ticker.sleep();
  const identity = await prepareVideoLanguageTiming({ id: "w", path: root }, { ...input, variant: source, filmDurationSeconds: 2, bindings: [{ source: { phrase: "完成" }, variant: { phrase: "完成" } }] });
  expect(identity.identity).toBe(true);
  expect(identity.rootTimelineScript).toBe("");
  expect(identity.windows[0]!.timelineScript).toBe("");
  await expect(prepareVideoLanguageTiming({ id: "w", path: root }, { ...input, bindings: [{ source: { phrase: "完成" }, variant: { phrase: "Action" } }, { source: { phrase: "动作" }, variant: { phrase: "Complete" } }] })).rejects.toMatchObject({ code: "invalid_video_language_alignment" });
  await writeFile(join(root, variant.audioPath), await readFile(join(root, source.audioPath)));
  await expect(prepareVideoLanguageTiming({ id: "w", path: root }, input)).rejects.toMatchObject({ code: "invalid_video_language_alignment" });
});
