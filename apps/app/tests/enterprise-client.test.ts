import { describe, expect, spyOn, test } from "bun:test";
import { enterpriseFeaturesSchema, enterpriseMessageSchema, enterpriseOkSchema, type EnterpriseResourceType } from "@ipollowork/types/enterprise";
import { canManageEnterprise, enterpriseApi, enterpriseErrorMessage, enterpriseRequest } from "../src/app/lib/enterprise-client";
import { iPolloWorkServerError } from "../src/app/lib/ipollowork-server";
import type { EnterpriseConnection } from "../src/app/lib/enterprise-connections";
import { saveEnterpriseConnection, setEnterpriseConnectionAccount } from "../src/app/lib/enterprise-connections";
import { desktopFetchViaMain } from "../src/app/lib/desktop";
import { conversationEngineAdapters, withEnterpriseShareContext } from "../src/react-app/domains/session/engine/conversation-engines";

const connection: EnterpriseConnection = { id: "ent_test", name: "示例企业", shortName: "示例", origin: "https://enterprise.example", logoUrl: null, accent: "blue", authMode: "ipollo_oidc", membership: { id: "employee-1", role: "member", status: "active" }, session: { token: "synthetic-enterprise-session", expiresAt: "2099-01-01T00:00:00.000Z" } };
describe("enterprise client boundary", () => {
  test("every resource management request rechecks a cached administrator and blocks a demoted member", async () => {
    const cached = { ...connection, membership: { ...connection.membership, role: "admin" } } satisfies EnterpriseConnection;
    let checks = 0, managementRequests = 0;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/membership")) {
        checks++;
        return Response.json({ membership: { ...connection.membership, displayName: "Employee", email: "employee@example.com" } });
      }
      managementRequests++;
      return Response.json({ ok: true });
    });
    try {
      const types: EnterpriseResourceType[] = ["template", "extension", "skill"];
      for (const type of types) {
        expect(canManageEnterprise(cached, type)).toBe(true);
        const actions = [
          () => enterpriseApi.resources(cached, type),
          () => enterpriseApi.access(cached, "resource", type),
          () => enterpriseApi.setAccess(cached, "resource", { revision: 0, access: "all", memberIds: [], departments: [], groupIds: [] }, type),
          () => enterpriseApi.review(cached, "resource", "1.0.0", "approved", "", type),
          () => enterpriseApi.archive(cached, "resource", type),
        ];
        for (const action of actions) await expect(action()).rejects.toMatchObject({ status: 403, code: "forbidden" });
      }
      expect(checks).toBe(15);
      expect(managementRequests).toBe(0);
    } finally { fetchMock.mockRestore(); }
  });
  test("membership verification failures never fall back to cached management privileges", async () => {
    const cached = { ...connection, membership: { ...connection.membership, role: "admin" } } satisfies EnterpriseConnection;
    let managementRequests = 0;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/membership")) return Response.json({ error: "temporary_unavailable" }, { status: 503 });
      managementRequests++;
      return Response.json({ items: [], nextCursor: null });
    });
    try {
      await expect(enterpriseApi.resources(cached, "template")).rejects.toMatchObject({ status: 503 });
      expect(managementRequests).toBe(0);
    } finally { fetchMock.mockRestore(); }
  });
  test("fresh resource administrator roles remain limited to their assigned type on every call", async () => {
    const cached = { ...connection, membership: { ...connection.membership, role: "admin" } } satisfies EnterpriseConnection;
    const types: EnterpriseResourceType[] = ["template", "extension", "skill"];
    for (const [role, allowedType] of [["template_admin", "template"], ["extension_admin", "extension"], ["skill_admin", "skill"]]) {
      let checks = 0, managementRequests = 0;
      const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input).endsWith("/membership")) {
          checks++;
          expect(init?.cache).toBe("no-store");
          return Response.json({ membership: { ...connection.membership, role, displayName: "Employee", email: "employee@example.com" } });
        }
        managementRequests++;
        return Response.json(String(input).endsWith("/review") ? { ok: true } : { items: [], nextCursor: null });
      });
      try {
        for (const type of types) {
          if (type === allowedType) await expect(enterpriseApi.resources(cached, type)).resolves.toEqual({ items: [], nextCursor: null });
          else await expect(enterpriseApi.resources(cached, type)).rejects.toMatchObject({ status: 403 });
          const review = enterpriseApi.review(cached, "resource", "1.0.0", "approved", "", type);
          if (type === allowedType) await expect(review).resolves.toEqual({ ok: true });
          else await expect(review).rejects.toMatchObject({ status: 403 });
        }
        expect(checks).toBe(6);
        expect(managementRequests).toBe(2);
      } finally { fetchMock.mockRestore(); }
    }
  });
  test("resource managers only manage their assigned resource type and inactive roles have no management access", () => {
    for (const role of ["owner", "admin", "template_admin", "extension_admin", "skill_admin", "member"] as const) {
      const current = { ...connection, membership: { ...connection.membership, role } };
      expect(canManageEnterprise(current, "template")).toBe(["owner", "admin", "template_admin"].includes(role));
      expect(canManageEnterprise(current, "extension")).toBe(["owner", "admin", "extension_admin"].includes(role));
      expect(canManageEnterprise(current, "skill")).toBe(["owner", "admin", "skill_admin"].includes(role));
      expect(canManageEnterprise({ ...current, membership: { ...current.membership, status: "suspended" } }, "template")).toBe(false);
    }
  });
  test("summary and model failures are not reported as an enterprise connection failure", () => {
    expect(enterpriseErrorMessage(new iPolloWorkServerError(400, "enterprise_summary_model_required", "Select a model"))).toContain("选择一个已连接的模型");
    expect(enterpriseErrorMessage(new iPolloWorkServerError(502, "enterprise_summary_failed", "Summary failed"))).toContain("当前模型未能生成总结");
    expect(enterpriseErrorMessage(new iPolloWorkServerError(402, "provider_quota_exhausted", "insufficient_quota"))).toContain("额度不足");
    expect(enterpriseErrorMessage(new iPolloWorkServerError(504, "provider_timeout", "timeout"))).toContain("响应超时");
    expect(enterpriseErrorMessage(new iPolloWorkServerError(500, "internal_error", "Unexpected server error"))).not.toContain("企业服务请求失败");
  });
  test("features unavailable on an older service default to false", () => {
    const features = enterpriseFeaturesSchema.parse({ templates: true, extensions: true });
    expect(features.directory).toBe(false); expect(features.sessionSharing).toBe(false); expect(features.resourceManagement).toBe(false);
  });
  test("package validation failures describe the package problem instead of a connection failure", () => {
    for (const code of ["invalid_extension_manifest", "extension_manifest_missing", "extension_file_missing", "invalid_template_package", "unsafe_template_file", "template_package_too_large", "resource_version_already_exists"]) {
      const message = enterpriseErrorMessage(new Error(code));
      expect(message).not.toContain("检查连接");
      expect(message).not.toContain("企业服务请求失败");
    }
    expect(enterpriseErrorMessage(new Error("invalid_extension_manifest"))).toContain("插件清单");
    expect(enterpriseErrorMessage(new Error("extension_file_missing"))).toContain("缺少");
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
    storage.setItem("ipollowork.den.baseUrl", "http://i.ipollo.ai");
    storage.setItem("ipollowork.den.authToken", "synthetic-cloud-session");
    setEnterpriseConnectionAccount({ userId: "snapshot-account", baseUrl: "http://i.ipollo.ai", token: "synthetic-cloud-session" });
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
