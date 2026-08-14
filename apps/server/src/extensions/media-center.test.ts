import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import {
  MEDIA_EXTENSION_ACTIONS,
  MEDIA_EXTENSION_ID,
  callMediaExtensionAction,
  estimateVoiceoverDurationSeconds,
  planSceneVoiceoverTiming,
  validateVoiceoverTimelineHtml,
} from "./media-center.js";

const nativeFetch = globalThis.fetch;
const mediaProviderFetchKey = Symbol.for("ipollowork.mediaProviderFetch");
const nativeMediaProviderFetch: unknown = Reflect.get(globalThis, mediaProviderFetchKey);
const directories: string[] = [];

const config = {
  workspaces: [],
} as unknown as ServerConfig;

function env(values: Record<string, string>): EnvService {
  return {
    list: async () => Object.entries(values).map(([key, value]) => ({ key, value, updatedAt: 0 })),
  } as unknown as EnvService;
}

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  if (nativeMediaProviderFetch === undefined) Reflect.deleteProperty(globalThis, mediaProviderFetchKey);
  else Reflect.set(globalThis, mediaProviderFetchKey, nativeMediaProviderFetch);
  while (directories.length) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

test("describes workspace speech synthesis as an installed iPolloWork capability", () => {
  const speechActions = MEDIA_EXTENSION_ACTIONS.filter((action) => action.action.startsWith("speech_synthesize"));
  expect(speechActions).toHaveLength(3);
  for (const action of speechActions) {
    expect(action.description).toContain("Built-in iPolloWork CosyVoice action");
    expect(action.description.toLowerCase()).toContain("without");
    expect(action.description.toLowerCase()).toContain("external cli");
  }
});

async function workspaceConfig() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-media-"));
  directories.push(root);
  await writeFile(join(root, "sample.wav"), "voice sample");
  return {
    root,
    config: {
      workspaces: [{ id: "workspace-voice", path: root, name: "Voice test" }],
    } as unknown as ServerConfig,
  };
}

