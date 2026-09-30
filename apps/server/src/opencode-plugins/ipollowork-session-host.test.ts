import { afterEach, expect, test } from "bun:test";
import { iPolloWorkSessionHost } from "./ipollowork-session-host.js";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  url: process.env.IPOLLOWORK_SERVER_URL,
  token: process.env.IPOLLOWORK_SERVER_TOKEN,
  workspaceId: process.env.IPOLLOWORK_WORKSPACE_ID,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries({
    IPOLLOWORK_SERVER_URL: originalEnvironment.url,
    IPOLLOWORK_SERVER_TOKEN: originalEnvironment.token,
    IPOLLOWORK_WORKSPACE_ID: originalEnvironment.workspaceId,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("binds each native host call to the invoking OpenCode session", async () => {
  process.env.IPOLLOWORK_SERVER_URL = "http://127.0.0.1:1234";
  process.env.IPOLLOWORK_SERVER_TOKEN = "test-token";
  process.env.IPOLLOWORK_WORKSPACE_ID = "ws_shared";
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  }, { preconnect: originalFetch.preconnect });
  const plugin = await iPolloWorkSessionHost();
  const execute = plugin.tool.ipollowork_session_call.execute;
  await execute({ name: "ipollowork_extension_call", args: { extensionId: "wechat-channels-ops", action: "claim-job" } }, { sessionID: "ses_first", directory: "C:/workspace" });
  await execute({ name: "ipollowork_extension_call", args: { extensionId: "wechat-channels-ops", action: "claim-job" } }, { sessionID: "ses_second", directory: "C:/workspace" });
  expect(requests.map((request) => (request.context as Record<string, unknown>).sessionId)).toEqual(["ses_first", "ses_second"]);
  expect(requests.every((request) => (request.context as Record<string, unknown>).workspaceId === "ws_shared")).toBe(true);
});

test("never calls the host when OpenCode omits the session identity", async () => {
  let called = false;
  globalThis.fetch = Object.assign(async (_url: string | URL | Request) => {
    called = true;
    return Response.json({ ok: true });
  }, { preconnect: originalFetch.preconnect });
  const plugin = await iPolloWorkSessionHost();
  await expect(plugin.tool.ipollowork_session_call.execute({ name: "ipollowork_browser_open_url", args: {} }, {})).rejects.toThrow("session identity");
  expect(called).toBe(false);
});

test("resolves the workspace from OpenCode's own directory when no workspace env is set", async () => {
  process.env.IPOLLOWORK_SERVER_URL = "http://127.0.0.1:1234";
  process.env.IPOLLOWORK_SERVER_TOKEN = "test-token";
  delete process.env.IPOLLOWORK_WORKSPACE_ID;
  let context: Record<string, unknown> = {};
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    context = JSON.parse(String(init?.body)).context;
    return Response.json({ ok: true });
  }, { preconnect: originalFetch.preconnect });
  const plugin = await iPolloWorkSessionHost();
  await plugin.tool.ipollowork_session_call.execute(
    { name: "ipollowork_extension_list_actions", args: { extensionId: "douyin-ops" } },
    { sessionID: "ses_current", directory: "C:/current-workspace" },
  );
  expect(context).toMatchObject({ sessionId: "ses_current", directory: "C:/current-workspace" });
  expect(context.workspaceId).toBeUndefined();
});

test("keeps the task directory when OpenCode also provides a different worktree", async () => {
  process.env.IPOLLOWORK_SERVER_URL = "http://127.0.0.1:1234";
  process.env.IPOLLOWORK_SERVER_TOKEN = "test-token";
  delete process.env.IPOLLOWORK_WORKSPACE_ID;
  let context: Record<string, unknown> = {};
  globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    context = JSON.parse(String(init?.body)).context;
    return Response.json({ ok: true });
  }, { preconnect: originalFetch.preconnect });
  const plugin = await iPolloWorkSessionHost();
  await plugin.tool.ipollowork_session_call.execute(
    { name: "ipollowork_browser_act", args: { actions: [] } },
    { sessionID: "ses_current", directory: "C:/current-workspace", worktree: "C:/other-worktree" },
  );
  expect(context).toMatchObject({
    sessionId: "ses_current",
    directory: "C:/current-workspace",
    worktree: "C:/other-worktree",
  });
});
