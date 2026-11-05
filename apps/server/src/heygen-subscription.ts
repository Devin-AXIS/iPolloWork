import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { heygenAvatarFormat, heygenBillingModeSchema, type HeygenSubscriptionStatus } from "@ipollowork/types/video-generation";
import { serviceErrorInfo } from "@ipollowork/types/provider-errors";
import { z } from "zod";
import { authorizationVault } from "./authorization-runtime.js";
import { ApiError, providerApiError } from "./errors.js";
import { fetchMcpService, mcpServiceAuthorizationStatus, revokeMcpServiceAuthorization, startMcpServiceAuthorization } from "./mcp-authorization.js";
import { providerFetch, providerOAuthFetch } from "./provider-fetch.js";
import type { ServerConfig } from "./types.js";
import { runtimeStorageDir } from "./runtime-storage.js";

// Use our own dynamically registered OAuth client; never borrow another application's client ID.
export const HEYGEN_MCP_URL = "https://mcp.heygen.com/mcp/v1";
const HEYGEN_MCP_TRANSPORT_URL = `${HEYGEN_MCP_URL}/`;
const BILLING_CREDENTIAL = { connectionId: "heygen-video", accountId: "default", methodId: "billing", methodFingerprint: "heygen-billing-v1" };

export async function heygenSubscriptionStatus(config: ServerConfig): Promise<HeygenSubscriptionStatus & { sessionId?: string }> {
  const vault = await authorizationVault(config);
  const values = await vault.readCredentialForAccount(BILLING_CREDENTIAL);
  const mode = heygenBillingModeSchema.parse(values?.mode ?? "api-key");
  return { ...await mcpServiceAuthorizationStatus(config, HEYGEN_MCP_URL), mode };
}

export async function updateHeygenSubscription(config: ServerConfig, input: unknown, callbackUrl: string) {
  const { action } = z.object({ action: z.enum(["connect", "disconnect", "use-subscription", "use-api-key"]) }).strict().parse(input);
  const vault = await authorizationVault(config);
  if (action === "disconnect") {
    await revokeMcpServiceAuthorization(config, HEYGEN_MCP_URL);
  } else {
    const mode = action === "use-api-key" ? "api-key" : "subscription";
    // A failed login must not silently switch billing back to an existing API wallet.
    await vault.saveCredential({ ...BILLING_CREDENTIAL, values: { mode }, secretFields: [] });
  }
  if (action === "connect") {
    try {
      return await startMcpServiceAuthorization({ config, resourceUrl: HEYGEN_MCP_URL, callbackUrl, fetcher: providerOAuthFetch });
    } catch {
      throw new ApiError(400, "heygen_oauth_unavailable", "无法发起 HeyGen 官方授权。请检查网络；若 HeyGen 拒绝客户端注册或回调地址，需要先申请 iPolloWork 接入白名单。");
    }
  }
  return { status: await heygenSubscriptionStatus(config) };
}

type HeygenTool = "get_current_user" | "create_asset_upload" | "complete_asset_upload" | "create_video_from_image" | "get_video";
const record = z.record(z.string(), z.unknown());
const stages = { get_current_user: "读取账户", create_asset_upload: "申请素材上传", complete_asset_upload: "确认素材上传", create_video_from_image: "提交生成", get_video: "查询视频" };

