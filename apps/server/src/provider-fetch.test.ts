import { afterEach, expect, test } from "bun:test";
import { classifyProviderFailure, serviceErrorMessage } from "@ipollowork/types/provider-errors";
import { ApiError, formatError, toApiError } from "./errors.js";
import { providerFetch, PROVIDER_FETCH_SYMBOL } from "./provider-fetch.js";

const previous: unknown = Reflect.get(globalThis, PROVIDER_FETCH_SYMBOL);
afterEach(() => {
  if (previous === undefined) Reflect.deleteProperty(globalThis, PROVIDER_FETCH_SYMBOL);
  else Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, previous);
});

test("JSON, HTML, empty and oversized gateway errors use the same safe fallback", async () => {
  for (const status of [500, 502, 503, 504]) {
    for (const body of ['{"error":{"message":"private secret-value"}}', "<html>Gateway error</html>", "", "x".repeat(70_000)]) {
      let calls = 0;
      Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => { calls++; return new Response(body, { status }); });
      await expect(providerFetch("https://mock.invalid/generate", { method: "POST" })).rejects.toMatchObject({
        status, code: status === 504 ? "provider_timeout" : "provider_unavailable",
        message: status === 504 ? "第三方服务响应超时，请稍后重试。" : "第三方服务暂时不可用，请稍后重试。",
      });
      expect(calls).toBe(1);
    }
  }
});

test("auth, permission, billing and rate limits remain distinct, without leaking provider details", async () => {
  for (const [status, upstreamCode, expectedCode] of [
    [401, "invalid_api_key", "provider_auth_failed"], [403, "forbidden", "provider_access_denied"],
    [402, "payment_required", "provider_quota_exhausted"], [429, "insufficient_quota", "provider_quota_exhausted"],
    [429, "rate_limit_exceeded", "provider_rate_limited"],
  ] as const) {
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => Response.json({ error: { code: upstreamCode, message: "private key-value" } }, { status }));
    await expect(providerFetch("https://mock.invalid")).rejects.toMatchObject({ status, code: expectedCode });
  }
});

test("transport errors are safe and timeouts do not turn into auth failures", async () => {
  for (const [error, code] of [[new TypeError("fetch failed"), "provider_network_error"], [new DOMException("deadline", "TimeoutError"), "provider_timeout"], [new DOMException("aborted", "AbortError"), "provider_timeout"]] as const) {
    Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async () => { throw error; });
    await expect(providerFetch("https://mock.invalid")).rejects.toMatchObject({ code });
  }
});

test("successful and domain-validation responses remain consumable; caller cancellation propagates", async () => {
  const controller = new AbortController();
  Reflect.set(globalThis, PROVIDER_FETCH_SYMBOL, async (_url: unknown, init: RequestInit) => {
    expect(init.signal).toBeDefined();
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
    return Response.json({ error: { message: "Voice does not match model" } }, { status: 400 });
  });
  const response = await providerFetch("https://mock.invalid", { signal: controller.signal });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { message: "Voice does not match model" } });
});

test("legacy plugin errors get a fallback without disguising local failures or losing domain guidance", () => {
  expect(formatError(toApiError(new Error("GitHub request failed with HTTP 503")))).toMatchObject({ code: "provider_unavailable" });
  expect(formatError(toApiError(new Error("WeChat request failed with HTTP 429")))).toMatchObject({ code: "provider_rate_limited" });
  expect(formatError(toApiError(new Error("Cannot read properties of undefined")))).toEqual({ code: "internal_error", message: "操作未完成，请稍后重试。", details: undefined });
  expect(formatError(new ApiError(403, "read_only", "Workspace is read only")).message).toBe("Workspace is read only");
  expect(classifyProviderFailure({ status: 503, message: "Invalid API key" })?.code).toBe("provider_unavailable");
  expect(serviceErrorMessage("JSON Parse error: Unrecognized token '<'")).toBe("操作未完成，请稍后重试。");
  const guidance = "ChatGPT/Codex 图片额度已用完，请等待额度重置，或选择 API 模型（独立计费）。";
  expect(serviceErrorMessage({ status: 429, message: guidance })).toBe(guidance);
});
