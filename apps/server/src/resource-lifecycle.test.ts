import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertResourceWritable, beginResourceDeletion, beginResourceOperation, forgetResourceLifecycle, markResourceEngineDeleted, readResourceLifecycle, reconcileResourceWorkspaces, releaseResourceOperations, removeOwnedFiles, resetDeletedProject, validateProjectDeletion } from "./resource-lifecycle.js";
import { DeepSeekHarnessRuntimePool, deleteDeepSeekSessionFiles } from "./deepseek-harness-runtime.js";
import { CodexHarnessRuntimePool } from "./codex-harness-runtime.js";
import { EnvService } from "./env-file.js";
import { recordSessionArtifact, sessionArtifactCleanup, deleteSessionArtifactRecords, listSessionArtifacts } from "./session-artifacts.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ipollowork-lifecycle-")); roots.push(root);
  const project = join(root, "project"); await mkdir(project);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test", hostToken: "test-host", configPath: join(root, "state", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [project], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    workspaces: [{ id: "project", path: project, name: "Project", preset: "starter", workspaceType: "local", engineId: "opencode" }],
  };
  return { root, config, workspace: config.workspaces[0], project };
}

test("deletion scope and barriers survive retries and project re-registration", async () => {
  const { config, project } = await fixture();
  await writeFile(join(project, "original.txt"), "original");
  expect(await readFile(join(project, "original.txt"), "utf8")).toBe("original");
  await assertResourceWritable(config, "project", "ses_a");
  await beginResourceDeletion(config, "project", "ses_a", "deepseek-harness", { paths: ["original.txt"], retainedPaths: [] });
  await markResourceEngineDeleted(config, "project", "ses_a");
  await beginResourceDeletion(config, "project", "ses_a", "deepseek-harness", { paths: [], retainedPaths: [] });
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.cleanup?.paths).toEqual(["original.txt"]);
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.engineDeleted).toBe(1);
  await forgetResourceLifecycle(config, "project", "ses_a");
  await expect(assertResourceWritable(config, "project", "ses_a")).rejects.toMatchObject({ code: "resource_deleted" });
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.summary).toBeNull();
  await resetDeletedProject(config, "project");
  await expect(assertResourceWritable(config, "project", "ses_a")).rejects.toMatchObject({ code: "resource_deleted" });
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.deleteFiles).toBe(1);
  await beginResourceDeletion(config, "project", "ses_keep", "deepseek-harness", { paths: [], retainedPaths: [] }, undefined, false);
  await beginResourceDeletion(config, "project", "ses_keep", "deepseek-harness", { paths: [], retainedPaths: [] }, undefined, true);
  expect((await readResourceLifecycle(config, "project", "ses_keep"))?.deleteFiles).toBe(0);
  await forgetResourceLifecycle(config, "project", "ses_keep");
  expect((await readResourceLifecycle(config, "project", "ses_keep"))?.deleteFiles).toBe(0);
  expect((await readResourceLifecycle(config, "project", "ses_keep"))?.engineDeleted).toBe(0);
  await expect(assertResourceWritable({ ...config }, "project", "ses_keep")).rejects.toMatchObject({ code: "resource_deleted" });
  expect(await readFile(join(project, "original.txt"), "utf8")).toBe("original");
});

test("legacy lifecycle databases migrate pending full deletion and expose previously archived projects", async () => {
  const { config, workspace, root } = await fixture();
  await mkdir(join(root, "state"));
  const { Database } = await import("bun:sqlite");
  const db = new Database(join(root, "state", "runtime.sqlite"));
  db.exec(`CREATE TABLE resource_lifecycle (
    workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, engine_id TEXT NOT NULL,
    archived_at INTEGER, deleting INTEGER NOT NULL DEFAULT 0, engine_deleted INTEGER NOT NULL DEFAULT 0,
    summary TEXT, cleanup TEXT, PRIMARY KEY (workspace_id, session_id)
  ); INSERT INTO resource_lifecycle(workspace_id,session_id,engine_id,deleting) VALUES ('project','ses_pending','opencode',1);`);
  db.close();
  expect((await readResourceLifecycle(config, "project", "ses_pending"))?.deleteFiles).toBe(1);
  config.workspaces = [{ ...workspace, archivedAt: 100 }];
  await reconcileResourceWorkspaces(config);
  expect(config.workspaces).toHaveLength(1);
  expect(config.workspaces[0]?.archivedAt).toBeUndefined();
  await expect(assertResourceWritable(config, "project", "ses_pending")).rejects.toMatchObject({ code: "resource_deleting" });
});

for (const engine of ["codex-harness", "deepseek-harness"]) test(`${engine}: cleanup waits for a runtime already closing after config reload`, async () => {
  const { config, workspace, root } = await fixture();
  const env = new EnvService({ path: join(root, "env.json") });
  const pool = engine === "codex-harness" ? new CodexHarnessRuntimePool({ config, env }) : new DeepSeekHarnessRuntimePool({ config, env });
  const runtime = pool.forWorkspace({ ...workspace, engineId: engine });
  let finish = () => {};
  const closed = new Promise<void>(resolve => { finish = resolve; });
  const close = spyOn(runtime, "close").mockImplementation(() => closed);
  let deletionMayStart = false;
  const reload = pool.closeWorkspace(workspace.id);
  const deletion = pool.closeWorkspace(workspace.id).then(() => { deletionMayStart = true; });
  await Promise.resolve();
  expect(deletionMayStart).toBe(false);
  const shutdown = pool.close();
  expect(() => pool.forWorkspace({ ...workspace, engineId: engine })).toThrow("server runtime pool has been closed");
  finish();
  await Promise.all([reload, deletion, shutdown]);
  expect(deletionMayStart).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  close.mockRestore();
  await pool.close();
  expect(() => pool.forWorkspace({ ...workspace, engineId: engine })).toThrow("server runtime pool has been closed");
});

