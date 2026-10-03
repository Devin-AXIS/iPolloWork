import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeVideoMusic } from "./video-audio-analysis.js";

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
