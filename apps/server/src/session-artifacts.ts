import { realpath, stat } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { z } from "zod";
import type { SessionArtifact, SessionArtifactPage } from "@ipollowork/types/workspace";
import { ApiError } from "./errors.js";
import { importNodeSqlite } from "./node-sqlite.js";
import { resolveWithinRoot } from "./paths.js";
import { runtimeDbPath } from "./runtime-storage.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureDir } from "./utils.js";

const PAGE_SIZE = 100;
const generationSchema = z.object({
  id: z.string(), kind: z.enum(["image", "video"]), model: z.string(), completedAt: z.number(),
  width: z.number().optional(), height: z.number().optional(), duration: z.number().optional(),
});
const artifactRow = z.object({
  sequence: z.number(),
  path: z.string(),
  size: z.number(),
  updatedAt: z.number(),
  generation: z.string().nullable(),
});

export function sessionArtifactOwner(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
    throw new ApiError(400, "invalid_session", "A valid sessionId is required");
  }
  return value;
}

async function openArtifactDb(config: ServerConfig) {
  const path = runtimeDbPath(config);
  await ensureDir(dirname(path));
  const sqlite = typeof process.versions.bun === "string"
    ? new (await import("bun:sqlite")).Database(path, { create: true })
    : new (await importNodeSqlite()).DatabaseSync(path);
  try {
    sqlite.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS session_artifacts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(workspace_id, session_id, path)
      );
      CREATE INDEX IF NOT EXISTS session_artifacts_owner
        ON session_artifacts(workspace_id, session_id, sequence DESC);
    `);
    sqlite.exec(`CREATE TABLE IF NOT EXISTS artifact_path_renames (workspace_id TEXT NOT NULL, old_path TEXT NOT NULL, new_path TEXT NOT NULL, PRIMARY KEY(workspace_id, old_path))`);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS artifact_path_renames_target ON artifact_path_renames(workspace_id, new_path)`);
    const columns = sqlite.prepare("PRAGMA table_info(session_artifacts)");
    try {
      if (!z.array(z.object({ name: z.string() })).parse(columns.all()).some(column => column.name === "generation")) {
        sqlite.exec("ALTER TABLE session_artifacts ADD COLUMN generation TEXT");
      }
    } finally { if ("finalize" in columns) columns.finalize(); }
    return sqlite;
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

/** Called only after the producer has saved its file; never stores image bytes. */
export async function recordSessionArtifact(
  config: ServerConfig,
  workspace: WorkspaceInfo,
  sessionId: string,
  path: string,
  replacedPath?: string,
  generation?: SessionArtifact["generation"],
): Promise<void> {
  const owner = sessionArtifactOwner(sessionId);
  const absolutePath = await resolveWithinRoot(workspace.path, path);
  const info = await stat(absolutePath);
  if (!info.isFile() || !info.size) throw new ApiError(400, "invalid_artifact", "Artifact must be a non-empty file");
  const normalizedPath = relative(await realpath(workspace.path), absolutePath).replaceAll("\\", "/");
  const db = await openArtifactDb(config);
  let transaction = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transaction = true;
    const statement = db.prepare(`INSERT INTO session_artifacts(workspace_id, session_id, path, size, updated_at, generation)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, session_id, path) DO UPDATE SET size = excluded.size, updated_at = excluded.updated_at, generation = COALESCE(session_artifacts.generation, excluded.generation)`);
    try {
      statement.run(workspace.id, owner, normalizedPath, info.size, info.mtimeMs, generation ? JSON.stringify(generationSchema.parse(generation)) : null);
    } finally {
      if ("finalize" in statement) statement.finalize();
    }
    if (replacedPath && replacedPath !== normalizedPath) {
      const remove = db.prepare("DELETE FROM session_artifacts WHERE workspace_id = ? AND session_id = ? AND path = ?");
      try { remove.run(workspace.id, owner, replacedPath); }
      finally { if ("finalize" in remove) remove.finalize(); }
    }
    db.exec("COMMIT");
  } catch (error) {
    if (transaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export async function listSessionArtifacts(
  config: ServerConfig,
  workspaceId: string,
  sessionId: string,
  cursor: number | null = null,
): Promise<SessionArtifactPage> {
  const owner = sessionArtifactOwner(sessionId);
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor <= 0)) {
    throw new ApiError(400, "invalid_cursor", "Artifact cursor must be a positive integer");
  }
  const db = await openArtifactDb(config);
  try {
    const statement = db.prepare(`
      SELECT sequence, path, size, updated_at AS updatedAt, generation FROM session_artifacts
      WHERE workspace_id = ? AND session_id = ? AND sequence < ?
      ORDER BY sequence DESC LIMIT ?
    `);
    try {
      const rows = z.array(artifactRow).parse(statement.all(workspaceId, owner, cursor ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE + 1));
      const page = rows.slice(0, PAGE_SIZE);
      const aliases = new Map<string, string[]>();
      if (page.length) {
        const query = db.prepare(`SELECT old_path, new_path FROM artifact_path_renames WHERE workspace_id = ? AND new_path IN (${page.map(() => "?").join(",")})`);
        try {
          for (const row of z.array(z.object({ old_path: z.string(), new_path: z.string() })).parse(query.all(workspaceId, ...page.map(item => item.path)))) {
            const paths = aliases.get(row.new_path) ?? []; paths.push(row.old_path); aliases.set(row.new_path, paths);
          }
        } finally { if ("finalize" in query) query.finalize(); }
      }
      return {
        items: page.map(({ path, size, updatedAt, generation }) => ({ path, size, updatedAt, ...(generation ? { generation: generationSchema.parse(JSON.parse(generation)) } : {}), ...(aliases.has(path) ? { previousPaths: aliases.get(path) } : {}) })),
        nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].sequence : null,
      };
    } finally {
      if ("finalize" in statement) statement.finalize();
    }
  } finally {
    db.close();
  }
}

export async function recordArtifactRename(config: ServerConfig, workspaceId: string, from: string, to: string, artifact: {sessionId:string;size:number;updatedAt:number}) {
  const db = await openArtifactDb(config);
  try {
    db.exec("BEGIN IMMEDIATE");
    const statements = [
      ["UPDATE OR REPLACE session_artifacts SET path = ? WHERE workspace_id = ? AND path = ?", [to, workspaceId, from]],
      ["UPDATE artifact_path_renames SET new_path = ? WHERE workspace_id = ? AND new_path = ?", [to, workspaceId, from]],
      ["DELETE FROM artifact_path_renames WHERE workspace_id = ? AND old_path = ?", [workspaceId, to]],
      ["INSERT OR REPLACE INTO artifact_path_renames VALUES (?, ?, ?)", [workspaceId, from, to]],
    ] satisfies Array<[string, string[]]>;
    for (const [sql, values] of statements) { const statement = db.prepare(sql); try { statement.run(...values); } finally { if ("finalize" in statement) statement.finalize(); } }
    const register = db.prepare(`INSERT INTO session_artifacts(workspace_id, session_id, path, size, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, session_id, path) DO UPDATE SET size = excluded.size, updated_at = excluded.updated_at`);
    try { register.run(workspaceId,sessionArtifactOwner(artifact.sessionId),to,artifact.size,artifact.updatedAt); }
    finally { if ("finalize" in register) register.finalize(); }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
