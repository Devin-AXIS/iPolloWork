import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StdioJsonRpcEvent } from "../stdio-json-rpc-runtime.js";
import { codexImageBytes, generateCodexImage, runCodexImageTurn } from "./codex-image-generation.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64");
const image = { type: "imageGeneration", status: "completed", result: png.toString("base64"), failure: null };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

function fakeRpc(options: { capability?: boolean; result?: unknown; silent?: boolean; turn?: unknown } = {}) {
  let listener: ((event: StdioJsonRpcEvent) => void) | undefined;
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    subscribed: () => Boolean(listener),
    async call(method: string, params?: unknown) {
      calls.push({ method, params });
      if (method === "modelProvider/capabilities/read") return { imageGeneration: options.capability !== false };
      if (method === "thread/start") return { thread: { id: "image-thread" } };
      if (method === "turn/start" && !options.silent) {
        queueMicrotask(() => listener?.({ type: "notification", method: "turn/completed", params: {
          threadId: "image-thread", turn: options.turn ?? { status: "completed", items: options.result === null ? [] : [options.result ?? image] },
        } }));
      }
      return {};
    },
    notify() {},
    respond() {},
    subscribe(callback: (event: StdioJsonRpcEvent) => void) {
      listener = callback;
      return () => { listener = undefined; };
    },
  };
}

describe("ChatGPT image generation", () => {
  test("uses an isolated native image turn with no conversation context or general tools", async () => {
    const rpc = fakeRpc();
    expect(await runCodexImageTurn(rpc, tmpdir(), { prompt: "A red bird", size: "auto", quality: "auto", image: { bytes: png, mimeType: "image/png" } })).toEqual(png);
    expect(rpc.calls[1]).toMatchObject({ method: "thread/start", params: {
      ephemeral: true, modelProvider: "openai", approvalPolicy: "never", sandbox: "read-only",
      config: { "features.shell_tool": false, "features.plugins": false, "features.image_generation": true },
    } });
    expect(rpc.calls[2]).toMatchObject({ method: "turn/start", params: { input: [
      { type: "text", text: expect.stringContaining("A red bird") },
      { type: "image", url: `data:image/png;base64,${png.toString("base64")}` },
    ] } });
    expect(rpc.subscribed()).toBe(false);
  });

  test("rejects an unsupported runtime before starting a turn", async () => {
    const rpc = fakeRpc({ capability: false });
    await expect(runCodexImageTurn(rpc, tmpdir(), { prompt: "bird", size: "auto", quality: "auto" })).rejects.toMatchObject({ code: "codex_image_unavailable" });
    expect(rpc.calls).toHaveLength(1);
  });

  test("reports missing output and releases the subscription", async () => {
    const rpc = fakeRpc({ result: null });
    await expect(runCodexImageTurn(rpc, tmpdir(), { prompt: "bird", size: "auto", quality: "auto" })).rejects.toMatchObject({
      code: "codex_image_generation_failed", message: "Codex 未返回图片结果，图片工具可能未能启动。请更新 Codex 运行时后重试。",
    });
    expect(rpc.subscribed()).toBe(false);
  });

  test.each([
    ["usageLimitExceeded", 429, "codex_image_usage_limit"],
    ["unauthorized", 401, "codex_image_login_required"],
    ["internalServerError", 502, "codex_image_generation_failed"],
  ])("classifies failed turns by structured %s without exposing runtime details", async (codexErrorInfo, status, code) => {
    const rpc = fakeRpc({ turn: { status: "failed", items: [], error: { codexErrorInfo, message: "private-token", additionalDetails: "private-stderr" } } });
    const error = await runCodexImageTurn(rpc, tmpdir(), { prompt: "bird", size: "auto", quality: "auto" }).catch((error: unknown) => error);
    expect(error).toMatchObject({ status, code });
    expect(String(error)).not.toContain("private-");
    expect(rpc.subscribed()).toBe(false);
  });

  test("reports an interrupted turn without blaming credentials", async () => {
    const rpc = fakeRpc({ turn: { status: "interrupted", items: [] } });
    await expect(runCodexImageTurn(rpc, tmpdir(), { prompt: "bird", size: "auto", quality: "auto" })).rejects.toMatchObject({ message: "Codex 图片任务已中断，请重试。" });
    expect(rpc.subscribed()).toBe(false);
  });

  test("times out a stalled turn and releases the subscription", async () => {
    const rpc = fakeRpc({ silent: true });
    await expect(runCodexImageTurn(rpc, tmpdir(), { prompt: "bird", size: "auto", quality: "auto" }, 5)).rejects.toMatchObject({ status: 504 });
    expect(rpc.subscribed()).toBe(false);
  });

  test("keeps subscription quota failures separate from API billing", async () => {
    await expect(codexImageBytes({ ...image, failure: { type: "usageLimitExceeded" } }, tmpdir())).rejects.toMatchObject({ status: 429, code: "codex_image_usage_limit" });
  });

  test("requires browser login even when an API key exists", async () => {
    await expect(generateCodexImage({ read: async () => ({ OPENAI_API_KEY: "api-only" }) }, { prompt: "bird", size: "auto", quality: "auto" })).rejects.toMatchObject({ status: 401 });
  });

  test("rejects non-images, invalid base64 and oversized output", async () => {
    for (const result of [Buffer.from("not an image").toString("base64"), "!!!!", "A".repeat(35 * 1024 * 1024)]) {
      await expect(codexImageBytes({ ...image, result }, tmpdir())).rejects.toMatchObject({ code: "codex_image_generation_failed" });
    }
  });

  test("reads only structured PNG output within its temporary root", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipollowork-codex-image-test-"));
    roots.push(root);
    const path = join(root, "image.png");
    await writeFile(path, png);
    expect(await codexImageBytes({ ...image, result: "", savedPath: path }, root)).toEqual(png);
    await expect(codexImageBytes({ ...image, result: "", savedPath: join(root, "..", "outside.png") }, root)).rejects.toMatchObject({ code: "path_escape" });
    await expect(codexImageBytes({ type: "agentMessage", text: path }, root)).rejects.toMatchObject({ code: "codex_image_generation_failed" });
  });
});
