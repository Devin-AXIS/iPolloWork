import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer, syncAllWorkspacesRuntimeMcpToEngine } from "./server.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

type EngineRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
};

// Keep the engine sync retry backoff tiny so failure-path tests stay fast.
process.env.IPOLLOWORK_MCP_SYNC_RETRY_DELAY_MS = "10";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-mcp-engine-sync-"));
  roots.push(root);
  return root;
}

function startMockOpencode(options?: { failMcpNames?: string[] }) {
  const requests: EngineRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json().catch(() => null) : null;
      requests.push({ method: request.method, pathname: url.pathname, search: url.search, body });

      if (url.pathname === "/instance/dispose") return Response.json({ disposed: true });
      if (url.pathname === "/mcp" && request.method === "POST") {
        const name = (body as { name?: string } | null)?.name;
        if (name && options?.failMcpNames?.includes(name)) {
          return Response.json({ code: "mcp_invalid", message: "Invalid MCP config" }, { status: 500 });
        }
        return Response.json({});
      }
      if (url.pathname.match(/^\/mcp\/[^/]+\/disconnect$/) && request.method === "POST") return Response.json({});
      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startiPolloWorkServer(workspaceRoot: string, opencodeBaseUrl: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: opencodeBaseUrl,
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, config };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`${label} was not an object`);
}

function expectWorkOAuthProxy(request: EngineRequest | undefined, base: string, name: string, enabled = true) {
  const body = requireRecord(request?.body, "engine MCP request");
  const config = requireRecord(body.config, "engine MCP config");
  const headers = requireRecord(config.headers, "engine MCP headers");
  expect(body.name).toBe(name);
  expect(config).toMatchObject({
    type: "remote",
    enabled,
    oauth: false,
  });
  expect(config.url).toMatch(new RegExp(`^${base}/mcp-proxy/ws_1/${name}\\?connection=mcp%3A`));
  expect(headers.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{32,}$/);
  expect(config.connectionId).toBeUndefined();
}

const POSTHOG_CONFIG = {
  type: "remote",
  url: "https://mcp.posthog.com/mcp",
  enabled: true,
  oauth: {},
};

