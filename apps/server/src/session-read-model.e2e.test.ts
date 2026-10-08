import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { startServer } from "./server.js";
import { DeepSeekHarnessRuntime } from "./deepseek-harness-runtime.js";
import { CodexHarnessRuntime } from "./codex-harness-runtime.js";
import type { ServerConfig } from "./types.js";
import { bindConversationSession, bindProjectSessionExecution, listWorkItems, readProjectSessionWorkItem } from "./work-items.js";
import {
  codexHarnessCompletion,
  deepSeekHarnessCompletion,
  opencodeCompletion,
} from "./workspace-session-runtime.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function createWorkspaceRoot(folderName?: string) {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-session-read-"));
  const workspaceRoot = folderName ? join(root, folderName) : root;
  await mkdir(join(workspaceRoot, ".opencode"), { recursive: true });
  roots.push(root);
  return workspaceRoot;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function startMockOpencode(input?: { delegatedWorker?: boolean; invalidList?: boolean; invalidStatus?: boolean; holdCommand?: Promise<void>; promptAsyncNoContent?: boolean; beforeSessionWrite?: () => Promise<void> }) {
  const requests: Array<{
    method: string;
    pathname: string;
    search: string;
    directory: string | null;
    body: unknown;
  }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname.startsWith("/session")) await input?.beforeSessionWrite?.();
      const body = request.method === "GET"
        ? null
        : await request.clone().json().catch(() => null);
      requests.push({
        method: request.method,
        pathname: url.pathname,
        search: url.search,
        directory: request.headers.get("x-opencode-directory"),
        body,
      });

      if (input?.delegatedWorker && /^\/session\/ses_(worker|fork|foreign)$/.test(url.pathname)) {
        return Response.json({ id: url.pathname.split("/").pop(), parentID: "ses_1", title: "Child", directory: url.pathname.endsWith("foreign") ? "/foreign" : request.headers.get("x-opencode-directory") });
      }

      if (url.pathname === "/session" && request.method === "GET") {
        if (input?.invalidList) {
          return Response.json({ nope: true });
        }
        return Response.json([
          {
            id: "ses_1",
            title: "Hostname Check",
            slug: "hostname-check",
            directory: request.headers.get("x-opencode-directory"),
            time: { created: 100, updated: 200 },
          },
        ]);
      }

      if (url.pathname === "/session" && request.method === "POST") {
        return Response.json({
          id: "ses_created",
          title: isRecord(body) && typeof body.title === "string" ? body.title : "New conversation",
          slug: "ses_created",
          directory: request.headers.get("x-opencode-directory"),
          time: { created: 300, updated: 300 },
        });
      }

      if (url.pathname === "/session/status") {
        if (input?.invalidStatus) {
          return Response.json({ nope: true });
        }
        return Response.json({ ses_1: { type: "busy" } });
      }

      if (url.pathname === "/session/ses_1") {
        return Response.json({
          id: "ses_1",
          title: "Hostname Check",
          slug: "hostname-check",
          directory: request.headers.get("x-opencode-directory"),
          time: { created: 100, updated: 200 },
        });
      }

      if (url.pathname === "/session/ses_1/message") {
        return Response.json([
          {
            info: {
              id: "msg_1",
              sessionID: "ses_1",
              role: "assistant",
              time: { created: 200 },
            },
            parts: [
              ...(input?.delegatedWorker ? [{ id: "delegation", messageID: "msg_1", sessionID: "ses_1", type: "tool", tool: "task", state: { status: "running", input: {}, metadata: { sessionId: "ses_worker" } } }] : []),
              {
                id: "prt_1",
                messageID: "msg_1",
                sessionID: "ses_1",
                type: "text",
                text: "hostname: mock-host",
              },
            ],
          },
        ]);
      }

      if (url.pathname === "/session/ses_1/todo") {
        return Response.json([
          {
            content: "Validate session reads",
            status: "completed",
            priority: "high",
          },
        ]);
      }

      if (url.pathname === "/session/ses_1/command" && request.method === "POST") {
        await input?.holdCommand;
        return Response.json({ ok: true });
      }

      if (url.pathname === "/mcp" && request.method === "POST") return Response.json({});
      if (url.pathname === "/session/ses_created/prompt_async" && request.method === "POST") {
        if (input?.promptAsyncNoContent) {
          return new Response(null, { status: 204 });
        }
        return Response.json(true);
      }

      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function startiPolloWorkServer(input: {
  workspaceRoot: string;
  opencodeBaseUrl: string;
  engineId?: string;
  readOnly?: boolean;
  beforeStart?: (config: ServerConfig) => Promise<void>;
}) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    configPath: join(input.workspaceRoot, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: input.workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: input.opencodeBaseUrl,
        ...(input.engineId ? { engineId: input.engineId } : {}),
      },
    ],
    authorizedRoots: [input.workspaceRoot],
    readOnly: input.readOnly ?? true,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  await input.beforeStart?.(config);
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { server, token: config.token, config };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let index = 0; index < 20; index++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