describe("Media Center extension", () => {
  test("estimates multilingual narration duration before provider synthesis", () => {
    expect(estimateVoiceoverDurationSeconds("这是八个汉字的旁白。")).toBeGreaterThan(2);
    expect(estimateVoiceoverDurationSeconds("Five clear words for this scene.")).toBeGreaterThan(2);
  });

  test("allocates narration inside its scene and reports the exact downstream shift", () => {
    expect(planSceneVoiceoverTiming(4, 3, 4.5)).toEqual({
      startSeconds: 4,
      endSeconds: 8.5,
      requiredSceneDurationSeconds: 4.75,
      shiftFollowingBySeconds: 1.75,
      readingBufferSeconds: 0.25,
    });
    expect(planSceneVoiceoverTiming(10, 5, 2)).toEqual({
      startSeconds: 10,
      endSeconds: 12,
      requiredSceneDurationSeconds: 5,
      shiftFollowingBySeconds: 0,
      readingBufferSeconds: 0.25,
    });
  });

  test("rejects a video that cuts away before slow narration finishes", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="7">
        <section id="intro" class="scene clip" data-start="0" data-duration="3"></section>
        <section id="details" class="scene clip" data-start="3" data-duration="4"></section>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="5"></audio>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="details" data-ipw-scene-text="Details" data-ipw-narration-text="Details" data-start="3" data-duration="4.5"></audio>
      </main>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("voiceover_exceeds_scene");
    expect(result.issues.map((issue) => issue.code)).toContain("voiceover_overlap");
    expect(result.issues.map((issue) => issue.code)).toContain("composition_too_short");
  });

  test("accepts a video whose scenes and total duration adapt to narration", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="10">
        <section id="intro" class="scene clip" data-start="0" data-duration="5.25">Intro</section>
        <section id="details" class="scene clip" data-start="5.25" data-duration="4.75">Details</section>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="5"></audio>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="details" data-ipw-scene-text="Details" data-ipw-narration-text="Details" data-start="5.25" data-duration="4.5"></audio>
      </main>
    </body>`);

    expect(result).toMatchObject({ valid: true, sceneCount: 2, voiceoverCount: 2, issues: [] });
  });

  test("binds narration to marked captions while preserving richer scene content", () => {
    const narration = "乔丹六次夺冠，并六次当选总决赛 MVP。关键时刻的统治力定义了一个时代。";
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="12">
        <section id="jordan" class="scene clip" data-start="0" data-duration="12">
          <h1>Michael Jordan</h1>
          <strong>6× Champion</strong><span>Chicago Bulls · 1984–1998</span>
          <p data-ipw-narration-source="true">${narration}</p>
        </section>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="jordan" data-ipw-scene-text="${narration}" data-ipw-narration-text="${narration}" data-start="0" data-duration="11"></audio>
      </main>
    </body>`);

    expect(result).toMatchObject({ valid: true, sceneCount: 1, voiceoverCount: 1, issues: [] });
  });

  test("rejects narration metadata that no longer matches the scene's visible text", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="5.25">
        <section id="intro" class="scene clip" data-start="0" data-duration="5.25">
          <h1>Current title</h1>
          <p>Current subtitle</p>
        </section>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Old title" data-ipw-narration-text="Old title" data-start="0" data-duration="5"></audio>
      </main>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("voiceover_scene_text_mismatch");
  });

  test("rejects legacy and duplicate voiceovers instead of ignoring them", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="8">
        <section id="intro" class="scene clip" data-start="0" data-duration="4"></section>
        <audio data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="4"></audio>
        <audio id="vo-old-intro" src="assets/audio/voice/old.mp3" data-start="0" data-duration="4"></audio>
      </main>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.voiceoverCount).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_voiceover_binding");
    expect(result.issues.map((issue) => issue.code)).toContain("voiceover_overlap");
  });

  test("rejects generated narration mp3 nodes that are not placed on the HyperFrames timeline", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="11">
        <section id="intro" class="scene clip" data-start="0" data-duration="5">Intro</section>
        <section id="details" class="scene clip" data-start="5" data-duration="6">Details</section>
        <audio id="narration-01" src="assets/audio/narration-01.mp3"></audio>
        <audio id="narration-02" src="assets/audio/narration-02.mp3"></audio>
      </main>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.voiceoverCount).toBe(2);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_voiceover_binding");
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_voiceover_window");
  });

  test("rejects scripts that manually play or seek voiceover audio", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <main data-composition-id="main" data-duration="5.25">
        <section id="intro" class="scene clip" data-start="0" data-duration="5.25">Intro</section>
        <audio id="narration-01" data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="5"></audio>
      </main>
      <script>
        const narrationAudio = document.getElementById("narration-01");
        narrationAudio.currentTime = 0;
        narrationAudio.play();
      </script>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("manual_voiceover_playback");
  });

  test("rejects captions whose hidden animation target cannot resolve", () => {
    const result = validateVoiceoverTimelineHtml(`
      <main data-composition-id="main" data-duration="4">
        <section id="scene" class="scene clip" data-start="0" data-duration="4"></section>
        <div data-hf-id="caption-one" data-ipw-caption="true" class="clip caption" data-start="0" data-duration="4">Caption</div>
      </main>
      <style>.caption { opacity: 0; }</style>
      <script>timeline.to('#caption-one', { opacity: 1 });</script>
    `);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "caption_animation_target_missing" }));
  });

  test("rejects infinite caption animation that cannot be sought deterministically", () => {
    const result = validateVoiceoverTimelineHtml(`
      <main data-composition-id="main" data-duration="4">
        <section id="scene" class="scene clip" data-start="0" data-duration="4"></section>
        <div id="caption-one" data-ipw-caption="true" class="clip caption" data-start="0" data-duration="4">Caption</div>
      </main>
      <style>.caption { animation: flicker .1s infinite; }</style>
    `);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "non_seek_safe_caption_animation" }));
  });

  test("rejects default captions that stretch from the top or paint a solid panel", () => {
    const result = validateVoiceoverTimelineHtml(`
      <main data-composition-id="main" data-duration="4">
        <section id="scene" class="scene clip" data-start="0" data-duration="4"></section>
        <div id="caption-one" data-ipw-caption="true" class="clip caption" data-start="0" data-duration="4"><div class="caption-inner">Caption</div></div>
      </main>
      <style>
        .clip { position: absolute; inset: 0; }
        .caption { left: 0; right: 0; bottom: 28px; display: flex; justify-content: center; }
        .caption-inner { background: #111827; color: white; }
      </style>
    `, { requirements: { captions: true } });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "default_caption_layout_invalid",
      "default_caption_background_invalid",
    ]));
  });

  test("accepts default captions whose class rules override a global clip inset", () => {
    const result = validateVoiceoverTimelineHtml(`
      <style>
        .clip { position: absolute; inset: 0; overflow: hidden; }
        .caption { position: absolute; inset: auto 5% 5%; height: auto; display: flex; align-items: flex-end; justify-content: center; overflow: visible; background: transparent; }
        .caption-inner { max-width: 90%; background: transparent; color: white; text-align: center; text-shadow: 0 2px 8px black; }
      </style>
      <main data-composition-id="main" data-duration="5">
        <section id="scene" class="scene clip" data-start="0" data-duration="5" data-track-index="0"></section>
        <div class="caption clip" data-ipw-caption="true" data-start="0" data-duration="5" data-track-index="1">
          <span class="caption-inner">Caption</span>
        </div>
      </main>
    `, { requirements: { captions: true } });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("allows explicitly requested custom caption treatments", () => {
    const result = validateVoiceoverTimelineHtml(`
      <main data-composition-id="main" data-duration="4">
        <section id="scene" class="scene clip" data-start="0" data-duration="4"></section>
        <div id="caption-one" data-ipw-caption="true" class="clip caption-card" data-start="0" data-duration="4">Caption</div>
      </main>
    `, { requirements: { captions: true, captionStyle: "custom" } });
    expect(result.valid).toBe(true);
  });

  test("rejects legacy frame timelines that only describe a longer narrated video in script", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><body>
      <div id="root" data-composition-id="main" data-duration="8">
        <section id="scene-01" class="frame active hook" data-duration="4000">AI related tech</section>
        <section id="scene-02" class="frame" data-duration="4000">Built for developers</section>
        <section id="scene-03" class="frame" data-duration="6000">LangChain</section>
        <section id="scene-04" class="frame" data-duration="6000">LangGraph</section>
        <section id="scene-05" class="frame" data-duration="5000">Tech Stack</section>
        <section id="scene-06" class="frame" data-duration="7000">AI Agent</section>
        <section id="scene-07" class="frame" data-duration="6000">AIGC</section>
        <section id="scene-08" class="frame" data-duration="4000">CTA</section>
      </div>
      <script>
        const voiceovers = [
          'assets/vo_01.mp3',
          'assets/vo_02.mp3',
          'assets/vo_03.mp3',
          'assets/vo_04.mp3',
          'assets/vo_05.mp3',
          'assets/vo_06.mp3',
          'assets/vo_07.mp3',
          'assets/vo_08.mp3'
        ];
        const audio = new Audio(voiceovers[0]);
        audio.play();
      </script>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.voiceoverCount).toBe(0);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_hyperframes_scenes");
    expect(result.issues.map((issue) => issue.code)).toContain("legacy_frame_millisecond_timeline");
    expect(result.issues.map((issue) => issue.code)).toContain("declared_duration_mismatch");
    expect(result.issues.map((issue) => issue.code)).toContain("voiceover_assets_not_on_timeline");
  });

  test("rejects one hidden player that swaps voiceover underscore files by script", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><head>
      <link rel="preload" as="audio" href="voiceover_1.mp3">
      <link rel="preload" as="audio" href="voiceover_2.mp3">
      <link rel="preload" as="audio" href="voiceover_3.mp3">
      <link rel="preload" as="audio" href="voiceover_4.mp3">
    </head><body>
      <div id="root" data-composition-id="main" data-duration="8">
        <section id="scene-1" class="frame active hook" data-duration="6000">AI related tech</section>
        <section id="scene-2" class="frame" data-duration="10000">LangChain</section>
        <section id="scene-3" class="frame" data-duration="10000">LangGraph</section>
        <section id="scene-4" class="frame" data-duration="10000">AI Agent</section>
        <audio id="bgm" src="bgm.mp3" loop></audio>
        <audio id="voiceover" preload="auto"></audio>
      </div>
      <script>
        const voiceover = document.getElementById("voiceover");
        const voiceoverSrcs = Array.from({ length: 4 }, (_, index) => "voiceover_" + (index + 1) + ".mp3");
        function playVoiceover(index) {
          voiceover.src = voiceoverSrcs[index];
          voiceover.currentTime = 0;
          voiceover.play();
        }
      </script>
    </body>`);

    expect(result.valid).toBe(false);
    expect(result.voiceoverCount).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toContain("legacy_frame_millisecond_timeline");
    expect(result.issues.map((issue) => issue.code)).toContain("declared_duration_mismatch");
    expect(result.issues.map((issue) => issue.code)).toContain("manual_voiceover_playback");
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_voiceover_binding");
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_voiceover_window");
    expect(result.issues.map((issue) => issue.code)).toContain("voiceover_assets_not_on_timeline");
  });

  test("rejects generated voiceover assets that are not referenced by index.html", async () => {
    const workspace = await workspaceConfig();
    await writeFile(join(workspace.root, "video.html"), `<!doctype html><main data-composition-id="main" data-duration="5">
      <section id="intro" class="scene clip" data-start="0" data-duration="5">Intro</section>
    </main>`);
    await mkdir(join(workspace.root, "assets"), { recursive: true });
    await writeFile(join(workspace.root, "assets", "vo_01.mp3"), "voice");

    const result = await callMediaExtensionAction(
      workspace.config,
      env({}),
      "voiceover_timeline_validate",
      { sourcePath: "video.html" },
      { directory: workspace.root },
    );

    expect(result).toMatchObject({ ok: true, result: { output: { valid: false, voiceoverAssetCount: 1 } } });
    expect((result as any).result.output.issues.map((issue: any) => issue.code)).toContain("voiceover_assets_unreferenced");
  });

  test("rejects timeline voiceover references whose files are missing", async () => {
    const workspace = await workspaceConfig();
    await writeFile(join(workspace.root, "video.html"), `<!doctype html><main data-composition-id="main" data-duration="5">
      <section id="intro" class="scene clip" data-start="0" data-duration="5">Intro</section>
      <audio src="./assets/voiceover-missing.mp3" data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="4"></audio>
    </main>`);

    const result = await callMediaExtensionAction(
      workspace.config,
      env({}),
      "voiceover_timeline_validate",
      { sourcePath: "video.html" },
      { directory: workspace.root },
    );

    expect(result).toMatchObject({ ok: true, result: { output: { valid: false } } });
    expect(JSON.stringify(result)).toContain("voiceover_assets_missing");
  });

  test("rejects underscore voiceover files present in assets but missing from the timeline", async () => {
    const workspace = await workspaceConfig();
    await writeFile(join(workspace.root, "video.html"), `<!doctype html><main data-composition-id="main" data-duration="5">
      <section id="intro" class="scene clip" data-start="0" data-duration="5">Intro</section>
    </main>`);
    await mkdir(join(workspace.root, "assets"), { recursive: true });
    await writeFile(join(workspace.root, "assets", "voiceover_1.mp3"), "voice");

    const result = await callMediaExtensionAction(
      workspace.config,
      env({}),
      "voiceover_timeline_validate",
      { sourcePath: "video.html" },
      { directory: workspace.root },
    );

    expect(result).toMatchObject({ ok: true, result: { output: { valid: false, voiceoverAssetCount: 1 } } });
    expect((result as any).result.output.issues.map((issue: any) => issue.code)).toContain("voiceover_assets_unreferenced");
  });

  test("validates a workspace video timeline without requiring provider credentials", async () => {
    const workspace = await workspaceConfig();
    await writeFile(join(workspace.root, "video.html"), `<!doctype html><main data-composition-id="main" data-duration="5.25">
      <section id="intro" class="scene clip" data-start="0" data-duration="5.25">Intro</section>
      <audio data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="5"></audio>
    </main>`);

    const result = await callMediaExtensionAction(
      workspace.config,
      env({}),
      "voiceover_timeline_validate",
      { sourcePath: "video.html" },
      { directory: workspace.root },
    );
    expect(result).toMatchObject({ ok: true, result: { output: { valid: true, voiceoverCount: 1 } } });
  });

  test("rejects completion when explicitly requested media deliverables are absent", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><main data-composition-id="main" data-duration="5">
      <section id="intro" class="scene clip" data-start="0" data-duration="5">Intro</section>
    </main>`, {
      requirements: {
        voiceover: true,
        captions: true,
        bgm: true,
        animationReferences: ["caption-clip-wipe"],
        targetDurationSeconds: 120,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "required_voiceover_missing",
      "required_captions_missing",
      "required_bgm_missing",
      "required_animation_missing",
      "requested_duration_mismatch",
    ]));
  });

  test("accepts requested media only when the timeline contains every deliverable", () => {
    const result = validateVoiceoverTimelineHtml(`<!doctype html><main data-composition-id="main" data-duration="5.25">
      <section id="intro" class="scene clip" data-start="0" data-duration="5.25"><span data-ipw-narration-source="true">Intro</span></section>
      <div class="clip" data-ipw-caption="true" data-ipw-caption-style="transparent-bottom" data-ipw-animation-reference="caption-clip-wipe" data-start="0" data-duration="5" style="position:absolute;inset:auto 5% 5%;height:auto;display:flex;align-items:flex-end;justify-content:center;overflow:visible;background:transparent;pointer-events:none"><span data-ipw-caption-text="true" style="max-width:90%;background:transparent;color:white;text-align:center;text-shadow:0 2px 8px black">Intro</span></div>
      <audio src="./assets/voiceover-intro.mp3" data-ipw-voiceover="true" data-ipw-scene-id="intro" data-ipw-scene-text="Intro" data-ipw-narration-text="Intro" data-start="0" data-duration="5"></audio>
      <audio src="./assets/bgm.mp3" data-ipw-bgm="true" data-start="0" data-duration="5.25" data-track-index="11"></audio>
    </main>`, {
      mediaAssets: ["assets/voiceover-intro.mp3", "assets/bgm.mp3"],
      requirements: {
        voiceover: true,
        captions: true,
        captionStyle: "transparent-bottom",
        bgm: true,
        animationReferences: ["caption-clip-wipe"],
        targetDurationSeconds: 5,
      },
    });

    expect(result).toMatchObject({
      valid: true,
      voiceoverCount: 1,
      captionCount: 1,
      bgmCount: 1,
      animationReferences: ["caption-clip-wipe"],
    });
  });

  test("rejects narration that differs from its visible scene text before calling Model Studio", async () => {
    const workspace = await workspaceConfig();
    let requested = false;
    globalThis.fetch = ((() => {
      requested = true;
      throw new Error("provider must not be called");
    }) as unknown) as typeof fetch;

    await expect(callMediaExtensionAction(
      workspace.config,
      env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }),
      "speech_synthesize_workspace_file",
      {
        text: "unrelated narration",
        sceneId: "scene-hook",
        sceneText: "visible scene title",
        sceneStart: 0,
        sceneDuration: 3,
        outputPath: "video/session/assets/voiceover-scene-1.mp3",
      },
      { directory: workspace.root },
    )).rejects.toMatchObject({ code: "voiceover_scene_text_mismatch" });
    expect(requested).toBe(false);
  });

  test("saves synthesized MP3 in the workspace and reports its real frame duration", async () => {
    const workspace = await workspaceConfig();
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]); // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
    const mp3 = Buffer.concat(Array.from({ length: 100 }, () => frame));
    let request = 0;
    globalThis.fetch = ((input, init) => {
      request += 1;
      if (request === 1) {
        expect(String(input)).toContain("SpeechSynthesizer");
        return Promise.resolve(new Response(JSON.stringify({ output: { audio: { url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/scene.mp3?Expires=42" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      expect(String(input)).toBe("https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/scene.mp3?Expires=42");
      expect(init?.redirect).toBe("error");
      return Promise.resolve(new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } }));
    }) as typeof fetch;

    const result = await callMediaExtensionAction(workspace.config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "speech_synthesize_workspace_file", {
      text: "第一段旁白",
      sceneId: "scene-hook",
      sceneText: "第一段旁白",
      sceneStart: 0,
      sceneDuration: 1,
      voice: "longyingmu_v3",
      model: "cosyvoice-v3-flash",
      outputPath: "video/session/assets/voiceover-scene-1.mp3",
      compositionPath: "video/session/index.html",
    }, { directory: workspace.root });

    const measuredDuration = (result as any).result.output.durationSeconds;
    expect(result).toMatchObject({
      result: {
        output: {
          sourcePath: "video/session/assets/voiceover-scene-1.mp3",
          durationSeconds: expect.any(Number),
          bytes: mp3.byteLength,
          sceneId: "scene-hook",
          sceneText: "第一段旁白",
          sceneStart: 0,
          timing: {
            startSeconds: 0,
            endSeconds: expect.any(Number),
            requiredSceneDurationSeconds: expect.any(Number),
            shiftFollowingBySeconds: expect.any(Number),
            readingBufferSeconds: 0.25,
          },
        },
      },
    });
    expect((result as any).result.output.audioElementId).toBe("voiceover-scene-hook-voiceover-scene-1");
    expect((result as any).result.output.timelinePatch).toMatchObject({
      setSceneStartSeconds: 0,
      setSceneDurationSeconds: expect.any(Number),
      shiftFollowingBySeconds: expect.any(Number),
      rootDurationMustBeAtLeastSeconds: expect.any(Number),
      keepSceneVisibleUntilSeconds: expect.any(Number),
    });
    const audioElementHtml = (result as any).result.output.audioElementHtml;
    expect(audioElementHtml).toContain('src="./assets/voiceover-scene-1.mp3"');
    expect(audioElementHtml).toContain('data-ipw-voiceover="true"');
    expect(audioElementHtml).toContain('data-ipw-scene-id="scene-hook"');
    expect(audioElementHtml).toContain('data-ipw-scene-text=');
    expect(audioElementHtml).toContain('data-ipw-narration-text=');
    expect(audioElementHtml).toContain('data-start="0"');
    expect(audioElementHtml).toContain(`data-duration="${Math.round(measuredDuration * 1_000) / 1_000}"`);
    const expectedDuration = 100 * 1152 / 44_100;
    expect(Math.abs(measuredDuration - expectedDuration)).toBeLessThan(0.001);
    expect(await readFile(join(workspace.root, "video/session/assets/voiceover-scene-1.mp3"))).toEqual(mp3);
  });

  test("synthesizes an ordered voiceover batch concurrently and returns cumulative timeline shifts", async () => {
    const workspace = await workspaceConfig();
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    const mp3 = Buffer.concat(Array.from({ length: 100 }, () => frame));
    let activeSynthesisRequests = 0;
    let maximumSynthesisRequests = 0;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (!url.includes("SpeechSynthesizer")) {
        return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      activeSynthesisRequests += 1;
      maximumSynthesisRequests = Math.max(maximumSynthesisRequests, activeSynthesisRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSynthesisRequests -= 1;
      const body = JSON.parse(String(init?.body));
      const sceneName = body.input.text === "Intro" ? "intro" : "details";
      return new Response(JSON.stringify({ output: { audio: { url: `https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/${sceneName}.mp3` } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await callMediaExtensionAction(
      workspace.config,
      env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }),
      "speech_synthesize_workspace_batch",
      {
        scenes: [
          { text: "Intro", sceneId: "intro", sceneText: "Intro", sceneStart: 0, sceneDuration: 1, outputPath: "assets/voiceover-batch-intro.mp3" },
          { text: "Details", sceneId: "details", sceneText: "Details", sceneStart: 1, sceneDuration: 1, outputPath: "assets/voiceover-batch-details.mp3" },
        ],
        compositionPath: "video/session/index.html",
        voice: "longyingmu_v3",
      },
      { directory: workspace.root },
    );

    expect(maximumSynthesisRequests).toBe(2);
    expect(result).toMatchObject({
      result: {
        output: {
          sceneCount: 2,
          totalShiftSeconds: expect.any(Number),
          rootDurationMustBeAtLeastSeconds: expect.any(Number),
          items: [
            {
              sceneId: "intro",
              sourcePath: "video/session/assets/voiceover-batch-intro.mp3",
              originalSceneStart: 0,
              sceneStart: 0,
              cumulativeShiftAfterSeconds: expect.any(Number),
              audioElementHtml: expect.stringContaining('src="./assets/voiceover-batch-intro.mp3"'),
            },
            {
              sceneId: "details",
              sourcePath: "video/session/assets/voiceover-batch-details.mp3",
              originalSceneStart: 1,
              sceneStart: expect.any(Number),
              cumulativeShiftAfterSeconds: expect.any(Number),
              audioElementHtml: expect.stringContaining('src="./assets/voiceover-batch-details.mp3"'),
            },
          ],
        },
      },
    });
    expect(await readFile(join(workspace.root, "video/session/assets/voiceover-batch-intro.mp3"))).toEqual(mp3);
    expect(await readFile(join(workspace.root, "video/session/assets/voiceover-batch-details.mp3"))).toEqual(mp3);
  });

  test("rejects voiceover output outside the current composition assets directory", async () => {
    const workspace = await workspaceConfig();
    let requested = false;
    globalThis.fetch = (() => {
      requested = true;
      throw new Error("provider must not be called");
    }) as unknown as typeof fetch;

    await expect(callMediaExtensionAction(
      workspace.config,
      env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }),
      "speech_synthesize_workspace_batch",
      {
        scenes: [
          { text: "Intro", sceneId: "intro", sceneText: "Intro", sceneStart: 0, sceneDuration: 1, outputPath: "assets-other/voiceover.mp3" },
        ],
        compositionPath: "video/session/index.html",
      },
      { directory: workspace.root },
    )).rejects.toMatchObject({ code: "voiceover_output_outside_composition" });
    expect(requested).toBe(false);
  });

  test("reuses identical synthesized narration without changing workspace output paths", async () => {
    const workspace = await workspaceConfig();
    const frame = Buffer.alloc(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    const mp3 = Buffer.concat(Array.from({ length: 100 }, () => frame));
    let synthesisRequests = 0;
    let downloadRequests = 0;
    globalThis.fetch = ((input) => {
      if (String(input).includes("SpeechSynthesizer")) {
        synthesisRequests += 1;
        return Promise.resolve(new Response(JSON.stringify({ output: { audio: { url: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/cache-test.mp3" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      downloadRequests += 1;
      return Promise.resolve(new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } }));
    }) as typeof fetch;

    const common = {
      text: "Unique resumable narration cache test",
      sceneId: "cache-scene",
      sceneText: "Unique resumable narration cache test",
      sceneStart: 0,
      sceneDuration: 2,
      voice: "longyingmu_v3",
    };
    for (const revision of ["first", "second"]) {
      await callMediaExtensionAction(
        workspace.config,
        env({ DASHSCOPE_API_KEY: "sk-cache-test" }),
        "speech_synthesize_workspace_file",
        { ...common, outputPath: `video/session/assets/voiceover-cache-${revision}.mp3` },
        { directory: workspace.root },
      );
    }

    expect(synthesisRequests).toBe(1);
    expect(downloadRequests).toBe(1);
    expect(await readFile(join(workspace.root, "video/session/assets/voiceover-cache-first.mp3"))).toEqual(mp3);
    expect(await readFile(join(workspace.root, "video/session/assets/voiceover-cache-second.mp3"))).toEqual(mp3);
  });

  test("rejects narration that cannot fit a requested duration before provider synthesis", async () => {
    const workspace = await workspaceConfig();
    const narration = "这是需要保留页面事实但明显无法塞进五秒镜头的详细旁白。".repeat(12);
    let requested = false;
    Reflect.set(globalThis, mediaProviderFetchKey, () => {
      requested = true;
      throw new Error("provider must not be called");
    });

    await expect(callMediaExtensionAction(
      workspace.config,
      env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }),
      "speech_synthesize_workspace_batch",
      {
        scenes: [{
          text: narration,
          sceneId: "details",
          sceneText: narration,
          sceneStart: 0,
          sceneDuration: 5,
          outputPath: "video/session/assets/voiceover-too-long.mp3",
        }],
        targetDurationSeconds: 5,
      },
      { directory: workspace.root },
    )).rejects.toMatchObject({ code: "voiceover_target_duration_exceeded" });
    expect(requested).toBe(false);
  });

  test("rejects synthesized audio URLs outside Model Studio result storage", async () => {
    const workspace = await workspaceConfig();
    let requests = 0;
    globalThis.fetch = ((input, init) => {
      requests += 1;
      expect(String(input)).toContain("SpeechSynthesizer");
      return Promise.resolve(new Response(JSON.stringify({ output: { audio: { url: "https://127.0.0.1/private.mp3" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }) as typeof fetch;

    await expect(callMediaExtensionAction(workspace.config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "speech_synthesize_workspace_file", {
      text: "Visible narration",
      sceneId: "scene-hook",
      sceneText: "Visible narration",
      sceneStart: 0,
      sceneDuration: 2,
      outputPath: "video/session/assets/voiceover-scene-unsafe.mp3",
    }, { directory: workspace.root })).rejects.toMatchObject({
      code: "bailian_audio_url_invalid",
      message: "Alibaba Model Studio returned an unsafe synthesized audio URL.",
    });
    expect(requests).toBe(1);
  });

  test("keeps the Model Studio key server-side while synthesizing speech", async () => {
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-bailian-secret" });
      expect(String(init?.body)).toContain("cosyvoice-v3-flash");
      expect(String(init?.body)).toContain("hello");
      return Promise.resolve(new Response(JSON.stringify({ output: { audio: { url: "https://audio.example.test/a.wav" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }) as typeof fetch;

    const result = await callMediaExtensionAction(config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "speech_synthesize", {
      text: "hello",
    }, {});

    expect(result).toMatchObject({
      ok: true,
      extensionId: MEDIA_EXTENSION_ID,
      action: "speech_synthesize",
      result: {
        provider: "aliyun-bailian",
        operation: "speech_synthesize",
        output: { output: { audio: { url: "https://audio.example.test/a.wav" } } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("sk-bailian-secret");
  });

  test("explains CosyVoice 418 responses without exposing provider internals", async () => {
    globalThis.fetch = ((_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "cosyvoice-v3-flash",
        input: { voice: "longyingmu_v3" },
      });
      return Promise.resolve(new Response(JSON.stringify({
        message: "[cosyvoice:]Engine return error code: 418",
      }), { status: 418, headers: { "content-type": "application/json" } }));
    }) as typeof fetch;

    await expect(callMediaExtensionAction(config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "speech_synthesize", {
      text: "hello",
      voice: "longwan",
      model: "cosyvoice-v3-flash",
    }, {})).rejects.toMatchObject({
      status: 422,
      code: "bailian_voice_incompatible",
      message: expect.stringContaining("compatible v3 voice"),
    });
  });

  test("uses the asynchronous task endpoint for a digital human", async () => {
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis");
      expect(init?.headers).toMatchObject({ "X-DashScope-Async": "enable" });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "wan2.2-s2v",
        input: { image_url: "https://assets.example.test/person.png", audio_url: "https://assets.example.test/voice.mp3" },
      });
      return Promise.resolve(new Response(JSON.stringify({ output: { task_id: "task_123", task_status: "PENDING" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }) as typeof fetch;

    const result = await callMediaExtensionAction(config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "digital_human_generate", {
      imageUrl: "https://assets.example.test/person.png",
      audioUrl: "https://assets.example.test/voice.mp3",
    }, {});

    expect(result).toMatchObject({
      ok: true,
      result: {
        provider: "aliyun-bailian",
        operation: "digital_human_generate",
        taskId: "task_123",
      },
    });
  });

  test("lists only reusable custom voice metadata", async () => {
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "voice-enrollment",
        input: { action: "list_voice", page_index: 0, page_size: 100 },
      });
      return Promise.resolve(new Response(JSON.stringify({
        output: {
          voice_list: [{ voice_id: "ipw-voice-a", target_model: "cosyvoice-v3-flash", status: "OK" }],
          total_count: 1,
        },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }) as typeof fetch;

    const result = await callMediaExtensionAction(config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "voice_list", {}, {});

    expect(result).toMatchObject({
      ok: true,
      result: {
        output: {
          items: [{ id: "ipw-voice-a", model: "cosyvoice-v3-flash", status: "OK" }],
          totalCount: 1,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("sk-bailian-secret");
  });

  test("clones a workspace sample through a private temporary OSS object and always removes it", async () => {
    const { root, config: workspace } = await workspaceConfig();
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: String(init?.body ?? "") });
      if (url.includes("dashscope.aliyuncs.com")) {
        const body = JSON.parse(String(init?.body));
        expect(body.input.prefix).toMatch(/^ipw[a-z0-9]{1,7}$/);
        expect(body.input.url).toContain("x-oss-signature=");
        expect(body.input.url).not.toContain("oss-secret");
        return Promise.resolve(new Response(JSON.stringify({ output: { voice_id: "ipw-new-voice" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    const result = await callMediaExtensionAction(workspace, env({
      DASHSCOPE_API_KEY: "sk-bailian-secret",
      ALIYUN_OSS_ACCESS_KEY_ID: "LTAIvoice",
      ALIYUN_OSS_ACCESS_KEY_SECRET: "oss-secret",
      ALIYUN_OSS_BUCKET: "private-assets",
      ALIYUN_OSS_REGION: "cn-hangzhou",
    }), "voice_clone_workspace_file", { sourcePath: "sample.wav" }, { directory: root });

    expect(result).toMatchObject({ ok: true, result: { output: { voiceId: "ipw-new-voice", model: "cosyvoice-v3-flash" } } });
    expect(requests.map((request) => request.method)).toEqual(["PUT", "POST", "DELETE"]);
    expect(requests[0]?.url).toContain("/ipollowork/temp/voice-clone/");
    expect(requests[2]?.url).toContain("/ipollowork/temp/voice-clone/");
    expect(JSON.stringify(result)).not.toContain("sk-bailian-secret");
    expect(JSON.stringify(result)).not.toContain("oss-secret");
    expect(JSON.stringify(result)).not.toContain("x-oss-signature=");
  });

  test("uses Electron's injected provider fetch without replacing local server fetch", async () => {
    let providerFetchCalled = false;
    Reflect.set(globalThis, mediaProviderFetchKey, (async (input: string | URL | Request) => {
      providerFetchCalled = true;
      expect(String(input)).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization");
      return new Response(JSON.stringify({ output: { voice_list: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);
    globalThis.fetch = (() => {
      throw new Error("Node fetch must remain unused for media provider traffic in Electron");
    }) as unknown as typeof fetch;

    const result = await callMediaExtensionAction(config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "voice_list", {}, {});

    expect(providerFetchCalled).toBe(true);
    expect(result).toMatchObject({ ok: true, result: { output: { items: [] } } });
  });

  test("clones a workspace sample through Bailian temporary storage when object storage is not configured", async () => {
    const { root, config: workspace } = await workspaceConfig();
    const requests: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/api/v1/uploads?")) {
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({
          data: {
            policy: "encoded-policy",
            signature: "upload-signature",
            upload_dir: "dashscope-instant/account/date/request",
            upload_host: "https://dashscope-file-test.oss-cn-beijing.aliyuncs.com",
            oss_access_key_id: "temporary-access-key",
            x_oss_object_acl: "private",
            x_oss_forbid_overwrite: "true",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url === "https://dashscope-file-test.oss-cn-beijing.aliyuncs.com") {
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get("OSSAccessKeyId")).toBe("temporary-access-key");
        expect(form.get("key")).toMatch(/^dashscope-instant\/account\/date\/request\/.+\.wav$/);
        expect(form.get("file")).toBeInstanceOf(Blob);
        return new Response(null, { status: 200 });
      }
      expect(url).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-bailian-secret",
        "X-DashScope-OssResourceResolve": "enable",
      });
      const body = JSON.parse(String(init?.body));
      expect(body.input.url).toMatch(/^oss:\/\/dashscope-instant\/account\/date\/request\/.+\.wav$/);
      return new Response(JSON.stringify({ output: { voice_id: "ipw-bailian-temp-voice" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await callMediaExtensionAction(
      workspace,
      env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }),
      "voice_clone_workspace_file",
      { sourcePath: "sample.wav" },
      { directory: root },
    );

    expect(result).toMatchObject({ ok: true, result: { output: { voiceId: "ipw-bailian-temp-voice", model: "cosyvoice-v3-flash" } } });
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("sk-bailian-secret");
    expect(JSON.stringify(result)).not.toContain("temporary-access-key");
  });

  test("collects the documented streaming file-translation response without exposing the key", async () => {
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-bailian-secret" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "qwen3-livetranslate-flash",
        stream: true,
        translation_options: { source_lang: "zh", target_lang: "en" },
      });
      return Promise.resolve(new Response([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }));
    }) as typeof fetch;

    const result = await callMediaExtensionAction(config, env({ DASHSCOPE_API_KEY: "sk-bailian-secret" }), "speech_translate", {
      fileUrl: "https://assets.example.test/input.wav",
      format: "wav",
      sourceLanguage: "zh",
      targetLanguage: "en",
    }, {});

    expect(result).toMatchObject({ ok: true, result: { provider: "aliyun-bailian", output: { text: "Hello world" } } });
    expect(JSON.stringify(result)).not.toContain("sk-bailian-secret");
  });
});
