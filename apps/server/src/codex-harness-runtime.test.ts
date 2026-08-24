import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  serializeSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";

import {
  codexHarnessConfig,
  codexHarnessHostMcp,
  codexHarnessProviders,
  codexHarnessRuntimeProviderId,
  CodexHarnessModelSelectionError,
  CodexHarnessRuntime,
} from "./codex-harness-runtime.js";
import {
  listCodexHarnessSessions,
  mapCodexMessages,
  readCodexHarnessSnapshot,
} from "./codex-harness-session-read-model.js";
import { CodexProviderGateway } from "./codex-provider-gateway.js";
import { EnvService } from "./env-file.js";
import { projectCodexHarnessProviderList } from "./routes/codex-harness.js";
import { buildCodexHarnessAdditionalContext } from "./workspace-session-runtime.js";
import { disposeRuntimeOpencodeConfigStore } from "./runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

const roots: string[] = [];
const configs: ServerConfig[] = [];
const servers: Server[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function removeTestRoot(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (process.platform === "win32" && (code === "EBUSY" || code === "EPERM")) return;
    throw error;
  }
}

async function testConfig(): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-codex-runtime-test-"));
  roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "test",
    hostToken: "test-host",
    configPath: join(root, "config.json"),
    approval: { mode: "manual", timeoutMs: 30_000 },
    corsOrigins: [],
    workspaces: [],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
  configs.push(config);
  return config;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const config of configs.splice(0)) await disposeRuntimeOpencodeConfigStore(config);
  for (const root of roots.splice(0)) await removeTestRoot(root);
});

