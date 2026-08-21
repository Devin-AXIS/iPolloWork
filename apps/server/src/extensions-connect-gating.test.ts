import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const CLIENT_TOKEN = "owt_connect_client_token";
const HOST_TOKEN = "owt_connect_host_token";

const actionSchema = z.object({
  extensionId: z.string(),
  action: z.string(),
}).passthrough();

const actionsResponseSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  actions: z.array(actionSchema),
}).passthrough();

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
}).passthrough();

const connectStateResponseSchema = z.object({
  ok: z.literal(true),
  schemaVersion: z.literal(1),
  connectEnabled: z.boolean(),
  cloudMcpPresent: z.boolean(),
  googleWorkspace: z.object({ legacyConfigured: z.boolean() }),
}).passthrough();

const gatedCallSchema = z.object({
  ok: z.literal(false),
  error: z.literal("use_ipollowork_cloud"),
  message: z.string(),
}).passthrough();

const googleWorkspaceStatusSchema = z.object({
  configured: z.boolean(),
  missing: z.array(z.string()),
  connected: z.boolean(),
  connect: z.object({
    enabled: z.literal(true),
    cloudMcpPresent: z.boolean(),
    guidance: z.string(),
  }).optional(),
}).passthrough();

const googleWorkspaceStatusActionSchema = z.object({
  ok: z.literal(true),
  extensionId: z.literal("google-workspace"),
  action: z.literal("status"),
  result: googleWorkspaceStatusSchema,
}).passthrough();

type ActionItem = z.infer<typeof actionSchema>;

const previousEnv = {
  runtimeDb: process.env.IPOLLOWORK_RUNTIME_DB,
  googleClientSecret: process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET,
  legacyGoogleClientSecret: process.env.IPOLLOWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET,
  tokenBrokerUrl: process.env.IPOLLOWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL,
  legacyTokenBrokerUrl: process.env.GOOGLE_WORKSPACE_TOKEN_BROKER_URL,
};

const stops: Array<() => void | Promise<void>> = [];
const dirs: string[] = [];

function restoreEnv(key: string, value: string | undefined) {
  if (typeof value === "string") process.env[key] = value;
  else delete process.env[key];
}

function clearLegacyGoogleWorkspaceEnv() {
  delete process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET;
  delete process.env.IPOLLOWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET;
  delete process.env.IPOLLOWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL;
  delete process.env.GOOGLE_WORKSPACE_TOKEN_BROKER_URL;
}

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

async function boot() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-connect-gating-"));
  dirs.push(root);
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config = serverConfig(root);
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, config };
}

function clientHeaders() {
  return { authorization: `Bearer ${CLIENT_TOKEN}` };
}

function clientJsonHeaders() {
  return { ...clientHeaders(), "content-type": "application/json" };
}

function hostJsonHeaders() {
  return { "x-ipollowork-host-token": HOST_TOKEN, "content-type": "application/json" };
}

async function readSchema<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json();
  return schema.parse(body);
}

async function listActions(base: string): Promise<ActionItem[]> {
  const response = await fetch(`${base}/experimental/extensions/actions`, { headers: clientHeaders() });
  expect(response.status).toBe(200);
  return (await readSchema(response, actionsResponseSchema)).actions;
}

function actionKeys(actions: ActionItem[]): string[] {
  return actions.map((action) => `${action.extensionId}/${action.action}`).sort();
}

