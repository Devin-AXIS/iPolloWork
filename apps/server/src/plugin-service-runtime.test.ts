import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  disposeAllPluginServices,
  disposePluginServices,
  listPluginServiceActions,
} from "./plugin-service-runtime.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_plugin_service";
const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;

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

afterEach(async () => {
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("plugin service runtime", () => {
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
});
