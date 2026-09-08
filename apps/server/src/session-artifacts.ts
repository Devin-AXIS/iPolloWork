import { realpath, stat } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { z } from "zod";
import type { SessionArtifactPage } from "@ipollowork/types/workspace";
import { ApiError } from "./errors.js";
import { importNodeSqlite } from "./node-sqlite.js";
import { resolveWithinRoot } from "./paths.js";
import { runtimeDbPath } from "./runtime-storage.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { ensureDir } from "./utils.js";

const PAGE_SIZE = 100;
const artifactRow = z.object({
  sequence: z.number(),
  path: z.string(),
  size: z.number(),
  updatedAt: z.number(),
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
    const statement = db.prepare(`INSERT INTO session_artifacts(workspace_id, session_id, path, size, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, session_id, path) DO UPDATE SET size = excluded.size, updated_at = excluded.updated_at`);
    try {
      statement.run(workspace.id, owner, normalizedPath, info.size, info.mtimeMs);
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
      SELECT sequence, path, size, updated_at AS updatedAt FROM session_artifacts
      WHERE workspace_id = ? AND session_id = ? AND sequence < ?
      ORDER BY sequence DESC LIMIT ?
    `);
    try {
      const rows = z.array(artifactRow).parse(statement.all(workspaceId, owner, cursor ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE + 1));
      const page = rows.slice(0, PAGE_SIZE);
      return {
        items: page.map(({ path, size, updatedAt }) => ({ path, size, updatedAt })),
        nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].sequence : null,
      };
    } finally {
      if ("finalize" in statement) statement.finalize();
    }
  } finally {
    db.close();
  }
}
