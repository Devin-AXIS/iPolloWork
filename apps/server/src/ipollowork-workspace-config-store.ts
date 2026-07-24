import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

const ipolloworkWorkspaceConfigs = sqliteTable("ipollowork_workspace_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

type iPolloWorkWorkspaceConfigDb = {
  get: (workspaceId: string) => { configJson: string } | undefined;
  upsert: (value: { workspaceId: string; configJson: string; updatedAt: number }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeiPolloWorkWorkspaceConfig(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.IPOLLOWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "ipollowork");
  return join(configDir, "runtime.sqlite");
}

async function openDb(path: string): Promise<iPolloWorkWorkspaceConfigDb> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run("CREATE TABLE IF NOT EXISTS ipollowork_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const db = drizzle(sqlite);
    return {
      get: (workspaceId) => db
        .select()
        .from(ipolloworkWorkspaceConfigs)
        .where(eq(ipolloworkWorkspaceConfigs.workspaceId, workspaceId))
        .get(),
      upsert: ({ workspaceId, configJson, updatedAt }) => {
        db
          .insert(ipolloworkWorkspaceConfigs)
          .values({ workspaceId, configJson, updatedAt })
          .onConflictDoUpdate({
            target: ipolloworkWorkspaceConfigs.workspaceId,
            set: { configJson, updatedAt },
          })
          .run();
      },
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec("CREATE TABLE IF NOT EXISTS ipollowork_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const get = sqlite.prepare("SELECT config_json AS configJson FROM ipollowork_workspace_configs WHERE workspace_id = ?");
  const upsert = sqlite.prepare("INSERT INTO ipollowork_workspace_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at");
  return {
    get: (workspaceId) => {
      const row = get.get(workspaceId);
      if (!isRecord(row) || typeof row.configJson !== "string") return undefined;
      return { configJson: row.configJson };
    },
    upsert: ({ workspaceId, configJson, updatedAt }) => {
      upsert.run(workspaceId, configJson, updatedAt);
    },
  };
}

const dbByPath = new Map<string, Promise<iPolloWorkWorkspaceConfigDb>>();

async function workspaceConfigDb(config: ServerConfig): Promise<iPolloWorkWorkspaceConfigDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const db = openDb(path);
  dbByPath.set(path, db);
  return db;
}

export async function readiPolloWorkWorkspaceConfig(config: ServerConfig, workspaceId: string): Promise<Record<string, unknown>> {
  const db = await workspaceConfigDb(config);
  const row = db.get(workspaceId);
  if (!row) return {};
  try {
    return normalizeiPolloWorkWorkspaceConfig(JSON.parse(row.configJson));
  } catch {
    return {};
  }
}

export async function writeiPolloWorkWorkspaceConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = await workspaceConfigDb(config);
  const next = normalizeiPolloWorkWorkspaceConfig(updater(await readiPolloWorkWorkspaceConfig(config, workspaceId)));
  db.upsert({ workspaceId, configJson: JSON.stringify(next), updatedAt: Date.now() });
  return next;
}

export async function hasiPolloWorkWorkspaceConfig(
  config: ServerConfig,
  workspaceId: string,
): Promise<boolean> {
  const db = await workspaceConfigDb(config);
  return Boolean(db.get(workspaceId));
}

/**
 * Seed the DB-backed ipollowork config for a workspace if no row exists yet.
 * Used at workspace creation and as the migrate-on-read landing spot for
 * legacy `.opencode/ipollowork.json` files. No-op when a row is already present,
 * so it never clobbers live provisioning state.
 */
export async function seediPolloWorkWorkspaceConfigIfEmpty(
  config: ServerConfig,
  workspaceId: string,
  seed: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (await hasiPolloWorkWorkspaceConfig(config, workspaceId)) {
    return readiPolloWorkWorkspaceConfig(config, workspaceId);
  }
  return writeiPolloWorkWorkspaceConfig(config, workspaceId, () => seed);
}

export function mergeiPolloWorkWorkspaceConfigs(
  legacy: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return { ...legacy, ...stored };
}