async function putConnectState(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/experimental/connect/state`, {
    method: "PUT",
    headers: hostJsonHeaders(),
    body: JSON.stringify(body),
  });
}

async function callCalendarListEvents(base: string): Promise<Response> {
  return fetch(`${base}/experimental/extensions/call`, {
    method: "POST",
    headers: clientJsonHeaders(),
    body: JSON.stringify({
      extensionId: "google-workspace",
      action: "calendar_list_events",
      args: {
        timeMin: "2026-01-01T00:00:00.000Z",
        timeMax: "2026-01-02T00:00:00.000Z",
      },
      context: {},
    }),
  });
}

async function callGoogleWorkspaceStatus(base: string): Promise<Response> {
  return fetch(`${base}/experimental/extensions/call`, {
    method: "POST",
    headers: clientJsonHeaders(),
    body: JSON.stringify({
      extensionId: "google-workspace",
      action: "status",
      args: {},
      context: {},
    }),
  });
}

async function expectLegacyCallPassesThrough(base: string) {
  const response = await callCalendarListEvents(base);
  expect(response.status).toBe(400);
  const body = await readSchema(response, apiErrorSchema);
  expect(body.code).toBe("google_workspace_not_connected");
}

function expectAllActions(actions: ActionItem[]) {
  expect(actions).toHaveLength(33);
  expect(actions.filter((action) => action.extensionId === "google-workspace")).toHaveLength(14);
  expect(actions.filter((action) => action.extensionId === "openai-image-generation")).toHaveLength(2);
  expect(actions.filter((action) => action.extensionId === "media")).toHaveLength(15);
  expect(actions.filter((action) => action.extensionId === "storage")).toHaveLength(2);
}

beforeEach(() => {
  clearLegacyGoogleWorkspaceEnv();
});

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  restoreEnv("IPOLLOWORK_RUNTIME_DB", previousEnv.runtimeDb);
  restoreEnv("GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", previousEnv.googleClientSecret);
  restoreEnv("IPOLLOWORK_GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", previousEnv.legacyGoogleClientSecret);
  restoreEnv("IPOLLOWORK_GOOGLE_WORKSPACE_TOKEN_BROKER_URL", previousEnv.tokenBrokerUrl);
  restoreEnv("GOOGLE_WORKSPACE_TOKEN_BROKER_URL", previousEnv.legacyTokenBrokerUrl);
});

describe("Connect-aware legacy extension gating", () => {
  test("exposes one engine-neutral host tool catalog and dispatches extension discovery through it", async () => {
    const { base } = await boot();
    const catalogResponse = await fetch(`${base}/engine-tools`, { headers: clientHeaders() });
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json() as { tools?: Array<{ name?: string }> };
    expect(catalog.tools?.map((tool) => tool.name)).toEqual([
      "ipollowork_extension_list_actions",
      "ipollowork_extension_call",
      "ipollowork_project_read",
      "ipollowork_project_apply",
      "ipollowork_workspace_app_list_tools",
      "ipollowork_workspace_app_call_tool",
    ]);

    const callResponse = await fetch(`${base}/engine-tools/call`, {
      method: "POST",
      headers: { ...clientHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        name: "ipollowork_extension_list_actions",
        args: { extensionId: "storage" },
        context: { workspaceId: "ws_1" },
      }),
    });
    expect(callResponse.status).toBe(200);
    const call = await callResponse.json() as { actions?: Array<{ extensionId?: string }> };
    expect(call.actions?.length).toBeGreaterThan(0);
    expect(call.actions?.every((action) => action.extensionId === "storage")).toBe(true);
  });

  test("exposes the shared host tools through the Codex-compatible MCP bridge", async () => {
    const { base } = await boot();
    const client = new McpClient({ name: "ipollowork-host-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${base}/engine-tools/mcp?workspaceId=ws_1`),
      { requestInit: { headers: clientHeaders() } },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        "ipollowork_extension_list_actions",
        "ipollowork_extension_call",
        "ipollowork_project_read",
        "ipollowork_project_apply",
        "ipollowork_workspace_app_list_tools",
        "ipollowork_workspace_app_call_tool",
      ]);
      const result = await client.callTool({
        name: "ipollowork_extension_list_actions",
        arguments: { extensionId: "storage" },
      });
      expect(result.structuredContent).toMatchObject({
        ok: true,
        actions: expect.arrayContaining([
          expect.objectContaining({ extensionId: "storage" }),
        ]),
      });
    } finally {
      await client.close();
    }
  });

  test("reads and applies a validated project through the shared engine host tools", async () => {
    const { base } = await boot();
    const call = (name: string, args: Record<string, unknown>) => fetch(`${base}/engine-tools/call`, {
      method: "POST",
      headers: { ...clientHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ name, args, context: { workspaceId: "ws_1", sessionId: "session_builder" } }),
    });

    const blockedResponse = await call("ipollowork_project_read", {});
    expect(blockedResponse.status).toBe(403);
    const activateResponse = await fetch(`${base}/workspace/ws_1/project-builder-sessions/session_builder`, {
      method: "POST",
      headers: clientJsonHeaders(),
      body: "{}",
    });
    expect(activateResponse.status).toBe(200);

    const initialResponse = await call("ipollowork_project_read", {});
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json() as { source?: string; project?: { agents?: Array<{ id?: string }> } };
    expect(initial.source).toBe("default");
    expect(initial.project?.agents?.[0]?.id).toBe("project-lead");

    const project = {
      schemaVersion: 1,
      goal: "Publish the weekly briefing",
      agents: [{ id: "editor", name: "Editor", avatarSeed: "editor" }],
      orchestration: { entryAgentId: "editor", relations: [] },
    };
    const applyResponse = await call("ipollowork_project_apply", { config: project, summary: "Create editor workflow" });
    expect(applyResponse.status).toBe(200);

    const savedResponse = await call("ipollowork_project_read", {});
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json() as { source?: string; project?: { goal?: string } };
    expect(saved.source).toBe("saved");
    expect(saved.project?.goal).toBe("Publish the weekly briefing");

    const invalidResponse = await call("ipollowork_project_apply", {
      config: { ...project, orchestration: { entryAgentId: "missing", relations: [] } },
      summary: "Break the project",
    });
    expect(invalidResponse.status).toBe(400);
  });

  test("defaults to unchanged legacy extension behavior when no connect state file exists", async () => {
    const { base } = await boot();

    expectAllActions(await listActions(base));
    await expectLegacyCallPassesThrough(base);
  });

  test("keeps legacy extension behavior unchanged when connectEnabled is false", async () => {
    const { base } = await boot();
    const put = await putConnectState(base, { connectEnabled: false });
    expect(put.status).toBe(200);

    expectAllActions(await listActions(base));
    await expectLegacyCallPassesThrough(base);
    const status = await readSchema(
      await fetch(`${base}/experimental/google-workspace/status`, { headers: clientHeaders() }),
      googleWorkspaceStatusSchema,
    );
    expect(status.connect).toBeUndefined();
  });

  test("keeps legacy extension behavior unchanged when legacy Google Workspace is configured", async () => {
    process.env.GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET = "test-secret";
    const { base } = await boot();
    const put = await putConnectState(base, { connectEnabled: true });
    expect(put.status).toBe(200);

    expectAllActions(await listActions(base));
    await expectLegacyCallPassesThrough(base);
    const status = await readSchema(
      await fetch(`${base}/experimental/google-workspace/status`, { headers: clientHeaders() }),
      googleWorkspaceStatusSchema,
    );
    expect(status.connect).toBeUndefined();
    const state = await readSchema(
      await fetch(`${base}/experimental/connect/state`, { headers: clientHeaders() }),
      connectStateResponseSchema,
    );
    expect(state.googleWorkspace.legacyConfigured).toBe(true);
  });

  test("gates only non-status Google Workspace actions when Connect is enabled without legacy config", async () => {
    const { base, config } = await boot();
    const put = await putConnectState(base, { connectEnabled: true });
    expect(put.status).toBe(200);

    const actions = await listActions(base);
    expect(actionKeys(actions)).toEqual([
      "google-workspace/status",
      "media/digital_human_generate",
      "media/speech_recognize_realtime",
      "media/speech_synthesize",
      "media/speech_synthesize_workspace_batch",
      "media/speech_synthesize_workspace_file",
      "media/speech_transcribe",
      "media/speech_translate",
      "media/status",
      "media/task_get",
      "media/video_edit",
      "media/video_generate",
      "media/voice_clone",
      "media/voice_clone_workspace_file",
      "media/voice_list",
      "media/voiceover_timeline_validate",
      "openai-image-generation/image_generate",
      "openai-image-generation/status",
      "storage/status",
      "storage/upload_workspace_file",
    ]);

    const gated = await callCalendarListEvents(base);
    expect(gated.status).toBe(200);
    const gatedBody = await readSchema(gated, gatedCallSchema);
    expect(gatedBody.message).toContain("Settings > Connect");
    expect(gatedBody.message).toContain("Do not direct them to Settings > Extensions");

    const status = await readSchema(
      await fetch(`${base}/experimental/google-workspace/status`, { headers: clientHeaders() }),
      googleWorkspaceStatusSchema,
    );
    expect(status.connect).toEqual({
      enabled: true,
      cloudMcpPresent: false,
      guidance: gatedBody.message,
    });

    const statusAction = await readSchema(await callGoogleWorkspaceStatus(base), googleWorkspaceStatusActionSchema);
    expect(statusAction.result.connect).toEqual(status.connect);

    await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({
      ...current,
      mcp: {
        ...current.mcp,
        "ipollowork-cloud": { type: "remote", url: "https://cloud.example/mcp" },
      },
    }));

    const cloudGated = await callCalendarListEvents(base);
    const cloudBody = await readSchema(cloudGated, gatedCallSchema);
    expect(cloudBody.message).toContain("call search_capabilities");
    expect(cloudBody.message).toContain("execute_capability");
    expect(cloudBody.message).toContain("Settings > Connect");

    const cloudStatus = await readSchema(
      await fetch(`${base}/experimental/google-workspace/status`, { headers: clientHeaders() }),
      googleWorkspaceStatusSchema,
    );
    expect(cloudStatus.connect).toEqual({
      enabled: true,
      cloudMcpPresent: true,
      guidance: cloudBody.message,
    });
  });

  test("validates and round-trips the persisted connect state route", async () => {
    const { base } = await boot();
    const badType = await putConnectState(base, { connectEnabled: "true" });
    expect(badType.status).toBe(400);
    expect((await readSchema(badType, apiErrorSchema)).code).toBe("invalid_payload");

    const extraKey = await putConnectState(base, { connectEnabled: true, extra: false });
    expect(extraKey.status).toBe(400);

    const put = await putConnectState(base, { connectEnabled: true });
    expect(put.status).toBe(200);
    const putState = await readSchema(put, connectStateResponseSchema);
    expect(putState.connectEnabled).toBe(true);
    expect(putState.cloudMcpPresent).toBe(false);
    expect(putState.googleWorkspace.legacyConfigured).toBe(false);

    const get = await fetch(`${base}/experimental/connect/state`, { headers: clientHeaders() });
    expect(get.status).toBe(200);
    const getState = await readSchema(get, connectStateResponseSchema);
    expect(getState).toEqual(putState);
  });
});