describe("Codex Harness provider projection", () => {
  test("sends runtime and plugin guidance as hidden application context", () => {
    expect(buildCodexHarnessAdditionalContext(
      " Long-running local process rule:\nRuntime guidance ",
      ["Plugin system guidance", "", " Plugin user guidance "],
    )).toEqual({
      "ipollowork.runtime": {
        value: "Long-running local process rule:\nRuntime guidance",
        kind: "application",
      },
      "ipollowork.plugins": {
        value: "Plugin system guidance\n\nPlugin user guidance",
        kind: "application",
      },
    });
  });

  test("preserves every authored Codex user text block", () => {
    const messages = mapCodexMessages({
      id: "codex-thread",
      turns: [{
        id: "turn-1",
        status: "completed",
        items: [{
          id: "user-1",
          clientId: "ipollowork-user-1",
          type: "userMessage",
          content: [
            { type: "text", text: "Compare both notes" },
            { type: "text", text: "Template applied: quoted source text" },
          ],
        }],
      }],
    });

    expect(messages[0]?.info.id).toBe("ipollowork-user-1");
    expect(messages[0]?.parts).toEqual([expect.objectContaining({
      type: "text",
      text: "Compare both notes\nTemplate applied: quoted source text",
    })]);
  });

  test("lists providers without preparing the Codex task runtime", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const workspace: WorkspaceInfo = {
      id: "codex-provider-list",
      name: "Codex provider list",
      path: root,
      preset: "starter",
      workspaceType: "local",
      engineId: "codex-harness",
    };
    const runtime = new CodexHarnessRuntime({
      config,
      env: new EnvService({ path: join(root, "env.json") }),
      workspace,
    });

    try {
      expect((await runtime.providers()).map((provider) => provider.id)).toEqual(["opencode"]);
      expect(existsSync(join(root, "codex-harness-workspaces"))).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  test("reuses a warm Codex runtime without repeating provider preparation for every RPC", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const fixturePath = join(root, "codex-warm-runtime-fixture.js");
    await writeFile(fixturePath, String.raw`
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize" || message.method === "test/ping") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
  }
});
`, "utf8");
    class CountingEnvService extends EnvService {
      listCalls = 0;

      override async list() {
        this.listCalls += 1;
        return await super.list();
      }
    }
    const env = new CountingEnvService({ path: join(root, "env.json") });
    const previousCli = process.env.IPOLLOWORK_CODEX_CLI;
    process.env.IPOLLOWORK_CODEX_CLI = fixturePath;
    const runtime = new CodexHarnessRuntime({
      config,
      env,
      workspace: {
        id: "codex-warm-runtime",
        name: "Codex warm runtime",
        path: root,
        preset: "starter",
        workspaceType: "local",
        engineId: "codex-harness",
      },
    });

    try {
      await runtime.call("test/ping");
      await runtime.call("test/ping");
      await runtime.call("test/ping");
      expect(env.listCalls).toBe(1);
    } finally {
      await runtime.close();
      if (previousCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
      else process.env.IPOLLOWORK_CODEX_CLI = previousCli;
    }
  });

  test("restarts a live thread once to apply a changed provider and preserves event subscribers", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const fixturePath = join(root, "codex-app-server-fixture.js");
    const rebindMarkerPath = join(root, "codex-rebind-marker");
    const rebindLogPath = join(root, "codex-rebind-log");
    await writeFile(fixturePath, String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
    return;
  }
  if (message.method === "thread/start") {
    fs.appendFileSync(
      process.env.IPOLLOWORK_CODEX_REBIND_LOG,
      message.method + ":" + message.params.modelProvider + "/" + message.params.model + "\n",
    );
    const marker = process.env.IPOLLOWORK_CODEX_REBIND_MARKER + ".start";
    const mismatch = !fs.existsSync(marker);
    if (mismatch) fs.writeFileSync(marker, "retry");
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        modelProvider: mismatch ? "ipollowork-opencode" : message.params.modelProvider,
        model: mismatch ? "big-pickle" : message.params.model,
        thread: { id: mismatch ? "thread-fallback" : "thread-selected" },
      },
    }) + "\n");
    return;
  }
  if (message.method === "thread/read") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: { thread: { id: message.params.threadId, turns: [{ id: "materialized-turn" }] } },
    }) + "\n");
    return;
  }
  if (message.method === "thread/resume") {
    fs.appendFileSync(
      process.env.IPOLLOWORK_CODEX_REBIND_LOG,
      message.method + ":" + message.params.modelProvider + "/" + message.params.model + "\n",
    );
    const simulateLoadedThread = message.params.model === "deepseek-v4"
      && !fs.existsSync(process.env.IPOLLOWORK_CODEX_REBIND_MARKER);
    if (simulateLoadedThread) fs.writeFileSync(process.env.IPOLLOWORK_CODEX_REBIND_MARKER, "retry");
    const mismatch = simulateLoadedThread || message.params.model === "force-mismatch";
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        modelProvider: mismatch ? "ipollowork-openai" : message.params.modelProvider,
        model: mismatch ? "gpt-fallback" : message.params.model,
        thread: {
          id: message.params.threadId,
        },
      },
    }) + "\n");
    if (!mismatch && message.params.model === "deepseek-v4") {
      process.stdout.write(JSON.stringify({
        method: "test/modelRebound",
        params: { threadId: message.params.threadId, model: message.params.model },
      }) + "\n");
    }
    return;
  }
});
`, "utf8");
    const previousCli = process.env.IPOLLOWORK_CODEX_CLI;
    const previousMarker = process.env.IPOLLOWORK_CODEX_REBIND_MARKER;
    const previousLog = process.env.IPOLLOWORK_CODEX_REBIND_LOG;
    process.env.IPOLLOWORK_CODEX_CLI = fixturePath;
    process.env.IPOLLOWORK_CODEX_REBIND_MARKER = rebindMarkerPath;
    process.env.IPOLLOWORK_CODEX_REBIND_LOG = rebindLogPath;
    const runtime = new CodexHarnessRuntime({
      config,
      env: new EnvService({ path: join(root, "env.json") }),
      workspace: {
        id: "codex-resume-cache",
        name: "Codex resume cache",
        path: root,
        preset: "starter",
        workspaceType: "local",
        engineId: "codex-harness",
      },
    });

    try {
      const started = await runtime.startThread<{
        thread: { id: string };
        modelProvider: string;
        model: string;
      }>({
        cwd: root,
        modelProvider: "ipollowork-deepseek",
        model: "deepseek-v4",
        allowProviderModelFallback: false,
      });
      expect(started).toMatchObject({
        thread: { id: "thread-selected" },
        modelProvider: "ipollowork-deepseek",
        model: "deepseek-v4",
      });
      await runtime.resumeThread({
        threadId: "thread-1",
        cwd: root,
        modelProvider: "ipollowork-openai",
        model: "gpt-5.6",
      });
      await runtime.resumeThread({
        threadId: "thread-1",
        cwd: root,
        modelProvider: "ipollowork-openai",
        model: "gpt-5.6",
      });
      await runtime.resumeThread({
        threadId: "thread-1",
        cwd: root,
        modelProvider: "ipollowork-openai",
        model: "gpt-5.6-mini",
      });

      const eventAbort = new AbortController();
      const events = await runtime.events(eventAbort.signal);
      const eventReader = events.body?.getReader();
      if (!eventReader) throw new Error("Codex event stream was not created");
      await runtime.resumeThread({
        threadId: "thread-1",
        cwd: root,
        modelProvider: "ipollowork-deepseek",
        model: "deepseek-v4",
      });
      const reboundEvent = await Promise.race([
        eventReader.read(),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("Timed out waiting for rebound event")), 2_000);
        }),
      ]);
      expect(new TextDecoder().decode(reboundEvent.value)).toContain('"method":"test/modelRebound"');
      eventAbort.abort();
      expect((await readFile(rebindLogPath, "utf8")).trim().split("\n")).toEqual([
        "thread/start:ipollowork-deepseek/deepseek-v4",
        "thread/start:ipollowork-deepseek/deepseek-v4",
        "thread/resume:ipollowork-openai/gpt-5.6",
        "thread/resume:ipollowork-openai/gpt-5.6-mini",
        "thread/resume:ipollowork-deepseek/deepseek-v4",
        "thread/resume:ipollowork-deepseek/deepseek-v4",
      ]);

      let mismatchError: unknown;
      try {
        await runtime.resumeThread({
          threadId: "thread-1",
          cwd: root,
          modelProvider: "ipollowork-deepseek",
          model: "force-mismatch",
        });
      } catch (error) {
        mismatchError = error;
      }
      expect(mismatchError).toBeInstanceOf(CodexHarnessModelSelectionError);
      expect((await readFile(rebindLogPath, "utf8")).trim().split("\n").slice(-2)).toEqual([
        "thread/resume:ipollowork-deepseek/force-mismatch",
        "thread/resume:ipollowork-deepseek/force-mismatch",
      ]);
    } finally {
      await runtime.close();
      if (previousCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
      else process.env.IPOLLOWORK_CODEX_CLI = previousCli;
      if (previousMarker === undefined) delete process.env.IPOLLOWORK_CODEX_REBIND_MARKER;
      else process.env.IPOLLOWORK_CODEX_REBIND_MARKER = previousMarker;
      if (previousLog === undefined) delete process.env.IPOLLOWORK_CODEX_REBIND_LOG;
      else process.env.IPOLLOWORK_CODEX_REBIND_LOG = previousLog;
    }
  });

  test("replaces an unmaterialized empty thread when its provider changes", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const fixturePath = join(root, "codex-empty-thread-rebind-fixture.js");
    const logPath = join(root, "codex-empty-thread-rebind-log");
    await writeFile(fixturePath, String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const log = (value) => fs.appendFileSync(process.env.IPOLLOWORK_CODEX_EMPTY_REBIND_LOG, value + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
    return;
  }
  log(message.method);
  if (message.method === "thread/resume") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        modelProvider: "ipollowork-opencode",
        model: "big-pickle",
        thread: { id: message.params.threadId },
      },
    }) + "\n");
    return;
  }
  if (message.method === "thread/read" && message.params.includeTurns) {
    process.stdout.write(JSON.stringify({
      id: message.id,
      error: {
        code: -32602,
        message: "thread empty-old is not materialized yet; includeTurns is unavailable before first user message",
      },
    }) + "\n");
    return;
  }
  if (message.method === "thread/read") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: { thread: { id: "empty-old", name: "恒生银行演示" } },
    }) + "\n");
    return;
  }
  if (message.method === "thread/start") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        modelProvider: message.params.modelProvider,
        model: message.params.model,
        thread: { id: "empty-replacement" },
      },
    }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\n");
});
`, "utf8");
    const previousCli = process.env.IPOLLOWORK_CODEX_CLI;
    const previousLog = process.env.IPOLLOWORK_CODEX_EMPTY_REBIND_LOG;
    process.env.IPOLLOWORK_CODEX_CLI = fixturePath;
    process.env.IPOLLOWORK_CODEX_EMPTY_REBIND_LOG = logPath;
    const runtime = new CodexHarnessRuntime({
      config,
      env: new EnvService({ path: join(root, "env.json") }),
      workspace: {
        id: "codex-empty-rebind",
        name: "Codex empty rebind",
        path: root,
        preset: "starter",
        workspaceType: "local",
        engineId: "codex-harness",
      },
    });

    try {
      await expect(runtime.resumeThread({
        threadId: "empty-old",
        cwd: root,
        modelProvider: "ipollowork-deepseek-official",
        model: "deepseek-v4-flash",
      })).resolves.toMatchObject({
        modelProvider: "ipollowork-deepseek-official",
        model: "deepseek-v4-flash",
        thread: { id: "empty-replacement" },
      });
      expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual([
        "initialized",
        "thread/resume",
        "thread/read",
        "thread/read",
        "thread/start",
        "thread/name/set",
        "thread/delete",
      ]);
    } finally {
      await runtime.close();
      if (previousCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
      else process.env.IPOLLOWORK_CODEX_CLI = previousCli;
      if (previousLog === undefined) delete process.env.IPOLLOWORK_CODEX_EMPTY_REBIND_LOG;
      else process.env.IPOLLOWORK_CODEX_EMPTY_REBIND_LOG = previousLog;
    }
  });

  test("lists the workspace-owned Codex home without an unreliable cwd filter", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const fixturePath = join(root, "codex-thread-list-fixture.js");
    await writeFile(fixturePath, String.raw`
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
    return;
  }
  if (message.method === "thread/list") {
    if (Object.prototype.hasOwnProperty.call(message.params, "cwd")) {
      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32602, message: "cwd filter rejected" } }) + "\n");
      return;
    }
    if (JSON.stringify(message.params.modelProviders) !== "[]") {
      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32602, message: "provider filter not disabled" } }) + "\n");
      return;
    }
    if (JSON.stringify(message.params.sourceKinds) !== JSON.stringify(["cli", "vscode"])) {
      process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32602, message: "interactive sources not requested" } }) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        data: message.params.archived ? [] : [{ id: "thread-1", preview: "Fast task", updatedAt: 42 }],
        nextCursor: null,
      },
    }) + "\n");
  }
});
`, "utf8");
    const previousCli = process.env.IPOLLOWORK_CODEX_CLI;
    process.env.IPOLLOWORK_CODEX_CLI = fixturePath;
    const workspace: WorkspaceInfo = {
      id: "codex-thread-list",
      name: "Codex thread list",
      path: root,
      preset: "starter",
      workspaceType: "local",
      engineId: "codex-harness",
    };
    const runtime = new CodexHarnessRuntime({
      config,
      env: new EnvService({ path: join(root, "env.json") }),
      workspace,
    });

    try {
      await expect(listCodexHarnessSessions(runtime, workspace, { limit: 200 })).resolves.toEqual([
        expect.objectContaining({ id: "thread-1", title: "Fast task", directory: root }),
      ]);
    } finally {
      await runtime.close();
      if (previousCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
      else process.env.IPOLLOWORK_CODEX_CLI = previousCli;
    }
  });

  test("reads an unmaterialized Codex thread as an empty task before its first user message", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const fixturePath = join(root, "codex-unmaterialized-thread-fixture.js");
    await writeFile(fixturePath, String.raw`
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
    return;
  }
  if (message.method === "thread/read" && message.params.includeTurns) {
    process.stdout.write(JSON.stringify({
      id: message.id,
      error: {
        code: -32602,
        message: "thread thread-fresh is not materialized yet; includeTurns is unavailable before first user message",
      },
    }) + "\n");
    return;
  }
  if (message.method === "thread/read") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: { thread: { id: "thread-fresh", name: "New conversation", cwd: message.params.cwd } },
    }) + "\n");
  }
});
`, "utf8");
    const previousCli = process.env.IPOLLOWORK_CODEX_CLI;
    process.env.IPOLLOWORK_CODEX_CLI = fixturePath;
    const workspace: WorkspaceInfo = {
      id: "codex-unmaterialized-thread",
      name: "Codex unmaterialized thread",
      path: root,
      preset: "starter",
      workspaceType: "local",
      engineId: "codex-harness",
    };
    const runtime = new CodexHarnessRuntime({
      config,
      env: new EnvService({ path: join(root, "env.json") }),
      workspace,
    });

    try {
      await expect(readCodexHarnessSnapshot(runtime, "thread-fresh")).resolves.toEqual({
        session: expect.objectContaining({ id: "thread-fresh", title: "New conversation" }),
        messages: [],
        todos: [],
        status: { type: "idle" },
      });
    } finally {
      await runtime.close();
      if (previousCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
      else process.env.IPOLLOWORK_CODEX_CLI = previousCli;
    }
  });

  test("does not expose an unconfigured Codex OAuth account", async () => {
    const config = await testConfig();
    const providers = await codexHarnessProviders({
      config,
      records: [],
      openAiCodexOAuth: {
        accessToken: "oauth-access-token",
        accountId: "account-1",
      },
      catalog: new Map([
        [
          "opencode",
          {
            name: "iPolloWork Built-in Models",
            models: [
              { id: "big-pickle", name: "Big Pickle" },
              { id: "gpt-paid", name: "Paid GPT" },
            ],
          },
        ],
        ["openai", { name: "OpenAI", models: [{ id: "gpt-5.5" }] }],
      ]),
    });

    expect(providers.map((provider) => provider.id)).toEqual(["opencode"]);
    expect(providers[0]?.models.map((model) => model.id)).toEqual(["big-pickle"]);
  });

  test("namespaces configured providers instead of overriding Codex built-ins", () => {
    const config = codexHarnessConfig({
      providers: [{
        id: "openai",
        name: "OpenAI",
        api: "openai-responses",
        baseURL: "https://api.openai.com/v1",
        apiKey: "sk-openai",
        models: [{ id: "gpt-5.4" }],
      }],
      mcp: {},
    });

    expect(codexHarnessRuntimeProviderId("openai")).toBe("ipollowork-openai");
    expect(config).toContain("[features]");
    expect(config).toContain("plugins = false");
    expect(config).toContain('[model_providers."ipollowork-openai"]');
    expect(config).not.toContain('[model_providers."openai"]');
    expect(config).toContain('env_key = "IPOLLOWORK_CODEX_PROVIDER_IPOLLOWORK_OPENAI_API_KEY"');
  });

  test("mounts the shared plugin host as a scoped Codex MCP server", async () => {
    const config = await testConfig();
    config.port = 43127;
    const workspace: WorkspaceInfo = {
      id: "codex plugins/one",
      name: "Codex plugins",
      path: config.authorizedRoots[0]!,
      preset: "starter",
      workspaceType: "local",
      engineId: "codex-harness",
    };
    const generated = codexHarnessConfig({
      providers: [],
      mcp: { ipollowork: codexHarnessHostMcp(config, workspace) },
    });

    expect(generated).toContain('[mcp_servers."ipollowork"]');
    expect(generated).toContain('url = "http://127.0.0.1:43127/engine-tools/mcp?workspaceId=codex%20plugins%2Fone"');
    expect(generated).toContain('http_headers = { "Authorization" = "Bearer test" }');
  });

  test("keeps configured models authoritative over Codex's native directory", () => {
    const result = projectCodexHarnessProviderList([{
      id: "openai",
      name: "OpenAI",
      api: "openai-responses",
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-openai",
      models: [
        { id: "gpt-configured", name: "Configured GPT" },
        { id: "gpt-not-supported", name: "Unsupported GPT" },
      ],
    }], [
      {
        model: "gpt-configured",
        displayName: "Native configured GPT",
        inputModalities: ["text", "image"],
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
      { model: "gpt-not-configured", displayName: "Unconfigured GPT" },
    ]);

    expect(Object.keys(result.all[0]?.models ?? {})).toEqual([
      "gpt-configured",
      "gpt-not-supported",
    ]);
    expect(result.all[0]?.models["gpt-configured"]).toMatchObject({
      name: "Configured GPT",
      capabilities: { attachment: true, reasoning: true },
      variants: { high: { name: "high" } },
    });
    expect(result.default).toEqual({ openai: "gpt-configured" });
  });

  test("projects every configured provider protocol and public built-in models", async () => {
    const config = await testConfig();
    const records = [
      {
        key: sharedProviderProfileEnvKey("opencode"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "opencode",
          displayName: "iPolloWork Built-in Models",
          api: "openai-responses",
          baseURL: "https://opencode.ai/zen/v1",
          models: [
            { id: "big-pickle", name: "Big Pickle" },
            { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free" },
            { id: "paid-model", name: "Paid model" },
          ],
        }),
      },
      { key: sharedProviderCredentialEnvKey("openai"), value: "sk-openai" },
      {
        key: sharedProviderProfileEnvKey("openai"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "openai",
          displayName: "OpenAI",
          api: "openai-responses",
          baseURL: "https://api.openai.com/v1",
          models: [{ id: "gpt-5.4", name: "GPT 5.4" }],
        }),
      },
      { key: sharedProviderCredentialEnvKey("chat-only"), value: "chat-key" },
      {
        key: sharedProviderProfileEnvKey("chat-only"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "chat-only",
          displayName: "Chat only",
          api: "openai-completions",
          baseURL: "https://chat.example/v1",
          models: [{ id: "chat-model" }],
        }),
      },
    ];

    const providers = await codexHarnessProviders({ config, records });
    expect(providers.map((provider) => provider.id)).toEqual(["opencode", "openai", "chat-only"]);
    expect(providers[0]?.models.map((model) => model.id)).toEqual(["big-pickle", "deepseek-v4-flash-free"]);
    expect(providers[0]?.upstream).toMatchObject({ protocol: "openai-completions" });
    expect(providers[1]).toMatchObject({
      api: "openai-responses",
      apiKey: "sk-openai",
      models: [{ id: "gpt-5.4" }],
    });
    expect(providers[2]).toMatchObject({
      api: "openai-responses",
      models: [{ id: "chat-model" }],
      upstream: {
        protocol: "openai-completions",
        baseURL: "https://chat.example/v1",
        apiKey: "chat-key",
      },
    });
  });

  test("projects the shared OpenAI OAuth session into Codex Harness", async () => {
    const config = await testConfig();
    const records = [{
      key: sharedProviderProfileEnvKey("openai"),
      value: serializeSharedProviderProfile({
        schemaVersion: 1,
        providerId: "openai",
        displayName: "OpenAI",
        models: [],
      }),
    }];

    const providers = await codexHarnessProviders({
      config,
      records,
      openAiCodexOAuth: {
        accessToken: "oauth-access-token",
        accountId: "account-1",
      },
      catalog: new Map([[
        "openai",
        { name: "OpenAI", models: [{ id: "gpt-5.4", name: "GPT 5.4" }] },
      ]]),
    });

    expect(providers.find((provider) => provider.id === "openai")).toMatchObject({
      name: "OpenAI",
      api: "openai-responses",
      baseURL: "https://chatgpt.com/backend-api/codex",
      apiKey: "oauth-access-token",
      models: [{ id: "gpt-5.4", name: "GPT 5.4" }],
      httpHeaders: { "ChatGPT-Account-Id": "account-1" },
    });
  });

  test("prefers an explicitly configured OpenAI API key over OAuth", async () => {
    const config = await testConfig();
    const records = [
      { key: sharedProviderCredentialEnvKey("openai"), value: "sk-openai" },
      {
        key: sharedProviderProfileEnvKey("openai"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "openai",
          displayName: "OpenAI",
          api: "openai-responses",
          baseURL: "https://api.openai.com/v1",
          models: [{ id: "gpt-5.4" }],
        }),
      },
    ];

    const providers = await codexHarnessProviders({
      config,
      records,
      openAiCodexOAuth: {
        accessToken: "oauth-access-token",
        accountId: "account-1",
      },
    });

    expect(providers.find((provider) => provider.id === "openai")).toMatchObject({
      baseURL: "https://api.openai.com/v1",
      apiKey: "sk-openai",
    });
    expect(providers.find((provider) => provider.id === "openai")?.httpHeaders).toBeUndefined();
  });
});

