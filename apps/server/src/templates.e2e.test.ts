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
    expect(catalog.items).toHaveLength(65);

    const missingCategory = await fetch(`${base}/workspace/ws/templates/import`, {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/vnd.ipollowork-template+zip" },
      body: new Uint8Array([1]),
    });
    expect(missingCategory.status).toBe(400);
    expect((await missingCategory.json()).code).toBe("template_category_required");

    const materializedResponse = await fetch(`${base}/workspace/ws/templates/ipollowork.saas-landing/materialize`, { method: "POST", headers, body: JSON.stringify({ sessionId: "session_api" }) });
    expect(materializedResponse.status).toBe(200);
    const materialized = await materializedResponse.json();
    expect(materialized.state.entry).toBe("design/session_api/entry.html");

    const videoMaterializedResponse = await fetch(`${base}/workspace/ws/templates/ipollowork.html-anything.video-hyperframes/materialize`, { method: "POST", headers, body: JSON.stringify({ sessionId: "session_video" }) });
    expect(videoMaterializedResponse.status).toBe(200);
    const videoMaterialized = await videoMaterializedResponse.json();
    expect(videoMaterialized.state.entry).toBe("video/session_video/index.html");
    expect(await readFile(join(root, videoMaterialized.state.entry), "utf8")).toContain("data-composition-variables");
    const videoTemplate = await fetch(`${base}/workspace/ws/template-sessions/session_video`, { headers }).then((response) => response.json());
    expect(videoTemplate.manifest.surface).toBe("video");
    expect((await fetch(`${base}/workspace/ws/design-sessions/session_video/template`, { headers })).status).toBe(404);

    const uninstallResponse = await fetch(`${base}/workspace/ws/templates/ipollowork.saas-landing`, { method: "DELETE", headers });
    expect(uninstallResponse.status).toBe(200);
    expect(await readFile(join(root, materialized.state.entry), "utf8")).toContain("<!doctype html>");
    const sessions = await fetch(`${base}/workspace/ws/template-sessions`, { headers }).then((response) => response.json());
    expect(sessions.items.map((item: { sessionId: string }) => item.sessionId)).toEqual(expect.arrayContaining(["session_api", "session_video"]));
    const metadata = await fetch(`${base}/workspace/ws/template-sessions/session_api`, { headers }).then((response) => response.json());
    expect(metadata.manifest.id).toBe("ipollowork.saas-landing");
  });
});
