import { lstat, readdir, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { importNodeSqlite } from "./node-sqlite.js";
import { runtimeDbPath, runtimeStorageDir } from "./runtime-storage.js";
import { ensureDir } from "./utils.js";
import { sessionInfoSchema } from "./session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

const summarySchema = sessionInfoSchema.extend({ engineId: z.string() });
export type LifecycleSummary = z.infer<typeof summarySchema>;
const cleanupSchema = z.object({ paths: z.array(z.string()), retainedPaths: z.array(z.string()) });
export type ResourceCleanup = z.infer<typeof cleanupSchema>;
type ActiveOperation = { sessionId?: string; done: Promise<void> };
const activeOperations = new WeakMap<ServerConfig, Map<string, Set<ActiveOperation>>>();
/** Register before checking the barrier, so deletion can drain already accepted writes. */
export async function beginResourceOperation(config: ServerConfig, workspaceId: string, sessionId?: string, allowArchived = false) {
  const projects = activeOperations.get(config) ?? new Map<string, Set<ActiveOperation>>(); activeOperations.set(config, projects);
  const operations = projects.get(workspaceId) ?? new Set<ActiveOperation>(); projects.set(workspaceId, operations);
  let finish = () => {};
  const operation = { sessionId, done: new Promise<void>(resolve => { finish = resolve; }) };
  operations.add(operation);
  const release = () => { operations.delete(operation); if (!operations.size) projects.delete(workspaceId); finish(); };
  try { await assertResourceWritable(config, workspaceId, sessionId, allowArchived); return release; }
  catch (error) { release(); throw error; }
}
export async function releaseResourceOperations(config: ServerConfig, workspaceId: string, sessionId?: string) {
  const operations = activeOperations.get(config)?.get(workspaceId);
  if (operations) await Promise.all([...operations].filter(operation => sessionId === undefined || operation.sessionId === undefined || operation.sessionId === sessionId).map(operation => operation.done));
}
const rowSchema = z.object({
  workspaceId: z.string(), sessionId: z.string(), engineId: z.string(), archivedAt: z.number().nullable(),
  deleting: z.number(), engineDeleted: z.number(), summary: z.string().nullable(), cleanup: z.string().nullable(),
});

async function database(config: ServerConfig) {
  const path = runtimeDbPath(config);
  await ensureDir(dirname(path));
  const db = typeof process.versions.bun === "string"
    ? new (await import("bun:sqlite")).Database(path, { create: true })
    : new (await importNodeSqlite()).DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS resource_lifecycle (
        workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, engine_id TEXT NOT NULL,
        archived_at INTEGER, deleting INTEGER NOT NULL DEFAULT 0, engine_deleted INTEGER NOT NULL DEFAULT 0,
        summary TEXT, cleanup TEXT, PRIMARY KEY (workspace_id, session_id)
      );`);
    return db;
  } catch (error) { db.close(); throw error; }
}
const select = "SELECT workspace_id AS workspaceId, session_id AS sessionId, engine_id AS engineId, archived_at AS archivedAt, deleting, engine_deleted AS engineDeleted, summary, cleanup FROM resource_lifecycle";
function decode(value: unknown) {
  const row = rowSchema.parse(value);
  return { ...row, summary: row.summary ? summarySchema.parse(JSON.parse(row.summary)) : null,
    cleanup: row.cleanup ? cleanupSchema.parse(JSON.parse(row.cleanup)) : null };
}
export async function readResourceLifecycle(config: ServerConfig, workspaceId: string, sessionId = "") {
  const db = await database(config);
  try {
    const statement = db.prepare(`${select} WHERE workspace_id = ? AND session_id = ?`);
    try { const row = statement.get(workspaceId, sessionId); return row ? decode(row) : null; }
    finally { if ("finalize" in statement) statement.finalize(); }
  } finally { db.close(); }
}
export async function listResourceLifecycles(config: ServerConfig, workspaceId: string) {
  const db = await database(config);
  try {
    const statement = db.prepare(`${select} WHERE workspace_id = ?`);
    try { return statement.all(workspaceId).map(decode); }
    finally { if ("finalize" in statement) statement.finalize(); }
  } finally { db.close(); }
}
export async function rememberResourceSummaries(config: ServerConfig, workspaceId: string, summaries: LifecycleSummary[]) {
  const db = await database(config);
  try {
    db.exec("BEGIN IMMEDIATE");
    const statement = db.prepare(`INSERT INTO resource_lifecycle(workspace_id, session_id, engine_id, archived_at, summary)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET summary = excluded.summary
      WHERE resource_lifecycle.summary IS NOT excluded.summary AND resource_lifecycle.deleting = 0`);
    try { for (const value of summaries) { const summary = summarySchema.parse(value); statement.run(workspaceId, summary.id, summary.engineId, summary.time?.archived || null, JSON.stringify(summary)); } }
    finally { if ("finalize" in statement) statement.finalize(); }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; } finally { db.close(); }
}
export async function archiveResource(config: ServerConfig, workspaceId: string, sessionId: string, engineId: string, archived: boolean, summary?: LifecycleSummary) {
  const db = await database(config);
  try {
    const statement = db.prepare(`INSERT INTO resource_lifecycle(workspace_id, session_id, engine_id, archived_at, summary)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET
      archived_at = excluded.archived_at, summary = COALESCE(excluded.summary, resource_lifecycle.summary)
      WHERE resource_lifecycle.deleting = 0`);
    try { statement.run(workspaceId, sessionId, engineId, archived ? Date.now() : null, summary ? JSON.stringify(summarySchema.parse(summary)) : null); }
    finally { if ("finalize" in statement) statement.finalize(); }
  } finally { db.close(); }
}
export async function beginResourceDeletion(config: ServerConfig, workspaceId: string, sessionId: string, engineId: string, cleanup: ResourceCleanup, summary?: LifecycleSummary) {
  const db = await database(config);
  try {
    const statement = db.prepare(`INSERT INTO resource_lifecycle(workspace_id, session_id, engine_id, deleting, cleanup, summary)
      VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(workspace_id, session_id) DO UPDATE SET deleting = 1,
      cleanup = COALESCE(resource_lifecycle.cleanup, excluded.cleanup), summary = COALESCE(resource_lifecycle.summary, excluded.summary)`);
    try { statement.run(workspaceId, sessionId, engineId, JSON.stringify(cleanupSchema.parse(cleanup)), summary ? JSON.stringify(summarySchema.parse(summary)) : null); }
    finally { if ("finalize" in statement) statement.finalize(); }
  } finally { db.close(); }
}
export async function markResourceEngineDeleted(config: ServerConfig, workspaceId: string, sessionId: string) {
  const db = await database(config);
  try { run(db, "UPDATE resource_lifecycle SET engine_deleted = 1 WHERE workspace_id = ? AND session_id = ?", workspaceId, sessionId); }
  finally { db.close(); }
}
export async function forgetResourceLifecycle(config: ServerConfig, workspaceId: string, sessionId?: string) {
  const db = await database(config);
  try {
    if (sessionId === undefined) run(db, "DELETE FROM resource_lifecycle WHERE workspace_id = ? AND session_id <> ''", workspaceId);
    // Keep only an opaque deletion barrier, never history, filenames, or recoverable content.
    run(db, "UPDATE resource_lifecycle SET deleting = 2, engine_deleted = 1, engine_id = '', archived_at = NULL, summary = NULL, cleanup = NULL WHERE workspace_id = ? AND session_id = ?", workspaceId, sessionId ?? "");
  } finally { db.close(); }
}
export async function assertResourceWritable(config: ServerConfig, workspaceId: string, sessionId?: string, allowArchived = false) {
  if (!allowArchived && config.workspaces.find(workspace => workspace.id === workspaceId)?.archivedAt) throw new ApiError(409, "resource_archived", "项目已归档，请先恢复。");
  const db = await database(config);
  let records: ReturnType<typeof decode>[];
  try {
    const query = db.prepare(`${select} WHERE workspace_id = ? AND session_id IN ('', ?)`);
    try { records = query.all(workspaceId, sessionId ?? "").map(decode); } finally { if ("finalize" in query) query.finalize(); }
  } finally { db.close(); }
  const blocked = records.find(row => row.deleting || (!allowArchived && row.archivedAt));
  if (blocked?.deleting === 2) throw new ApiError(410, "resource_deleted", "此项目或会话已删除。");
  if (blocked) throw new ApiError(409, blocked.deleting ? "resource_deleting" : "resource_archived",
    blocked.deleting ? "正在删除，请等待清理完成。" : "此项目或会话已归档，请先恢复。" );
}
/** Only explicit project creation may reuse a path whose previous project was deleted. */
export async function resetDeletedProject(config: ServerConfig, workspaceId: string) {
  const db = await database(config);
  try { run(db, "DELETE FROM resource_lifecycle WHERE workspace_id = ? AND deleting = 2", workspaceId); }
  finally { db.close(); }
}
/** Do not resurrect deleted projects from a stale registry during boot. */
export async function reconcileResourceWorkspaces(config: ServerConfig) {
  const retained: WorkspaceInfo[] = [];
  for (const workspace of config.workspaces) {
    const state = await readResourceLifecycle(config, workspace.id);
    if (state?.deleting === 2) continue;
    retained.push(state?.deleting ? { ...workspace, archivedAt: workspace.archivedAt || Date.now() } : workspace);
  }
  config.workspaces = retained;
}
/** Remove host-owned data only after producers have stopped and file cleanup succeeded. */
export async function deleteResourceRecords(config: ServerConfig, workspaceId: string, sessionId?: string) {
  const db = await database(config);
  try {
    db.exec("BEGIN IMMEDIATE");
    const tables = ["video_jobs", "enterprise_session_snapshots", "template_session_snapshots", ...(sessionId === undefined ? ["ipollowork_workspace_configs", "runtime_opencode_configs", "template_installations"] : [])];
    for (const table of tables) {
      const query = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
      let exists: unknown;
      try { exists = query.get(table); } finally { if ("finalize" in query) query.finalize(); }
      if (!exists) continue;
      if (sessionId === undefined) run(db, `DELETE FROM ${table} WHERE workspace_id = ?`, workspaceId);
      else run(db, `DELETE FROM ${table} WHERE workspace_id = ? AND session_id = ?`, workspaceId, sessionId);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; } finally { db.close(); }
}

function run(db: Awaited<ReturnType<typeof database>>, sql: string, ...values: string[]) {
  const statement = db.prepare(sql);
  try { statement.run(...values); } finally { if ("finalize" in statement) statement.finalize(); }
}

function contained(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
/** Check every ancestor, including missing leaves; never traverse a directory link. */
export async function verifyCleanupPath(root: string, path: string, allowRoot = false) {
  const absoluteRoot = resolve(root); const absolute = resolve(path);
  if (!contained(absoluteRoot, absolute) || (!allowRoot && absolute === absoluteRoot)) throw new ApiError(400, "unsafe_cleanup_path", "清理路径超出所属项目。");
  let current = absolute;
  while (contained(absoluteRoot, current)) {
    const info = await lstat(current).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (info?.isSymbolicLink() && current !== absolute) throw new ApiError(409, "linked_cleanup_parent", "清理路径包含目录链接，请先检查文件归属。");
    if (current === absoluteRoot) {
      if (info?.isSymbolicLink()) throw new ApiError(409, "linked_workspace", "项目根目录是链接，无法整体删除。");
      break;
    }
    current = dirname(current);
  }
  return absolute;
}
export async function removeOwnedFiles(root: string, cleanup: ResourceCleanup, allowRoot = false) {
  const protectedPaths = cleanup.retainedPaths.map(path => resolve(root, path));
  async function remove(path: string) {
    const absolute = await verifyCleanupPath(root, path, allowRoot);
    if (protectedPaths.some(protectedPath => protectedPath === absolute || contained(protectedPath, absolute))) return;
    const info = await lstat(absolute).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) return;
    if (info.isSymbolicLink()) { await unlink(absolute); return; }
    if (!info.isDirectory()) { await rm(absolute, { force: true }); return; }
    // Recursive rm unlinks junctions, and the ancestor check prevents entering one.
    if (!protectedPaths.some(protectedPath => contained(absolute, protectedPath))) { await rm(absolute, { recursive: true, force: true, maxRetries: 3 }); return; }
    for (const entry of await readdir(absolute)) await remove(join(absolute, entry));
    if (!(await readdir(absolute)).length) await rm(absolute, { recursive: true, force: true });
  }
  for (const path of cleanup.paths) await remove(resolve(root, path));
}
export async function validateProjectDeletion(config: ServerConfig, workspace: WorkspaceInfo) {
  if (workspace.workspaceType === "remote") throw new ApiError(400, "remote_project_delete", "请连接项目所在服务端后删除项目及文件。");
  const root = resolve(workspace.path);
  if (root === dirname(root) || contained(root, homedir()) || contained(root, runtimeStorageDir(config))) {
    throw new ApiError(409, "protected_project_root", "该目录承载系统或服务运行数据，不能作为项目整体删除。");
  }
  if (config.workspaces.some(other => other.id !== workspace.id && other.workspaceType !== "remote" && other.path && contained(root, other.path))) {
    throw new ApiError(409, "project_directory_in_use", "该目录仍被其他项目使用，请先处理关联项目。");
  }
  await verifyCleanupPath(root, root, true);
}
