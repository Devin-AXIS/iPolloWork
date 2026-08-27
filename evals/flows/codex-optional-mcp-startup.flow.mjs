import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FLOW_ID = "codex-optional-mcp-startup";
const CODEX_CLI_ENV = "IPOLLOWORK_EVAL_CODEX_CLI";

function witness(ctx, condition, assertion, actual) {
  if (!condition) {
    ctx.recordEvidence({ type: "assertion", status: "failed", assertion, actual });
    ctx.assert(false, `${assertion}${actual ? ` (actual: ${actual})` : ""}`);
  }
  ctx.recordEvidence({ type: "assertion", status: "passed", assertion, actual });
}

function waitForMessage(messages, subscribe, predicate, timeoutMs) {
  const current = messages.find(predicate);
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for Codex app-server response`));
    }, timeoutMs);
    const unsubscribe = subscribe((message) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(message);
    });
  });
}

async function startUnauthorizedMcp() {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      authorization: request.headers.authorization ?? null,
    });
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "mcp_authorization_required" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve mock MCP address");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function proveOptionalMcp(codexCli, codexHome, mcpUrl) {
  const child = spawn(codexCli, [
    "-c", `mcp_servers.figma.url=${JSON.stringify(mcpUrl)}`,
    "-c", "mcp_servers.figma.required=false",
    "app-server", "--stdio",
  ], {
    cwd: codexHome,
    env: { ...process.env, CODEX_HOME: codexHome, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const messages = [];
  const listeners = new Set();
  const stderr = [];
  let stdoutBuffer = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        messages.push(message);
        for (const listener of listeners) listener(message);
      } catch {
        // Codex diagnostics belong on stderr; ignore non-protocol stdout noise.
      }
    }
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

  try {
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "ipollowork-fraimz", title: "iPolloWork Fraimz", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      },
    });
    const initialized = await waitForMessage(messages, subscribe, (message) => message.id === 1, 30_000);
    send({ method: "initialized", params: {} });
    send({ id: 2, method: "mcpServerStatus/list", params: {} });
    const status = await waitForMessage(messages, subscribe, (message) => message.id === 2, 60_000);
    return {
      initialized,
      status,
      stillRunning: child.exitCode === null,
      diagnostics: stderr.join("").split(/\r?\n/).filter((line) => line.includes("figma")).slice(-8),
    };
  } finally {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 5_000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.stdin.end();
        child.kill();
      });
    }
  }
}

export default {
  id: FLOW_ID,
  title: "Codex Harness survives an unavailable optional Figma MCP",
  kind: "internal",
  requiresApp: false,
  requiredEnv: [CODEX_CLI_ENV],
  steps: [{
    name: "A Figma 401 does not stop Codex Harness",
    run: async (ctx) => {
      const codexHome = await mkdtemp(join(tmpdir(), "ipollowork-codex-optional-mcp-"));
      const mcp = await startUnauthorizedMcp();
      try {
        await ctx.prove("Codex Harness remains available when the optional Figma MCP returns 401", {
          voiceover: "Figma 暂时不可用时，Codex 对话仍然可以正常启动。",
          action: async () => {
            ctx.result = await proveOptionalMcp(process.env[CODEX_CLI_ENV], codexHome, mcp.url);
          },
          assert: async () => {
            const initialized = ctx.result.initialized;
            const status = ctx.result.status;
            const figma = status.result?.data?.find((server) => server.name === "figma");
            witness(ctx, Boolean(initialized.result) && !initialized.error, "Codex app-server initialize succeeds");
            witness(ctx, mcp.requests.length > 0, "Codex attempts to initialize the Figma MCP", String(mcp.requests.length));
            witness(ctx, mcp.requests.every((request) => request.authorization === null), "The reproduced Figma requests have no Authorization header");
            witness(ctx, Boolean(figma) && figma.serverInfo === null, "Figma is reported unavailable without removing it from status");
            witness(ctx, ctx.result.stillRunning, "Codex app-server remains alive after the Figma failure");
            ctx.output("Codex optional MCP result", JSON.stringify({
              initialized: Boolean(initialized.result),
              figma: figma ? { serverInfo: figma.serverInfo, authStatus: figma.authStatus } : null,
              unauthorizedRequests: mcp.requests.length,
              authorizationHeaders: mcp.requests.filter((request) => request.authorization !== null).length,
              appServerStillRunning: ctx.result.stillRunning,
              diagnostics: ctx.result.diagnostics,
            }, null, 2));
          },
        });
      } finally {
        await mcp.close();
        await rm(codexHome, { recursive: true, force: true });
      }
    },
  }],
};
