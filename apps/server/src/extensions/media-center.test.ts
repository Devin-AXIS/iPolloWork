import { afterEach, describe, expect, test } from "bun:test";

import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import {
  MEDIA_EXTENSION_ID,
  callMediaExtensionAction,
} from "./media-center.js";

const nativeFetch = globalThis.fetch;

const config = {
  workspaces: [],
} as unknown as ServerConfig;

function env(values: Record<string, string>): EnvService {
  return {
    list: async () => Object.entries(values).map(([key, value]) => ({ key, value, updatedAt: 0 })),
  } as unknown as EnvService;
}

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("Media Center extension", () => {
  test("keeps the Model Studio key server-side while synthesizing speech", async () => {
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-bailian-secret" });
      expect(String(init?.body)).toContain("cosyvoice-v3-flash");
      expect(String(init?.body)).toContain("hello");
      return Promise.resolve(new Response(JSON.stringify({ output: { audio_url: "https://audio.example.test/a.wav" } }), {
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
        output: { output: { audio_url: "https://audio.example.test/a.wav" } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("sk-bailian-secret");
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