function subscriptionToolError(name: HeygenTool, result: Record<string, unknown>) {
  const texts = z.array(z.object({ type: z.string(), text: z.string().optional() })).safeParse(result.content);
  const text = texts.success ? texts.data.find(item => item.type === "text")?.text : undefined;
  let source: unknown = result.structuredContent;
  if (!source && text) {
    try { source = JSON.parse(text); } catch { source = text; }
  }
  const info = serviceErrorInfo(source);
  const reason = [info.code, info.message].filter(Boolean).join(": ")
    .replace(/https?:\/\/[^\s"<>]+/gi, "[服务链接]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|signature|secret|password)["'\s:=]+[^\s,;}]+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-+/=]{64,}/g, "[redacted]").replace(/[\u0000-\u001f]/g, " ").slice(0, 450);
  return new ApiError(info.status && info.status >= 400 && info.status <= 599 ? info.status : 400, "heygen_subscription_rejected",
    `HeyGen ${stages[name]}失败${reason ? `：${reason}` : "，未返回具体原因，请检查账户权限和输入素材。"} 未改用 API 余额。`);
}

// The sidebar polls every ten seconds. Share one bounded, session-bound account read;
// submission and queue execution always bypass this display-only cache.
let accountCheck: { binding: string; expiresAt: number; result: Promise<{ plan: string; avatarLimits: ReturnType<typeof heygenAvatarFormat> }> } | undefined;
export async function heygenSubscriptionAccount(config: ServerConfig, sessionId: string, fresh = false, signal = AbortSignal.timeout(15_000)) {
  const binding = `${runtimeStorageDir(config)}:${sessionId}`;
  if (!fresh && accountCheck?.binding === binding && accountCheck.expiresAt > Date.now()) return accountCheck.result;
  const result = callHeygenSubscriptionTool(config, "get_current_user", {}, signal, sessionId).then(user => {
    const subscription = z.object({ plan: z.string().trim().min(1).max(100) }).safeParse(user.subscription);
    if (!subscription.success) throw new ApiError(502, "heygen_subscription_plan_unavailable", "HeyGen 未返回可识别的套餐，请刷新或重新授权后再生成。");
    const { plan } = subscription.data;
    return { plan, avatarLimits: heygenAvatarFormat(plan) };
  });
  const check = { binding, expiresAt: Date.now() + 60_000, result };
  accountCheck = check;
  try { return await result; }
  catch (error) { if (accountCheck === check) accountCheck = undefined; throw error; }
}

/** Only these bounded media operations are reachable; provider tools are never installed into the agent. */
export async function callHeygenSubscriptionTool(config: ServerConfig, name: HeygenTool, args: Record<string, unknown>, signal: AbortSignal, sessionId?: string) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const client = new Client({ name: "iPolloWork", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(HEYGEN_MCP_TRANSPORT_URL), {
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    fetch: async (_url, init) => {
      const response = await fetchMcpService(config, HEYGEN_MCP_URL, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline }, providerOAuthFetch, sessionId, HEYGEN_MCP_TRANSPORT_URL);
      // Bound both JSON and SSE responses through their full consumption.
      if (!response.body) return response;
      let size = 0;
      const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > 2 * 1024 * 1024) throw new ApiError(502, "heygen_response_too_large", "HeyGen 返回的数据过大。");
        controller.enqueue(chunk);
      } }));
      return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
  });
  try {
    await client.connect(transport, { signal: deadline, timeout: 60_000 });
    const result = await client.callTool({ name, arguments: args }, undefined, { signal: deadline, timeout: 60_000 });
    if (result.isError) throw subscriptionToolError(name, result);
    const structured = record.safeParse(result.structuredContent);
    if (structured.success) return record.parse(structured.data.data ?? structured.data);
    const content = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(result.content);
    const text = content.find(item => item.type === "text")?.text;
    if (!text) throw new ApiError(502, "heygen_response_invalid", "HeyGen 未返回有效结果。");
    const parsed = record.parse(JSON.parse(text));
    return record.parse(parsed.data ?? parsed);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function uploadHeygenSubscriptionAsset(config: ServerConfig, bytes: Uint8Array, filename: string, contentType: string, signal: AbortSignal, sessionId: string) {
  const result = await callHeygenSubscriptionTool(config, "create_asset_upload", { filename, contentType, sizeBytes: bytes.byteLength }, signal, sessionId);
  const upload = z.object({ asset_id: z.string().min(1).max(200), upload_url: z.url(), upload_headers: z.record(z.string(), z.string()).optional() }).parse(result);
  const url = new URL(upload.upload_url);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
    || !(url.hostname.endsWith(".amazonaws.com") || url.hostname.endsWith(".heygen.com") || url.hostname.endsWith(".heygen.ai"))) {
    throw new ApiError(502, "heygen_upload_url_invalid", "HeyGen 返回的上传地址不受信任。");
  }
  const headers = new Headers(upload.upload_headers);
  if (headers.has("authorization") || headers.has("x-api-key") || headers.has("cookie") || headers.has("x-ipollowork-host-token")) {
    throw new ApiError(502, "heygen_upload_headers_invalid", "HeyGen 返回的上传凭据不受信任。");
  }
  const response = await providerFetch(url, { method: "PUT", headers, body: new Blob([new Uint8Array(bytes)]), redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  await response.body?.cancel();
  if (!response.ok) throw providerApiError({}, response.status);
  await callHeygenSubscriptionTool(config, "complete_asset_upload", { assetId: upload.asset_id }, signal, sessionId);
  return upload.asset_id;
}
