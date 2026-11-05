import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import {
  ipolloworkRuntimeConfigFilePath,
  keepiPolloWorkRuntimeConfigFileFresh,
  writeiPolloWorkRuntimeConfigFile,
} from "./ipollowork-runtime-config.js";
import { disposeRuntimeOpencodeConfigStore, readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ReloadEvent, ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) {
    const root = roots.pop();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReloadEvent(value: unknown): value is ReloadEvent {
  return isRecord(value) && typeof value.reason === "string";
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-runtime-patch-reload-"));
  roots.push(root);
  return root;
}

async function startiPolloWorkServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    configPath: join(workspaceRoot, "server.json"),
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, config };
}

async function patchConfig(base: string, token: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${base}/workspace/ws_1/config`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify(payload),
  });
  expect(response.status).toBe(200);
}

async function readEvents(base: string, token: string): Promise<ReloadEvent[]> {
  const response = await fetch(`${base}/workspace/ws_1/events`, { headers: auth(token) });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new Error("Expected reload event response");
  }
  return body.items.filter(isReloadEvent);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("workspace config patch reload events", () => {
  test("compaction patches persist through config reads and engine projection and only reload on changes", async () => {
    const root = await createWorkspaceRoot();
    const opencodePath = join(root, "opencode.jsonc");
    const source = JSON.stringify({ compaction: { auto: true, prune: true } });
    await writeFile(opencodePath, source);
    const { base, token, config } = await startiPolloWorkServer(root);
    await writeiPolloWorkRuntimeConfigFile(config, "ws_1");
    const unsubscribe = keepiPolloWorkRuntimeConfigFileFresh(config, "ws_1");
    const options = { prune: false, tail_turns: 3, preserve_recent_tokens: 8_000, reserved: 16_000 };

    try {
      for (const auto of [false, true]) {
        if (auto) await sleep(800);
        await patchConfig(base, token, { opencode: { compaction: auto ? { auto } : { auto, ...options } } });
        await disposeRuntimeOpencodeConfigStore(config);
        expect((await readRuntimeOpencodeConfig(config, "ws_1")).compaction).toEqual({ auto, ...options });

        const response = await fetch(`${base}/workspace/ws_1/config`, { headers: auth(token) });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ opencode: { compaction: { auto, ...options } } });

        let projected: unknown;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const runtime: unknown = JSON.parse(await readFile(ipolloworkRuntimeConfigFilePath(config), "utf8"));
          projected = isRecord(runtime) ? runtime.compaction : undefined;
          if (isRecord(projected) && projected.auto === auto) break;
          await sleep(20);
        }
        expect(projected).toEqual({ auto, ...options });
        expect(await readEvents(base, token)).toHaveLength(auto ? 2 : 1);
      }

      await sleep(800);
      await patchConfig(base, token, { opencode: { compaction: { auto: true } } });
      expect(await readEvents(base, token)).toHaveLength(2);
      expect(await readFile(opencodePath, "utf8")).toBe(source);
    } finally {
      unsubscribe();
    }
  });

  test("invalid compaction values leave the saved settings and reload events unchanged", async () => {
    const root = await createWorkspaceRoot();
    const { base, token, config } = await startiPolloWorkServer(root);
    await patchConfig(base, token, { opencode: { compaction: { auto: false } } });

    for (const compaction of [
      { auto: "false" },
      { prune: 1 },
      { tail_turns: -1 },
      { preserve_recent_tokens: 1.5 },
      { reserved: Number.MAX_SAFE_INTEGER + 1 },
      null,
    ]) {
      const response = await fetch(`${base}/workspace/ws_1/config`, {
        method: "PATCH",
        headers: auth(token),
        body: JSON.stringify({ opencode: { compaction } }),
      });
      expect(response.status).toBe(400);
    }

    expect((await readRuntimeOpencodeConfig(config, "ws_1")).compaction).toEqual({ auto: false });
    expect(await readEvents(base, token)).toHaveLength(1);
  });

  test("identical runtime provider patches do not emit another config reload event", async () => {
    const root = await createWorkspaceRoot();
    const { base, token } = await startiPolloWorkServer(root);
    const payload = {
      opencode: {
        provider: {
          p1: {
            id: "openrouter",
            name: "OpenRouter",
            env: ["OPENROUTER_API_KEY"],
            models: {
              "model-a": { id: "model-a", name: "Model A" },
            },
          },
        },
      },
    };

    await patchConfig(base, token, payload);
    const firstEvents = await readEvents(base, token);
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0]?.reason).toBe("config");

    await sleep(800);
    await patchConfig(base, token, payload);

    const secondEvents = await readEvents(base, token);
    expect(secondEvents).toHaveLength(1);
  });
});
