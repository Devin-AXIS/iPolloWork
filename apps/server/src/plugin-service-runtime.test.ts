import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EnvService } from "./env-file.js";
import { callExperimentalExtensionAction, listExperimentalExtensionActions } from "./extensions/index.js";
import {
  bindPluginAuthorizationRuntime,
  pluginAuthorizationStore,
  pluginInstallationId,
  savePluginSecretAuthorization,
} from "./plugin-platform-runtime.js";
import { installPluginPackage } from "./plugin-package-lifecycle.js";
import {
  callPluginServiceAction,
  deletePluginServiceData,
  disposeAllPluginServices,
  disposePluginServices,
  listPluginServiceActions,
  pluginServiceDataDirectory,
} from "./plugin-service-runtime.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_plugin_service";
const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;
const previousGitHubApiBase = process.env.IPOLLOWORK_GITHUB_API_BASE;
const previousWeChatOfficialApiBase = process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE;
const originalFetch = globalThis.fetch;

function config(root: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function writeServicePackage(root: string, id: string): Promise<void> {
  const servicePath = `service/${id}.ts`;
  await mkdir(join(root, "service"), { recursive: true });
  await writeFile(join(root, servicePath), `
export default async function createService(runtime) {
  const counterKey = "ipollowork-test-service-instance:${id}";
  const instance = Number(Reflect.get(globalThis, counterKey) ?? 0) + 1;
  Reflect.set(globalThis, counterKey, instance);
  return {
    dispose: async () => Reflect.set(globalThis, counterKey + ":disposed", instance),
    actions: {
      status: async () => {
        const credential = await runtime.authorization.getCredential("api-key");
        return { connected: Boolean(credential?.apiKey), keyPrefix: credential?.apiKey?.slice(0, 4) ?? null, instance };
      },
    },
  };
}
`, "utf8");
  await writeFile(join(root, "ipollowork.plugin.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    name: id,
    description: "Runtime isolation fixture",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: {
      version: "1.0.0",
      updateId: `fixture/${id}`,
      entrypoints: { service: servicePath },
    },
    authorization: {
      required: true,
      methods: [
        {
          id: "api-key",
          kind: "secret-form",
          label: "API key",
          fields: [{ id: "apiKey", label: "API key", secret: true, required: true }],
        },
        {
          id: "oauth",
          kind: "oauth-pkce",
          label: "OAuth",
          clientId: "fixture-client",
          authorizationUrl: "https://accounts.fixture.example/authorize",
          tokenUrl: "https://accounts.fixture.example/token",
          scopes: [],
        },
      ],
    },
    resources: [{
      type: "local-service",
      id: `${id}-service`,
      path: servicePath,
      requires: ["authorization:api-key"],
      provides: ["action:status"],
      actions: [{
        id: "status",
        title: "Connection status",
        description: "Check the plugin-owned connection.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }],
    }],
  }, null, 2), "utf8");
}

async function writeCapabilityPackage(root: string): Promise<void> {
  await mkdir(join(root, "service"), { recursive: true });
  await writeFile(join(root, "service", "capability.ts"), `
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default async function createService(runtime) {
  return {
    actions: {
      inspect: async (args) => {
        await mkdir(runtime.storage.dataDir, { recursive: true });
        await writeFile(join(runtime.storage.dataDir, "owned.txt"), "owned\\n", "utf8");
        return {
          value: await runtime.environment.get(args.name),
          dataDir: runtime.storage.dataDir,
          workspaceRoot: runtime.workspace.root,
        };
      },
    },
  };
}
`, "utf8");
  await writeFile(join(root, "ipollowork.plugin.json"), JSON.stringify({
    schemaVersion: 1,
    id: "runtime-capability",
    name: "Runtime Capability",
    description: "Runtime capability fixture.",
    source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false },
    package: {
      version: "1.0.0",
      updateId: "fixture/runtime-capability",
      entrypoints: { service: "service/capability.ts" },
    },
    resources: [{
      type: "local-service",
      id: "runtime-capability-service",
      path: "service/capability.ts",
      environment: ["ALLOWED_PLUGIN_KEY"],
      actions: [{
        id: "inspect",
        title: "Inspect",
        description: "Inspect bounded runtime capabilities.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
          additionalProperties: false,
        },
      }],
    }],
  }, null, 2), "utf8");
}

async function git(root: string, args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
}

