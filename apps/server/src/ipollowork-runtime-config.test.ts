import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  keepiPolloWorkRuntimeConfigFileFresh,
  ipolloworkRuntimeConfigFilePath,
  writeiPolloWorkRuntimeConfigFile,
} from "./ipollowork-runtime-config.js";
import {
  disposeRuntimeOpencodeConfigStore,
  writeRuntimeOpencodeConfig,
  writeRuntimeProviderChannels,
} from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
const cleanups: Array<() => void> = [];
const configs: ServerConfig[] = [];
let previousDb: string | undefined;

afterEach(async () => {
  while (cleanups.length) cleanups.pop()?.();
  for (const config of configs.splice(0)) await disposeRuntimeOpencodeConfigStore(config);
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-runtime-config-file-"));
  roots.push(root);
  previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      { id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  configs.push(config);
  return { root, config };
}

async function readConfigFile(config: ServerConfig): Promise<Record<string, unknown>> {
  const raw = await readFile(ipolloworkRuntimeConfigFilePath(config), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("ipollowork runtime config file", () => {
  test("writes runtime-DB MCPs and ipollowork defaults into the file", async () => {
    const { config } = await setup();
    await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({
      ...current,
      mcp: { posthog: { type: "remote", url: "https://mcp.posthog.com/mcp", enabled: true } },
    }));

    const path = await writeiPolloWorkRuntimeConfigFile(config, "ws_1");
    expect(path).toBe(ipolloworkRuntimeConfigFilePath(config));

    const parsed = await readConfigFile(config);
    const mcp = parsed.mcp as Record<string, Record<string, unknown>>;
    expect(mcp.posthog?.enabled).toBe(true);
    expect(parsed.default_agent).toBe("ipollowork");
    expect(Array.isArray(parsed.plugin)).toBe(true);
    expect((parsed.plugin as string[]).join("\n")).not.toContain("chrome-devtools");
    const providers = parsed.provider as Record<string, Record<string, unknown>>;
    const openCode = providers.opencode;
    const whitelist = Array.isArray(openCode?.whitelist)
      ? openCode.whitelist.filter((modelId): modelId is string => typeof modelId === "string")
      : [];
    expect(whitelist).toEqual([
      "big-pickle",
      "hy3-free",
      "mimo-v2.5-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "x-preview-f-free",
    ]);
    expect(Object.keys(openCode?.models as Record<string, unknown>)).toEqual(whitelist);
    const models = openCode?.models as Record<string, {
      name?: string;
      status?: string;
      headers?: Record<string, string>;
    }>;
    expect(models["x-preview-f-free"]).toMatchObject({
      name: "Ox Alpha Free",
      headers: { "x-opencode-session": "" },
    });
    expect(models["big-pickle"]?.headers).toBeUndefined();
    expect(Object.values(models).every((model) => model.status === "active")).toBe(true);
  });

  test("ipollowork prompt has a static search-first Memory Bank section, distinct from ## Memory", async () => {
    const { config } = await setup();
    await writeiPolloWorkRuntimeConfigFile(config, "ws_1");

    const parsed = await readConfigFile(config);
    const agent = parsed.agent as Record<string, { prompt?: string }>;
    const prompt = agent.ipollowork?.prompt ?? "";

    // The new Memory Bank section is present and distinct from the existing ## Memory section.
    expect(prompt).toContain("## Memory Bank");
    expect(prompt).toContain("## Memory\n");
    // Search-first (B1): never name tools that do not exist.
    expect(prompt).toContain("search_capabilities");
    expect(prompt).toContain("execute_capability");
    expect(prompt).toContain('"query": { "q": "the user\'s recall words" }');
    expect(prompt).toContain('"path": { "id": "mem_…" }');
    expect(prompt).not.toContain("memory_save");
    expect(prompt).not.toContain("memory_search");
    // No-secrets guidance is the only v0 plaintext-at-rest mitigation.
    expect(prompt).toMatch(/secret|credential|API key|token|PII/i);
  });

  test("ipollowork prompt requires plain-text Markdown tables of contents", async () => {
    const { config } = await setup();
    await writeiPolloWorkRuntimeConfigFile(config, "ws_1");

    const parsed = await readConfigFile(config);
    const agent = parsed.agent as Record<string, { prompt?: string }>;
    const prompt = agent.ipollowork?.prompt ?? "";

    expect(prompt).toContain("table of contents");
    expect(prompt).toContain("plain text");
    expect(prompt).toContain("Never use Markdown links");
    expect(prompt).toContain("HTML anchors");
    expect(prompt).toContain("fragment URLs");
  });

  test("keepiPolloWorkRuntimeConfigFileFresh rewrites the file on runtime-DB writes", async () => {
    const { config } = await setup();
    await writeiPolloWorkRuntimeConfigFile(config, "ws_1");
    cleanups.push(keepiPolloWorkRuntimeConfigFileFresh(config, "ws_1"));

    await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({
      ...current,
      mcp: { stripe: { type: "remote", url: "https://mcp.stripe.com", enabled: false } },
    }));

    // The refresh is fire-and-forget; poll briefly for the rewrite.
    let mcp: Record<string, Record<string, unknown>> = {};
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = await readConfigFile(config);
      mcp = (parsed.mcp ?? {}) as Record<string, Record<string, unknown>>;
      if (mcp.stripe) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(mcp.stripe?.enabled).toBe(false);
  });

  test("keepiPolloWorkRuntimeConfigFileFresh projects global provider channel writes", async () => {
    const { config } = await setup();
    await writeiPolloWorkRuntimeConfigFile(config, "ws_1");
    cleanups.push(keepiPolloWorkRuntimeConfigFileFresh(config, "ws_1"));

    await writeRuntimeProviderChannels(config, (current) => ({
      ...current,
      shared: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://models.example/v1" },
        models: { shared: { name: "Shared model" } },
      },
    }));

    let providers: Record<string, Record<string, unknown>> = {};
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const parsed = await readConfigFile(config);
      providers = (parsed.provider ?? {}) as Record<string, Record<string, unknown>>;
      if (providers.shared) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(providers.shared).toMatchObject({
      options: { baseURL: "https://models.example/v1" },
    });
  });

  test("writes for other workspaces do not rewrite the primary file", async () => {
    const { config } = await setup();
    await writeiPolloWorkRuntimeConfigFile(config, "ws_1");
    cleanups.push(keepiPolloWorkRuntimeConfigFileFresh(config, "ws_1"));

    await writeRuntimeOpencodeConfig(config, "ws_other", (current) => ({
      ...current,
      mcp: { other: { type: "remote", url: "https://example.com/mcp", enabled: true } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const parsed = await readConfigFile(config);
    const mcp = (parsed.mcp ?? {}) as Record<string, Record<string, unknown>>;
    expect(mcp.other).toBeUndefined();
  });
});
