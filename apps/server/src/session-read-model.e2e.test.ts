import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import { startServer } from "./server.js";
import { DeepSeekHarnessRuntime } from "./deepseek-harness-runtime.js";
import type { ServerConfig } from "./types.js";
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

function startMockOpencode(input?: { invalidList?: boolean; invalidStatus?: boolean; holdCommand?: Promise<void>; promptAsyncNoContent?: boolean }) {
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
}) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
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
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { server, token: config.token };
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