describe("workspace session completion projection", () => {
  for (const engineId of [DEFAULT_ENGINE_ID, CODEX_HARNESS_ENGINE_ID]) {
    test(`${engineId} native workers share artifact ownership while user forks and foreign sessions stay isolated`, async () => {
      const workspaceRoot = await createWorkspaceRoot();
      const mock = startMockOpencode({ delegatedWorker: true });
      const call = engineId === CODEX_HARNESS_ENGINE_ID ? spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string, payload: unknown): Promise<T> => {
        const id = (payload as { threadId?: string }).threadId;
        return { thread: { id, cwd: id === "ses_foreign" ? "/foreign" : workspaceRoot, ...(id !== "ses_1" ? { parentThreadId: "ses_1" } : {}), ...(id === "ses_worker" || id === "ses_foreign" ? { source: { subAgent: { thread_spawn: {} } } } : {}), turns: [] } } as T;
      }) : null;
      try {
        const { server, token, config } = await startiPolloWorkServer({ workspaceRoot, engineId, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
        await bindConversationSession(config, config.workspaces[0]!, "ses_1", { title: "Video", engineId });
        const directory = join(workspaceRoot, "video/ses_1-artifact-video");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "brief.json"), "{}");
        await writeFile(join(directory, "index.html"), "<main>Editable diagrams</main>");
        const review = async (sessionId: string, sourcePath = "video/ses_1-artifact-video/index.html") => fetch(`http://127.0.0.1:${server.port}/experimental/extensions/call`, {
          method: "POST", headers: { ...auth(token), "Content-Type": "application/json" },
          body: JSON.stringify({ extensionId: "media", action: "artifact_media_review", args: { phase: "plan", sourcePath, needs: [], exemption: "diagrams-sufficient", reason: "Approved editable geometry" }, context: { workspaceId: "ws_1", sessionId } }),
        });
        const response = await review("ses_worker");
        expect(response.status).toBe(200);
        expect(JSON.parse(await readFile(join(directory, "brief.json"), "utf8")).mediaPlan.sourcePath).toBe("video/ses_1-artifact-video/index.html");
        expect((await review("ses_fork")).status).toBe(400);
        expect((await review("ses_foreign")).status).toBeGreaterThanOrEqual(400);
        expect((await review("ses_worker", "video/unrelated-artifact-video/index.html")).status).toBe(400);
      } finally { call?.mockRestore(); }
    });
  }

  test("does not treat an earlier turn or interrupted native run as successful completion", () => {
    const startedAt = 20_500;
    expect(codexHarnessCompletion({ id: "thread", turns: [{ id: "earlier", status: "completed", startedAt: 10, items: [] }] }, { startedAt })).toBeNull();
    expect(codexHarnessCompletion({ id: "thread", turns: [{ id: "earlier", status: "completed", startedAt: 30, items: [] }] }, { turnId: "current" })).toBeNull();
    expect(codexHarnessCompletion({ id: "thread", turns: [{ id: "current", status: "interrupted", startedAt: 20, items: [] }] }, { startedAt })).toEqual({ status: "failed", error: "Codex task failed" });
    for (const status of ["interrupted", "failed", "completed"]) {
      expect(codexHarnessCompletion({ id: "thread", status: { type: "active", activeFlags: ["waitingOnApproval"] }, turns: [{ id: "current", status, startedAt: 20, items: [] }] }, { startedAt })).toBeNull();
      expect(codexHarnessCompletion({ id: "thread", status: { type: "idle" }, turns: [{ id: "current", status, startedAt: 20, completedAt: null, items: [] }] }, { startedAt })).toBeNull();
    }
    expect(codexHarnessCompletion({ id: "thread", status: { type: "idle" }, turns: [{ id: "current", status: "completed", startedAt: 20, items: [] }] }, { startedAt })).toEqual({ status: "done" });
    expect(deepSeekHarnessCompletion({ hasMore: false, events: [{ event: { type: "turn/end", seq: 1, time: 10_000, data: { reason: { kind: "completed" } } } }] }, { startedAt })).toBeNull();
    expect(deepSeekHarnessCompletion({ hasMore: false, events: [{ event: { type: "turn/end", seq: 1, time: 30_000, data: { reason: { kind: "interrupted" } } } }] }, { startedAt })).toEqual({ status: "failed", error: "DeepSeek Harness task was interrupted" });
    expect(opencodeCompletion({ sessionId: "session", startedAt, statuses: {}, messages: [{ info: { id: "message", sessionID: "session", role: "assistant", time: { created: 10_000 } }, parts: [] }] })).toBeNull();
  });

  test("server settles an ordinary native run without a UI completion callback", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const call = spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string, payload: unknown): Promise<T> => {
      const input = payload as { threadId?: string };
      const threadId = input.threadId ?? "native_root";
      return (method === "turn/start" ? { turn: { id: "current_turn" } } : {
        thread: { id: threadId, cwd: workspaceRoot, ...(threadId === "native_child" ? { parentThreadId: "native_root" } : {}), turns: [{ id: "current_turn", status: "completed", startedAt: Math.floor(Date.now() / 1_000), items: [] }] },
      }) as T;
    });
    try {
      const { server, token, config } = await startiPolloWorkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
      const base = `http://127.0.0.1:${server.port}/workspace/ws_1`;
      const headers = { ...auth(token), "Content-Type": "application/json" };
      const started = await fetch(`${base}/project-sessions/native_root/execution`, { method: "PUT", headers, body: JSON.stringify({ title: "Native generated title ".repeat(9), runtime: { engineId: CODEX_HARNESS_ENGINE_ID, model: null, mode: null, modelVariant: null } }) });
      expect(started.status).toBe(200);
      expect((await started.json()).title.length).toBe(80);
      const send = (id: string) => fetch(`${base}/engine/codex-harness/rpc`, { method: "POST", headers, body: JSON.stringify({ method: "turn/start", payload: { threadId: id, input: [] } }) });
      expect((await send("native_root")).status).toBe(200);
      let item = await readProjectSessionWorkItem(config, "ws_1", "native_root");
      for (let index = 0; index < 100 && item?.status === "running"; index++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        item = await readProjectSessionWorkItem(config, "ws_1", "native_root");
      }
      expect(item?.status).toBe("review");
      expect(item?.runCompletedAt).toBeNumber();
      expect(item?.customFields.reviewedAt).toBeUndefined();
      const settledVersion = item?.version;
      const redundantFinish = await fetch(`${base}/project-sessions/native_root/execution`, { method: "PATCH", headers, body: JSON.stringify({ status: "done", title: "Long native title ".repeat(12) }) });
      expect(redundantFinish.status).toBe(200);
      expect((await redundantFinish.json()).version).toBe(settledVersion);
      expect((await send("native_child")).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect((await listWorkItems(config, { workspaceIds: ["ws_1"] })).items.map((row) => row.execution?.sessionId)).toEqual(["native_root"]);
    } finally { call.mockRestore(); }
  });

  test("rechecks live Codex metadata after terminal history hydration", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    let executing = true;
    let metadataReads = 0;
    const call = spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string, payload: unknown): Promise<T> => {
      if (method === "turn/start") return { turn: { id: "current_turn" } } as T;
      const input = payload as { threadId?: string; includeTurns?: boolean };
      if (input.includeTurns === false) metadataReads++;
      return { thread: {
        id: input.threadId ?? "native_root", cwd: workspaceRoot,
        status: { type: executing && input.includeTurns === false && metadataReads > 1 ? "active" : "idle" },
        turns: [{ id: "current_turn", status: "completed", startedAt: Math.floor(Date.now() / 1_000), completedAt: Math.floor(Date.now() / 1_000), items: [] }],
      } } as T;
    });
    try {
      const { server, token, config } = await startiPolloWorkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
      const base = `http://127.0.0.1:${server.port}/workspace/ws_1`;
      const headers = { ...auth(token), "Content-Type": "application/json" };
      await fetch(`${base}/project-sessions/native_root/execution`, { method: "PUT", headers, body: JSON.stringify({ title: "Native run", runtime: { engineId: CODEX_HARNESS_ENGINE_ID, model: null, mode: null, modelVariant: null } }) });
      await fetch(`${base}/engine/codex-harness/rpc`, { method: "POST", headers, body: JSON.stringify({ method: "turn/start", payload: { threadId: "native_root", input: [] } }) });
      for (let index = 0; index < 20 && metadataReads < 2; index++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(metadataReads).toBeGreaterThanOrEqual(2);
      expect((await readProjectSessionWorkItem(config, "ws_1", "native_root"))?.status).toBe("running");
      executing = false;
      let item = await readProjectSessionWorkItem(config, "ws_1", "native_root");
      for (let index = 0; index < 40 && item?.status === "running"; index++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        item = await readProjectSessionWorkItem(config, "ws_1", "native_root");
      }
      expect(item?.status).toBe("review");
    } finally { call.mockRestore(); }
  });

  test("recovers bound native running conversations from authentic terminal history on restart", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const call = spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(async <T>(_method: string, payload: unknown): Promise<T> => {
      const id = (payload as { threadId: string }).threadId;
      return { thread: { id, cwd: workspaceRoot, turns: [
        { id: "previous", status: "completed", startedAt: 1, items: [] },
        { id: "current", status: id === "interrupted_root" ? "interrupted" : "completed", startedAt: Math.floor(Date.now() / 1_000), error: id === "interrupted_root" ? { message: "Native run stopped" } : null, items: [] },
      ] } } as T;
    });
    try {
      const { config } = await startiPolloWorkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false, beforeStart: async (config) => {
        for (const id of ["completed_root", "interrupted_root"]) await bindProjectSessionExecution(config, config.workspaces[0]!, id, { title: id, runtime: { engineId: CODEX_HARNESS_ENGINE_ID, model: null, mode: null, modelVariant: null } });
      } });
      let items = (await listWorkItems(config, { workspaceIds: ["ws_1"] })).items;
      for (let index = 0; index < 100 && items.some((item) => item.status === "running"); index++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        items = (await listWorkItems(config, { workspaceIds: ["ws_1"] })).items;
      }
      expect(items).toHaveLength(2);
      expect(items.find((item) => item.execution?.sessionId === "completed_root")?.status).toBe("review");
      expect(items.find((item) => item.execution?.sessionId === "interrupted_root")).toMatchObject({ status: "failed", lastError: "Native run stopped" });
      expect(items.every((item) => item.customFields.reviewedAt === undefined)).toBe(true);
    } finally { call.mockRestore(); }
  });

  test("maps successful and failed engine runs into the shared lifecycle", () => {
    expect(deepSeekHarnessCompletion({
      hasMore: false,
      events: [{
        event: {
          type: "turn/end",
          seq: 2,
          time: 20,
          data: { turn: 1, reason: { kind: "completed" } },
        },
      }],
    })).toEqual({ status: "done" });
    expect(deepSeekHarnessCompletion({
      hasMore: false,
      events: [{
        event: {
          type: "turn/end",
          seq: 2,
          time: 20,
          data: { turn: 1, reason: { kind: "error", error: { message: "Token expired" } } },
        },
      }],
    })).toEqual({ status: "failed", error: "Token expired" });
    expect(codexHarnessCompletion({
      id: "thread_1",
      turns: [{ id: "turn_1", status: "completed", items: [] }],
    })).toEqual({ status: "done" });
    expect(opencodeCompletion({
      sessionId: "session_1",
      statuses: { session_1: { type: "idle" } },
      messages: [{
        info: { id: "message_1", sessionID: "session_1", role: "assistant" },
        parts: [],
      }],
    })).toEqual({ status: "done" });
  });
});