describe("runtime MCP engine sync", () => {
  test("hot-adds a runtime MCP into the running engine when added", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const ipollowork = await startiPolloWorkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const response = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(ipollowork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(response.status).toBe(200);

      const addRequest = mock.requests.find((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(addRequest).toBeDefined();
      expectWorkOAuthProxy(addRequest, ipollowork.base, "posthog");
      expect(addRequest?.search).toContain(`directory=${encodeURIComponent(workspaceRoot)}`);
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("re-registers runtime MCPs with the engine after a reload", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const ipollowork = await startiPolloWorkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const addResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(ipollowork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(addResponse.status).toBe(200);
      mock.requests.length = 0;

      const reloadResponse = await fetch(`${ipollowork.base}/workspace/ws_1/engine/reload`, {
        method: "POST",
        headers: auth(ipollowork.token),
      });
      expect(reloadResponse.status).toBe(200);

      const disposeIndex = mock.requests.findIndex((entry) => entry.pathname === "/instance/dispose");
      const syncIndex = mock.requests.findIndex((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(disposeIndex).toBeGreaterThanOrEqual(0);
      expect(syncIndex).toBeGreaterThan(disposeIndex);
      expectWorkOAuthProxy(mock.requests[syncIndex], ipollowork.base, "posthog");
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("pushes toggled enabled state to the engine", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const ipollowork = await startiPolloWorkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const addResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(ipollowork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(addResponse.status).toBe(200);
      mock.requests.length = 0;

      const toggleResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp/posthog/enabled`, {
        method: "POST",
        headers: auth(ipollowork.token),
        body: JSON.stringify({ enabled: false }),
      });
      expect(toggleResponse.status).toBe(200);

      const syncRequest = mock.requests.find((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(syncRequest).toBeDefined();
      expectWorkOAuthProxy(syncRequest, ipollowork.base, "posthog", false);
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("disconnects a removed MCP from the engine", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const ipollowork = await startiPolloWorkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const addResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(ipollowork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(addResponse.status).toBe(200);
      mock.requests.length = 0;

      const removeResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp/posthog`, {
        method: "DELETE",
        headers: auth(ipollowork.token),
      });
      expect(removeResponse.status).toBe(200);

      const disconnectRequest = mock.requests.find(
        (entry) => entry.method === "POST" && entry.pathname === "/mcp/posthog/disconnect",
      );
      expect(disconnectRequest).toBeDefined();
      expect(disconnectRequest?.search).toContain(`directory=${encodeURIComponent(workspaceRoot)}`);
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("reload keeps registering remaining MCPs when one entry fails", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode({ failMcpNames: ["bad"] });
      const ipollowork = await startiPolloWorkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      for (const [name, config] of [["bad", POSTHOG_CONFIG], ["posthog", POSTHOG_CONFIG]] as const) {
        const response = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
          method: "POST",
          headers: auth(ipollowork.token),
          body: JSON.stringify({ name, config }),
        });
        expect(response.status).toBe(200);
      }
      mock.requests.length = 0;

      const reloadResponse = await fetch(`${ipollowork.base}/workspace/ws_1/engine/reload`, {
        method: "POST",
        headers: auth(ipollowork.token),
      });
      expect(reloadResponse.status).toBe(200);

      const syncedNames = mock.requests
        .filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .map((entry) => (entry.body as { name?: string } | null)?.name);
      // "bad" fails with a 500 but must not block the entries after it.
      expect(syncedNames).toContain("bad");
      expect(syncedNames).toContain("posthog");
      // 5xx entries are retried once.
      expect(syncedNames.filter((name) => name === "bad").length).toBe(2);

      // The failure is surfaced on the MCP list endpoint instead of being
      // swallowed silently.
      const listResponse = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
        headers: auth(ipollowork.token),
      });
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {
        engineSync?: { status: string; failures: Array<{ name: string; status?: number; body?: unknown }> } | null;
      };
      expect(listBody.engineSync?.status).toBe("failed");
      expect(listBody.engineSync?.failures).toContainEqual({
        name: "bad",
        status: 500,
        body: { code: "mcp_invalid", message: "Invalid MCP config" },
      });
      expect(listBody.engineSync?.failures.map((failure) => failure.name)).not.toContain("posthog");
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("startup sync pushes runtime MCPs for every workspace", async () => {
    const rootA = await createWorkspaceRoot();
    const rootB = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const baseUrl = `http://127.0.0.1:${mock.server.port}`;
      const config: ServerConfig = {
        host: "127.0.0.1",
        port: 0,
        token: "owt_test_token",
        hostToken: "owt_host_token",
        approval: { mode: "auto", timeoutMs: 1000 },
        corsOrigins: ["*"],
        workspaces: [
          { id: "ws_1", name: "A", path: rootA, preset: "starter", workspaceType: "local", baseUrl },
          { id: "ws_2", name: "B", path: rootB, preset: "starter", workspaceType: "local", baseUrl },
        ],
        authorizedRoots: [rootA, rootB],
        readOnly: false,
        startedAt: Date.now(),
        tokenSource: "cli",
        hostTokenSource: "cli",
        logFormat: "pretty",
        logRequests: false,
      };

      await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({ ...current, mcp: { posthog: POSTHOG_CONFIG } }));
      await writeRuntimeOpencodeConfig(config, "ws_2", (current) => ({ ...current, mcp: { stripe: POSTHOG_CONFIG } }));

      await syncAllWorkspacesRuntimeMcpToEngine(config);

      const syncs = mock.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      const byName = new Map(syncs.map((entry) => [(entry.body as { name?: string } | null)?.name, entry.search]));
      expect(byName.get("posthog")).toContain(`directory=${encodeURIComponent(rootA)}`);
      expect(byName.get("stripe")).toContain(`directory=${encodeURIComponent(rootB)}`);
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("startup sync skips disabled runtime MCPs", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const baseUrl = `http://127.0.0.1:${mock.server.port}`;
      const config: ServerConfig = {
        host: "127.0.0.1",
        port: 0,
        token: "owt_test_token",
        hostToken: "owt_host_token",
        approval: { mode: "auto", timeoutMs: 1000 },
        corsOrigins: ["*"],
        workspaces: [
          { id: "ws_1", name: "A", path: workspaceRoot, preset: "starter", workspaceType: "local", baseUrl },
        ],
        authorizedRoots: [workspaceRoot],
        readOnly: false,
        startedAt: Date.now(),
        tokenSource: "cli",
        hostTokenSource: "cli",
        logFormat: "pretty",
        logRequests: false,
      };

      await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({
        ...current,
        mcp: {
          disabled: { ...POSTHOG_CONFIG, enabled: false },
          enabled: POSTHOG_CONFIG,
        },
      }));

      await syncAllWorkspacesRuntimeMcpToEngine(config);

      const syncedNames = mock.requests
        .filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .map((entry) => (entry.body as { name?: string } | null)?.name);
      expect(syncedNames).toEqual(["enabled"]);
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  test("MCP add still succeeds when the engine is unreachable", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const ipollowork = await startiPolloWorkServer(workspaceRoot, "http://127.0.0.1:9");

      const response = await fetch(`${ipollowork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(ipollowork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { items: Array<{ name: string }> };
      expect(body.items.some((item) => item.name === "posthog")).toBe(true);
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });

  // When the OpenCode engine endpoint on record is unreachable (process down or
  // moved to a new port), a lightweight /instance/dispose cannot revive it.
  // The reload endpoint must report a distinct, actionable error
  // (opencode_engine_unreachable) instead of either a generic 502 or a fake
  // 200 — the latter would tell the user "reloaded" while chat stays broken.
  // The desktop client uses this code to escalate to a full engine restart.
  test("engine reload reports engine-unreachable when the engine is down", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
    process.env.IPOLLOWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const ipollowork = await startiPolloWorkServer(workspaceRoot, "http://127.0.0.1:9");

      const response = await fetch(`${ipollowork.base}/workspace/ws_1/engine/reload`, {
        method: "POST",
        headers: auth(ipollowork.token),
      });
      expect(response.status).toBe(503);
      const body = await response.json() as { code?: string };
      expect(body.code).toBe("opencode_engine_unreachable");
    } finally {
      if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
      else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
    }
  });
});
