import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

const ipollowalkWorkspaceConfigs = sqliteTable("ipollowalk_workspace_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

type iPolloWalkWorkspaceConfigDb = {
  get: (workspaceId: string) => { configJson: string } | undefined;
  upsert: (value: { workspaceId: string; configJson: string; updatedAt: number }) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeiPolloWalkWorkspaceConfig(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.IPOLLOWALK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "ipollowalk");
  return join(configDir, "runtime.sqlite");
}

async function openDb(path: string): Promise<iPolloWalkWorkspaceConfigDb> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run("CREATE TABLE IF NOT EXISTS ipollowalk_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const db = drizzle(sqlite);
    return {
      get: (workspaceId) => db
        .select()
        .from(ipollowalkWorkspaceConfigs)
        .where(eq(ipollowalkWorkspaceConfigs.workspaceId, workspaceId))
        .get(),
      upsert: ({ workspaceId, configJson, updatedAt }) => {
        db
          .insert(ipollowalkWorkspaceConfigs)
          .values({ workspaceId, configJson, updatedAt })
          .onConflictDoUpdate({
            target: ipollowalkWorkspaceConfigs.workspaceId,
            set: { configJson, updatedAt },
          })
          .run();
      },
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(path);
  sqlite.exec("CREATE TABLE IF NOT EXISTS ipollowalk_workspace_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const get = sqlite.prepare("SELECT config_json AS configJson FROM ipollowalk_workspace_configs WHERE workspace_id = ?");
  const upsert = sqlite.prepare("INSERT INTO ipollowalk_workspace_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at");
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

const dbByPath = new Map<string, Promise<iPolloWalkWorkspaceConfigDb>>();

async function workspaceConfigDb(config: ServerConfig): Promise<iPolloWalkWorkspaceConfigDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const db = openDb(path);
  dbByPath.set(path, db);
  return db;
}

export async function readiPolloWalkWorkspaceConfig(config: ServerConfig, workspaceId: string): Promise<Record<string, unknown>> {
  const db = await workspaceConfigDb(config);
  const row = db.get(workspaceId);
  if (!row) return {};
  try {
    return normalizeiPolloWalkWorkspaceConfig(JSON.parse(row.configJson));
  } catch {
    return {};
  }
}

export async function writeiPolloWalkWorkspaceConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = await workspaceConfigDb(config);
  const next = normalizeiPolloWalkWorkspaceConfig(updater(await readiPolloWalkWorkspaceConfig(config, workspaceId)));
  db.upsert({ workspaceId, configJson: JSON.stringify(next), updatedAt: Date.now() });
  return next;
}

export async function hasiPolloWalkWorkspaceConfig(
  config: ServerConfig,
  workspaceId: string,
): Promise<boolean> {
  const db = await workspaceConfigDb(config);
  return Boolean(db.get(workspaceId));
}

/**
 * Seed the DB-backed ipollowalk config for a workspace if no row exists yet.
 * Used at workspace creation and as the migrate-on-read landing spot for
 * legacy `.opencode/ipollowalk.json` files. No-op when a row is already present,
 * so it never clobbers live provisioning state.
 */
export async function seediPolloWalkWorkspaceConfigIfEmpty(
  config: ServerConfig,
  workspaceId: string,
  seed: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (await hasiPolloWalkWorkspaceConfig(config, workspaceId)) {
    return readiPolloWalkWorkspaceConfig(config, workspaceId);
  }
  return writeiPolloWalkWorkspaceConfig(config, workspaceId, () => seed);
}

export function mergeiPolloWalkWorkspaceConfigs(
  legacy: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  return { ...legacy, ...stored };
}