async function writeFakeHarnessRuntime(root: string): Promise<string> {
  const path = join(root, "fake-dsh-runtime.mjs");
  await writeFile(path, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

let seq = 0;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
const event = (sessionId, type, data) => notify("session.event", { sessionId, event: { type, seq: seq++, time: Date.now(), data } });

createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") {
    send({ jsonrpc: "2.0", id: frame.id, result: { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "test" } } });
    return;
  }
  if (frame.method === "session/prompt") {
    const sessionId = frame.params.sessionId;
    const messageId = "fake-user";
    event(sessionId, "agent/inbox/spliced", { inserted: [{ id: messageId }] });
    notify("session.status", { sessionId, status: "running" });
    writeFileSync(join(process.cwd(), "dsh-output.txt"), "created by isolated DSH\\n");
    event(sessionId, "assistant/message", { message: { content: [{ type: "text", text: "DSH completed the isolated task." }] } });
    notify("session.status", { sessionId, status: "idle" });
    send({ jsonrpc: "2.0", id: frame.id, result: { messageId } });
    return;
  }
  if (frame.method === "shutdown") {
    send({ jsonrpc: "2.0", id: frame.id, result: {} });
    setImmediate(() => process.exit(0));
  }
});
`, "utf8");
  await chmod(path, 0o755);
  return path;
}

async function createFakeRuntimeWheel(root: string) {
  const filename = "deepseek_harness_runtime_bin-0.1.0rc6-py3-none-macosx_14_0_arm64.whl";
  const wheelRoot = join(root, "wheel-root");
  const runtimeDirectory = join(wheelRoot, "deepseek_harness_runtime", "runtime");
  const runtimeName = "dsh-jsonrpc-agent-pkg-macos-arm64";
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(join(runtimeDirectory, runtimeName), "#!/bin/sh\nexit 0\n", "utf8");
  const wheelPath = join(root, filename);
  const child = Bun.spawn(["/usr/bin/zip", "-qr", wheelPath, "deepseek_harness_runtime"], {
    cwd: wheelRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Unable to create fake DSH wheel: ${stderr}`);
  const bytes = await readFile(wheelPath);
  return {
    bytes,
    filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  if (previousGitHubApiBase === undefined) delete process.env.IPOLLOWORK_GITHUB_API_BASE;
  else process.env.IPOLLOWORK_GITHUB_API_BASE = previousGitHubApiBase;
  if (previousWeChatOfficialApiBase === undefined) delete process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE;
  else process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE = previousWeChatOfficialApiBase;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("plugin service runtime", () => {
  test("exposes only declared environment values and removes plugin-owned data", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-plugin-capability-workspace-");
    const packageRoot = await temporaryRoot("ipollowork-plugin-capability-package-");
    const runtimeRoot = await temporaryRoot("ipollowork-plugin-capability-runtime-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(runtimeRoot, "runtime.sqlite");
    await writeCapabilityPackage(packageRoot);
    const serverConfig = config(workspaceRoot);
    const env = new EnvService({ path: join(runtimeRoot, "env.json") });
    await env.upsertMany([
      { key: "ALLOWED_PLUGIN_KEY", value: "allowed-value" },
      { key: "UNDECLARED_PLUGIN_KEY", value: "hidden-value" },
    ]);
    await installPluginPackage({ serverConfig, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });

    const inspected = await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "runtime-capability",
      action: "inspect",
      args: { name: "ALLOWED_PLUGIN_KEY" },
      context: {},
    });
    const dataDir = pluginServiceDataDirectory(serverConfig, WORKSPACE_ID, "runtime-capability");
    expect(inspected).toMatchObject({
      result: { value: "allowed-value", dataDir, workspaceRoot },
    });
    expect(await access(join(dataDir, "owned.txt")).then(() => true)).toBe(true);

    await expect(callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "runtime-capability",
      action: "inspect",
      args: { name: "UNDECLARED_PLUGIN_KEY" },
      context: {},
    })).rejects.toMatchObject({ code: "plugin_environment_denied" });

    await disposePluginServices(serverConfig, WORKSPACE_ID, "runtime-capability");
    expect(await access(join(dataDir, "owned.txt")).then(() => true)).toBe(true);
    await deletePluginServiceData(serverConfig, WORKSPACE_ID, "runtime-capability");
    await expect(access(dataDir)).rejects.toThrow();
  });

  test("runs DSH in an isolated Git copy and returns a patch without touching the source", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-dsh-workspace-");
    const runtimeRoot = await temporaryRoot("ipollowork-dsh-runtime-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/deepseek-harness", import.meta.url));
    process.env.IPOLLOWORK_RUNTIME_DB = join(runtimeRoot, "runtime.sqlite");
    await writeFile(join(workspaceRoot, "README.md"), "# DSH fixture\n", "utf8");
    await git(workspaceRoot, ["init"]);
    await git(workspaceRoot, ["add", "README.md"]);
    await git(workspaceRoot, ["-c", "user.name=iPolloWork", "-c", "user.email=test@ipollowork.invalid", "commit", "-m", "fixture"]);
    const runtimePath = await writeFakeHarnessRuntime(runtimeRoot);
    const env = new EnvService({ path: join(runtimeRoot, "env.json") });
    await env.upsertMany([
      { key: "DSH_RUNTIME_BIN", value: runtimePath },
      { key: "DEEPSEEK_API_KEY", value: "test-deepseek-key" },
    ]);
    const serverConfig = config(workspaceRoot);
    await installPluginPackage({ serverConfig, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });

    const capabilities = await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "deepseek-harness",
      action: "capabilities",
      args: {},
      context: { directory: workspaceRoot },
    });
    expect(capabilities).toMatchObject({
      result: {
        available: true,
        runtime: { source: "environment" },
        isolation: { originalWorkspaceWrite: false, uninstallDeletesData: true },
      },
    });

    const started = await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "deepseek-harness",
      action: "start",
      args: { prompt: "Create dsh-output.txt", mode: "code" },
      context: { directory: workspaceRoot },
    });
    const jobId = record(started.result)?.jobId;
    if (typeof jobId !== "string") throw new Error("DSH start did not return a job ID");

    let status: Awaited<ReturnType<typeof callPluginServiceAction>> | null = null;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      status = await callPluginServiceAction({
        config: serverConfig,
        env,
        workspaceId: WORKSPACE_ID,
        pluginId: "deepseek-harness",
        action: "status",
        args: { jobId },
        context: { directory: workspaceRoot },
      });
      if (record(status.result)?.state !== "running") break;
      await Bun.sleep(25);
    }

    expect(status).not.toBeNull();
    expect(status).toMatchObject({
      result: {
        state: "completed",
        result: {
          finalResponse: "DSH completed the isolated task.",
          patchHasMore: false,
        },
      },
    });
    const result = record(record(status?.result)?.result);
    expect(typeof result?.patch === "string" ? result.patch : "").toContain("dsh-output.txt");
    await expect(access(join(workspaceRoot, "dsh-output.txt"))).rejects.toThrow();

    const dataDir = pluginServiceDataDirectory(serverConfig, WORKSPACE_ID, "deepseek-harness");
    expect(await access(join(dataDir, "jobs", jobId, "result.json")).then(() => true)).toBe(true);
    await disposePluginServices(serverConfig, WORKSPACE_ID, "deepseek-harness");
    await deletePluginServiceData(serverConfig, WORKSPACE_ID, "deepseek-harness");
    await expect(access(dataDir)).rejects.toThrow();
  });

  test("installs, activates, and removes a checksum-verified managed DSH runtime", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-dsh-managed-workspace-");
    const runtimeRoot = await temporaryRoot("ipollowork-dsh-managed-runtime-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/deepseek-harness", import.meta.url));
    const wheel = await createFakeRuntimeWheel(runtimeRoot);
    process.env.IPOLLOWORK_RUNTIME_DB = join(runtimeRoot, "runtime.sqlite");
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://files.example.test/runtime.whl") {
        return new Response(wheel.bytes, { headers: { "content-length": String(wheel.bytes.byteLength) } });
      }
      if (url === "https://pypi.org/pypi/deepseek-harness-runtime-bin/0.1.0rc6/json" || url === "https://pypi.org/pypi/deepseek-harness-runtime-bin/json") {
        return Response.json({
          info: { version: "0.1.0rc6" },
          urls: [{
            filename: wheel.filename,
            url: "https://files.example.test/runtime.whl",
            size: wheel.bytes.byteLength,
            digests: { sha256: wheel.sha256 },
          }],
        });
      }
      throw new Error(`Unexpected fetch in managed DSH runtime test: ${url}`);
    }, originalFetch);
    const env = new EnvService({ path: join(runtimeRoot, "env.json") });
    const serverConfig = config(workspaceRoot);
    await installPluginPackage({ serverConfig, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });

    const installed = await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "deepseek-harness",
      action: "runtime_install",
      args: { version: "0.1.0rc6" },
      context: {},
    });
    expect(installed).toMatchObject({
      result: {
        installed: true,
        active: { source: "managed", version: "0.1.0rc6" },
        installedVersions: ["0.1.0rc6"],
      },
    });

    const capabilities = await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "deepseek-harness",
      action: "capabilities",
      args: {},
      context: {},
    });
    expect(capabilities).toMatchObject({
      result: {
        available: true,
        runtime: { source: "managed", version: "0.1.0rc6" },
        runtimeManagement: { managedActiveVersion: "0.1.0rc6", installedVersions: ["0.1.0rc6"] },
      },
    });

    const status = await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "deepseek-harness",
      action: "runtime_status",
      args: {},
      context: {},
    });
    expect(status).toMatchObject({ result: { latestVersion: "0.1.0rc6", updateAvailable: false } });

    await callPluginServiceAction({
      config: serverConfig,
      env,
      workspaceId: WORKSPACE_ID,
      pluginId: "deepseek-harness",
      action: "runtime_remove",
      args: {},
      context: {},
    });
    const dataDir = pluginServiceDataDirectory(serverConfig, WORKSPACE_ID, "deepseek-harness");
    await expect(access(join(dataDir, "runtime"))).rejects.toThrow();
  });

  test("loads the bundled DSH service with the Node ESM runtime", async () => {
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/deepseek-harness", import.meta.url));
    const servicePath = join(packageRoot, "service", "deepseek-harness.mjs");
    const dataDir = await temporaryRoot("ipollowork-dsh-node-service-");
    const script = `
const loaded = await import(${JSON.stringify(pathToFileURL(servicePath).href)});
const service = await loaded.default({
  plugin: { id: "deepseek-harness", version: "0.2.1" },
  authorization: { getCredential: async () => null },
  environment: { get: async () => null },
  storage: { dataDir: ${JSON.stringify(dataDir)} },
  workspace: { root: ${JSON.stringify(packageRoot)} },
});
console.log(JSON.stringify(await service.actions.capabilities()));
await service.dispose();
`;
    const child = Bun.spawn(["node", "--input-type=module", "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      available: false,
      modes: ["standard", "code", "review"],
      isolation: { originalWorkspaceWrite: false, uninstallDeletesData: true },
    });
  });

  test("discovers declared actions and gives a service only its own authorization capability", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-plugin-service-workspace-");
    const alphaRoot = await temporaryRoot("ipollowork-plugin-service-alpha-");
    const betaRoot = await temporaryRoot("ipollowork-plugin-service-beta-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    await writeServicePackage(alphaRoot, "alpha-service");
    await writeServicePackage(betaRoot, "beta-service");
    const serverConfig = config(workspaceRoot);

    for (const packageRoot of [alphaRoot, betaRoot]) {
      await installPluginPackage({ serverConfig, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    }
    await expect(callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "alpha-service",
      action: "status",
      args: {},
      context: {},
    })).rejects.toMatchObject({ code: "plugin_authorization_required" });
    await savePluginSecretAuthorization({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "alpha-service",
      methodId: "api-key",
      accountId: "default",
      values: { apiKey: "alpha-secret" },
    });
    await savePluginSecretAuthorization({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "beta-service",
      methodId: "api-key",
      accountId: "default",
      values: { apiKey: "beta-secret" },
    });

    expect(await listPluginServiceActions(serverConfig, WORKSPACE_ID)).toEqual([
      expect.objectContaining({ extensionId: "alpha-service", action: "status" }),
      expect.objectContaining({ extensionId: "beta-service", action: "status" }),
    ]);
    const firstAlphaCall = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "alpha-service",
      action: "status",
      args: {},
      context: {},
    });
    const secondAlphaCall = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "alpha-service",
      action: "status",
      args: {},
      context: {},
    });
    expect(firstAlphaCall).toMatchObject({ ok: true, extensionId: "alpha-service", result: { connected: true, keyPrefix: "alph", instance: 1 } });
    expect(secondAlphaCall).toMatchObject({ result: { instance: 1 } });

    expect(await listExperimentalExtensionActions(serverConfig, "alpha-service", { directory: workspaceRoot })).toEqual([
      expect.objectContaining({ extensionId: "alpha-service", action: "status" }),
    ]);
    expect(await callExperimentalExtensionAction(serverConfig, new EnvService({ path: join(workspaceRoot, "unused-env.json") }), {
      extensionId: "beta-service",
      action: "status",
      args: {},
      context: { directory: workspaceRoot },
    })).toMatchObject({ ok: true, extensionId: "beta-service", result: { connected: true, keyPrefix: "beta" } });

    const alphaStore = await pluginAuthorizationStore(serverConfig, WORKSPACE_ID);
    await alphaStore.saveCredential({
      installationId: pluginInstallationId(WORKSPACE_ID, "alpha-service"),
      accountId: "default",
      methodId: "oauth",
      values: { accessToken: "expired-token", refreshToken: "refresh-token", expiresAt: String(Date.now() - 1) },
      secretFields: ["accessToken", "refreshToken"],
    });
    let refreshRequests = 0;
    const authorization = await bindPluginAuthorizationRuntime(serverConfig, WORKSPACE_ID, "alpha-service", {
      fetcher: async () => {
        refreshRequests += 1;
        return new Response(JSON.stringify({ access_token: "fresh-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const [freshA, freshB] = await Promise.all([
      authorization.getCredential("oauth"),
      authorization.getCredential("oauth"),
    ]);
    expect(freshA?.accessToken).toBe("fresh-token");
    expect(freshB?.accessToken).toBe("fresh-token");
    expect(refreshRequests).toBe(1);

    expect(await disposePluginServices(serverConfig, WORKSPACE_ID, "alpha-service")).toBe(1);
    expect(Reflect.get(globalThis, "ipollowork-test-service-instance:alpha-service:disposed")).toBe(1);
    expect(await disposeAllPluginServices(serverConfig)).toBe(1);
    expect(Reflect.get(globalThis, "ipollowork-test-service-instance:beta-service:disposed")).toBe(1);
  });

  test("runs the bundled GitHub service through fixed actions without exposing its token", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-github-service-workspace-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/github", import.meta.url));
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    process.env.IPOLLOWORK_GITHUB_API_BASE = "https://api.github.test";
    const serverConfig = config(workspaceRoot);
    const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      requests.push({ url, method, authorization: headers.get("authorization") });
      if (url.endsWith("/user")) {
        return Response.json({ login: "octocat", id: 1, avatar_url: "https://avatars.example/octocat", html_url: "https://github.com/octocat" });
      }
      if (url.includes("/repos/acme/demo/pulls?") && method === "GET") {
        return Response.json([{ number: 7, title: "Ship GitHub plugin", state: "open", draft: true, user: { login: "octocat" } }]);
      }
      if (url.endsWith("/repos/acme/demo/pulls") && method === "POST") {
        return Response.json({ number: 8, title: "Ship GitHub plugin", state: "open", draft: true, user: { login: "octocat" }, html_url: "https://github.com/acme/demo/pull/8" }, { status: 201 });
      }
      return Response.json({ message: "Not found" }, { status: 404 });
    }, { preconnect: originalFetch.preconnect });

    await installPluginPackage({ serverConfig, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    await savePluginSecretAuthorization({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "github",
      methodId: "github-token",
      accountId: "default",
      values: { accessToken: "github_pat_private" },
    });

    const status = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "github",
      action: "connection-status",
      args: {},
      context: {},
    });
    const pulls = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "github",
      action: "list-pull-requests",
      args: { owner: "acme", repo: "demo", limit: 10 },
      context: {},
    });
    const created = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "github",
      action: "create-pull-request",
      args: { owner: "acme", repo: "demo", title: "Ship GitHub plugin", head: "agent/github", base: "main" },
      context: {},
    });

    expect(status).toMatchObject({ result: { connected: true, account: { login: "octocat" } } });
    expect(pulls).toMatchObject({ result: { items: [{ number: 7, title: "Ship GitHub plugin" }] } });
    expect(created).toMatchObject({ result: { number: 8, draft: true, htmlUrl: "https://github.com/acme/demo/pull/8" } });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.authorization === "Bearer github_pat_private")).toBe(true);
    expect(JSON.stringify({ status, pulls, created })).not.toContain("github_pat_private");
    await disposeAllPluginServices(serverConfig);
  });

  test("runs the bundled WeChat Official Account service through bounded content, comment, and menu actions without exposing AppSecret", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-wechat-official-service-workspace-");
    const packageRoot = fileURLToPath(new URL("../../../examples/plugin-packages/wechat-official", import.meta.url));
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    process.env.IPOLLOWORK_WECHAT_OFFICIAL_API_BASE = "https://api.weixin.test";
    await writeFile(join(workspaceRoot, "cover.png"), new Uint8Array([137, 80, 78, 71]), "binary");
    const serverConfig = config(workspaceRoot);
    const requests: Array<{ path: string; method: string; bodyType: string }> = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url);
      const method = init?.method ?? "GET";
      const bodyType = init?.body instanceof FormData ? "form-data" : typeof init?.body;
      requests.push({ path: url.pathname, method, bodyType });
      if (url.pathname === "/cgi-bin/token") {
        expect(url.searchParams.get("appid")).toBe("wx_test_account");
        expect(url.searchParams.get("secret")).toBe("wechat-secret");
        return Response.json({ access_token: "wechat-access-token", expires_in: 7_200 });
      }
      if (url.pathname === "/cgi-bin/material/add_material") return Response.json({ media_id: "cover-media-id", url: "https://mmbiz.example/cover.png" });
      if (url.pathname === "/cgi-bin/draft/add") return Response.json({ media_id: "draft-media-id" });
      if (url.pathname === "/cgi-bin/freepublish/submit") return Response.json({ publish_id: "publish-id" });
      if (url.pathname === "/cgi-bin/freepublish/get") return Response.json({ publish_id: "publish-id", publish_status: 0, article_id: "article-id" });
      if (url.pathname === "/cgi-bin/comment/list") return Response.json({ total_count: 1, comment: [{ user_comment_id: 9, content: "Great post" }] });
      if (url.pathname === "/cgi-bin/comment/reply/add") return Response.json({ errcode: 0 });
      if (url.pathname === "/cgi-bin/menu/get") return Response.json({ menu: { button: [{ name: "Read" }] } });
      if (url.pathname === "/cgi-bin/menu/create") return Response.json({ errcode: 0 });
      return Response.json({ errcode: 404, errmsg: "Not found" }, { status: 404 });
    }, { preconnect: originalFetch.preconnect });

    await installPluginPackage({ serverConfig, workspaceId: WORKSPACE_ID, packageRoot, workspaceRoot });
    await savePluginSecretAuthorization({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      methodId: "wechat-official-account",
      accountId: "default",
      values: { appId: "wx_test_account", appSecret: "wechat-secret" },
    });

    const status = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "connection-status",
      args: {},
      context: {},
    });
    const cover = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "upload-cover-image",
      args: { sourcePath: "cover.png" },
      context: { directory: workspaceRoot },
    });
    const draft = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "create-draft",
      args: { articles: [{ title: "A careful article", content: "<p>Body</p>", thumbMediaId: "cover-media-id" }] },
      context: {},
    });
    const published = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "submit-publish",
      args: { mediaId: "draft-media-id" },
      context: {},
    });
    const publishStatus = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "get-publish-status",
      args: { publishId: "publish-id" },
      context: {},
    });
    const comments = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "list-comments",
      args: { msgDataId: 12 },
      context: {},
    });
    const reply = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "reply-comment",
      args: { msgDataId: 12, index: 0, userCommentId: 9, content: "Thank you" },
      context: {},
    });
    const menu = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "get-menu",
      args: {},
      context: {},
    });
    const updatedMenu = await callPluginServiceAction({
      config: serverConfig,
      workspaceId: WORKSPACE_ID,
      pluginId: "wechat-official",
      action: "update-menu",
      args: { menu: { button: [{ type: "view", name: "Read", url: "https://example.com" }] } },
      context: {},
    });

    expect(status).toMatchObject({ result: { connected: true, account: { appId: "wx_••••unt" } } });
    expect(cover).toMatchObject({ result: { mediaId: "cover-media-id" } });
    expect(draft).toMatchObject({ result: { mediaId: "draft-media-id" } });
    expect(published).toMatchObject({ result: { publishId: "publish-id" } });
    expect(publishStatus).toMatchObject({ result: { articleId: "article-id", publishStatus: 0 } });
    expect(comments).toMatchObject({ result: { totalCount: 1, commentList: [{ user_comment_id: 9 }] } });
    expect(reply).toMatchObject({ result: { replied: true } });
    expect(menu).toMatchObject({ result: { menu: { button: [{ name: "Read" }] } } });
    expect(updatedMenu).toMatchObject({ result: { updated: true } });
    expect(requests.filter((request) => request.path === "/cgi-bin/token")).toHaveLength(1);
    expect(requests).toContainEqual({ path: "/cgi-bin/material/add_material", method: "POST", bodyType: "form-data" });
    expect(JSON.stringify({ status, cover, draft, published, publishStatus, comments, reply, menu, updatedMenu })).not.toContain("wechat-secret");
    await disposeAllPluginServices(serverConfig);
  });
});