test("deleting a session removes its files and index, keeping shared files and other sessions", async () => {
  const { config, workspace, project } = await fixture();
  await mkdir(join(project, "design", "ses_a"), { recursive: true });
  await mkdir(join(project, "video", "ses_a"), { recursive: true });
  await writeFile(join(project, "design", "ses_a", "own.html"), "owned");
  await writeFile(join(project, "design", "ses_a", "shared.png"), "shared");
  await writeFile(join(project, "video", "ses_a", "render.mp4"), "render");
  await recordSessionArtifact(config, workspace, "ses_a", "design/ses_a/own.html");
  await recordSessionArtifact(config, workspace, "ses_a", "design/ses_a/shared.png");
  await recordSessionArtifact(config, workspace, "ses_b", "design/ses_a/shared.png");
  await beginResourceDeletion(config, workspace.id, "ses_b", "opencode", { paths: [], retainedPaths: [] }, undefined, false);
  await forgetResourceLifecycle(config, workspace.id, "ses_b");
  const manifest = await sessionArtifactCleanup(config, workspace, "ses_a");
  await removeOwnedFiles(project, manifest);
  await deleteSessionArtifactRecords(config, workspace.id, "ses_a");
  await expect(access(join(project, "design", "ses_a", "own.html"))).rejects.toThrow();
  await expect(access(join(project, "video", "ses_a"))).rejects.toThrow();
  expect(await readFile(join(project, "design", "ses_a", "shared.png"), "utf8")).toBe("shared");
  expect((await listSessionArtifacts(config, workspace.id, "ses_a")).items).toHaveLength(0);
  expect((await listSessionArtifacts(config, workspace.id, "ses_b")).items).toHaveLength(1);
});

test("cleanup refuses path escapes and linked ancestors; deleting a junction never deletes its target", async () => {
  const { root, project } = await fixture(); const outside = join(root, "outside"); await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "keep");
  const link = join(project, "linked"); await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  await expect(removeOwnedFiles(project, { paths: ["../outside"], retainedPaths: [] })).rejects.toMatchObject({ code: "unsafe_cleanup_path" });
  await expect(removeOwnedFiles(project, { paths: ["linked/keep.txt"], retainedPaths: [] })).rejects.toMatchObject({ code: "linked_cleanup_parent" });
  await removeOwnedFiles(project, { paths: ["linked"], retainedPaths: [] });
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
});

test("project deletion protects nested registered projects and host runtime data", async () => {
  const { config, workspace, project } = await fixture();
  config.workspaces.push({ ...workspace, id: "nested", path: join(project, "nested") });
  await expect(validateProjectDeletion(config, workspace)).rejects.toMatchObject({ code: "project_directory_in_use" });
  config.workspaces.pop(); config.configPath = join(project, "state", "server.json");
  await expect(validateProjectDeletion(config, workspace)).rejects.toMatchObject({ code: "protected_project_root" });
});

test("DeepSeek deletion removes only the owned native session and refuses unknown nonblank layouts", async () => {
  const { root } = await fixture(); const home = join(root, "dsh");
  await mkdir(join(home, "sessions"), { recursive: true });
  await writeFile(join(home, "sessions", "ses_a.jsonl"), "history");
  await writeFile(join(home, "sessions", "ses_b.jsonl"), "keep");
  await deleteDeepSeekSessionFiles(home, "C:\\Projects\\Demo", "ses_a", false);
  await expect(access(join(home, "sessions", "ses_a.jsonl"))).rejects.toThrow();
  expect(await readFile(join(home, "sessions", "ses_b.jsonl"), "utf8")).toBe("keep");
  await expect(deleteDeepSeekSessionFiles(home, "C:\\Projects\\Demo", "ses_missing", false)).rejects.toMatchObject({ code: "deepseek_storage_layout" });
  await mkdir(join(home, "sessions", "--C-Projects-Demo--", "ses_modern"), { recursive: true });
  await writeFile(join(home, "sessions", "--C-Projects-Demo--", "ses_modern", "session.jsonl"), "history");
  await deleteDeepSeekSessionFiles(home, "C:\\Projects\\Demo", "ses_modern", false);
  await expect(access(join(home, "sessions", "--C-Projects-Demo--", "ses_modern"))).rejects.toThrow();
});

test("cleanup drains accepted file writers and rejects late work before removing a project", async () => {
  const { config, project } = await fixture();
  const release = await beginResourceOperation(config, "project", "ses_a");
  await beginResourceDeletion(config, "project", "", "", { paths: ["."], retainedPaths: [] });
  let drained = false; const waiting = releaseResourceOperations(config, "project").then(() => { drained = true; });
  await new Promise(resolve => setTimeout(resolve, 5)); expect(drained).toBe(false);
  await expect(beginResourceOperation(config, "project", "ses_a")).rejects.toMatchObject({ code: "resource_deleting" });
  await writeFile(join(project, "last-result.txt"), "accepted before delete"); release(); await waiting;
  await removeOwnedFiles(project, { paths: ["."], retainedPaths: [] }, true);
  await forgetResourceLifecycle(config, "project"); await reconcileResourceWorkspaces(config);
  expect(config.workspaces).toHaveLength(0); await expect(access(project)).rejects.toThrow();
});
