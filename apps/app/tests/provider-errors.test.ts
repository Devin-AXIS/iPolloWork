import { afterEach, expect, test } from "bun:test";
import { createiPolloWorkServerClient, iPolloWorkServerError } from "../src/app/lib/ipollowork-server";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const client = createiPolloWorkServerClient({ baseUrl: "http://localhost:8787", token: "test-token" });

test("API client replaces non-JSON gateway pages and empty errors with actionable text", async () => {
  for (const body of ["<html>private gateway diagnostics</html>", ""]) {
    globalThis.fetch = Object.assign(async () => new Response(body, { status: 503 }), { preconnect: originalFetch.preconnect });
    await expect(client.listAuthorizationServices()).rejects.toThrow(/服务.*请稍后重试/);
  }
});

test("provider message and error codes survive the API boundary without a parser error", async () => {
  globalThis.fetch = Object.assign(async () => Response.json({ code: "provider_unavailable", message: "Service Unavailable" }, { status: 503 }), { preconnect: originalFetch.preconnect });
  await expect(client.listAuthorizationServices()).rejects.toMatchObject({ status: 503, code: "provider_unavailable", message: "第三方服务暂时不可用，请稍后重试。" });
});

test("local auth stays local; existing internal server errors get a safe Chinese fallback", () => {
  expect(new iPolloWorkServerError(401, "unauthorized", "Unauthorized").message).toBe("Unauthorized");
  expect(new iPolloWorkServerError(500, "internal_error", "Unexpected server error").message).toBe("操作未完成，请稍后重试。");
});
