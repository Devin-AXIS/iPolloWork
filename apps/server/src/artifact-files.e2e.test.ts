import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { listSessionArtifacts, recordSessionArtifact } from "./session-artifacts.js";
import { createVideoJob, updateVideoJob } from "./extensions/video-jobs.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-artifacts-"));
  roots.push(root);
  await mkdir(join(root, "reports"), { recursive: true });
  await writeFile(join(root, "reports", "artifact-eval.md"), "# Artifact Eval\n\nHello markdown.\n", "utf8");
  await writeFile(join(root, "reports", "artifact-eval.csv"), "name,revenue\nAda,10\nGrace,20\n", "utf8");
  await writeFile(join(root, "reports", "index.html"), "<!doctype html><h1>Artifact site</h1>", "utf8");
  await writeFile(join(root, "reports", "artifact-eval.xlsx"), new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]));
  await writeFile(join(root, "reports", "artifact-eval.pptx"), new Uint8Array([80, 75, 3, 4, 5, 6, 7, 8]));
  await mkdir(join(root, "analysis", "data"), { recursive: true });
  await writeFile(join(root, "analysis", "data", "account_monthly.csv"), "month,total\n2026-08,12\n", "utf8");
  await mkdir(join(root, "duplicate"), { recursive: true });
  await writeFile(join(root, "duplicate", "index.html"), "<!doctype html><h1>Duplicate</h1>", "utf8");
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
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, config };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

