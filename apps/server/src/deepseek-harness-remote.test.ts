import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { DeepSeekRemoteMux, deepSeekRemoteCall } from "./deepseek-harness-remote.js";
import { DeepSeekHarnessRuntime } from "./deepseek-harness-runtime.js";
import { EnvService } from "./env-file.js";
import type { ServerConfig } from "./types.js";

test("projects Work calls onto current DSH named Remote arguments", () => {
  expect(deepSeekRemoteCall("session.list", {})).toEqual({ method: "session/list", args: { _request: {} } });
  expect(deepSeekRemoteCall("llm.models", {})).toEqual({ method: "session/modelCatalog", args: {} });
  expect(deepSeekRemoteCall("settings.mutate", { ns: "test", ops: [] })).toEqual({ method: "settings/mutate", args: { ns: "test", ops: [] } });
  expect(deepSeekRemoteCall("session.prompt", { sessionId: "s", clientUserMessageId: "m", content: [] })).toEqual({ method: "session/prompt", args: { request: { sessionId: "s", requestId: "m", content: [] } } });
  expect(deepSeekRemoteCall("commands/execute", { args: { agentId: "s", line: "/permission read-only" } })).toEqual({ method: "commands/execute", args: { agentId: "s", line: "/permission read-only", submittedAttachments: [] } });
});

test("multiplexes subscriptions on one authenticated connection and cancels them independently", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  let connections = 0;
  const opened: string[] = [];
  server.on("connection", (socket, request) => {
    connections += 1;
    expect(request.headers.cookie).toBe("test-session=signed");
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type !== "open") return;
      opened.push(frame.endpoint);
      socket.send(JSON.stringify({ type: "item", streamId: frame.streamId, value: { endpoint: frame.endpoint } }));
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const mux = new DeepSeekRemoteMux(`http://127.0.0.1:${address.port}`, "test-session=signed");
  const abort = new AbortController();
  try {
    const first = mux.stream("session/follow", {}, abort.signal);
    const second = mux.stream("session/control", {}, abort.signal);
    expect(await first.next()).toMatchObject({ value: { endpoint: "session/follow" } });
    await first.return(undefined);
    expect(await second.next()).toMatchObject({ value: { endpoint: "session/control" } });
    expect(connections).toBe(1);
    expect(opened).toEqual(["session/follow", "session/control"]);
    await second.return(undefined);
  } finally {
    abort.abort();
    mux.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

const runtimeRoot = fileURLToPath(new URL("../../desktop/dsh-runtime/", import.meta.url));
const cli = join(runtimeRoot, "node_modules/@deepseek-ai/dsh/lib/bin.js");
const nodeBin = join(runtimeRoot, "node-runtime", process.platform === "win32" ? "node.exe" : "node");

test.skipIf(!existsSync(cli) || !existsSync(nodeBin))("current DSH authenticates, streams a tool-backed answer and restores its session", async () => {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-dsh-remote-"));
  const overrides = {
    IPOLLOWORK_DSH_HOME: join(root, "dsh"),
    IPOLLOWORK_DSH_CLI: cli,
    IPOLLOWORK_DSH_NODE_BIN: nodeBin,
    IPOLLOWORK_DSH_HOST_PLUGIN: join(runtimeRoot, "ipollowork-host-tools.mjs"),
    IPOLLOWORK_RUNTIME_DB: join(root, "runtime.db"),
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  let completions = 0;
  let toolCalls = 0;
  const host = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/engine-tools") return Response.json({ tools: [{ name: "ipollowork_test_ping", description: "Return a test greeting", parameters: { type: "object", properties: {} } }] });
    if (path === "/engine-tools/call") {
      const body = await request.json();
      expect(body.name).toBe("ipollowork_test_ping");
      toolCalls += 1;
      return Response.json({ greeting: "upgrade-ok" });
    }
    if (path === "/v1/chat/completions") {
      completions += 1;
      const body = await request.json();
      const hasToolResult = body.messages.some((message: { role: string }) => message.role === "tool");
      const delta = hasToolResult ? { content: "upgrade-ok" } : {
        tool_calls: [{ index: 0, id: "call_ping", type: "function", function: { name: "ipollowork_test_ping", arguments: "{}" } }],
      };
      const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
      const chunk = (delta: unknown, finish: string | null) => ({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta, finish_reason: finish }] });
      return new Response(frame(chunk({ role: "assistant", ...delta }, null)) + frame(chunk({}, hasToolResult ? "stop" : "tool_calls")) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }
    return new Response("not found", { status: 404 });
  } });
  const workspace = { id: "ws_dsh_test", name: "Engine verification", path: root, preset: "starter", workspaceType: "local", engineId: "deepseek-harness" } satisfies ServerConfig["workspaces"][number];
  const config: ServerConfig = {
    host: "127.0.0.1", port: host.port ?? 0, token: "test-token", hostToken: "test-host-token",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: [workspace], authorizedRoots: [root], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const runtime = new DeepSeekHarnessRuntime({ config, workspace, env: new EnvService({ path: join(root, ".env"), processEnv: {} }) });
  const abort = new AbortController();
  try {
    expect(await runtime.call<{ items: unknown[]; archivedSessionIds: string[] }>("workspace.list", {})).toEqual({ items: [], archivedSessionIds: [] });
    await runtime.call("credentials.set", { ref: "UPGRADE_TEST_KEY", value: "test-key" });
    await runtime.call("settings.mutate", { ns: "llm-pi-ai", ops: [{ op: "set", path: ["providers", "upgrade-test"], value: { api: "openai-completions", baseURL: `http://127.0.0.1:${host.port}/v1`, apiKeyEnv: "UPGRADE_TEST_KEY", models: [{ id: "test-model", name: "Test", contextWindow: 8192, maxTokens: 1024 }] } }] });
    const created = await runtime.call<{ sessionId: string }>("session.create", { cwd: root });
    await runtime.call("session.selectModel", { sessionId: created.sessionId, provider: "upgrade-test", model: "test-model" });
    const permission = await runtime.call<{ result: { kind: string } }>("commands/execute", {
      args: { agentId: created.sessionId, line: "/permission workspace-write" },
    });
    expect(permission.result.kind).toBe("success");
    const events = await runtime.events("mux", abort.signal);
    const reader = events.body!.getReader();
    const frames: string[] = [];
    const consume = (async () => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        frames.push(new TextDecoder().decode(item.value));
        if (frames.join("").includes('"type":"turn/end"')) break;
      }
    })();
    await runtime.call("session.prompt", { sessionId: created.sessionId, clientUserMessageId: "test-prompt", mode: "queue", content: [{ type: "text", text: "Call ipollowork_test_ping and report its greeting." }] });
    await Promise.race([consume, new Promise((_, reject) => setTimeout(() => reject(new Error(`No completed DSH turn (${completions} model requests, ${toolCalls} tool calls)`)), 20_000))]);
    expect(toolCalls).toBe(1);
    expect(frames.join("")).toContain("upgrade-ok");
    // DSH can also issue a background title-generation request.
    expect(completions).toBeGreaterThanOrEqual(2);
    const history = await runtime.call<{ events: unknown[] }>("session.history", { sessionId: created.sessionId });
    expect(JSON.stringify(history.events)).toContain("upgrade-ok");
    abort.abort();
    await runtime.close();
    const restored = await runtime.call<{ events: unknown[] }>("session.history", { sessionId: created.sessionId });
    expect(JSON.stringify(restored.events)).toContain("upgrade-ok");
  } finally {
    abort.abort();
    await runtime.close();
    host.stop(true);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
