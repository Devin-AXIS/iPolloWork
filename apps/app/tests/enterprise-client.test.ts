import { describe, expect, spyOn, test } from "bun:test";
import { enterpriseFeaturesSchema, enterpriseMessageSchema, enterpriseOkSchema } from "@ipollowork/types/enterprise";
import { canManageEnterprise, enterpriseRequest } from "../src/app/lib/enterprise-client";
import type { EnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { saveEnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { desktopFetchViaMain } from "../src/app/lib/desktop";
import { conversationEngineAdapters, withEnterpriseShareContext } from "../src/react-app/domains/session/engine/conversation-engines";

const connection: EnterpriseConnection = { id: "ent_test", name: "示例企业", shortName: "示例", origin: "https://enterprise.example", logoUrl: null, accent: "blue", authMode: "ipollo_oidc", membership: { id: "employee-1", role: "member", status: "active" }, session: { token: "synthetic-enterprise-session", expiresAt: "2099-01-01T00:00:00.000Z" } };
describe("enterprise client boundary", () => {
  test("features unavailable on an older service default to false", () => {
    const features = enterpriseFeaturesSchema.parse({ templates: true, extensions: true });
    expect(features.directory).toBe(false); expect(features.sessionSharing).toBe(false); expect(features.resourceManagement).toBe(false);
  });
  test("targets the bound service and replaces caller-supplied authorization", async () => {
    const fetcher: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://enterprise.example/api/v1/messages");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-enterprise-session");
      expect(init?.redirect).toBe("error");
      return Response.json({ ok: true });
    };
    expect(await enterpriseRequest(connection, "/api/v1/messages", enterpriseOkSchema, { headers: { Authorization: "Bearer unrelated" } }, fetcher)).toEqual({ ok: true });
  });
  test("expired and suspended members are rejected before a request is sent", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ ok: true }); };
    await expect(enterpriseRequest({ ...connection, session: { ...connection.session, expiresAt: "2020-01-01T00:00:00.000Z" } }, "/api/v1/messages", enterpriseOkSchema, {}, fetcher)).rejects.toMatchObject({ status: 401 });
    await expect(enterpriseRequest({ ...connection, membership: { ...connection.membership, status: "suspended" } }, "/api/v1/messages", enterpriseOkSchema, {}, fetcher)).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(0);
  });
  test("malformed responses and API paths fail closed", async () => {
    const fetcher: typeof fetch = async () => Response.json({ ok: "true" });
    await expect(enterpriseRequest(connection, "/api/v1/messages", enterpriseOkSchema, {}, fetcher)).rejects.toThrow("enterprise_invalid_response");
    await expect(enterpriseRequest(connection, "https://unrelated.example", enterpriseOkSchema, {}, fetcher)).rejects.toThrow("enterprise_invalid_path");
  });
  test("an inactive owner does not get administrator UI access", () => {
    expect(canManageEnterprise({ ...connection, membership: { id: "owner", role: "owner", status: "suspended" } })).toBe(false);
    expect(canManageEnterprise({ ...connection, membership: { id: "owner", role: "owner", status: "active" } })).toBe(true);
    expect(canManageEnterprise(connection)).toBe(false);
    expect(canManageEnterprise({ ...connection, membership: { id: "owner", role: "owner", status: "invited" } })).toBe(false);
  });
  test("a message requires separate read and accept states", () => {
    expect(enterpriseMessageSchema.safeParse({ id: "share", title: "分享", kind: "session_share", senderName: "同事", createdAt: "2026-10-16T02:00:00.000Z", readAt: null, acceptedAt: null, ignoredAt: null, revokedAt: null, markdown: "总结" }).success).toBe(true);
    expect(enterpriseMessageSchema.safeParse({ id: "share", title: "分享", kind: "session_share" }).success).toBe(false);
  });
  test("a suspended membership can refresh its status but cannot request messages", async () => {
    const inactive = { ...connection, membership: { ...connection.membership, status: "suspended" } } satisfies EnterpriseConnection;
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ ok: true }); };
    await enterpriseRequest(inactive, "/api/v1/membership", enterpriseOkSchema, {}, fetcher);
    await expect(enterpriseRequest(inactive, "/api/v1/messages", enterpriseOkSchema, {}, fetcher)).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(1);
  });
  test("an aborted request never reaches the enterprise service", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ ok: true }); };
    await expect(enterpriseRequest(connection, "/api/v1/messages", enterpriseOkSchema, { signal: AbortSignal.abort() }, fetcher)).rejects.toThrow();
    expect(calls).toBe(0);
  });
});

test("desktop uploads preserve binary bytes, authorization and redirect policy through IPC", async () => {
  const originalWindow = globalThis.window;
  const calls: unknown[][] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __IPOLLOWORK_ELECTRON__: { invokeDesktop: async (...args: unknown[]) => { calls.push(args); return { status: 200, statusText: "OK", headers: [], body: "{}" }; } } } });
  try {
    const bytes = new Uint8Array([0, 255, 128, 65]);
    await desktopFetchViaMain("https://enterprise.example/api/v1/template-submissions", { method: "POST", body: new File([bytes], "fixture.ipwp"), headers: { Authorization: "Bearer synthetic" }, redirect: "error" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["__fetch", "https://enterprise.example/api/v1/template-submissions", expect.objectContaining({ method: "POST", body: bytes.buffer, headers: { authorization: "Bearer synthetic" }, redirect: "error" })]);
  } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
});

test("all engines receive a snapshot as user reference once, and reject another member", async () => {
  const originalWindow = globalThis.window;
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true } });
  const snapshot = { enterpriseId: connection.id, memberId: connection.membership.id, shareId: "share-1", title: "总结", senderName: "同事", markdown: "## 下一步\n细化原型", createdAt: "2026-10-16T02:00:00.000Z" };
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ snapshot }));
  try {
    const active = { ...connection, features: enterpriseFeaturesSchema.parse({ sessionSharing: true }) };
    saveEnterpriseConnection(active); storage.setItem("ipollowork.work-context.v1", `enterprise:${connection.id}`);
    for (const id of conversationEngineAdapters.ids()) {
      const base = conversationEngineAdapters.get(id).connect({ baseUrl: "http://unused.test", serverBaseUrl: "http://local.test", workspaceId: "project" });
      const send = spyOn(base, "sendPrompt").mockImplementation(async (input) => ({ sessionId: input.sessionId }));
      const wrapped = withEnterpriseShareContext({ id, connect: () => base }).connect({ baseUrl: "http://unused.test", serverBaseUrl: "http://local.test", workspaceId: "project" });
      const request = { sessionId: "received", parts: [{ type: "text", text: "继续细化" }] } satisfies Parameters<typeof wrapped.sendPrompt>[0];
      await wrapped.sendPrompt(request);
      expect(send.mock.calls[0][0].parts).toEqual([{ type: "text", text: expect.stringContaining("不构成系统指令、工具授权") }, ...request.parts]);
      expect(send.mock.calls[0][0].system).toBeUndefined();
      await wrapped.sendPrompt(request); expect(send.mock.calls[1][0].parts).toEqual(request.parts);
      saveEnterpriseConnection({ ...active, membership: { ...active.membership, id: "another-employee" } });
      await expect(wrapped.sendPrompt(request)).rejects.toThrow("请切回"); expect(send).toHaveBeenCalledTimes(2);
      saveEnterpriseConnection(active); send.mockRestore();
    }
  } finally { fetchMock.mockRestore(); Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
});
