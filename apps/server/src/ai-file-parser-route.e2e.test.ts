import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const CLIENT_TOKEN = "owt_ai_file_client";
const HOST_TOKEN = "owt_ai_file_host";
const stops: Array<() => void | Promise<void>> = [];
const dirs: string[] = [];
const nativeFetch = globalThis.fetch;
const priorEnvStore = process.env.IPOLLOWORK_ENV_STORE;
const priorTokenStore = process.env.IPOLLOWORK_TOKEN_STORE;
const priorOpenAiApiKey = process.env.OPENAI_API_KEY;

function clientAuth() {
  return { authorization: `Bearer ${CLIENT_TOKEN}` };
}

function hostAuth() {
  return { "x-ipollowork-host-token": HOST_TOKEN, "content-type": "application/json" };
}

function baseConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: dirs[dirs.length - 1]!, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [dirs[dirs.length - 1]!],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  } as ServerConfig;
}

async function boot() {
  const server = await startServer(baseConfig()) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}` };
}

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ipollowork-ai-file-parser-"));
  dirs.push(dir);
  process.env.IPOLLOWORK_ENV_STORE = join(dir, "env.json");
  process.env.IPOLLOWORK_TOKEN_STORE = join(dir, "tokens.json");
  delete process.env.OPENAI_API_KEY;
});

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  if (priorEnvStore === undefined) delete process.env.IPOLLOWORK_ENV_STORE;
  else process.env.IPOLLOWORK_ENV_STORE = priorEnvStore;
  if (priorTokenStore === undefined) delete process.env.IPOLLOWORK_TOKEN_STORE;
  else process.env.IPOLLOWORK_TOKEN_STORE = priorTokenStore;
  if (priorOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = priorOpenAiApiKey;
  globalThis.fetch = nativeFetch;
});

describe("AI file parser route", () => {
  test("keeps the OpenAI key server-side while returning structured analysis", async () => {
    const { base } = await boot();
    const envPut = await fetch(`${base}/env`, {
      method: "PUT",
      headers: hostAuth(),
      body: JSON.stringify({ key: "OPENAI_API_KEY", value: "sk-parser-secret" }),
    });
    expect(envPut.status).toBe(200);

    globalThis.fetch = ((input, init) => {
      if (String(input) === "https://api.openai.com/v1/responses") {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-parser-secret" });
        const body = JSON.parse(String(init?.body ?? "{}")) as { input: Array<{ content: Array<Record<string, string>> }> };
        expect(JSON.stringify(body)).toContain("input_file");
        expect(JSON.stringify(body)).toContain("reference.txt");
        return Promise.resolve(new Response(JSON.stringify({
          output_text: JSON.stringify({
            summary: "Reference describes a launch page.",
            userIntent: "Generate a launch page",
            targetAudience: "Enterprise users",
            keyFacts: ["Q4 launch"],
            designRequirements: ["Use clear hierarchy"],
            contentOutline: ["Hero", "CTA"],
            brandHints: ["Polished"],
            dataFindings: [],
            missingInfo: [],
            confidence: "high",
          }),
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const form = new FormData();
    form.append("file", new File(["Launch brief"], "reference.txt", { type: "text/plain" }));
    const response = await fetch(`${base}/workspace/ws_1/ai-file-parser/analyze`, {
      method: "POST",
      headers: clientAuth(),
      body: form,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      source: "openai",
      fileName: "reference.txt",
      analysis: {
        summary: "Reference describes a launch page.",
        confidence: "high",
      },
    });
  });
});
