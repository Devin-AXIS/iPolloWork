// Real Codex runtime/SSE boundary with a deterministic child; no model or paid tool runs.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexHarnessRuntime } from "../../apps/server/src/codex-harness-runtime.ts";
import { EnvService } from "../../apps/server/src/env-file.ts";

const root = await mkdtemp(join(tmpdir(), "ipollowork-approval-proof-"));
const cli = join(root, "codex-fixture.js");
await writeFile(cli, `
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
require('node:readline').createInterface({input: process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (!m.method) return;
  if (m.method === 'test/emit') send(m.params);
  send({id: m.id, result: {}});
});
`);
process.env.IPOLLOWORK_CODEX_CLI = cli;
const runtime = new CodexHarnessRuntime({
  config: {
    host: "127.0.0.1", port: 5275, token: "fixture", hostToken: "fixture",
    configPath: join(root, "config.json"), approval: { mode: "manual", timeoutMs: 30000 },
    corsOrigins: [], workspaces: [], authorizedRoots: [root], readOnly: false,
    startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  },
  env: new EnvService({ path: join(root, "env.json") }),
  workspace: { id: "approval-proof", name: "Approval proof", path: root, preset: "starter", workspaceType: "local", engineId: "codex-harness" },
});
const receipts = [];
const server = Bun.serve({
  hostname: "127.0.0.1", port: 5275, idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    let response;
    if (request.method === "OPTIONS") response = new Response(null);
    else if (url.pathname.endsWith("/events")) response = await runtime.events(request.signal);
    else if (url.pathname.endsWith("/respond")) {
      const body = await request.json();
      await runtime.respond(body.rpcId, body.result);
      receipts.push(body);
      await runtime.call("test/emit", { method: "serverRequest/resolved", params: { requestId: body.rpcId } });
      response = Response.json({ ok: true });
    } else if (url.pathname === "/ask") {
      receipts.length = 0;
      await runtime.call("test/emit", {
        id: 61, method: "mcpServer/elicitation/request",
        params: { threadId: "approval-proof", turnId: "turn-a", serverName: "ipollowork", mode: "form", message: "Allow image edit?", requestedSchema: { type: "object", properties: {} }, _meta: { codex_approval_kind: "mcp_tool_call", tool_params: { action: "image_edit" } } },
      });
      response = Response.json({ ok: true });
    } else if (url.pathname === "/receipts") response = Response.json(receipts);
    else response = new Response("Not found", { status: 404 });
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Headers", "content-type, authorization");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return response;
  },
});
async function stop() { server.stop(true); await runtime.close(); await rm(root, { recursive: true, force: true }); process.exit(); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log("Approval proof ready: http://127.0.0.1:5275");