describe("Codex provider protocol gateway", () => {
  test("translates Responses requests to OpenAI chat completions and back", async () => {
    let receivedPath = "";
    let receivedAuthorization = "";
    const receivedBodies: Record<string, unknown>[] = [];
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        receivedPath = request.url ?? "";
        receivedAuthorization = request.headers.authorization ?? "";
        const received: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (isRecord(received)) receivedBodies.push(received);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: receivedBodies.length === 1 ? "I will use the tool." : "Second turn completed.",
              ...(receivedBodies.length === 1
                ? {
                    reasoning_content: "I considered the previous context.",
                    tool_calls: [{
                      id: "call_1",
                      type: "function",
                      function: { name: "lookup", arguments: "{\"query\":\"hello\"}" },
                    }, {
                      id: "call_2",
                      type: "function",
                      function: { name: "lookup", arguments: "{\"query\":\"world\"}" },
                    }],
                  }
                : {}),
            },
          }],
          usage: { prompt_tokens: 4, completion_tokens: 5 },
        }));
      });
    });
    servers.push(upstream);
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => resolve());
    });
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Mock provider failed to bind");

    const gateway = new CodexProviderGateway();
    try {
      const routes = await gateway.configure([{
        providerId: "chat-only",
        protocol: "openai-completions",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "upstream-key",
      }]);
      const route = routes.get("chat-only");
      if (!route) throw new Error("Gateway route was not created");
      const response = await fetch(`${route.baseURL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${route.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "chat-model",
          instructions: "Be concise",
          input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
          tools: [{
            type: "function",
            name: "lookup",
            description: "Look up information",
            parameters: { type: "object", properties: { query: { type: "string" } } },
          }],
          stream: true,
        }),
      });
      const stream = await response.text();

      expect(response.status).toBe(200);
      expect(receivedPath).toBe("/v1/chat/completions");
      expect(receivedAuthorization).toBe("Bearer upstream-key");
      expect(receivedBodies[0]).toMatchObject({
        model: "chat-model",
        stream: false,
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user" },
        ],
      });
      expect(stream).toContain("response.output_text.delta");
      expect(stream).toContain("response.reasoning_summary_text.delta");
      expect(stream).toContain("response.function_call_arguments.delta");
      expect(stream).toContain("response.function_call_arguments.done");
      expect(stream).toContain("response.completed");
      expect(stream).toContain("I will use the tool.");

      const streamEvents = stream.split("\n").flatMap((line): Record<string, unknown>[] => {
        if (!line.startsWith("data: {") || line === "data: [DONE]") return [];
        const parsed: unknown = JSON.parse(line.slice(6));
        return isRecord(parsed) ? [parsed] : [];
      });
      const argumentDeltas = streamEvents.filter((event) => event.type === "response.function_call_arguments.delta");
      const argumentDone = streamEvents.filter((event) => event.type === "response.function_call_arguments.done");
      expect(argumentDeltas).toHaveLength(2);
      expect(argumentDone).toHaveLength(2);
      expect(argumentDeltas.map((event) => event.delta)).toEqual([
        '{"query":"hello"}',
        '{"query":"world"}',
      ]);
      expect(argumentDone.map((event) => event.arguments)).toEqual([
        '{"query":"hello"}',
        '{"query":"world"}',
      ]);

      const completedLine = stream.split("\n").find((line) => (
        line.startsWith("data: {") && line.includes('"type":"response.completed"')
      ));
      if (!completedLine) throw new Error("Gateway did not emit a completed response");
      const completedEvent: unknown = JSON.parse(completedLine.slice(6));
      const completedResponse = isRecord(completedEvent) && isRecord(completedEvent.response)
        ? completedEvent.response
        : null;
      const priorOutput = completedResponse && Array.isArray(completedResponse.output)
        ? completedResponse.output.filter(isRecord)
        : [];
      const followUp = await fetch(`${route.baseURL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${route.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "chat-model",
          input: [
            ...priorOutput,
            { type: "function_call_output", call_id: "call_1", output: "hello result" },
            { type: "function_call_output", call_id: "call_2", output: "world result" },
            { role: "user", content: [{ type: "input_text", text: "Continue" }] },
          ],
          stream: true,
        }),
      });
      expect(followUp.status).toBe(200);
      await followUp.text();
      expect(receivedBodies[1]).toMatchObject({
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "I will use the tool." }],
            reasoning_content: "I considered the previous context.",
            tool_calls: [
              { id: "call_1", function: { name: "lookup" } },
              { id: "call_2", function: { name: "lookup" } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "hello result" },
          { role: "tool", tool_call_id: "call_2", content: "world result" },
          { role: "user" },
        ],
      });

      const interruptedFollowUp = await fetch(`${route.baseURL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${route.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "chat-model",
          input: [
            ...priorOutput,
            { type: "function_call_output", call_id: "call_1", output: "hello result" },
            { role: "user", content: [{ type: "input_text", text: "Recover" }] },
          ],
          stream: true,
        }),
      });
      expect(interruptedFollowUp.status).toBe(200);
      await interruptedFollowUp.text();
      expect(receivedBodies[2]).toMatchObject({
        messages: [
          {
            role: "assistant",
            tool_calls: [{ id: "call_1" }],
          },
          { role: "tool", tool_call_id: "call_1" },
          { role: "user" },
        ],
      });
    } finally {
      await gateway.close();
    }
  });
});
