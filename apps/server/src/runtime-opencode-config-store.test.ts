import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMcp, listMcp, setMcpEnabled } from "./mcp.js";
import { buildiPolloWorkRuntimeConfig } from "./ipollowork-runtime-config.js";
import { readiPolloWorkWorkspaceConfig } from "./ipollowork-workspace-config-store.js";
import { registerOpencodePluginBinding, unregisterOpencodePluginBinding } from "./opencode-plugin-projection.js";
import { onRuntimeMcpConfigWrite } from "./runtime-capability-store.js";
import {
  onRuntimeOpencodeConfigWrite,
  readRuntimeProviderChannels,
  readRuntimeOpencodeConfig,
  writeRuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_runtime_test";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

function serverConfig(root: string, dbPath: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
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
  } satisfies ServerConfig;
}

async function withWorkspace(fn: (input: { root: string; config: ServerConfig }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-runtime-config-"));
  const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
  const dbPath = join(root, "runtime.sqlite");
  process.env.IPOLLOWORK_RUNTIME_DB = dbPath;
  try {
    await fn({ root, config: serverConfig(root, dbPath) });
  } finally {
    if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
    else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toThrow();
}

describe("runtime OpenCode config store", () => {
  test("stores provider channels once and projects them into every workspace", async () => {
    await withWorkspace(async ({ root, config }) => {
      const secondWorkspaceId = "ws_runtime_second";
      config.workspaces.push({
        id: secondWorkspaceId,
        name: "Second",
        path: root,
        preset: "starter",
        workspaceType: "local",
      });
      const server = await startServer(config) as Served;
      try {
        const profile = {
          npm: "@ai-sdk/openai-compatible",
          name: "Shared channel",
          options: { baseURL: "https://models.example/v1" },
          models: { shared: { name: "Shared model" } },
        };
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ opencode: { provider: { shared: profile } } }),
        });
        expect(response.status).toBe(200);

        expect(await readRuntimeProviderChannels(config)).toEqual({ shared: profile });
        expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).provider).toBeUndefined();

        for (const workspaceId of [WORKSPACE_ID, secondWorkspaceId]) {
          const configResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/config`, {
            headers: { authorization: `Bearer ${config.token}` },
          });
          expect(configResponse.status).toBe(200);
          expect(await configResponse.json()).toMatchObject({
            opencode: { provider: { shared: profile } },
          });
          const runtime = JSON.parse(await buildiPolloWorkRuntimeConfig(config, workspaceId));
          expect(runtime.provider?.shared).toEqual(profile);
        }

        const deleteResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${secondWorkspaceId}/config`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ opencode: { provider: { shared: null } } }),
        });
        expect(deleteResponse.status).toBe(200);
        expect(await readRuntimeProviderChannels(config)).toEqual({});
        for (const workspaceId of [WORKSPACE_ID, secondWorkspaceId]) {
          const configResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/config`, {
            headers: { authorization: `Bearer ${config.token}` },
          });
          expect(configResponse.status).toBe(200);
          const body = await configResponse.json() as { opencode?: { provider?: Record<string, unknown> } };
          expect(body.opencode?.provider?.shared).toBeUndefined();
        }
      } finally {
        await server.stop(true);
      }
    });
  });

  test("reports no-op writes without notifying listeners", async () => {
    await withWorkspace(async ({ config }) => {
      let writes = 0;
      const unsubscribe = onRuntimeOpencodeConfigWrite((writtenConfig, workspaceId) => {
        if (writtenConfig === config && workspaceId === WORKSPACE_ID) {
          writes += 1;
        }
      });

      try {
        const first = await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
          ...current,
          mcp: { posthog: { type: "remote", url: "https://mcp.posthog.com/mcp", enabled: true } },
        }));
        expect(first.changed).toBe(true);
        expect(writes).toBe(1);

        const second = await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
          ...current,
          mcp: { posthog: { type: "remote", url: "https://mcp.posthog.com/mcp", enabled: true } },
        }));
        expect(second.changed).toBe(false);
        expect(second.config).toEqual(first.config);
        expect(writes).toBe(1);

        const third = await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
          ...current,
          mcp: { posthog: { type: "remote", url: "https://mcp.posthog.com/mcp", enabled: false } },
        }));
        expect(third.changed).toBe(true);
        expect(writes).toBe(2);
      } finally {
        unsubscribe();
      }
    });
  });

  test("notifies engine-neutral listeners only when shared MCP capabilities change", async () => {
    await withWorkspace(async ({ config }) => {
      let writes = 0;
      const unsubscribe = onRuntimeMcpConfigWrite((writtenConfig, workspaceId) => {
        if (writtenConfig === config && workspaceId === WORKSPACE_ID) writes += 1;
      });

      try {
        await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
          ...current,
          plugin: ["runtime-plugin"],
        }));
        expect(writes).toBe(0);

        await addMcp(config, WORKSPACE_ID, "posthog", {
          type: "remote",
          url: "https://mcp.posthog.com/mcp",
          enabled: true,
        });
        expect(writes).toBe(1);

        await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
          ...current,
          provider: { example: { npm: "@ai-sdk/openai-compatible" } },
        }));
        expect(writes).toBe(1);
      } finally {
        unsubscribe();
      }
    });
  });

  test("stores MCP changes in the iPolloWork runtime DB without rewriting workspace files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "mcp": {\n    "project": { "type": "remote", "url": "https://project.example/mcp" }\n  }\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      await setMcpEnabled(config, WORKSPACE_ID, "runtime", false);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      await expectMissing(join(root, ".opencode", "ipollowork.json"));
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.runtime?.enabled).toBe(false);

      const items = await listMcp(config, WORKSPACE_ID, root);
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("project:config.project");
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("runtime:config.remote");
    });
  });

  test("stores plugin changes in the iPolloWork runtime DB without rewriting workspace files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "plugin": ["project-plugin"]\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      expect(await registerOpencodePluginBinding(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);
      expect(await unregisterOpencodePluginBinding(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);
      expect(await registerOpencodePluginBinding(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      await expectMissing(join(root, ".opencode", "ipollowork.json"));
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugin).toEqual(["runtime-plugin"]);

      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      const runtimeConfig = JSON.parse(await buildiPolloWorkRuntimeConfig(config, WORKSPACE_ID)) as {
        plugin?: string[];
        mcp?: Record<string, Record<string, unknown>>;
      };
      expect(runtimeConfig.plugin).toContain("runtime-plugin");
      expect(runtimeConfig.mcp?.runtime?.url).toBe("https://runtime.example/mcp");
    });
  });

  test("malformed user opencode config does not block runtime config reads", async () => {
    await withWorkspace(async ({ root, config }) => {
      await writeFile(join(root, "opencode.jsonc"), '{ "mcp": {\n}\n}\n}\n', "utf8");
      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", enabled: true });
      await registerOpencodePluginBinding(config, WORKSPACE_ID, "runtime-plugin");

      const mcpItems = await listMcp(config, WORKSPACE_ID, root);
      const runtime = await readRuntimeOpencodeConfig(config, WORKSPACE_ID);

      // Global MCPs remain visible by design. A malformed project config must
      // not hide the runtime-owned entry that iPolloWork adds for this workspace.
      expect(mcpItems.find((item) => item.name === "runtime")?.source).toBe("config.remote");
      expect(runtime.plugin).toEqual(["runtime-plugin"]);
    });
  });

  test("stores iPolloWork-owned workspace config in the runtime DB without writing legacy files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            ipollowork: {
              cloudImports: {
                providers: {
                  provider_1: { cloudProviderId: "provider_1", providerId: "managed", name: "Managed", modelIds: [] },
                },
              },
            },
          }),
        });
        expect(response.status).toBe(200);

        const legacyiPolloWorkPath = join(root, ".opencode", "ipollowork.json");
        const legacyiPolloWork = await readFile(legacyiPolloWorkPath, "utf8").catch(() => "");
        expect(legacyiPolloWork).not.toContain("provider_1");
        expect(legacyiPolloWork).not.toContain("cloudImports");
        expect((await readiPolloWorkWorkspaceConfig(config, WORKSPACE_ID)).cloudImports).toEqual({
          providers: {
            provider_1: { cloudProviderId: "provider_1", providerId: "managed", name: "Managed", modelIds: [] },
          },
        });

        const configResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(configResponse.status).toBe(200);
        expect(await configResponse.json()).toMatchObject({
          ipollowork: {
            cloudImports: {
              providers: {
                provider_1: { cloudProviderId: "provider_1", providerId: "managed", name: "Managed", modelIds: [] },
              },
            },
          },
        });
      } finally {
        await server.stop(true);
      }
    });
  });

});