describe("workspace session read APIs", () => {
  test("rejects permanent deletion for DeepSeek Harness sessions", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      readOnly: false,
    });

    const response = await fetch(
      `http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/sessions/ses_1`,
      { method: "DELETE", headers: auth(ipollowork.token) },
    );
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      code: "session_delete_unsupported",
      message: "DeepSeek Harness supports session archiving but not permanent deletion",
    });
    expect(mock.requests).toHaveLength(0);
  });

  test("lists sessions and returns session details, messages, and snapshot", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const base = `http://127.0.0.1:${ipollowork.server.port}`;

    const listResponse = await fetch(`${base}/workspace/ws_1/sessions?roots=true&limit=1&search=host&start=10`, {
      headers: auth(ipollowork.token),
    });
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody).toEqual({
      items: [
        {
          id: "ses_1",
          engineId: DEFAULT_ENGINE_ID,
          title: "Hostname Check",
          slug: "hostname-check",
          directory: workspaceRoot,
          time: { created: 100, updated: 200 },
          status: { type: "busy" },
        },
      ],
    });

    const detailResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_1`, {
      headers: auth(ipollowork.token),
    });
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.item.id).toBe("ses_1");
    expect(detailBody.item.directory).toBe(workspaceRoot);

    const messagesResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_1/messages?limit=5`, {
      headers: auth(ipollowork.token),
    });
    expect(messagesResponse.status).toBe(200);
    const messagesBody = await messagesResponse.json();
    expect(messagesBody.items).toHaveLength(1);
    expect(messagesBody.items[0]?.info.id).toBe("msg_1");
    expect(messagesBody.items[0]?.parts[0]?.text).toBe("hostname: mock-host");

    const snapshotResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_1/snapshot?limit=5`, {
      headers: auth(ipollowork.token),
    });
    expect(snapshotResponse.status).toBe(200);
    const snapshotBody = await snapshotResponse.json();
    expect(snapshotBody.item.session.id).toBe("ses_1");
    expect(snapshotBody.item.messages).toHaveLength(1);
    expect(snapshotBody.item.todos).toEqual([
      {
        content: "Validate session reads",
        status: "completed",
        priority: "high",
      },
    ]);
    expect(snapshotBody.item.status).toEqual({ type: "busy" });

    const listRequest = mock.requests.find((request) => request.pathname === "/session");
    expect(listRequest?.directory).toBe(workspaceRoot);
    expect(listRequest?.search).toContain("roots=true");
    expect(listRequest?.search).toContain("limit=1");
    expect(listRequest?.search).toContain("search=host");
    expect(listRequest?.search).toContain("start=10");

  });

  test("accepts guest-side rem_ workspace aliases for session reads", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/rem_ws_1/sessions`, {
      headers: auth(ipollowork.token),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0]?.id).toBe("ses_1");
    expect(body.items[0]?.directory).toBe(workspaceRoot);
    expect(mock.requests.find((request) => request.pathname === "/session")?.directory).toBe(workspaceRoot);
  });

  test("encodes non-ASCII workspace directory headers for session reads", async () => {
    const workspaceRoot = await createWorkspaceRoot("项目");
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/sessions`, {
      headers: auth(ipollowork.token),
    });

    expect(response.status).toBe(200);
    const listRequest = mock.requests.find((request) => request.pathname === "/session");
    const encodedDirectory = encodeURIComponent(workspaceRoot);
    expect(listRequest?.directory).toBe(encodedDirectory);
    expect(listRequest?.search).toContain(`directory=${encodedDirectory}`);
  });

  test("encodes non-ASCII workspace directory headers for opencode proxy requests", async () => {
    const workspaceRoot = await createWorkspaceRoot("项目");
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/opencode/session`, {
      headers: auth(ipollowork.token),
    });

    expect(response.status).toBe(200);
    const proxyRequest = mock.requests.find((request) => request.pathname === "/session");
    expect(proxyRequest?.directory).toBe(encodeURIComponent(workspaceRoot));
  });

  test("returns 404 when the upstream session is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/sessions/ses_missing/snapshot`, {
      headers: auth(ipollowork.token),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "session_not_found",
      message: "Session not found",
    });

  });

  test("acknowledges proxied session commands before upstream completion", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const command = deferred();
    const mock = startMockOpencode({ holdCommand: command.promise });
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await Promise.race([
      fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/opencode/session/ses_1/command`, {
        method: "POST",
        headers: { ...auth(ipollowork.token), "Content-Type": "application/json" },
        body: JSON.stringify({ command: "review", arguments: "" }),
      }),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(response).not.toBe("timeout");
    expect(response instanceof Response ? response.status : 0).toBe(200);
    await expect(response instanceof Response ? response.json() : null).resolves.toMatchObject({ accepted: true });
    const sawCommand = await waitUntil(() => mock.requests.some((request) => request.pathname === "/session/ses_1/command"));
    command.resolve();
    expect(sawCommand).toBe(true);
  });

  test("keeps legacy /w workspace opencode proxy alias", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/w/ws_1/opencode/session`, {
      headers: auth(ipollowork.token),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(mock.requests.some((request) => request.pathname === "/session")).toBe(true);
  });

  test("returns 502 when OpenCode returns an invalid session list payload", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ invalidList: true });
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/sessions`, {
      headers: auth(ipollowork.token),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "opencode_invalid_response",
      message: "OpenCode returned invalid session list",
    });

  });

  test("keeps the session directory available when OpenCode status is temporarily invalid", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ invalidStatus: true });
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/sessions`, {
      headers: auth(ipollowork.token),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty("status");
  });
});

