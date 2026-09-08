import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import sharp from "sharp";

import type { AuthorizationAccess } from "../authorization-center.js";
import { PROVIDER_FETCH_SYMBOL } from "../provider-fetch.js";
import type { ServerConfig } from "../types.js";
import { callOpenAiImageGenerationExtensionAction, openAiImageGenerationStatus, OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS } from "./openai-image-generation.js";
import { listSessionArtifacts } from "../session-artifacts.js";
import { imageRevision } from "./image-edit-results.js";

const roots: string[] = [];
const originalFetch = globalThis.fetch;
const originalProviderFetch: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
const solidPng = (red: number, alpha = 1) => sharp({ create: { width: 4, height: 4, channels: 4, background: { r: red, g: 0, b: 0, alpha } } }).png().toBuffer();

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
  if (originalProviderFetch === undefined) Reflect.deleteProperty(globalThis, PROVIDER_FETCH_SYMBOL);
  else Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, originalProviderFetch);
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("OpenAI image editing", () => {
  async function reviewedEdit(root: string, format: "png" | "jpeg" | "webp" = "png") {
    const serverConfig = config(root);
    const context = { workspaceId: "workspace", sessionId: "save-session" };
    const sourcePath = "artifacts/后羿射日." + format;
    const source = await sharp(await solidPng(20)).toFormat(format).toBuffer();
    const generated = await solidPng(220);
    await mkdir(join(root, "artifacts"), { recursive: true });
    await writeFile(join(root, sourcePath), source);
    let calls = 0;
    globalThis.fetch = Object.assign(async () => {
      calls++;
      return Response.json({ data: [{ b64_json: generated.toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });
    const result = await callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_edit", {
      sourcePath, sourceRevision: imageRevision(source), reviewResult: true, prompt: "Turn it red",
    }, context);
    if (!result || !("path" in result) || !result.path || !("editId" in result.result) || typeof result.result.editId !== "string") throw new Error("Expected a reviewable image");
    return { serverConfig, context, sourcePath, source, generated, resultPath: result.path, editId: result.result.editId, calls: () => calls };
  }

  test("save as keeps two distinct named files and artifacts without another model request", async () => {
    const root = await temporaryRoot();
    const edit = await reviewedEdit(root);
    expect(edit.resultPath).toContain("后羿射日-edited-");
    expect((await listSessionArtifacts(edit.serverConfig, "workspace", edit.context.sessionId)).items).toHaveLength(2);
    const save = () => callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { editId: edit.editId, mode: "copy" }, edit.context);
    expect(await save()).toMatchObject({ path: edit.resultPath, result: { saveMode: "copy", originalPath: edit.sourcePath } });
    expect(await save()).toMatchObject({ path: edit.resultPath });
    expect((await readFile(join(root, edit.sourcePath))).equals(edit.source)).toBe(true);
    expect((await readFile(join(root, edit.resultPath))).equals(edit.generated)).toBe(true);
    expect((await listSessionArtifacts(edit.serverConfig, "workspace", edit.context.sessionId)).items.map(i => i.path).sort()).toEqual([edit.sourcePath, edit.resultPath].sort());
    expect(edit.calls()).toBe(1);
  });

  test.each(["png", "jpeg", "webp"] as const)("overwrite retains the %s source path/format and exactly one main artifact", async format => {
    const root = await temporaryRoot();
    const edit = await reviewedEdit(root, format);
    const save = () => callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { editId: edit.editId, mode: "overwrite" }, edit.context);
    expect(await save()).toMatchObject({ path: edit.sourcePath, result: { saveMode: "overwrite", originalPath: edit.sourcePath } });
    const saved = await readFile(join(root, edit.sourcePath));
    expect((await sharp(saved).metadata()).format).toBe(format);
    expect((await sharp(saved).raw().toBuffer())[0]).toBeGreaterThan(210);
    await expect(readFile(join(root, edit.resultPath))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await listSessionArtifacts(edit.serverConfig, "workspace", edit.context.sessionId)).items).toMatchObject([{ path: edit.sourcePath, size: saved.length }]);
    expect(await save()).toMatchObject({ path: edit.sourcePath }); // Idempotent even after the preview was removed.
    expect(edit.calls()).toBe(1);
  });

  test("stale source rejects overwrite but permits keeping the generated copy", async () => {
    const root = await temporaryRoot();
    const edit = await reviewedEdit(root);
    const changed = await solidPng(80);
    await writeFile(join(root, edit.sourcePath), changed);
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { editId: edit.editId, mode: "overwrite" }, edit.context)).rejects.toMatchObject({ code: "image_source_changed" });
    expect((await readFile(join(root, edit.sourcePath))).equals(changed)).toBe(true);
    expect((await readFile(join(root, edit.resultPath))).equals(edit.generated)).toBe(true);
    await callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { editId: edit.editId, mode: "copy" }, edit.context);
    expect((await listSessionArtifacts(edit.serverConfig, "workspace", edit.context.sessionId)).items).toHaveLength(2);
  });

  test("stale loaded revisions reject review edits before a model request", async () => {
    const root = await temporaryRoot();
    const edit = await reviewedEdit(root);
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit", {
      sourcePath: edit.sourcePath, sourceRevision: "stale", reviewResult: true, prompt: "Again",
    }, edit.context)).rejects.toMatchObject({ code: "image_source_changed" });
    expect(edit.calls()).toBe(1);
  });

  test("changed copies, foreign receipts, invalid modes and read-only saves cannot replace the source", async () => {
    const root = await temporaryRoot();
    const edit = await reviewedEdit(root);
    const args = { editId: edit.editId, mode: "overwrite" };
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", args, { ...edit.context, sessionId: "other" })).rejects.toMatchObject({ code: "image_edit_expired" });
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { ...args, editId: "../outside" }, edit.context)).rejects.toMatchObject({ code: "invalid_image_save" });
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { ...args, mode: "delete" }, edit.context)).rejects.toMatchObject({ code: "invalid_image_save" });
    await expect(callOpenAiImageGenerationExtensionAction({ ...edit.serverConfig, readOnly: true }, authorization, "image_edit_save", args, edit.context)).rejects.toMatchObject({ code: "read_only" });
    await writeFile(join(root, edit.resultPath), await solidPng(100));
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", args, edit.context)).rejects.toMatchObject({ code: "image_result_changed" });
    expect((await readFile(join(root, edit.sourcePath))).equals(edit.source)).toBe(true);
    expect((await listSessionArtifacts(edit.serverConfig, "workspace", edit.context.sessionId)).items).toHaveLength(2);
  });

  test("a symlink swapped into the edited-copy path cannot delete or copy an outside file", async () => {
    const root = await temporaryRoot(), outside = await temporaryRoot();
    const edit = await reviewedEdit(root);
    await writeFile(join(outside, basename(edit.resultPath)), edit.generated);
    await writeFile(join(outside, basename(edit.sourcePath)), edit.source);
    await rename(join(root, "artifacts"), join(root, "held"));
    await symlink(outside, join(root, "artifacts"), process.platform === "win32" ? "junction" : "dir");
    await expect(callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { editId: edit.editId, mode: "overwrite" }, edit.context)).rejects.toThrow();
    expect((await readFile(join(root, "held", basename(edit.sourcePath)))).equals(edit.source)).toBe(true);
    expect((await readFile(join(outside, basename(edit.resultPath)))).equals(edit.generated)).toBe(true);
  });

  test("concurrent overwrites of the same original cannot silently replace one another", async () => {
    const root = await temporaryRoot();
    const first = await reviewedEdit(root), second = await reviewedEdit(root);
    const outcomes = await Promise.allSettled([first, second].map(edit =>
      callOpenAiImageGenerationExtensionAction(edit.serverConfig, authorization, "image_edit_save", { editId: edit.editId, mode: "overwrite" }, edit.context)));
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    expect((await listSessionArtifacts(first.serverConfig, "workspace", first.context.sessionId)).items).toHaveLength(2);
  });
  test.each(["openai/gpt-image-2", "volcengine/seedream-5"])("edits a frozen selection through %s after the live source changes", async (model) => {
    const root = await temporaryRoot();
    const serverConfig = config(root);
    const context = { workspaceId: "workspace", sessionId: "selection-session" };
    const source = await solidPng(20);
    const maskPixels = Buffer.alloc(4 * 4 * 4, 0);
    for (let offset = 3; offset < maskPixels.length; offset += 4) maskPixels[offset] = 255;
    maskPixels[5 * 4 + 3] = 0;
    const mask = await sharp(maskPixels, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
    await writeFile(join(root, "source.png"), source);
    const captured = await callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "selection_capture", {
      sourcePath: "source.png", sourceDataUrl: `data:image/png;base64,${source.toString("base64")}`, maskDataUrl: `data:image/png;base64,${mask.toString("base64")}`,
    }, context);
    const selectionId = captured?.result && "selectionId" in captured.result ? captured.result.selectionId : null;
    expect(selectionId).toBeString();
    const updated = await solidPng(100);
    await writeFile(join(root, "source.png"), updated);
    let calls = 0;
    const generated = await solidPng(220);
    globalThis.fetch = Object.assign(async () => { calls++; return Response.json({ data: [{ b64_json: generated.toString("base64") }] }); }, { preconnect: originalFetch.preconnect });
    const args = { sourcePath: "source.png", selectionId, prompt: "Make selected area red", model };
    await expect(callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_edit", args, { ...context, sessionId: "other-session" }))
      .rejects.toMatchObject({ code: "image_selection_expired" });
    expect(calls).toBe(0);
    const edited = await callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_edit", args, context);
    if (!edited || !("path" in edited) || !edited.path) throw new Error("Missing edited artifact");
    const actual = await sharp(await readFile(join(root, edited.path))).raw().toBuffer();
    const expected = await sharp(source).raw().toBuffer();
    expected[5 * 4] = 220;
    expect(actual).toEqual(expected);
    expect([...await readFile(join(root, "source.png"))]).toEqual([...updated]);
    expect((await listSessionArtifacts(serverConfig, "workspace", "selection-session")).items).toHaveLength(1);
    expect((await listSessionArtifacts(serverConfig, "workspace", "other-session")).items).toHaveLength(0);
  });
  test("registers generation and edit with the initiating session and preserves a same-named source", async () => {
    const root = await temporaryRoot();
    const serverConfig = config(root);
    globalThis.fetch = Object.assign(async () => Response.json({ data: [{ b64_json: Buffer.from("generated-image").toString("base64") }] }), { preconnect: originalFetch.preconnect });
    const generated = await callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_generate", {
      prompt: "A painted sun", filename: "sun",
    }, { workspaceId: "workspace", sessionId: "session-original" });
    if (!generated || !("path" in generated) || !generated.path) throw new Error("Expected generation result");
    globalThis.fetch = Object.assign(async () => Response.json({ data: [{ b64_json: Buffer.from("edited-image").toString("base64") }] }), { preconnect: originalFetch.preconnect });
    const edited = await callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_edit", {
      prompt: "Make it blue", sourcePath: generated.path, filename: "sun",
    }, { workspaceId: "workspace", sessionId: "session-original" });
    if (!edited || !("path" in edited) || !edited.path) throw new Error("Expected edit result");
    expect(edited.path).not.toBe(generated.path);
    expect(await readFile(join(root, generated.path), "utf8")).toBe("generated-image");
    expect(await readFile(join(root, edited.path), "utf8")).toBe("edited-image");
    expect((await listSessionArtifacts(serverConfig, "workspace", "session-original")).items.map((item) => item.path))
      .toEqual([edited.path, generated.path]);
    expect((await listSessionArtifacts(serverConfig, "workspace", "session-switched")).items).toEqual([]);
    await expect(callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_generate", {
      prompt: "Bad owner",
    }, { workspaceId: "workspace", sessionId: "../bad" })).rejects.toThrow("sessionId");
    globalThis.fetch = Object.assign(async () => Response.json({ error: { message: "Provider unavailable" } }, { status: 503 }), { preconnect: originalFetch.preconnect });
    await expect(callOpenAiImageGenerationExtensionAction(serverConfig, authorization, "image_generate", {
      prompt: "Should fail",
    }, { workspaceId: "workspace", sessionId: "session-failed" })).rejects.toThrow();
    expect((await listSessionArtifacts(serverConfig, "workspace", "session-failed")).items).toEqual([]);
  });

  test("preserves separate generations of the same prompt when no filename is specified", async () => {
    const root = await temporaryRoot();
    globalThis.fetch = Object.assign(async () => Response.json({ data: [{ b64_json: Buffer.from("generated-image").toString("base64") }] }), { preconnect: originalFetch.preconnect });
    const responses = await Promise.all([1, 2].map(() => callOpenAiImageGenerationExtensionAction(
      config(root), authorization, "image_generate", { prompt: "生成图片" }, { workspaceId: "workspace" },
    )));
    const paths = responses.map((response) => response && "path" in response ? response.path : "");
    expect(paths[0]).not.toBe(paths[1]);
    for (const path of paths) {
      if (!path) throw new Error("Generation did not return an artifact path");
      expect(path).toMatch(/^artifacts\/ipollowork-image-[a-f0-9-]+\.png$/);
      expect(await readFile(join(root, path), "utf8")).toBe("generated-image");
    }
  });

  test("catalog separates browser login from API credentials without exposing either", async () => {
    const status = await openAiImageGenerationStatus({
      read: async () => ({}),
      openAiBrowserSession: async () => ({ accessToken: "private-access-token", accountId: "private-account" }),
    });
    expect(status.models.find((model) => model.id === "openai/gpt-image-2")?.configured).toBe(false);
    expect(status.models.find((model) => model.id === "openai/gpt-image-2-codex")).toMatchObject({ configured: true, capabilities: { mask: false, region: true } });
    expect(status.defaultModel).toBe("openai/gpt-image-2-codex");
    expect(JSON.stringify(status)).not.toContain("private-");
  });

  test("generates through a connected model when chat omits model and Image Studio is closed", async () => {
    const root = await temporaryRoot();
    const calls: string[] = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ data: [{ b64_json: Buffer.from("headless-image").toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });
    const result = await callOpenAiImageGenerationExtensionAction(config(root), {
      read: async (service): Promise<Readonly<Record<string, string>>> => service === "volcengine-video" ? { ARK_API_KEY: "test-ark-key" } : {},
    }, "image_generate", { prompt: "A mountain at sunrise" }, { workspaceId: "workspace" });
    if (!result || !("path" in result) || !result.path) throw new Error("Expected a saved image");
    expect(result.result).toMatchObject({ model: "volcengine/seedream-5", workspaceId: "workspace" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("volces.com");
    expect(await readFile(join(root, result.path), "utf8")).toBe("headless-image");
  });

  test("submits the workspace image and transparent mask, then saves a new PNG artifact", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    const original = await sharp(await solidPng(20)).jpeg().toBuffer();
    await writeFile(join(root, "references", "source.jpg"), original);
    const mask = (await solidPng(0, 0)).toString("base64");
    const output = await solidPng(220);
    const submissions: FormData[] = [];
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) submissions.push(init.body);
      return Response.json({ data: [{ b64_json: output.toString("base64") }] });
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
    expect(submitted?.get("prompt")).toStartWith("Replace the selected background with a quiet studio wall");
    expect(submitted?.get("prompt")).toContain("rectangular patch");
    expect(submitted?.get("quality")).toBe("high");
    expect(submitted?.get("size")).toBe("1536x1024");
    expect(submitted?.get("image")).toBeInstanceOf(Blob);
    expect(submitted?.get("mask")).toBeInstanceOf(Blob);
    expect(await sharp(await readFile(join(root, "artifacts", "studio-result.png"))).raw().toBuffer()).toEqual(await sharp(output).raw().toBuffer());
    expect([...await readFile(join(root, "references", "source.jpg"))]).toEqual([...original]);
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

  test("rejects a workspace symlink that resolves outside the active workspace", async () => {
    const root = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    const outsideImage = join(outsideRoot, "outside.png");
    await writeFile(outsideImage, Buffer.from("outside-image"));
    await symlink(outsideRoot, join(root, "references", "linked"), process.platform === "win32" ? "junction" : "dir");
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });

    await expect(callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      { sourcePath: "references/linked/outside.png", prompt: "Change it" },
      { workspaceId: "workspace" },
    )).rejects.toMatchObject({ code: "path_escape" });
    expect(called).toBe(false);
  });

  test("rejects an oversized source from metadata before calling the provider", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    const oversizedImage = join(root, "references", "too-large.png");
    await writeFile(oversizedImage, "");
    await truncate(oversizedImage, 25 * 1024 * 1024 + 1);
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });

    await expect(callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      { sourcePath: "references/too-large.png", prompt: "Change it" },
      { workspaceId: "workspace" },
    )).rejects.toMatchObject({ code: "invalid_image", status: 413 });
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
        { id: "openai/gpt-image-2-codex", configured: false, available: true, capabilities: { mask: false, region: true } },
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
        size: "3K",
      },
      { workspaceId: "workspace" },
    );

    expect(requests[0]).toEqual({
      url: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      body: {
        model: "doubao-seedream-5-0-260128",
        prompt: "A quiet glass pavilion at dawn",
        response_format: "b64_json",
        output_format: "png",
        watermark: false,
        size: "3K",
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

  test("advertises the same model parameter values accepted by both action schemas", async () => {
    const { models } = await openAiImageGenerationStatus(authorization);
    expect(models[0]?.parameters.quality?.delivery).toBe("native");
    expect(models[1]?.parameters).toMatchObject({ quality: null, size: { delivery: "prompt" } });
    expect(models[2]?.parameters).toMatchObject({ quality: null, size: { default: "2K", delivery: "native" } });
    expect(models[2]?.parameters.size?.values).not.toContain("1024x1024");
    for (const action of OPENAI_IMAGE_GENERATION_EXTENSION_ACTIONS.filter((action) => action.action === "image_generate" || action.action === "image_edit")) {
      for (const model of models) {
        for (const key of ["size", "quality"] as const) {
          const schema = Reflect.get(action.inputSchema.properties, key);
          for (const value of model.parameters[key]?.values ?? []) expect(schema.enum).toContain(value);
        }
      }
    }
  });

  test("sends every advertised native size and quality unchanged for generation and editing", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "source.png"), "source");
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init?.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(String(init?.body)));
      return Response.json({ data: [{ b64_json: Buffer.from("image").toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });
    for (const model of (await openAiImageGenerationStatus(authorization)).models) {
      if (model.parameters.size?.delivery !== "native") continue;
      for (const action of ["image_generate", "image_edit"]) {
        for (const size of model.parameters.size.values) {
          for (const quality of model.parameters.quality?.values ?? ["auto"]) {
            await callOpenAiImageGenerationExtensionAction(config(root), authorization, action, {
              model: model.id, prompt: "Fixture", sourcePath: "source.png", size, quality,
            }, { workspaceId: "workspace" });
            expect(requests.at(-1)).toMatchObject({ size });
            if (model.parameters.quality) expect(requests.at(-1)?.quality).toBe(quality);
            else expect(requests.at(-1)).not.toHaveProperty("quality");
          }
        }
      }
    }
  });

  test("rejects unsupported or malformed settings before provider calls instead of silently defaulting", async () => {
    const root = await temporaryRoot();
    await writeFile(join(root, "source.png"), "source");
    let calls = 0;
    globalThis.fetch = Object.assign(async () => { calls += 1; return Response.json({}); }, { preconnect: originalFetch.preconnect });
    for (const action of ["image_generate", "image_edit"]) {
      for (const args of [
        { model: "volcengine/seedream-5", quality: "high" },
        { model: "volcengine/seedream-5", size: "1024x1024" },
        { model: "openai/gpt-image-2", size: "3K" },
        { model: "openai/gpt-image-2", size: 123 },
        { model: "openai/gpt-image-2", quality: "ultra" },
        { model: "openai/gpt-image-2-codex", quality: "high" },
      ]) {
        await expect(callOpenAiImageGenerationExtensionAction(config(root), authorization, action, {
          prompt: "Fixture", sourcePath: "source.png", ...args,
        }, { workspaceId: "workspace" })).rejects.toMatchObject({ status: 400, code: "image_parameter_unsupported" });
      }
    }
    expect(calls).toBe(0);
  });

  test("uses Electron's system-proxy-aware fetch for image generation", async () => {
    const root = await temporaryRoot();
    let platformFetchCalled = false;
    let desktopFetchUrl = "";
    globalThis.fetch = Object.assign(async () => {
      platformFetchCalled = true;
      return Response.json({});
    }, { preconnect: originalFetch.preconnect });
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async (input: RequestInfo | URL) => {
      desktopFetchUrl = String(input);
      return Response.json({ data: [{ b64_json: Buffer.from("desktop-fetch-image").toString("base64") }] });
    });

    const response = await callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_generate",
      { prompt: "A proxy-aware image", filename: "proxy-result" },
      { workspaceId: "workspace" },
    );

    expect(platformFetchCalled).toBe(false);
    expect(desktopFetchUrl).toBe("https://api.openai.com/v1/images/generations");
    expect(response?.result).toMatchObject({ path: "artifacts/proxy-result.png" });
    expect(await readFile(join(root, "artifacts", "proxy-result.png"), "utf8")).toBe("desktop-fetch-image");
  });

  test("returns an actionable provider error when image generation cannot connect", async () => {
    const root = await temporaryRoot();
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => {
      throw new TypeError("fetch failed");
    });

    await expect(callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_generate",
      { prompt: "A test image" },
      { workspaceId: "workspace" },
    )).rejects.toMatchObject({
      status: 502,
      code: "openai_image_generation_unreachable",
      message: "Could not reach OpenAI for image generation. Check your connection or system proxy and try again.",
    });
  });

  test("sends the full mask as a second reference for Seedream, without requiring approximate bounds", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "references"), { recursive: true });
    const original = await solidPng(20);
    const output = await solidPng(220);
    await writeFile(join(root, "references", "source.png"), original);
    const requests: Array<Record<string, unknown>> = [];
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return Response.json({ data: [{ b64_json: output.toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });

    const response = await callOpenAiImageGenerationExtensionAction(
      config(root),
      authorization,
      "image_edit",
      {
        model: "volcengine/seedream-5",
        sourcePath: "references/source.png",
        prompt: "Turn the selected object blue",
        maskDataUrl: `data:image/png;base64,${(await solidPng(0, 0)).toString("base64")}`,
        filename: "seedream-edit",
      },
      { workspaceId: "workspace" },
    );

    expect(requests[0]).toMatchObject({
      model: "doubao-seedream-5-0-260128",
      size: "2K",
      output_format: "png",
      image: [expect.stringContaining("data:image/png;base64,"), expect.stringContaining("data:image/png;base64,")],
    });
    expect(requests[0]?.prompt).toContain("exact, pixel-aligned selection mask");
    expect(response?.result).toMatchObject({ path: "artifacts/seedream-edit.png", model: "volcengine/seedream-5" });
    expect(await sharp(await readFile(join(root, "artifacts", "seedream-edit.png"))).raw().toBuffer()).toEqual(await sharp(output).raw().toBuffer());
  });

  test("rejects invalid selected image bytes before contacting a provider", async () => {
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
    )).rejects.toMatchObject({ code: "invalid_image" });
    expect(called).toBe(false);
  });

  test.each(["openai/gpt-image-2", "volcengine/seedream-5"])("%s applies natural blending and continuity guidance through the real edit action", async (model) => {
    const root = await temporaryRoot();
    const width = 40, height = 40;
    const source = await sharp({ create: { width, height, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
    const generated = await sharp({ create: { width, height, channels: 4, background: { r: 220, g: 160, b: 100, alpha: 1 } } }).png().toBuffer();
    const mask = Buffer.alloc(width * height * 4, 255);
    for (let y = 5; y < 35; y++) for (let x = 5; x < 35; x++) mask[(y * width + x) * 4 + 3] = 0;
    const maskDataUrl = `data:image/png;base64,${(await sharp(mask, { raw: { width, height, channels: 4 } }).png().toBuffer()).toString("base64")}`;
    await writeFile(join(root, "source.png"), source);
    let calls = 0;
    globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const request = init?.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(String(init?.body));
      expect(request.prompt).toContain("rectangular patch");
      expect(request.prompt).toContain("lighting");
      return Response.json({ data: [{ b64_json: generated.toString("base64") }] });
    }, { preconnect: originalFetch.preconnect });
    const args = { model, prompt: "Turn only the orb blue", sourcePath: "source.png", maskDataUrl, filename: "natural", selectionBlend: "natural" };
    await expect(callOpenAiImageGenerationExtensionAction(config(root), authorization, "image_edit", { ...args, selectionBlend: "invalid" }, { workspaceId: "workspace" })).rejects.toMatchObject({ code: "invalid_selection_blend" });
    expect(calls).toBe(0);
    await callOpenAiImageGenerationExtensionAction(config(root), authorization, "image_edit", args, { workspaceId: "workspace" });
    expect(calls).toBe(1);
    const output = await sharp(await readFile(join(root, "artifacts/natural.png"))).ensureAlpha().raw().toBuffer();
    const original = await sharp(source).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < mask.length; i += 4) if (mask[i + 3] === 255) expect(output.subarray(i, i + 4)).toEqual(original.subarray(i, i + 4));
    expect(output[(5 * width + 20) * 4]).toBe(20);
    expect(output[(8 * width + 20) * 4]).toBeGreaterThan(20);
    expect(output[(8 * width + 20) * 4]).toBeLessThan(220);
    expect(output[(20 * width + 20) * 4]).toBe(220);
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
