import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import {
  MEDIA_EXTENSION_ID,
  callMediaExtensionAction,
  planSceneVoiceoverTiming,
} from "./media-center.js";

const nativeFetch = globalThis.fetch;
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
  while (directories.length) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
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
    globalThis.fetch = ((input) => {
      request += 1;
      if (request === 1) {
        expect(String(input)).toContain("SpeechSynthesizer");
        return Promise.resolve(new Response(JSON.stringify({ output: { audio: { url: "https://audio.example.test/scene.mp3" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      expect(String(input)).toBe("https://audio.example.test/scene.mp3");
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
    const expectedDuration = 100 * 1152 / 44_100;
    expect(Math.abs(measuredDuration - expectedDuration)).toBeLessThan(0.001);
    expect(await readFile(join(workspace.root, "video/session/assets/voiceover-scene-1.mp3"))).toEqual(mp3);
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