describe("artifact file routes", () => {
  test("artifact reads expose scoped live video states without prompts or upstream identifiers", async () => {
    const root = await createWorkspaceRoot();
    const { base, token, config } = await startiPolloWorkServer(root);
    const now = Date.now();
    const { job } = await createVideoJob(config, { id: "video-status-proof", workspaceId: "ws_1", sessionId: "media-session",
      model: "test-model", operation: "text", prompt: "private prompt", fingerprint: "test", upstreamId: "private-id",
      status: "running", path: "", message: "waiting", createdAt: now, updatedAt: now, nextPoll: now + 3600000,
    });
    const read = (session: string) => fetch(`${base}/workspace/ws_1/artifacts?sessionId=${session}`, { headers: auth(token) }).then(r => r.json());
    const page = await read("media-session");
    expect(page.videoJobs).toEqual([{ id: job.id, model: job.model, status: "running", updatedAt: now }]);
    expect(JSON.stringify(page)).not.toContain("private");
    expect((await read("other-session")).videoJobs).toEqual([]);
    await updateVideoJob(config, job, { status: "succeeded", path: "video/result.mp4" });
    expect((await read("media-session")).videoJobs[0].status).toBe("succeeded");
    expect((await fetch(`${base}/workspace/ws_1/artifacts?sessionId=media-session`)).status).toBe(401);
  });
  test("imports bounded media into its workspace path without overwriting an existing asset", async () => {
    const root = await createWorkspaceRoot();
    const { base, token } = await startiPolloWorkServer(root);
    const path = "design/media-proof/assets/background.mp4";
    const bytes = new Uint8Array(5_100_000).fill(37);
    const upload = (target: string, authorized = true, content = bytes) => {
      const body = new FormData();
      body.set("file", new File([content], "background.mp4", { type: "video/mp4" }));
      return fetch(`${base}/workspace/ws_1/files/raw?path=${encodeURIComponent(target)}`, {
        method: "POST", body, headers: authorized ? { Authorization: `Bearer ${token}` } : {},
      });
    };
    expect((await upload(path, false)).status).toBe(401);
    expect((await upload("../escape.mp4")).status).toBe(400);
    expect((await upload("design/media-proof/assets/executable.js")).status).toBe(400);
    expect((await upload("empty.mp4", true, new Uint8Array())).status).toBe(400);
    expect((await fetch(`${base}/workspace/ws_1/files/raw?path=malformed.mp4`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" }, body: "invalid",
    })).status).toBe(400);
    expect((await upload("too-large.png", true, new Uint8Array(25 * 1024 * 1024 + 1))).status).toBe(413);
    const outside = await createWorkspaceRoot();
    await symlink(outside, join(root, "outside"), process.platform === "win32" ? "junction" : "dir");
    expect((await upload("outside/new/escaped.mp4")).status).toBe(400);
    expect(await readFile(join(outside, "new/escaped.mp4")).catch(() => null)).toBeNull();
    expect((await upload(path)).status).toBe(200);
    expect(await readFile(join(root, path))).toEqual(Buffer.from(bytes));
    expect((await upload(path)).status).toBe(409);
    const downloaded = await fetch(`${base}/workspace/ws_1/files/raw?path=${path}`, { headers: auth(token) });
    expect(downloaded.headers.get("content-type")).toBe("video/mp4");
    expect((await downloaded.arrayBuffer()).byteLength).toBe(bytes.length);
    // Legacy JSON binary writes retain their original 5 MB bound.
    expect((await fetch(`${base}/workspace/ws_1/files/raw`, {
      method: "POST", headers: auth(token), body: JSON.stringify({ path: "large.png", dataBase64: Buffer.from(bytes).toString("base64") }),
    })).status).toBe(413);
  });
  test("persists session outputs independently of chat, isolates owners, and rejects unsafe paths", async () => {
    const root = await createWorkspaceRoot();
    const { base, token, config } = await startiPolloWorkServer(root);
    const workspace = config.workspaces[0];
    const path = "reports/artifact-eval.md";
    const generation = { id: "receipt-1", kind: "image", model: "Test image model", completedAt: 1000 } satisfies NonNullable<import("@ipollowork/types/workspace").SessionArtifact["generation"]>;
    await recordSessionArtifact(config, workspace, "session-a", path, undefined, generation);
    await Promise.all(Array.from({ length: 5 }, () => recordSessionArtifact(config, workspace, "session-a", path)));
    await recordSessionArtifact(config, workspace, "session-b", "reports/artifact-eval.csv");
    const response = await fetch(`${base}/workspace/ws_1/artifacts?sessionId=session-a`, { headers: auth(token) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ path, generation }], nextCursor: null });
    expect((await listSessionArtifacts(config, "ws_1", "session-b")).items.map((item) => item.path)).toEqual(["reports/artifact-eval.csv"]);
    expect((await listSessionArtifacts(config, "another-workspace", "session-a")).items).toEqual([]);
    expect((await listSessionArtifacts(config, "ws_1", "empty-session")).items).toEqual([]);
    await expect(recordSessionArtifact(config, workspace, "session-a", "../outside.png")).rejects.toThrow();
    await expect(recordSessionArtifact(config, workspace, "session-a", "reports/missing.png")).rejects.toThrow();
    expect((await fetch(`${base}/workspace/ws_1/artifacts?sessionId=session-a`)).status).toBe(401);
    for (const query of ["sessionId=../escape", "sessionId=", "sessionId=session-a&cursor=invalid"]) {
      expect((await fetch(`${base}/workspace/ws_1/artifacts?${query}`, { headers: auth(token) })).status).toBe(400);
    }
    // A new server and DB connection reconstruct the association without any UI state.
    await stops.pop()?.();
    const restarted = await startiPolloWorkServer(root);
    expect(await (await fetch(`${restarted.base}/workspace/ws_1/artifacts?sessionId=session-a`, { headers: auth(restarted.token) })).json())
      .toMatchObject({ items: [{ path, generation }], nextCursor: null });
  });

  test("pages saved outputs without duplicates or scanning unrelated workspace files", async () => {
    const root = await createWorkspaceRoot();
    const { config } = await startiPolloWorkServer(root);
    for (let index = 0; index < 103; index++) {
      const path = `reports/output-${index}.png`;
      await writeFile(join(root, path), "image");
      await recordSessionArtifact(config, config.workspaces[0], "session-many", path);
    }
    const first = await listSessionArtifacts(config, "ws_1", "session-many");
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).not.toBeNull();
    const second = await listSessionArtifacts(config, "ws_1", "session-many", first.nextCursor);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.path)).size).toBe(103);
  });

  test("resolve, read, write, and download markdown/csv/xlsx/pptx/html artifacts", async () => {
    const root = await createWorkspaceRoot();
    const { base, token } = await startiPolloWorkServer(root);

    const resolveResponse = await fetch(`${base}/workspace/ws_1/artifacts/resolve`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        targets: [
          { kind: "file", value: join(root, "reports", "artifact-eval.md"), confidence: 95 },
          { kind: "file", value: "Workspace/32423/reports/artifact-eval.md", confidence: 80 },
          { kind: "file", value: "reports/artifact-eval.csv", confidence: 80 },
          { kind: "file", value: "reports/artifact-eval.xlsx", confidence: 80 },
          { kind: "file", value: "reports/artifact-eval.pptx", confidence: 80 },
          { kind: "file", value: "reports/index.html", confidence: 80 },
          { kind: "file", value: "account_monthly.csv", confidence: 80 },
          { kind: "file", value: "index.html", confidence: 80 },
          { kind: "file", value: "reports/missing.md", confidence: 80 },
          { kind: "url", value: "http://localhost:4321", confidence: 80 },
          { kind: "url", value: "ws://localhost:4321/socket", confidence: 80 },
        ],
      }),
    });
    expect(resolveResponse.status).toBe(200);
    const resolved = await resolveResponse.json() as { items: Array<any> };
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.md")).toMatchObject({ exists: true, preview: "markdown", confidence: 95 });
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.csv")).toMatchObject({ exists: true, preview: "sheet" });
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.xlsx")).toMatchObject({ exists: true, preview: "sheet" });
    expect(resolved.items.find((item) => item.value === "reports/artifact-eval.pptx")).toMatchObject({ exists: true, preview: "slides", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    expect(resolved.items.find((item) => item.value === "reports/index.html")).toMatchObject({ exists: true, preview: "html" });
    expect(resolved.items.find((item) => item.value === "analysis/data/account_monthly.csv")).toMatchObject({ exists: true, preview: "sheet" });
    expect(resolved.items.find((item) => item.value === "index.html")).toMatchObject({ exists: false });
    expect(resolved.items.find((item) => item.value === "reports/missing.md")).toMatchObject({ exists: false });
    expect(resolved.items.find((item) => item.value === "http://localhost:4321/")).toMatchObject({ kind: "url", preview: "browser" });
    expect(resolved.items.find((item) => item.value === "ws://localhost:4321/socket")).toMatchObject({ kind: "url", preview: "browser" });

    const csvRead = await fetch(`${base}/workspace/ws_1/files/content?path=${encodeURIComponent("reports/artifact-eval.csv")}`, { headers: auth(token) });
    expect(await csvRead.json()).toMatchObject({ content: "name,revenue\nAda,10\nGrace,20\n" });

    const mdWrite = await fetch(`${base}/workspace/ws_1/files/content`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ path: "reports/artifact-eval.md", content: "# Updated\n" }),
    });
    expect(mdWrite.status).toBe(200);
    expect(await readFile(join(root, "reports", "artifact-eval.md"), "utf8")).toBe("# Updated\n");

    const xlsxWrite = await fetch(`${base}/workspace/ws_1/files/raw`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ path: "reports/artifact-eval.xlsx", dataBase64: Buffer.from([80, 75, 9, 9]).toString("base64") }),
    });
    expect(xlsxWrite.status).toBe(200);

    const xlsxDownload = await fetch(`${base}/workspace/ws_1/files/raw?path=${encodeURIComponent("reports/artifact-eval.xlsx")}`, { headers: auth(token) });
    expect(xlsxDownload.status).toBe(200);
    expect(Array.from(new Uint8Array(await xlsxDownload.arrayBuffer()))).toEqual([80, 75, 9, 9]);
  });
});
