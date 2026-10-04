// Test-only local HTTP/model fixture. Run: bun evals/support/session-compaction.ts
// Real HTTP and native DSH; all generated state stays under .ipollowork-dev.
// Requires the bundled apps/desktop/dsh-runtime dependencies and Node runtime.
// UI: from apps/app, VITE_IPOLLOWORK_URL=http://127.0.0.1:8797
// VITE_IPOLLOWORK_TOKEN=local-compaction-client pnpm dev:web --host 127.0.0.1 --port 5174
// Open that UI in an isolated CDP browser, then run pnpm fraimz --flow
// session-compaction --cdp-url <browser CDP URL> with IPOLLOWORK_EVAL_COMPACTION_FIXTURE
// pointing to .ipollowork-dev/session-compaction-ui.json. The flow prepares a new
// native session per run. OpenCode settings use a local HTTP fixture; separate
// native OpenCode/Codex smoke tests establish their real completion contracts.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sharedProviderCredentialEnvKey, sharedProviderDisconnectedEnvKey } from "../../packages/types/src/provider-credentials";
import { EnvService } from "../../apps/server/src/env-file";
import { startServer } from "../../apps/server/src/server";
import { writeRuntimeProviderChannels } from "../../apps/server/src/runtime-opencode-config-store";
import type { ServerConfig } from "../../apps/server/src/types";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const devRoot = join(repoRoot, ".ipollowork-dev");
const proofRoot = join(devRoot, "session-compaction-proof");
const workspaceRoot = join(proofRoot, "workspace");
const openCodeWorkspaceRoot = join(proofRoot, "opencode-workspace");
const runtimeRoot = join(repoRoot, "apps/desktop/dsh-runtime");
await mkdir(workspaceRoot, { recursive: true });
await mkdir(openCodeWorkspaceRoot, { recursive: true });
await writeFile(join(workspaceRoot, "README.md"), "# Isolated conversation compaction proof\nOnly local fixture data lives here.\n");
for (const key of Object.keys(process.env)) {
  if (/API_KEY|TOKEN|ACCESS_KEY|SECRET|AGENT_PROVIDER_/.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  IPOLLOWORK_ENV_STORE: join(proofRoot, "env.json"),
  IPOLLOWORK_RUNTIME_DB: join(proofRoot, "runtime.sqlite"),
  IPOLLOWORK_DSH_HOME: join(proofRoot, "dsh"),
  IPOLLOWORK_DSH_CLI: join(runtimeRoot, "node_modules/@deepseek-ai/dsh/lib/bin.js"),
  IPOLLOWORK_DSH_NODE_BIN: join(runtimeRoot, "node-runtime/node"),
  IPOLLOWORK_DSH_HOST_PLUGIN: join(runtimeRoot, "ipollowork-host-tools.mjs"),
});
const fixture = { completions: 0, compactions: 0, failNextCompaction: false, lastOrdinaryRequestSawCheckpoint: false, lastOrdinaryRequestSawKnownFact: false };
// Settings-only OpenCode HTTP fixture; native OpenCode compression is tested separately.
let openCodeConfig: Record<string, unknown> = {};
const openCodeSession = { id: "ses_compaction_settings", title: "OpenCode 配置验证任务", directory: openCodeWorkspaceRoot, time: { created: Date.now(), updated: Date.now() } };
const openCodeHost = Bun.serve({ port: 8799, hostname: "127.0.0.1", idleTimeout: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/config") {
    if (request.method === "PATCH") openCodeConfig = { ...openCodeConfig, ...await request.json() };
    return Response.json(openCodeConfig);
  }
  if (path === "/global/health") return Response.json({ healthy: true, version: "local-settings-fixture" });
  if (path === "/provider") return Response.json({ all: [], default: {}, connected: [] });
  if (path === "/session/status") return Response.json({});
  if (path === "/session") return Response.json(request.method === "POST" ? openCodeSession : [openCodeSession]);
  if (path === `/session/${openCodeSession.id}`) return Response.json(openCodeSession);
  if (path === `/session/${openCodeSession.id}/message` || path === `/session/${openCodeSession.id}/todo`) return Response.json([]);
  if (["/session", "/permission", "/question", "/command", "/agent"].includes(path)) return Response.json([]);
  if (path === "/event" || path === "/global/event") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": local settings fixture\n\n")); } }), { headers: { "content-type": "text/event-stream" } });
  return Response.json(true);
} });
const modelHost = Bun.serve({ port: 8798, hostname: "127.0.0.1", async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/fixture/new-session" && request.method === "POST") {
    fixture.failNextCompaction = false;
    return Response.json({ standardSessionId: await seed("standard", "标准模式：手动压缩验证") });
  }
  if (path === "/fixture/fail-next" && request.method === "POST") {
    fixture.failNextCompaction = true;
    return Response.json(fixture);
  }
  if (path === "/fixture/state") return Response.json(fixture);
  if (path === "/v1/models") return Response.json({ object: "list", data: [{ id: "local-compaction", object: "model", owned_by: "local-proof" }] });
  if (path !== "/v1/chat/completions") return new Response("not found", { status: 404 });
  fixture.completions += 1;
  const body = await request.json();
  const isCompaction = body.messages.some((message: { content?: unknown }) => typeof message.content === "string" && message.content.includes("You are now acting as a compaction engine"));
  const knownFactPresent = body.messages.some((message: { content?: unknown }) => typeof message.content === "string" && message.content.includes("银杉"));
  if (!isCompaction) {
    fixture.lastOrdinaryRequestSawCheckpoint = body.messages.some((message: { content?: unknown }) => typeof message.content === "string" && message.content.includes("<compacted-summary>"));
    fixture.lastOrdinaryRequestSawKnownFact = knownFactPresent;
  }
  if (isCompaction) {
    fixture.compactions += 1;
    if (fixture.failNextCompaction) {
      fixture.failNextCompaction = false;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_500));
      return Response.json({ error: { message: "The local compaction fixture rejected the summary request.", type: "authentication_error", code: "invalid_api_key" } }, { status: 401 });
    }
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_500));
  const content = isCompaction
    ? "## Primary Request and Intent\n- Verify manual conversation compaction using this isolated local fixture.\n## Key Technical Concepts\n- Native DeepSeek Harness compaction; local model HTTP fixture.\n## Files and Code\n- workspace/README.md identifies fixture scope.\n## Errors and Fixes\n- (none)\n## Pending Jobs\n- Continue reviewing context usage after compaction.\n## Current Work\n- The preparation prompt finished successfully.\n## Next Step\n- Confirm reduced context usage.\n## Critical Context\n- " + (knownFactPresent ? "项目代号是银杉。The expected English marker is silverfir. Preserve this fact and the user request; all traffic is local." : "No project code is present in the selected history.")
    : body.messages.some((message: { content?: unknown }) => typeof message.content === "string" && message.content.includes("请复述"))
      ? knownFactPresent ? "silverfir" : "unknown-project"
      : "准备完成，可继续验证会话压缩。";
  const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
  const chunk = (delta: unknown, finish: string | null) => ({ id: "chatcmpl-local-proof", object: "chat.completion.chunk", created: 1, model: "local-compaction", choices: [{ index: 0, delta, finish_reason: finish }] });
  const promptTokens = Math.ceil(JSON.stringify(body.messages).length / 4) + Math.ceil(JSON.stringify(body.tools ?? []).length / 4);
  const completionTokens = Math.ceil(content.length / 4);
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
  return new Response(frame(chunk({ role: "assistant", content }, null)) + frame({ ...chunk({}, "stop"), usage }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
} });
const workspace = { id: "ws_compaction_proof", name: "会话压缩验证", path: workspaceRoot, preset: "starter", workspaceType: "local", engineId: "deepseek-harness" } satisfies ServerConfig["workspaces"][number];
const openCodeWorkspace = { id: "ws_compaction_opencode", name: "OpenCode 压缩设置验证", path: openCodeWorkspaceRoot, preset: "starter", workspaceType: "local", engineId: "opencode", baseUrl: "http://127.0.0.1:8799" } satisfies ServerConfig["workspaces"][number];
const configPath = join(proofRoot, "server.json");
const opencodeAuthPath = join(proofRoot, "empty-opencode-auth.json");
const config: ServerConfig = {
  host: "127.0.0.1", port: 8797, token: "local-compaction-client", hostToken: "local-compaction-host",
  configPath, approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: ["*"],
  opencodeAuthPath,
  workspaces: [workspace, openCodeWorkspace], authorizedRoots: [workspaceRoot, openCodeWorkspaceRoot], readOnly: false, startedAt: Date.now(),
  tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
};
await writeFile(configPath, JSON.stringify(config, null, 2));
await writeFile(opencodeAuthPath, "{}\n");
const env = new EnvService({ path: process.env.IPOLLOWORK_ENV_STORE, processEnv: {} });
await env.upsertMany([
  { key: sharedProviderCredentialEnvKey("compaction-proof"), value: "test-key" },
  { key: sharedProviderDisconnectedEnvKey("openai"), value: "1" },
]);
await writeRuntimeProviderChannels(config, () => ({ "compaction-proof": {
  name: "本地压缩验证模型", npm: "@ai-sdk/openai-compatible", options: { baseURL: `http://127.0.0.1:${modelHost.port}/v1` },
  models: { "local-compaction": { name: "本地会话压缩模型", limit: { context: 128_000, output: 8192 }, modalities: { input: ["text"], output: ["text"] } } },
} }));
const server = await startServer(config);
const baseUrl = `http://127.0.0.1:${server.port}`;
const engineUrl = `${baseUrl}/workspace/${workspace.id}/engine/deepseek-harness`;
const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
async function rpc<T>(method: string, payload: unknown = {}): Promise<T> {
  const response = await fetch(`${engineUrl}/rpc`, { method: "POST", headers, body: JSON.stringify({ method, payload }) });
  if (!response.ok) throw new Error(`${method}: ${response.status} ${await response.text()}`);
  return (await response.json()).value;
}
async function seed(preset: string, title: string) {
  const created = await rpc<{ sessionId: string }>("session.create", { cwd: workspaceRoot });
  await rpc("agentPreset.select", { sessionId: created.sessionId, agentPreset: preset });
  await rpc("session.selectModel", { sessionId: created.sessionId, provider: "compaction-proof", model: "local-compaction" });
  const response = await fetch(`${engineUrl}/prompt`, { method: "POST", headers, body: JSON.stringify({ payload: {
    sessionId: created.sessionId, mode: "queue", content: [{ type: "text", text: "请准备会话压缩验证。请记住项目代号是银杉，英文标记是 silverfir。\n" + "This is retained preparation context. Preserve the project labels and review decisions while verifying the compaction workflow. ".repeat(240) }],
  } }) });
  if (!response.ok) throw new Error(`seed prompt: ${response.status} ${await response.text()}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await rpc<{ items: Array<{ sessionId: string; running: boolean; blank: boolean }> }>("session.list");
    const item = list.items.find((entry) => entry.sessionId === created.sessionId);
    if (item && item.running === false && item.blank === false) {
      await rpc("session.rename", { sessionId: created.sessionId, title });
      return created.sessionId;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Seeded ${preset} session did not settle`);
}
const standardSessionId = await seed("standard", "标准模式：手动压缩验证");
const minimalSessionId = await seed("minimal", "极简模式：不支持压缩");
await writeFile(join(devRoot, "session-compaction-ui.json"), JSON.stringify({ baseUrl, token: config.token, workspaceId: workspace.id, workspaceRoot, openCodeWorkspaceId: openCodeWorkspace.id, openCodeSessionId: openCodeSession.id, standardSessionId, minimalSessionId, modelHostPort: modelHost.port, providerId: "compaction-proof", modelId: "local-compaction", knownFact: "项目代号是银杉", expectedContinuityAnswer: "silverfir", newSessionUrl: `http://127.0.0.1:${modelHost.port}/fixture/new-session`, failNextCompactionUrl: `http://127.0.0.1:${modelHost.port}/fixture/fail-next`, fixtureStateUrl: `http://127.0.0.1:${modelHost.port}/fixture/state`, fixture }, null, 2));
console.log(JSON.stringify({ ready: true, baseUrl, standardSessionId, minimalSessionId, metadata: join(devRoot, "session-compaction-ui.json") }));
process.on("SIGTERM", () => { void server.stop().finally(() => { modelHost.stop(true); openCodeHost.stop(true); process.exit(0); }); });
process.on("SIGINT", () => { void server.stop().finally(() => { modelHost.stop(true); openCodeHost.stop(true); process.exit(0); }); });
