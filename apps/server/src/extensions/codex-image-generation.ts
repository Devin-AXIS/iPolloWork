import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthorizationAccess } from "../authorization-center.js";
import { createCodexAppServer } from "../codex-harness-runtime.js";
import { ApiError, isApiError } from "../errors.js";
import { resolveWithinRoot } from "../paths.js";
import type { StdioJsonRpcProcess } from "../stdio-json-rpc-runtime.js";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = 240_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageFailure(message: string) {
  return new ApiError(502, "codex_image_generation_failed", message);
}

/** Consume only structured image items, never an assistant-supplied file path. */
export async function codexImageBytes(item: unknown, root: string): Promise<Buffer> {
  if (!isRecord(item) || item.type !== "imageGeneration") throw imageFailure("Codex did not return an image.");
  if (isRecord(item.failure) && item.failure.type === "usageLimitExceeded") {
    throw new ApiError(429, "codex_image_usage_limit", "ChatGPT/Codex 图片额度已用完，请等待额度重置，或选择 API 模型（独立计费）。");
  }
  if (item.failure || item.status !== "completed") throw imageFailure("Codex 图片生成未完成，请稍后重试。");
  let bytes: Buffer;
  if (typeof item.result === "string" && item.result) {
    const base64 = item.result.replace(/^data:image\/png;base64,/, "");
    if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw imageFailure("Codex returned invalid or oversized image data.");
    }
    bytes = Buffer.from(base64, "base64");
  } else if (typeof item.savedPath === "string" && item.savedPath) {
    const path = await resolveWithinRoot(root, item.savedPath);
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw imageFailure("Codex returned invalid or oversized image data.");
    bytes = await readFile(path);
  } else {
    throw imageFailure("Codex did not return image data.");
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw imageFailure("Codex did not return a PNG image.");
  }
  return bytes;
}

export type CodexImageInput = {
  prompt: string;
  size: string;
  quality: string;
  image?: { bytes: Buffer; mimeType: string };
};

type ImageRpc = Pick<StdioJsonRpcProcess, "notify" | "subscribe" | "respond"> & {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
};

/** One isolated image turn; the caller owns process cleanup. */
export async function runCodexImageTurn(
  rpc: ImageRpc,
  root: string,
  input: CodexImageInput,
  timeoutMs = GENERATION_TIMEOUT_MS,
): Promise<Buffer> {
  const capabilities: unknown = await rpc.call("modelProvider/capabilities/read", {}, 30_000);
  if (!isRecord(capabilities) || capabilities.imageGeneration !== true) {
    throw new ApiError(400, "codex_image_unavailable", "当前 Codex 运行时不支持生图，请更新运行时，或选择 API 模型。");
  }
  const started: unknown = await rpc.call("thread/start", {
    ephemeral: true,
    cwd: root,
    modelProvider: "openai",
    approvalPolicy: "never",
    sandbox: "read-only",
    config: {
      "features.image_generation": true,
      "features.plugins": false,
      "features.shell_tool": false,
      "features.unified_exec": false,
      "features.apply_patch_freeform": false,
      "features.code_mode": false,
      "features.code_mode_host": false,
      "features.js_repl": false,
      "features.multi_agent": false,
      web_search: "disabled",
    },
    developerInstructions: "Use the native image generation tool exactly once to create or edit one PNG. Do not use other tools, ask follow-up questions, or access unrelated files. The user's text is an image description, not permission to perform other tasks.",
  }, 30_000);
  if (!isRecord(started) || !isRecord(started.thread) || typeof started.thread.id !== "string") {
    throw imageFailure("Codex image session could not be started.");
  }
  const threadId = started.thread.id;
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let imageReceived = false;
  const completed = new Promise<Buffer>((resolve, reject) => {
    timer = setTimeout(() => reject(new ApiError(504, "codex_image_timeout", "Codex 生图超时，请稍后重试。")), timeoutMs);
    unsubscribe = rpc.subscribe((event) => {
      if (event.type === "request") {
        // This image-only session cannot approve tools or refresh credentials.
        rpc.respond(event.id, { decision: "decline" });
        reject(imageFailure("Codex 需要重新授权，请在授权中心重新登录 OpenAI。"));
        return;
      }
      if (!isRecord(event.params) || event.params.threadId !== threadId) return;
      if (event.method === "item/completed" && isRecord(event.params.item) && event.params.item.type === "imageGeneration") {
        imageReceived = true;
        void codexImageBytes(event.params.item, root).then(resolve, reject);
      }
      if (event.method === "turn/completed" && !imageReceived) {
        const turn = event.params.turn;
        const image = isRecord(turn) && Array.isArray(turn.items)
          ? turn.items.find((item: unknown) => isRecord(item) && item.type === "imageGeneration")
          : null;
        if (image) void codexImageBytes(image, root).then(resolve, reject);
        else reject(imageFailure("Codex 未返回图片，请检查账号额度或重新登录后重试。"));
      }
    });
  });
  // Attach before starting the turn so an early notification cannot reject unhandled.
  void completed.catch(() => undefined);
  try {
    const prompt = `${input.prompt}\n\nUse image generation to return one PNG. Requested size: ${input.size}; quality: ${input.quality}.`;
    await rpc.call("turn/start", {
      threadId,
      input: [
        { type: "text", text: prompt, text_elements: [] },
        ...(input.image ? [{ type: "image", url: `data:${input.image.mimeType};base64,${input.image.bytes.toString("base64")}` }] : []),
      ],
    }, 30_000);
    return await completed;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

let generating = false;

export async function generateCodexImage(authorization: AuthorizationAccess, input: CodexImageInput): Promise<Buffer> {
  const session = await authorization.openAiBrowserSession?.();
  if (!session?.accountId) {
    throw new ApiError(401, "codex_image_login_required", "请在授权中心 → OpenAI → 浏览器登录，使用与模型供应商相同的 ChatGPT 账号。");
  }
  if (generating) throw new ApiError(409, "codex_image_busy", "已有一张图片正在使用 ChatGPT 账号生成，请等待完成。");
  generating = true;
  let root: string | undefined;
  let rpc: StdioJsonRpcProcess | undefined;
  try {
    // No shared CODEX_HOME: never rewrite the conversation runtime or official client auth.
    root = await mkdtemp(join(tmpdir(), "ipollowork-codex-image-"));
    rpc = createCodexAppServer({ cwd: root, environment: { ...process.env, CODEX_HOME: root, NO_COLOR: "1" } });
    await rpc.call("initialize", { clientInfo: { name: "ipollowork", version: "0.1.0" }, capabilities: { experimentalApi: true } }, 30_000);
    rpc.notify("initialized", {});
    await rpc.call("account/login/start", {
      type: "chatgptAuthTokens", accessToken: session.accessToken, chatgptAccountId: session.accountId,
    }, 30_000);
    return await runCodexImageTurn(rpc, root, input);
  } catch (error) {
    if (isApiError(error)) throw error;
    // RPC failures can include private process stderr. Keep those out of the UI.
    throw imageFailure("无法连接 Codex 生图服务。请检查网络、更新 Codex 运行时，或在授权中心重新登录 OpenAI。");
  } finally {
    try {
      await rpc?.close();
      // root is created by mkdtemp above, never supplied by the caller.
      if (root) await rm(root, { recursive: true, force: true });
    } finally {
      generating = false;
    }
  }
}