describe("workspace session write APIs", () => {
  test("verifies DeepSeek native child cwd and bound ancestry before routing", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const foreignRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const summaries = [
      { sessionId: "dsh_parent", cwd: workspaceRoot, updatedAt: 100, running: false, blank: true },
      { sessionId: "dsh_child", cwd: workspaceRoot, parentSessionId: "dsh_parent", updatedAt: 101, running: false, blank: false },
      { sessionId: "dsh_nested", cwd: workspaceRoot, parentSessionId: "dsh_child", updatedAt: 102, running: false, blank: true },
      { sessionId: "foreign_dsh", cwd: foreignRoot, parentSessionId: "dsh_parent", updatedAt: 103, running: false, blank: true },
      { sessionId: "unanchored_dsh", cwd: workspaceRoot, parentSessionId: "missing_parent", updatedAt: 104, running: false, blank: true },
    ];
    const calls: Array<{ method: string; payload: unknown }> = [];
    const call = spyOn(DeepSeekHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string, payload: unknown): Promise<T> => {
      calls.push({ method, payload });
      return (method === "session.list" ? { items: summaries }
        : method === "workspace.list" ? { archivedSessionIds: [] }
          : method === "session.history" ? { events: [], hasMore: false } : {}) as T;
    });
    try {
      const ipollowork = await startiPolloWorkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
      const workspace = ipollowork.config.workspaces[0];
      if (!workspace) throw new Error("Workspace required");
      await bindConversationSession(ipollowork.config, workspace, "dsh_parent", { title: "Parent", engineId: DEEPSEEK_HARNESS_ENGINE_ID });
      const base = `http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1`;
      const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };
      const nested = await fetch(`${base}/sessions/dsh_nested/snapshot`, { headers });
      expect(nested.status).toBe(200);
      expect(await nested.json()).toMatchObject({ item: { session: { id: "dsh_nested", parentID: "dsh_child", engineId: DEEPSEEK_HARNESS_ENGINE_ID } } });
      const cancel = await fetch(`${base}/engine/deepseek-harness/rpc`, { method: "POST", headers, body: JSON.stringify({ method: "session.cancel", payload: { sessionId: "dsh_child" } }) });
      expect(cancel.status).toBe(200);
      for (const id of ["foreign_dsh", "unanchored_dsh"]) {
        const forbidden = await fetch(`${base}/engine/deepseek-harness/rpc`, { method: "POST", headers, body: JSON.stringify({ method: "session.cancel", payload: { sessionId: id } }) });
        expect(forbidden.status).toBe(404);
        expect(calls.filter((request) => request.method === "session.cancel" && isRecord(request.payload) && request.payload.sessionId === id)).toHaveLength(0);
      }
      expect((await listWorkItems(ipollowork.config, { workspaceIds: [workspace.id] })).items.map((item) => item.execution?.sessionId)).toEqual(["dsh_parent"]);
      expect(mock.requests.some((request) => request.pathname.includes("dsh_nested"))).toBe(false);
    } finally { call.mockRestore(); }
  });
  test("discovers native Codex descendants from bound ancestry without creating work roots", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const foreignRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const threads = new Map([
      ["codex_parent", { id: "codex_parent", cwd: workspaceRoot, name: "Parent", turns: [] }],
      ["codex_child", { id: "codex_child", cwd: workspaceRoot, name: "Research child", parentThreadId: "codex_parent", turns: [{ id: "child_turn", status: "completed", items: [{ type: "agentMessage", id: "child_message", text: "Verified native child result" }] }] }],
      ["codex_grandchild", { id: "codex_grandchild", cwd: workspaceRoot, name: "Nested child", parentThreadId: "codex_child", turns: [] }],
      ["foreign_child", { id: "foreign_child", cwd: foreignRoot, name: "Foreign child", parentThreadId: "codex_parent", turns: [] }],
      ["foreign_parent", { id: "foreign_parent", cwd: foreignRoot, name: "Foreign parent", turns: [] }],
      ["same_cwd_foreign_ancestor", { id: "same_cwd_foreign_ancestor", cwd: workspaceRoot, name: "Wrong ancestor", parentThreadId: "foreign_parent", turns: [] }],
    ]);
    const calls: Array<{ method: string; payload: unknown }> = [];
    const call = spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string, payload: unknown): Promise<T> => {
      calls.push({ method, payload });
      const id = isRecord(payload) && typeof payload.threadId === "string" ? payload.threadId : "";
      return (method === "thread/read" ? { thread: threads.get(id) } : {}) as T;
    });
    try {
      const ipollowork = await startiPolloWorkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
      const workspace = ipollowork.config.workspaces[0];
      if (!workspace) throw new Error("Workspace required");
      await bindConversationSession(ipollowork.config, workspace, "codex_parent", { title: "Parent", engineId: CODEX_HARNESS_ENGINE_ID });
      const base = `http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1`;
      const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };
      const child = await fetch(`${base}/sessions/codex_child`, { headers });
      expect(child.status).toBe(200);
      expect(await child.json()).toMatchObject({ item: { id: "codex_child", parentID: "codex_parent", engineId: CODEX_HARNESS_ENGINE_ID } });
      const messages = await fetch(`${base}/sessions/codex_child/messages`, { headers });
      expect(messages.status).toBe(200);
      expect(await messages.json()).toMatchObject({ items: [{ parts: [{ text: "Verified native child result" }] }] });
      const nested = await fetch(`${base}/sessions/codex_grandchild/snapshot`, { headers });
      expect(nested.status).toBe(200);
      expect(await nested.json()).toMatchObject({ item: { session: { id: "codex_grandchild", engineId: CODEX_HARNESS_ENGINE_ID } } });
      workspace.engineId = DEEPSEEK_HARNESS_ENGINE_ID;
      const cancel = await fetch(`${base}/engine/codex-harness/rpc`, { method: "POST", headers, body: JSON.stringify({ method: "turn/interrupt", payload: { threadId: "codex_child", turnId: "child_turn" } }) });
      expect(cancel.status).toBe(200);
      expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ method: "turn/interrupt", payload: { threadId: "codex_child", turnId: "child_turn" } })]));
      for (const id of ["foreign_child", "same_cwd_foreign_ancestor"]) {
        const forbidden = await fetch(`${base}/engine/codex-harness/rpc`, { method: "POST", headers, body: JSON.stringify({ method: "turn/interrupt", payload: { threadId: id } }) });
        expect(forbidden.status).toBe(404);
        expect(calls.filter((request) => request.method === "turn/interrupt" && isRecord(request.payload) && request.payload.threadId === id)).toHaveLength(0);
      }
      expect((await listWorkItems(ipollowork.config, { workspaceIds: [workspace.id] })).items.map((item) => item.execution?.sessionId)).toEqual(["codex_parent"]);
      expect(mock.requests.some((request) => request.pathname.includes("codex_child"))).toBe(false);
    } finally { call.mockRestore(); }
  });
  test("creates and resumes Codex conversations in a project with an OpenCode default", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/video-agent", import.meta.url));
    const skillPaths = ["skills/ipollowork-video-compose/SKILL.md", "skills/ipollowork-video-studio/references/video-compose.md"];
    const assertSkills = async () => {
      for (const path of skillPaths) expect(await readFile(join(workspaceRoot, ".agents", path), "utf8")).toBe(await readFile(join(packageRoot, path), "utf8"));
    };
    const thread = { id: "codex_selected", cwd: workspaceRoot, name: "Code review", createdAt: 300, updatedAt: 400, turns: [] };
    const start = spyOn(CodexHarnessRuntime.prototype, "startThread").mockImplementation(
      async <T extends Record<string, unknown>>(): Promise<T> => { await assertSkills(); return { thread } as unknown as T; },
    );
    const resume = spyOn(CodexHarnessRuntime.prototype, "resumeThread").mockImplementation(async () => { await assertSkills(); return { thread }; });
    const calls: string[] = [];
    const call = spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(
      async <T>(method: string, payload: unknown): Promise<T> => {
        if (method === "turn/start" || method === "skills/list") await assertSkills();
        if (method === "skills/list") expect(payload).toEqual({ cwds: [workspaceRoot], forceReload: true });
        calls.push(method);
        const value = method === "thread/read" ? { thread }
          : method === "thread/list" ? { data: [thread], nextCursor: null }
            : {};
        return value as T;
      },
    );
    try {
      const ipollowork = await startiPolloWorkServer({
        workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false,
        beforeStart: async (config) => {
          const { installPluginPackage } = await import("./plugin-package-lifecycle.js");
          await installPluginPackage({ serverConfig: config, packageRoot });
        },
      });
      const base = `http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1`;
      const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };
      const created = await fetch(`${base}/sessions`, {
        method: "POST", headers, body: JSON.stringify({ title: "Code review", engineId: CODEX_HARNESS_ENGINE_ID }),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ item: { id: "codex_selected", engineId: CODEX_HARNESS_ENGINE_ID } });
      const snapshot = await fetch(`${base}/sessions/codex_selected/snapshot`, { headers });
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({ item: { session: { id: "codex_selected", engineId: CODEX_HARNESS_ENGINE_ID } } });
      const prompt = await fetch(`${base}/sessions/codex_selected/prompt`, {
        method: "POST", headers, body: JSON.stringify({ text: "Review the code" }),
      });
      expect(prompt.status).toBe(202);
      expect(calls).toContain("turn/start");
      expect(calls.indexOf("skills/list")).toBeLessThan(calls.indexOf("turn/start"));
      await rm(join(workspaceRoot, ".agents", "skills"), { recursive: true });
      const resumed = await fetch(`${base}/sessions/codex_selected/prompt`, {
        method: "POST", headers, body: JSON.stringify({ text: "Continue the review" }),
      });
      expect(resumed.status).toBe(202);
      expect(resume).toHaveBeenCalled();
      await assertSkills();
      expect(ipollowork.config.workspaces[0]?.engineId ?? DEFAULT_ENGINE_ID).toBe(DEFAULT_ENGINE_ID);
      const listed = await fetch(`${base}/sessions`, { headers });
      expect(listed.status).toBe(200);
      const items = (await listed.json()).items;
      expect(items.filter((item: { id: string }) => item.id === "codex_selected")).toHaveLength(1);
      expect(items.find((item: { id: string }) => item.id === "codex_selected")?.time).not.toHaveProperty("archived");
      expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ses_1", engineId: DEFAULT_ENGINE_ID })]));
      expect(mock.requests.some((request) => request.pathname.includes("codex_selected"))).toBe(false);
      const customized = join(workspaceRoot, ".agents", skillPaths[0]!);
      await writeFile(customized, "User-customized Skill.\n");
      const conflict = await fetch(`${base}/sessions`, {
        method: "POST", headers, body: JSON.stringify({ title: "Another video", engineId: CODEX_HARNESS_ENGINE_ID }),
      });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ code: "plugin_package_conflict" });
      expect(start).toHaveBeenCalledTimes(1);
      expect(await readFile(customized, "utf8")).toBe("User-customized Skill.\n");
    } finally {
      call.mockRestore();
      start.mockRestore();
      resume.mockRestore();
    }
  });

  test.each([CODEX_HARNESS_ENGINE_ID, DEEPSEEK_HARNESS_ENGINE_ID, DEFAULT_ENGINE_ID])("prepares plugin Skills through native %s creation and prompt APIs", async (engineId) => {
    const root = await createWorkspaceRoot();
    const directory = engineId === CODEX_HARNESS_ENGINE_ID ? ".agents" : engineId === DEEPSEEK_HARNESS_ENGINE_ID ? ".dsh" : ".opencode";
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/video-agent", import.meta.url));
    const expected = await readFile(join(packageRoot, "skills/ipollowork-video-compose/SKILL.md"), "utf8");
    let preparedWrites = 0;
    const assertPrepared = async () => { expect(await readFile(join(root, directory, "skills/ipollowork-video-compose/SKILL.md"), "utf8")).toBe(expected); preparedWrites++; };
    const mock = startMockOpencode({ beforeSessionWrite: engineId === DEFAULT_ENGINE_ID ? assertPrepared : undefined });
    const sessionId = engineId === DEFAULT_ENGINE_ID ? "ses_created" : "native_video";
    const thread = { id: sessionId, cwd: root, name: "Video", turns: [] };
    const start = spyOn(CodexHarnessRuntime.prototype, "startThread").mockImplementation(async <T extends Record<string, unknown>>(): Promise<T> => { await assertPrepared(); return { thread } as unknown as T; });
    const resume = spyOn(CodexHarnessRuntime.prototype, "resumeThread").mockImplementation(async () => { await assertPrepared(); return { thread }; });
    const codexCall = spyOn(CodexHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string): Promise<T> => {
      if (engineId === CODEX_HARNESS_ENGINE_ID && ["skills/list", "turn/start"].includes(method)) await assertPrepared();
      return (method === "thread/read" ? { thread } : method === "thread/list" ? { data: [], nextCursor: null } : {}) as T;
    });
    const dshCall = spyOn(DeepSeekHarnessRuntime.prototype, "call").mockImplementation(async <T>(method: string): Promise<T> => {
      if (["session.create", "session.prompt"].includes(method)) await assertPrepared();
      return (method === "session.create" ? { sessionId } : method === "session.list" ? { items: [] } : {}) as T;
    });
    try {
      const defaultEngine = engineId === DEFAULT_ENGINE_ID ? CODEX_HARNESS_ENGINE_ID : DEFAULT_ENGINE_ID;
      const app = await startiPolloWorkServer({ workspaceRoot: root, engineId: defaultEngine, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false,
        beforeStart: async config => { const { installPluginPackage } = await import("./plugin-package-lifecycle.js"); await installPluginPackage({ serverConfig: config, packageRoot }); },
      });
      const base = `http://127.0.0.1:${app.server.port}/workspace/ws_1`;
      const headers = { ...auth(app.token), "Content-Type": "application/json" };
      await rm(join(root, directory, "skills"), { recursive: true, force: true });
      const createPath = engineId === DEFAULT_ENGINE_ID ? "/opencode/session" : `/engine/${engineId}/rpc`;
      const creation = await fetch(base + createPath, { method: "POST", headers, body: JSON.stringify(engineId === DEFAULT_ENGINE_ID ? {} : { method: engineId === CODEX_HARNESS_ENGINE_ID ? "thread/start" : "session.create", payload: { cwd: root } }) });
      expect(creation.status).toBe(200);
      expect((await readProjectSessionWorkItem(app.config, "ws_1", sessionId))?.execution?.runtime.engineId).toBe(engineId);
      await rm(join(root, directory, "skills"), { recursive: true });
      const promptPath = engineId === DEFAULT_ENGINE_ID ? `/opencode/session/${sessionId}/prompt_async` : `/engine/${engineId}/prompt`;
      const prompted = await fetch(base + promptPath, { method: "POST", headers, body: JSON.stringify(engineId === DEFAULT_ENGINE_ID ? { parts: [{ type: "text", text: "Create a video" }] } : { payload: engineId === CODEX_HARNESS_ENGINE_ID ? { threadId: sessionId, input: [{ type: "text", text: "Create a video" }] } : { sessionId, content: [{ type: "text", text: "Create a video" }] } }) });
      expect(prompted.status).toBe(200);
      expect(preparedWrites).toBeGreaterThanOrEqual(2);
      expect(app.config.workspaces[0]?.engineId).toBe(defaultEngine);
      if (engineId !== DEFAULT_ENGINE_ID) {
        const crossed = await fetch(`${base}/opencode/session/${sessionId}/prompt_async`, { method: "POST", headers, body: "{}" });
        expect(crossed.status).toBe(409);
      }
    } finally { start.mockRestore(); resume.mockRestore(); codexCall.mockRestore(); dshCall.mockRestore(); }
  });

  test("keeps each conversation's selected engine across project default changes and unavailable runtimes", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    let unavailable = false;
    const calls: string[] = [];
    const call = spyOn(DeepSeekHarnessRuntime.prototype, "call").mockImplementation(
      async <T>(method: string): Promise<T> => {
        calls.push(method);
        if (unavailable && method === "session.list") throw new Error("Optional engine is unavailable");
        const value = method === "session.create" ? { sessionId: "dsh_selected" }
          : method === "session.list" ? { items: [{ sessionId: "dsh_selected", cwd: workspaceRoot, updatedAt: Date.now(), running: false, blank: true }] }
            : method === "workspace.list" ? { archivedSessionIds: [] }
              : method === "session.history" ? { events: [], hasMore: false }
                : {};
        return value as T;
      },
    );
    try {
      const ipollowork = await startiPolloWorkServer({
        workspaceRoot,
        opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
        readOnly: false,
      });
      const base = `http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1`;
      const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };
      const selected = await fetch(`${base}/sessions`, {
        method: "POST", headers,
        body: JSON.stringify({ title: "Video conversation", engineId: DEEPSEEK_HARNESS_ENGINE_ID }),
      });
      expect(selected.status).toBe(201);
      expect(await selected.json()).toMatchObject({ item: { id: "dsh_selected", engineId: DEEPSEEK_HARNESS_ENGINE_ID } });
      const defaultSession = await fetch(`${base}/sessions`, {
        method: "POST", headers, body: JSON.stringify({ title: "Development conversation" }),
      });
      expect(defaultSession.status).toBe(201);
      expect(await defaultSession.json()).toMatchObject({ item: { id: "ses_created", engineId: DEFAULT_ENGINE_ID } });

      const snapshot = await fetch(`${base}/sessions/dsh_selected/snapshot`, { headers });
      expect(snapshot.status).toBe(200);
      expect(await snapshot.json()).toMatchObject({ item: { session: { id: "dsh_selected", engineId: DEEPSEEK_HARNESS_ENGINE_ID } } });
      const list = await fetch(`${base}/sessions`, { headers });
      const listed = await list.json();
      expect(list.status).toBe(200);
      expect(listed.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "dsh_selected", engineId: DEEPSEEK_HARNESS_ENGINE_ID }),
        expect.objectContaining({ id: "ses_1", engineId: DEFAULT_ENGINE_ID }),
        expect.objectContaining({ id: "ses_created", engineId: DEFAULT_ENGINE_ID }),
      ]));

      const wrongEngine = await fetch(`${base}/engine/codex-harness/rpc`, {
        method: "POST", headers,
        body: JSON.stringify({ method: "turn/interrupt", payload: { threadId: "dsh_selected" } }),
      });
      expect(wrongEngine.status).toBe(409);
      expect(await wrongEngine.json()).toMatchObject({ code: "session_engine_mismatch" });
      const cancel = await fetch(`${base}/engine/deepseek-harness/rpc`, {
        method: "POST", headers,
        body: JSON.stringify({ method: "session.cancel", payload: { sessionId: "dsh_selected" } }),
      });
      expect(cancel.status).toBe(200);
      expect(calls).toContain("session.cancel");

      const workspace = ipollowork.config.workspaces[0];
      if (!workspace) throw new Error("Expected workspace");
      workspace.engineId = DEEPSEEK_HARNESS_ENGINE_ID;
      const prompt = await fetch(`${base}/sessions/ses_created/prompt`, {
        method: "POST", headers,
        body: JSON.stringify({ text: "Continue development", engineId: CODEX_HARNESS_ENGINE_ID }),
      });
      expect(prompt.status).toBe(202);
      expect(mock.requests.some((request) => request.pathname === "/session/ses_created/prompt_async")).toBe(true);
      unavailable = true;
      const partial = await fetch(`${base}/sessions`, { headers });
      expect(partial.status).toBe(200);
      expect((await partial.json()).items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "ses_1", engineId: DEFAULT_ENGINE_ID }),
        expect.objectContaining({ id: "dsh_selected", engineId: DEEPSEEK_HARNESS_ENGINE_ID, runtimeUnavailable: true }),
      ]));
    } finally {
      call.mockRestore();
    }
  });

  test("reports engine-specific session capabilities for the mounted workspace", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
      readOnly: false,
    });

    const response = await fetch(
      `http://127.0.0.1:${ipollowork.server.port}/w/ws_1/capabilities`,
      { headers: auth(ipollowork.token) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      engine: {
        id: DEEPSEEK_HARNESS_ENGINE_ID,
        sessions: { read: true, create: true, prompt: true, delete: false },
      },
    });
  });

  test("creates an OpenCode session and submits a prompt through the engine-agnostic routes", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
      readOnly: false,
    });
    const base = `http://127.0.0.1:${ipollowork.server.port}`;
    const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };

    const createResponse = await fetch(`${base}/workspace/ws_1/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "CI review" }),
    });
    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      item: { id: "ses_created", title: "CI review", directory: workspaceRoot },
    });

    const promptResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_created/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: "Review this change",
        model: { providerID: "openai", modelID: "gpt-test" },
        mode: "review",
        reasoningEffort: "high",
      }),
    });
    expect(promptResponse.status).toBe(202);
    await expect(promptResponse.json()).resolves.toEqual({ ok: true, accepted: true, sessionId: "ses_created" });

    const createRequest = mock.requests.find((request) => request.method === "POST" && request.pathname === "/session");
    expect(createRequest?.directory).toBe(workspaceRoot);
    expect(createRequest?.body).toMatchObject({ title: "CI review" });
    const promptRequest = mock.requests.find((request) => request.pathname === "/session/ses_created/prompt_async");
    expect(promptRequest?.body).toMatchObject({
      parts: [{ type: "text", text: "Review this change" }],
      model: { providerID: "openai", modelID: "gpt-test" },
      agent: "review",
      variant: "high",
    });
  });

  test("accepts an OpenCode async prompt when the engine returns 204", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ promptAsyncNoContent: true });
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
      readOnly: false,
    });
    const base = `http://127.0.0.1:${ipollowork.server.port}`;
    const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };

    const promptResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_created/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Review this change" }),
    });

    expect(promptResponse.status).toBe(202);
    await expect(promptResponse.json()).resolves.toEqual({ ok: true, accepted: true, sessionId: "ses_created" });
    expect(mock.requests.some((request) => request.pathname === "/session/ses_created/prompt_async")).toBe(true);
  });

  test("rejects an empty unified prompt before calling the engine", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const ipollowork = await startiPolloWorkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
      readOnly: false,
    });

    const response = await fetch(
      `http://127.0.0.1:${ipollowork.server.port}/workspace/ws_1/sessions/ses_created/prompt`,
      {
        method: "POST",
        headers: { ...auth(ipollowork.token), "Content-Type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_payload" });
    expect(mock.requests.some((request) => request.pathname.endsWith("/prompt_async"))).toBe(false);
  });

  test("creates a DeepSeek Harness session and translates the unified prompt", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const call = spyOn(DeepSeekHarnessRuntime.prototype, "call").mockImplementation(
      async <T>(method: string, payload: unknown): Promise<T> => {
        calls.push({ method, payload });
        const value = method === "session.create"
          ? { sessionId: "dsh_created", agentPreset: "standard" }
          : method === "llm.models"
            ? { groups: [{ id: "openai-codex", models: [{ id: "gpt-test" }] }] }
          : undefined;
        return value as T;
      },
    );
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();

    try {
      const ipollowork = await startiPolloWorkServer({
        workspaceRoot,
        opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
        engineId: DEEPSEEK_HARNESS_ENGINE_ID,
        readOnly: false,
      });
      const base = `http://127.0.0.1:${ipollowork.server.port}`;
      const headers = { ...auth(ipollowork.token), "Content-Type": "application/json" };

      const createResponse = await fetch(`${base}/workspace/ws_1/sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Harness review" }),
      });
      expect(createResponse.status).toBe(201);
      await expect(createResponse.json()).resolves.toMatchObject({
        item: {
          id: "dsh_created",
          title: "Harness review",
          directory: workspaceRoot,
          dsh: { blank: true, agentPreset: "standard" },
        },
      });

      const promptResponse = await fetch(`${base}/workspace/ws_1/sessions/dsh_created/prompt`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "Review this change",
          model: { providerID: "openai", modelID: "gpt-test" },
          mode: "code",
          reasoningEffort: "high",
          clientTimeZone: "Asia/Shanghai",
        }),
      });
      expect(promptResponse.status).toBe(202);
      expect(calls).toEqual([
        { method: "session.create", payload: { cwd: workspaceRoot } },
        { method: "session.rename", payload: { sessionId: "dsh_created", title: "Harness review" } },
        { method: "agentPreset.select", payload: { sessionId: "dsh_created", agentPreset: "code" } },
        { method: "llm.models", payload: {} },
        {
          method: "session.selectModel",
          payload: {
            sessionId: "dsh_created",
            provider: "openai-codex",
            model: "gpt-test",
            reasoningEffort: "high",
          },
        },
        {
          method: "session.prompt",
          payload: {
            sessionId: "dsh_created",
            mode: "queue",
            content: [{ type: "text", text: "Review this change" }],
            clientTimeZone: "Asia/Shanghai",
          },
        },
      ]);
    } finally {
      call.mockRestore();
    }
  });
});
