import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthorizationAccess } from "../authorization-center.js";
import type { ServerConfig } from "../types.js";
import { callOpenAiImageGenerationExtensionAction } from "./openai-image-generation.js";

const roots: string[] = [];
const originalFetch = globalThis.fetch;

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-image-edit-"));
  roots.push(root);
  return root;
}

function config(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
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

const authorization: AuthorizationAccess = {
  read: async (serviceId): Promise<Readonly<Record<string, string>>> => {
    if (serviceId === "openai-images") return { OPENAI_API_KEY: "test-openai-key" };
    if (serviceId === "volcengine-video") return { ARK_API_KEY: "test-ark-key" };
    return {};
  },
};

afterEach(async () => {
  globalThis.fetch = originalFetch;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("OpenAI image editing", () => {
  test("submits the workspace image and transparent mask, then saves a new PNG artifact", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "references", "source.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const mask = Buffer.from("mask-bytes").toString("base64");
    const submissions: FormData[] = [];
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) submissions.push(init.body);
      return Response.json({ data: [{ b64_json: Buffer.from("edited-image").toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });

    const response = await callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      {
        sourcePath: "references/source.jpg",
        prompt: "Replace the selected background with a quiet studio wall",
        maskDataUrl: `data:image/png;base64,${mask}`,
        selectionBounds: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.75 },
        filename: "studio-result",
        quality: "high",
        size: "1536x1024",
      },
      { workspaceId: "workspace" },
    );

    expect(response).toMatchObject({
      ok: true,
      action: "image_edit",
      result: { path: "artifacts/studio-result.png", model: "openai/gpt-image-2", provider: "openai" },
    });
    const submitted = submissions[0];
    expect(submitted?.get("model")).toBe("gpt-image-2");
    expect(submitted?.get("prompt")).toBe("Replace the selected background with a quiet studio wall");
    expect(submitted?.get("quality")).toBe("high");
    expect(submitted?.get("size")).toBe("1536x1024");
    expect(submitted?.get("image")).toBeInstanceOf(Blob);
    expect(submitted?.get("mask")).toBeInstanceOf(Blob);
    expect(await readFile(join(root, "artifacts", "studio-result.png"), "utf8")).toBe("edited-image");
    expect(await readFile(join(root, "references", "source.jpg"))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  test("rejects image paths outside the active workspace before calling the provider", async () => {
    const root = await temporaryRoot();
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });

    await expect(callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      { sourcePath: "../outside.png", prompt: "Change it" },
      { workspaceId: "workspace" },
    )).rejects.toMatchObject({ code: "invalid_path" });
    expect(called).toBe(false);
  });

  test("lists registered models and their authorization state", async () => {
    const root = await temporaryRoot();
    const response = await callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "status",
      {},
      { workspaceId: "workspace" },
    );

    expect(response?.result).toMatchObject({
      configured: true,
      defaultModel: "openai/gpt-image-2",
      models: [
        { id: "openai/gpt-image-2", configured: true, available: true, capabilities: { mask: true, region: true } },
        { id: "volcengine/seedream-5", configured: true, available: true, capabilities: { mask: false, region: true } },
        { id: "midjourney/official", configured: false, available: false },
      ],
    });
  });

  test("generates with Seedream through the shared image action", async () => {
    const root = await temporaryRoot();
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string }> = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        authorization: new Headers(init?.headers).get("Authorization") ?? "",
      });
      return Response.json({ data: [{ b64_json: Buffer.from("seedream-image").toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });

    const response = await callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_generate",
      {
        model: "volcengine/seedream-5",
        prompt: "A quiet glass pavilion at dawn",
        filename: "seedream-result",
        size: "1024x1024",
      },
      { workspaceId: "workspace" },
    );

    expect(requests[0]).toEqual({
      url: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      body: {
        model: "doubao-seedream-5-0-260128",
        prompt: "A quiet glass pavilion at dawn",
        response_format: "b64_json",
        watermark: false,
        size: "1024x1024",
      },
      authorization: "Bearer test-ark-key",
    });
    expect(response?.result).toMatchObject({
      path: "artifacts/seedream-result.png",
      model: "volcengine/seedream-5",
      provider: "volcengine",
    });
    expect(await readFile(join(root, "artifacts", "seedream-result.png"), "utf8")).toBe("seedream-image");
  });

  test("converts a selection into approximate bounds for a model without a native mask API", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "references", "source.png"), Buffer.from("source-image"));
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return Response.json({ data: [{ b64_json: Buffer.from("seedream-edit").toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });

    const response = await callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      {
        model: "volcengine/seedream-5",
        sourcePath: "references/source.png",
        prompt: "Turn the selected object blue",
        maskDataUrl: `data:image/png;base64,${Buffer.from("selection-mask").toString("base64")}`,
        selectionBounds: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.75 },
        filename: "seedream-edit",
      },
      { workspaceId: "workspace" },
    );

    expect(requests[0]).toMatchObject({
      model: "doubao-seedream-5-0-260128",
      image: `data:image/png;base64,${Buffer.from("source-image").toString("base64")}`,
    });
    expect(requests[0]?.prompt).toBe("Turn the selected object blue\n\nApply this change only inside the approximate selected region: left 10%, top 20%, right 60%, bottom 75%, measured from the top-left corner. Preserve all content outside this region.");
    expect(response?.result).toMatchObject({ path: "artifacts/seedream-edit.png", model: "volcengine/seedream-5" });
    expect(await readFile(join(root, "artifacts", "seedream-edit.png"), "utf8")).toBe("seedream-edit");
  });

  test("requires bounds when a selected edit targets a model without a native mask API", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    await writeFile(join(root, "references", "source.png"), Buffer.from("source-image"));
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });

    await expect(callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      {
        model: "volcengine/seedream-5",
        sourcePath: "references/source.png",
        prompt: "Change the selected object",
        maskDataUrl: `data:image/png;base64,${Buffer.from("selection-mask").toString("base64")}`,
      },
      { workspaceId: "workspace" },
    )).rejects.toMatchObject({ code: "image_selection_bounds_required" });
    expect(called).toBe(false);
  });

  test("rejects Midjourney before making a provider request", async () => {
    const root = await temporaryRoot();
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });

    await expect(callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_generate",
      { model: "midjourney/official", prompt: "A test image" },
      { workspaceId: "workspace" },
    )).rejects.toMatchObject({ code: "image_model_unavailable" });
    expect(called).toBe(false);
  });
});
