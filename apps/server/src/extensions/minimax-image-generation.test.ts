import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";
import {
  MINIMAX_EXTENSION_ACTIONS,
  MINIMAX_IMAGE_ENDPOINT_REGISTRY,
  MINIMAX_IMAGE_MODEL_REGISTRY,
  callMiniMaxExtensionAction,
} from "./minimax-image-generation.js";

const nativeFetch = globalThis.fetch;
const previousApiKey = process.env.MINIMAX_API_KEY;
const previousBaseUrl = process.env.MINIMAX_BASE_URL;
const directories: string[] = [];
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client",
    hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "workspace", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

async function testContext(values: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-minimax-image-"));
  directories.push(root);
  const env = new EnvService({ path: join(root, "env.json") });
  await env.upsertMany(Object.entries(values).map(([key, value]) => ({ key, value })));
  return { root, env, config: serverConfig(root) };
}

afterEach(async () => {
  globalThis.fetch = nativeFetch;
  restoreEnv("MINIMAX_API_KEY", previousApiKey);
  restoreEnv("MINIMAX_BASE_URL", previousBaseUrl);
  while (directories.length) {
    const directory = directories.pop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

describe("MiniMax image generation extension", () => {
  test("registers the supplied image models and regional endpoints", () => {
    expect(MINIMAX_IMAGE_MODEL_REGISTRY).toEqual({
      defaultModel: "image-01",
      models: ["image-01", "image-01-live"],
    });
    expect(MINIMAX_IMAGE_ENDPOINT_REGISTRY).toEqual([
      { region: "global_en", url: "https://api.minimax.io/v1/image_generation" },
      { region: "cn_zh", url: "https://api.minimaxi.com/v1/image_generation" },
    ]);
    expect(MINIMAX_EXTENSION_ACTIONS.map((action) => action.action)).toEqual(["status", "image_generate"]);
  });

  test("writes base64 image results as workspace artifacts", async () => {
    const { root, env, config } = await testContext({ MINIMAX_API_KEY: "test-key" });
    globalThis.fetch = ((input, init) => {
      expect(String(input)).toBe("https://api.minimaxi.com/v1/image_generation");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "image-01-live",
        prompt: "A red paper lantern",
        response_format: "base64",
        aspect_ratio: "1:1",
        width: 1024,
        height: 1024,
        seed: 7,
        n: 1,
        prompt_optimizer: false,
      });
      return Promise.resolve(new Response(JSON.stringify({
        data: { image_urls: [pngBase64] },
        metadata: { success_count: 1, failed_count: 0 },
        base_resp: { status_code: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }) as typeof fetch;

    const result = await callMiniMaxExtensionAction(config, env, "image_generate", {
      prompt: "A red paper lantern",
      model: "image-01-live",
      region: "cn_zh",
      filename: "lantern",
      aspectRatio: "1:1",
      width: 1024,
      height: 1024,
      responseFormat: "base64",
      seed: 7,
      n: 1,
      promptOptimizer: false,
    }, { directory: root });

    expect(result).toMatchObject({
      ok: true,
      path: "artifacts/lantern.png",
      result: {
        model: "image-01-live",
        region: "cn_zh",
        responseFormat: "base64",
        metadata: { successCount: 1, failedCount: 0 },
      },
    });
    expect((await readFile(join(root, "artifacts/lantern.png"))).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  test("uses the configured regional origin and downloads URL responses", async () => {
    const { root, env, config } = await testContext({
      MINIMAX_API_KEY: "test-key",
      MINIMAX_BASE_URL: "https://api.minimaxi.com",
    });
    const requested: string[] = [];
    globalThis.fetch = ((input) => {
      requested.push(String(input));
      if (requested.length === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          data: { image_urls: ["https://cdn.example.test/image"] },
          metadata: { success_count: 1, failed_count: 0 },
          base_resp: { status_code: 0 },
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return Promise.resolve(new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200 }));
    }) as typeof fetch;

    const result = await callMiniMaxExtensionAction(config, env, "image_generate", {
      prompt: "A glass sculpture",
      filename: "sculpture",
      responseFormat: "url",
    }, { directory: root });

    expect(requested).toEqual([
      "https://api.minimaxi.com/v1/image_generation",
      "https://cdn.example.test/image",
    ]);
    expect(result).toMatchObject({ path: "artifacts/sculpture.jpg", result: { region: "cn_zh" } });
    expect(await readFile(join(root, "artifacts/sculpture.jpg"))).toEqual(
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    );
  });

  test("rejects missing credentials and non-zero response status codes", async () => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_BASE_URL;
    const missing = await testContext();
    await expect(callMiniMaxExtensionAction(missing.config, missing.env, "image_generate", {
      prompt: "A clean product sketch",
    }, { directory: missing.root })).rejects.toMatchObject({ code: "minimax_api_key_missing" });

    const configured = await testContext({ MINIMAX_API_KEY: "test-key" });
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
      data: { image_urls: [] },
      base_resp: { status_code: 2004, status_msg: "Invalid parameter" },
    }), { status: 200, headers: { "content-type": "application/json" } }))) as unknown as typeof fetch;
    await expect(callMiniMaxExtensionAction(configured.config, configured.env, "image_generate", {
      prompt: "A clean product sketch",
    }, { directory: configured.root })).rejects.toMatchObject({
      status: 502,
      code: "minimax_image_generation_failed",
      message: "Invalid parameter",
    });
  });
});
