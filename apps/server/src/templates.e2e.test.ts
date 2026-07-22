import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    expect(catalog.items).toHaveLength(75);

    const invalidPackage = await fetch(`${base}/workspace/ws/templates/import`, {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/vnd.ipollowork-template+zip" },
      body: new Uint8Array([1]),
    });
    expect(invalidPackage.status).toBe(400);
    expect((await invalidPackage.json()).code).toBe("invalid_template_package");

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

    await mkdir(join(root, "video", "legacy_video"), { recursive: true });
    await writeFile(join(root, "video", "legacy_video", "index.html"), "<!doctype html><div data-composition-id=\"legacy-video\" data-duration=\"8\"></div>", "utf8");
    const adoptedResponse = await fetch(`${base}/workspace/ws/template-sessions/legacy_video/adopt-video`, { method: "POST", headers, body: "{}" });
    expect(adoptedResponse.status).toBe(200);
    const adopted = await adoptedResponse.json();
    expect(adopted.state.entry).toBe("video/legacy_video/index.html");
    expect(adopted.manifest.surface).toBe("video");
    expect(await readFile(join(root, adopted.state.entry), "utf8")).toContain("legacy-video");
    expect(JSON.parse(await readFile(join(root, adopted.state.briefPath), "utf8"))).toEqual({ source: "legacy-video-session" });

    const missingTemplateMetadataResponse = await fetch(`${base}/workspace/ws/template-sessions/plain-session`, { headers });
    expect(missingTemplateMetadataResponse.status).toBe(404);
    expect((await missingTemplateMetadataResponse.json()).code).toBe("template_session_not_found");

    const uninstallResponse = await fetch(`${base}/workspace/ws/templates/ipollowork.saas-landing`, { method: "DELETE", headers });
    expect(uninstallResponse.status).toBe(200);
    expect(await readFile(join(root, materialized.state.entry), "utf8")).toContain("<!doctype html>");
    const sessions = await fetch(`${base}/workspace/ws/template-sessions`, { headers }).then((response) => response.json());
    expect(sessions.items.map((item: { sessionId: string }) => item.sessionId)).toEqual(expect.arrayContaining(["session_api", "session_video"]));
    const metadata = await fetch(`${base}/workspace/ws/template-sessions/session_api`, { headers }).then((response) => response.json());
    expect(metadata.manifest.id).toBe("ipollowork.saas-landing");
  });
});
