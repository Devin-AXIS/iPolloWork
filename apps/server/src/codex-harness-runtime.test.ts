import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  serializeSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderDisconnectedEnvKey,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";

import {
  codexHarnessConfig,
  codexHarnessHostMcp,
  codexHarnessProviderDirectory,
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
import { deepSeekHarnessProviderCredentials } from "./deepseek-harness-runtime.js";
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
      { providerID: "opencode", modelID: "nemotron-3-ultra-free" },
    )).toEqual({
      "ipollowork.runtime": {
        value: "Long-running local process rule:\nRuntime guidance",
        kind: "application",
      },
      "ipollowork.plugins": {
        value: "Plugin system guidance\n\nPlugin user guidance",
        kind: "application",
      },
      "ipollowork.model": {
        value: 'Authoritative iPolloWork runtime model selection: providerID="opencode", modelID="nemotron-3-ultra-free". When asked which model is running, report this selection instead of inferring identity from Codex host instructions or earlier assistant messages.',
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

  test("unloads a previously read thread before changing its model provider", async () => {
    const config = await testConfig();
    if (!config.configPath) throw new Error("Test config path is required");
    const root = dirname(config.configPath);
    const fixturePath = join(root, "codex-provider-change-fixture.js");
    const logPath = join(root, "codex-provider-change-log");
    await writeFile(fixturePath, String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const log = (value) => fs.appendFileSync(process.env.IPOLLOWORK_CODEX_PROVIDER_CHANGE_LOG, value + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    log("initialize");
    process.stdout.write(JSON.stringify({ id: message.id, result: { ready: true } }) + "\n");
    return;
  }
  if (message.method === "thread/read") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        thread: {
          id: message.params.threadId,
          modelProvider: "ipollowork-openai",
          model: "gpt-5.6",
        },
      },
    }) + "\n");
    return;
  }
  if (message.method === "thread/resume") {
    log("resume:" + message.params.modelProvider + "/" + message.params.model);
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: {
        modelProvider: message.params.modelProvider,
        model: message.params.model,
        thread: { id: message.params.threadId },
      },
    }) + "\n");
  }
});
`, "utf8");
    const previousCli = process.env.IPOLLOWORK_CODEX_CLI;
    const previousLog = process.env.IPOLLOWORK_CODEX_PROVIDER_CHANGE_LOG;
    process.env.IPOLLOWORK_CODEX_CLI = fixturePath;
    process.env.IPOLLOWORK_CODEX_PROVIDER_CHANGE_LOG = logPath;
    const runtime = new CodexHarnessRuntime({
      config,
      env: new EnvService({ path: join(root, "env.json") }),
      workspace: {
        id: "codex-provider-change",
        name: "Codex provider change",
        path: root,
        preset: "starter",
        workspaceType: "local",
        engineId: "codex-harness",
      },
    });

    try {
      await runtime.call("thread/read", { threadId: "thread-1", includeTurns: false });
      await runtime.resumeThread({
        threadId: "thread-1",
        cwd: root,
        modelProvider: "ipollowork-opencode",
        model: "nemotron-3-ultra-free",
      });

      expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual([
        "initialize",
        "initialize",
        "resume:ipollowork-opencode/nemotron-3-ultra-free",
      ]);
    } finally {
      await runtime.close();
      if (previousCli === undefined) delete process.env.IPOLLOWORK_CODEX_CLI;
      else process.env.IPOLLOWORK_CODEX_CLI = previousCli;
      if (previousLog === undefined) delete process.env.IPOLLOWORK_CODEX_PROVIDER_CHANGE_LOG;
      else process.env.IPOLLOWORK_CODEX_PROVIDER_CHANGE_LOG = previousLog;
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

  test("replaces unmaterialized empty threads reported before or during resume", async () => {
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
    if (message.params.threadId === "missing-rollout") {
      process.stdout.write(JSON.stringify({
        id: message.id,
        error: {
          code: -32602,
          message: "no rollout found for thread id missing-rollout",
        },
      }) + "\n");
      return;
    }
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
      result: { thread: { id: message.params.threadId, name: "恒生银行演示" } },
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
      await expect(runtime.resumeThread({
        threadId: "missing-rollout",
        cwd: root,
        modelProvider: "ipollowork-opencode",
        model: "nemotron-3.5-lightning-free",
      })).resolves.toMatchObject({
        modelProvider: "ipollowork-opencode",
        model: "nemotron-3.5-lightning-free",
        thread: { id: "empty-replacement" },
      });
      expect((await readFile(logPath, "utf8")).trim().split("\n").slice(-5)).toEqual([
        "thread/resume",
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
    expect(providers[0]?.models.map((model) => model.id)).toEqual([
      "big-pickle",
      "hy3-free",
      "mimo-v2.5-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "x-preview-f-free",
    ]);
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

  test("keeps supported account providers visible when their credentials need reconnecting", () => {
    const records = [
      {
        key: sharedProviderProfileEnvKey("openai"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "openai",
          displayName: "OpenAI",
          models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
        }),
      },
      {
        key: sharedProviderProfileEnvKey("acme-compatible"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "acme-compatible",
          displayName: "Acme Compatible",
          api: "openai-completions",
          baseURL: "https://models.acme.test/v1",
          models: [{ id: "acme-chat", name: "Acme Chat" }],
        }),
      },
    ];
    const directory = codexHarnessProviderDirectory({
      records,
      providers: [{
        id: "opencode",
        name: "iPolloWork Built-in Models",
        api: "openai-responses",
        baseURL: "https://opencode.ai/zen/v1",
        apiKey: "public",
        models: [{ id: "big-pickle", name: "Big Pickle" }],
      }],
    });
    const result = projectCodexHarnessProviderList(
      directory.all,
      [],
      directory.connected,
    );

    expect(directory.all.map((provider) => provider.id)).toEqual([
      "opencode",
      "openai",
      "acme-compatible",
    ]);
    expect(result.connected).toEqual(["opencode"]);
    expect(Object.keys(result.all.find((provider) => provider.id === "openai")?.models ?? {}))
      .toEqual(["gpt-5.6-sol"]);
  });

  test("removes an explicitly disconnected provider from the Codex directory", async () => {
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
          models: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
        }),
      },
      { key: sharedProviderDisconnectedEnvKey("openai"), value: "1" },
    ];
    const providers = await codexHarnessProviders({
      config,
      records,
      openAiCodexOAuth: { accessToken: "official-token" },
    });
    const directory = codexHarnessProviderDirectory({ records, providers });

    expect(providers.map((provider) => provider.id)).not.toContain("openai");
    expect(directory.all.map((provider) => provider.id)).not.toContain("openai");
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
            { id: "north-mini-code-free", name: "North Mini Code Free" },
            { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free" },
            { id: "laguna-s-2.1-free", name: "Laguna S 2.1 Free" },
            { id: "ling-3.0-flash-free", name: "Ling 3.0 Flash Free" },
            { id: "big-pickle", name: "Big Pickle" },
            { id: "x-preview-f-free", name: "Ox Alpha Free" },
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
    expect(providers[0]?.models.map((model) => model.id)).toEqual([
      "big-pickle",
      "hy3-free",
      "mimo-v2.5-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "x-preview-f-free",
    ]);
    expect(providers[0]?.models.find((model) => model.id === "x-preview-f-free"))
      .toEqual({ id: "x-preview-f-free", name: "Ox Alpha Free" });
    expect(providers[0]?.upstream).toMatchObject({ protocol: "openai-completions" });
    expect(providers[0]?.upstream?.httpHeaders).toEqual({ "User-Agent": "opencode/ipollowork" });
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

    // The account record is the source of truth. A DSH binary (downloaded or
    // official) consumes the same provider IDs and secrets without a second
    // engine-specific connection.
    const deepSeekCredentials = deepSeekHarnessProviderCredentials(records);
    expect(deepSeekCredentials.get("openai")?.apiKey).toBe("sk-openai");
    expect(deepSeekCredentials.get("chat-only")?.apiKey).toBe("chat-key");
  });

  test("routes native account providers that were saved before portable metadata existed", async () => {
    const config = await testConfig();
    const providerCases = [
      ["deepseek-official", "DeepSeek", "deepseek-v4-flash"],
      ["anthropic", "Anthropic", "claude-sonnet"],
      ["google", "Google", "gemini-pro"],
      ["xai", "xAI", "grok-code"],
    ] as const;
    const records = providerCases.flatMap(([providerId, displayName, modelId]) => [
      { key: sharedProviderCredentialEnvKey(providerId), value: `${providerId}-key` },
      {
        key: sharedProviderProfileEnvKey(providerId),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId,
          displayName,
          models: [{ id: modelId }],
        }),
      },
    ]);
    records.push(
      { key: sharedProviderCredentialEnvKey("dynamic-cloud"), value: "dynamic-key" },
      {
        key: sharedProviderProfileEnvKey("dynamic-cloud"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "dynamic-cloud",
          displayName: "Dynamic cloud",
          models: [{ id: "dynamic-model" }],
        }),
      },
    );

    const providers = await codexHarnessProviders({ config, records });
    expect(providers.map((provider) => provider.id)).toEqual([
      "opencode",
      "deepseek-official",
      "anthropic",
      "google",
      "xai",
    ]);
    expect(providers.find((provider) => provider.id === "deepseek-official")?.upstream)
      .toMatchObject({ protocol: "openai-completions", baseURL: "https://api.deepseek.com" });
    expect(providers.find((provider) => provider.id === "anthropic")?.upstream)
      .toMatchObject({ protocol: "anthropic-messages", baseURL: "https://api.anthropic.com" });
    expect(providers.find((provider) => provider.id === "google")?.upstream)
      .toMatchObject({
        protocol: "openai-completions",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      });
    expect(providers.find((provider) => provider.id === "xai")?.upstream).toBeUndefined();
    expect(providers.some((provider) => provider.id === "dynamic-cloud")).toBe(false);
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
    let receivedUserAgent = "";
    let receivedOpenCodeProject = "";
    let receivedOpenCodeSession = "";
    let receivedOpenCodeRequest = "";
    let receivedOpenCodeClient = "";
    const receivedBodies: Record<string, unknown>[] = [];
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        receivedPath = request.url ?? "";
        receivedAuthorization = request.headers.authorization ?? "";
        receivedUserAgent = request.headers["user-agent"] ?? "";
        receivedOpenCodeProject = String(request.headers["x-opencode-project"] ?? "");
        receivedOpenCodeSession = String(request.headers["x-opencode-session"] ?? "");
        receivedOpenCodeRequest = String(request.headers["x-opencode-request"] ?? "");
        receivedOpenCodeClient = String(request.headers["x-opencode-client"] ?? "");
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
        providerId: "opencode",
        protocol: "openai-completions",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "upstream-key",
        httpHeaders: {
          "User-Agent": "opencode/ipollowork",
          "x-opencode-project": "workspace-test",
        },
      }]);
      const route = routes.get("opencode");
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
      expect(receivedUserAgent).toBe("opencode/ipollowork");
      expect(receivedOpenCodeProject).toBe("workspace-test");
      expect(receivedOpenCodeSession).toMatch(/^ses_[0-9a-f]{24}$/u);
      expect(receivedOpenCodeRequest).toMatch(/^msg_[0-9a-f]{24}$/u);
      expect(receivedOpenCodeClient).toBe("ipollowork");
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

  test("returns prompt length failures as non-retryable invalid requests", async () => {
    const upstream = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({
          error: { message: "[1261] Prompt exceeds max length" },
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
        providerId: "opencode",
        protocol: "openai-completions",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "upstream-key",
      }]);
      const route = routes.get("opencode");
      if (!route) throw new Error("Gateway route was not created");

      const response = await fetch(`${route.baseURL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${route.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "small-context-model",
          input: [{ role: "user", content: [{ type: "input_text", text: "oversized" }] }],
          stream: true,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toMatchObject({
        error: {
          message: "[1261] Prompt exceeds max length",
          type: "invalid_request_error",
        },
      });
    } finally {
      await gateway.close();
    }
  });

  test("keeps Ox Alpha on the public Zen route without session affinity", async () => {
    let receivedSession: string | undefined;
    let receivedModel = "";
    let receivedTools = false;
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        receivedSession = request.headers["x-opencode-session"] as string | undefined;
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (isRecord(body)) {
          receivedModel = String(body.model ?? "");
          receivedTools = Array.isArray(body.tools) && body.tools.length > 0;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: "OK" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
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
        providerId: "opencode",
        protocol: "openai-completions",
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        apiKey: "public",
      }]);
      const route = routes.get("opencode");
      if (!route) throw new Error("Gateway route was not created");
      const response = await fetch(`${route.baseURL}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${route.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "x-preview-f-free",
          input: [{ role: "user", content: [{ type: "input_text", text: "Reply exactly OK" }] }],
          tools: [{
            type: "function",
            name: "noop",
            parameters: { type: "object", properties: {} },
          }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("OK");
      expect(receivedModel).toBe("x-preview-f-free");
      expect(receivedTools).toBe(true);
      expect(receivedSession).toBeUndefined();
    } finally {
      await gateway.close();
    }
  });

  test("targets the versioned Anthropic messages endpoint", async () => {
    const receivedPaths: string[] = [];
    let receivedApiKey = "";
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        receivedPaths.push(request.url ?? "");
        receivedApiKey = String(request.headers["x-api-key"] ?? "");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          content: [{ type: "text", text: "Anthropic-compatible response" }],
          usage: { input_tokens: 3, output_tokens: 4 },
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
      const routes = await gateway.configure([
        {
          providerId: "anthropic-root",
          protocol: "anthropic-messages",
          baseURL: `http://127.0.0.1:${address.port}/anthropic`,
          apiKey: "anthropic-key",
        },
        {
          providerId: "anthropic-versioned",
          protocol: "anthropic-messages",
          baseURL: `http://127.0.0.1:${address.port}/already/v1`,
          apiKey: "anthropic-key",
        },
      ]);
      const streams: string[] = [];
      for (const providerId of ["anthropic-root", "anthropic-versioned"]) {
        const route = routes.get(providerId);
        if (!route) throw new Error("Gateway route was not created");
        const response = await fetch(`${route.baseURL}/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${route.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-compatible",
            input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
            stream: true,
          }),
        });
        expect(response.status).toBe(200);
        streams.push(await response.text());
      }

      expect(receivedPaths).toEqual(["/anthropic/v1/messages", "/already/v1/messages"]);
      expect(receivedApiKey).toBe("anthropic-key");
      expect(streams.every((stream) => stream.includes("Anthropic-compatible response"))).toBe(true);
      expect(streams.every((stream) => stream.includes("response.completed"))).toBe(true);
    } finally {
      await gateway.close();
    }
  });
});
