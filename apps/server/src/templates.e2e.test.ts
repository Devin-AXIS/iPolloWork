import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const previousRuntimeDb = process.env.IPOLLOWORK_RUNTIME_DB;

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  if (previousRuntimeDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB;
  else process.env.IPOLLOWORK_RUNTIME_DB = previousRuntimeDb;
});

describe("template API", () => {
  test("lists, materializes and uninstalls without deleting the session snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "ipw-template-api-"));
    roots.push(root);
    process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite");
    const config: ServerConfig = {
      host: "127.0.0.1", port: 0, token: "token", hostToken: "host", approval: { mode: "auto", timeoutMs: 1_000 }, corsOrigins: ["*"], workspaces: [{ id: "ws", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    };
    const server = await startServer(config);
    stops.push(() => server.stop());
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { Authorization: "Bearer token", "Content-Type": "application/json" };

    const capabilities = await fetch(`${base}/capabilities`, { headers }).then((response) => response.json());
    expect(capabilities.templates).toEqual({ read: true, install: true, import: true, uninstall: true });
    const catalog = await fetch(`${base}/workspace/ws/templates`, { headers }).then((response) => response.json());
    expect(catalog.items).toHaveLength(2);

    const materializedResponse = await fetch(`${base}/workspace/ws/templates/ipollowork.saas-landing/materialize`, { method: "POST", headers, body: JSON.stringify({ sessionId: "session_api" }) });
    expect(materializedResponse.status).toBe(200);
    const materialized = await materializedResponse.json();
    expect(materialized.state.entry).toBe("design/session_api/entry.html");

    const uninstallResponse = await fetch(`${base}/workspace/ws/templates/ipollowork.saas-landing`, { method: "DELETE", headers });
    expect(uninstallResponse.status).toBe(200);
    expect(await readFile(join(root, materialized.state.entry), "utf8")).toContain("<!doctype html>");
    const metadata = await fetch(`${base}/workspace/ws/design-sessions/session_api/template`, { headers }).then((response) => response.json());
    expect(metadata.manifest.id).toBe("ipollowork.saas-landing");
  });
});
