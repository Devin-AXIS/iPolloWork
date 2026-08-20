import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import { buildDeepSeekHarnessPatch } from "./deepseek-harness-patch.js";
import { disposeiPolloWorkWorkspaceConfigStore } from "./ipollowork-workspace-config-store.js";
import { writeRuntimeMcpConfig } from "./runtime-capability-store.js";
import { disposeRuntimeOpencodeConfigStore } from "./runtime-opencode-config-store.js";
import { disposeTemplateStore } from "./templates.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;
const previousHostPlugin = process.env.IPOLLOWORK_DSH_HOST_PLUGIN;

async function removeTestRoot(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (process.platform === "win32" && (code === "EBUSY" || code === "EPERM")) return;
    throw error;
  }
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function serverConfig(workspaceRoot: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(workspaceRoot, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{
      id: "ws_dsh",
      name: "DeepSeek Harness",
      path: workspaceRoot,
      preset: "starter",
      workspaceType: "local",
      engineId: DEEPSEEK_HARNESS_ENGINE_ID,
    }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

afterEach(async () => {
  for (const root of roots) {
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const config = serverConfig(root);
    await Promise.all([
      disposeRuntimeOpencodeConfigStore(config),
      disposeiPolloWorkWorkspaceConfigStore(config),
      disposeTemplateStore(config),
    ]);
  }
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
  if (previousHostPlugin === undefined) delete process.env.IPOLLOWORK_DSH_HOST_PLUGIN;
  else process.env.IPOLLOWORK_DSH_HOST_PLUGIN = previousHostPlugin;
  while (roots.length) await removeTestRoot(roots.pop()!);
});

describe("DeepSeek Harness runtime patch", () => {
  test("projects shared MCP capabilities and the host tool plugin without engine-specific state reads", async () => {
    const workspaceRoot = await temporaryRoot("ipollowork-dsh-patch-workspace-");
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    const hostPluginPath = join(workspaceRoot, "ipollowork-host-tools.mjs");
    await writeFile(hostPluginPath, "export default {}\n", "utf8");
    process.env.IPOLLOWORK_DSH_HOST_PLUGIN = hostPluginPath;
    const config = serverConfig(workspaceRoot);
    await writeRuntimeMcpConfig(config, "ws_dsh", () => ({
      "school remote": {
        type: "remote",
        url: "https://school.example/mcp",
        headers: { Authorization: "Bearer scoped", ignored: 42 },
      },
      "school-remote": {
        type: "local",
        command: ["node", "server.mjs"],
        environment: { SCHOOL: "one", ignored: false },
        env: { SCHOOL: "two" },
      },
      disabled: {
        type: "remote",
        url: "https://disabled.example/mcp",
        enabled: false,
      },
    }));

    const patch = await buildDeepSeekHarnessPatch(config, config.workspaces[0]!);
    expect(patch.slice(0, 2)).toEqual([
      { id: "skill-filesystem", disabled: false },
      { id: "tool-skill", disabled: false },
    ]);
    expect(patch[2]).toEqual({
      insert: [{
        id: "ipollowork-host-tools",
        name: pathToFileURL(hostPluginPath).href,
      }],
    });
    const mcpRows = (patch[3] as { insert: Array<{ config: Record<string, unknown> }> }).insert;
    expect(mcpRows).toHaveLength(2);
    expect(mcpRows.map((row) => row.config.transport)).toEqual(["streamable-http", "stdio"]);
    expect(mcpRows[0]?.config.headers).toEqual({ Authorization: "Bearer scoped" });
    expect(mcpRows[1]?.config).toMatchObject({
      command: "node",
      args: ["server.mjs"],
      env: { SCHOOL: "two" },
      cwd: workspaceRoot,
    });
    expect(new Set(mcpRows.map((row) => row.config.serverName)).size).toBe(2);
    expect(JSON.stringify(patch)).not.toContain("disabled.example");
  });
});
