import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { archiveResource, assertResourceWritable, beginResourceDeletion, beginResourceOperation, forgetResourceLifecycle, markResourceEngineDeleted, readResourceLifecycle, reconcileResourceWorkspaces, releaseResourceOperations, removeOwnedFiles, resetDeletedProject, validateProjectDeletion } from "./resource-lifecycle.js";
import { deleteDeepSeekSessionFiles } from "./deepseek-harness-runtime.js";
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

test("archiving preserves owned files, restoration permits work, deletion barriers survive retry and restart", async () => {
  const { config, project } = await fixture();
  await writeFile(join(project, "original.txt"), "original");
  await archiveResource(config, "project", "ses_a", "deepseek-harness", true, { id: "ses_a", engineId: "deepseek-harness" });
  await expect(assertResourceWritable(config, "project", "ses_a")).rejects.toMatchObject({ code: "resource_archived" });
  expect(await readFile(join(project, "original.txt"), "utf8")).toBe("original");
  await archiveResource(config, "project", "ses_a", "deepseek-harness", false);
  await assertResourceWritable(config, "project", "ses_a");
  await beginResourceDeletion(config, "project", "ses_a", "deepseek-harness", { paths: ["original.txt"], retainedPaths: [] });
  await markResourceEngineDeleted(config, "project", "ses_a");
  await beginResourceDeletion(config, "project", "ses_a", "deepseek-harness", { paths: [], retainedPaths: [] });
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.cleanup?.paths).toEqual(["original.txt"]);
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.engineDeleted).toBe(1);
  await forgetResourceLifecycle(config, "project", "ses_a");
  await expect(assertResourceWritable(config, "project", "ses_a")).rejects.toMatchObject({ code: "resource_deleted" });
  expect((await readResourceLifecycle(config, "project", "ses_a"))?.summary).toBeNull();
  await resetDeletedProject(config, "project"); await assertResourceWritable(config, "project", "ses_a");
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
