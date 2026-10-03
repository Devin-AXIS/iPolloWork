import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { importNodeSqlite } from "./node-sqlite.js";
import { runtimeDbPath } from "./runtime-storage.js";
import type { ServerConfig } from "./types.js";
import { ensureDir } from "./utils.js";

export type RuntimeOpencodeConfig = {
  default_agent?: string;
  plugin?: string[];
  disabled_providers?: string[];
  mcp?: Record<string, Record<string, unknown>>;
  permission?: {
    external_directory?: Record<string, unknown>;
  };
  provider?: Record<string, unknown>;
};

const runtimeOpencodeConfigs = sqliteTable("runtime_opencode_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

const runtimeProviderChannels = sqliteTable("runtime_provider_channels", {
  scope: text("scope").primaryKey(),
  channelsJson: text("channels_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

const GLOBAL_PROVIDER_CHANNEL_SCOPE = "global";

export type RuntimeProviderChannels = Record<string, Record<string, unknown>>;

type RuntimeOpencodeDb = {
  get: (workspaceId: string) => { configJson: string } | undefined;
  upsert: (value: { workspaceId: string; configJson: string; updatedAt: number }) => void;
  getProviderChannels: () => { channelsJson: string } | undefined;
  upsertProviderChannels: (value: { channelsJson: string; updatedAt: number }) => void;
  close: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRuntimeOpencodeConfig(value: unknown): RuntimeOpencodeConfig {
  if (!isRecord(value)) return {};
  const defaultAgent = typeof value.default_agent === "string" ? value.default_agent : undefined;
  const plugin = Array.isArray(value.plugin) ? value.plugin.filter((item) => typeof item === "string") : undefined;
  const disabledProviders = Array.isArray(value.disabled_providers)
    ? value.disabled_providers.filter((item) => typeof item === "string")
    : undefined;
  const mcp = isRecord(value.mcp) ? value.mcp as Record<string, Record<string, unknown>> : undefined;
  const permission = isRecord(value.permission) ? value.permission : undefined;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : undefined;
  const provider = isRecord(value.provider) ? value.provider : undefined;
  return {
    ...(defaultAgent ? { default_agent: defaultAgent } : {}),
    ...(plugin ? { plugin } : {}),
    ...(disabledProviders ? { disabled_providers: disabledProviders } : {}),
    ...(mcp ? { mcp } : {}),
    ...(externalDirectory ? { permission: { external_directory: externalDirectory } } : {}),
    ...(provider ? { provider } : {}),
  };
}

function parseRuntimeOpencodeConfig(configJson: string): RuntimeOpencodeConfig {
  try {
    return normalizeRuntimeOpencodeConfig(JSON.parse(configJson));
  } catch {
    return {};
  }
}

function normalizeRuntimeProviderChannels(value: unknown): RuntimeProviderChannels {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([providerId, profile]) => {
    const id = providerId.trim().toLowerCase();
    return /^[a-z][a-z0-9._-]*$/.test(id) && isRecord(profile)
      ? [[id, profile]]
      : [];
  }));
}

function parseRuntimeProviderChannels(channelsJson: string): RuntimeProviderChannels {
  try {
    return normalizeRuntimeProviderChannels(JSON.parse(channelsJson));
  } catch {
    return {};
  }
}

export type RuntimeOpencodeConfigWriteListener = (
  config: ServerConfig,
  workspaceId: string,
  previous: RuntimeOpencodeConfig,
  next: RuntimeOpencodeConfig,
) => void;

const writeListeners = new Set<RuntimeOpencodeConfigWriteListener>();
const providerChannelWriteListeners = new Set<(config: ServerConfig) => void>();

/**
 * Observe runtime config writes. Used to keep derived state (e.g. the
 * engine-visible runtime config file) in sync with the DB. Returns an
 * unsubscribe function. Listeners must not throw.
 */
export function onRuntimeOpencodeConfigWrite(listener: RuntimeOpencodeConfigWriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

async function openRuntimeDb(path: string): Promise<RuntimeOpencodeDb> {
  await ensureDir(dirname(path));
  if (typeof process.versions.bun === "string") {
    const { Database } = await import("bun:sqlite");
    const { drizzle } = await import("drizzle-orm/bun-sqlite");
    const sqlite = new Database(path, { create: true });
    sqlite.run("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    sqlite.run("CREATE TABLE IF NOT EXISTS runtime_provider_channels (scope TEXT PRIMARY KEY NOT NULL, channels_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
    const db = drizzle(sqlite);
    return {
      get: (workspaceId) => db
        .select()
        .from(runtimeOpencodeConfigs)
        .where(eq(runtimeOpencodeConfigs.workspaceId, workspaceId))
        .get(),
      upsert: ({ workspaceId, configJson, updatedAt }) => {
        db
          .insert(runtimeOpencodeConfigs)
          .values({ workspaceId, configJson, updatedAt })
          .onConflictDoUpdate({
            target: runtimeOpencodeConfigs.workspaceId,
            set: { configJson, updatedAt },
          })
          .run();
      },
      getProviderChannels: () => db
        .select()
        .from(runtimeProviderChannels)
        .where(eq(runtimeProviderChannels.scope, GLOBAL_PROVIDER_CHANNEL_SCOPE))
        .get(),
      upsertProviderChannels: ({ channelsJson, updatedAt }) => {
        db
          .insert(runtimeProviderChannels)
          .values({ scope: GLOBAL_PROVIDER_CHANNEL_SCOPE, channelsJson, updatedAt })
          .onConflictDoUpdate({
            target: runtimeProviderChannels.scope,
            set: { channelsJson, updatedAt },
          })
          .run();
      },
      close: () => sqlite.close(),
    };
  }
  const { DatabaseSync } = await importNodeSqlite();
  const sqlite = new DatabaseSync(path);
  sqlite.exec("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  sqlite.exec("CREATE TABLE IF NOT EXISTS runtime_provider_channels (scope TEXT PRIMARY KEY NOT NULL, channels_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  const get = sqlite.prepare("SELECT config_json AS configJson FROM runtime_opencode_configs WHERE workspace_id = ?");
  const upsert = sqlite.prepare("INSERT INTO runtime_opencode_configs (workspace_id, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at");
  const getProviderChannels = sqlite.prepare("SELECT channels_json AS channelsJson FROM runtime_provider_channels WHERE scope = ?");
  const upsertProviderChannels = sqlite.prepare("INSERT INTO runtime_provider_channels (scope, channels_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(scope) DO UPDATE SET channels_json = excluded.channels_json, updated_at = excluded.updated_at");
  return {
    get: (workspaceId) => {
      const row = get.get(workspaceId);
      if (!isRecord(row) || typeof row.configJson !== "string") return undefined;
      return { configJson: row.configJson };
    },
    upsert: ({ workspaceId, configJson, updatedAt }) => {
      upsert.run(workspaceId, configJson, updatedAt);
    },
    getProviderChannels: () => {
      const row = getProviderChannels.get(GLOBAL_PROVIDER_CHANNEL_SCOPE);
      if (!isRecord(row) || typeof row.channelsJson !== "string") return undefined;
      return { channelsJson: row.channelsJson };
    },
    upsertProviderChannels: ({ channelsJson, updatedAt }) => {
      upsertProviderChannels.run(GLOBAL_PROVIDER_CHANNEL_SCOPE, channelsJson, updatedAt);
    },
    close: () => sqlite.close(),
  };
}

const dbByPath = new Map<string, Promise<RuntimeOpencodeDb>>();
const providerChannelWriteQueueByPath = new Map<string, Promise<unknown>>();

export async function disposeRuntimeOpencodeConfigStore(config: ServerConfig): Promise<void> {
  const path = runtimeDbPath(config);
  await providerChannelWriteQueueByPath.get(path)?.catch(() => undefined);
  providerChannelWriteQueueByPath.delete(path);
  const pending = dbByPath.get(path);
  if (!pending) return;
  dbByPath.delete(path);
  const db = await pending;
  db.close();
}

async function runtimeDb(config: ServerConfig): Promise<RuntimeOpencodeDb> {
  const path = runtimeDbPath(config);
  const existing = dbByPath.get(path);
  if (existing) return existing;
  const db = openRuntimeDb(path);
  dbByPath.set(path, db);
  return db;
}

export function runtimePluginList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.plugin) ? config.plugin.filter((item) => typeof item === "string") : [];
}

export function runtimeDisabledProviderList(config: RuntimeOpencodeConfig): string[] {
  return Array.isArray(config.disabled_providers)
    ? config.disabled_providers.filter((item) => typeof item === "string")
    : [];
}

export function runtimeMcpMap(config: RuntimeOpencodeConfig): Record<string, Record<string, unknown>> {
  return isRecord(config.mcp) ? config.mcp as Record<string, Record<string, unknown>> : {};
}

export function runtimeExternalDirectory(config: RuntimeOpencodeConfig): Record<string, unknown> {
  const permission = isRecord(config.permission) ? config.permission : null;
  const externalDirectory = permission && isRecord(permission.external_directory) ? permission.external_directory : null;
  return externalDirectory ?? {};
}

export function onRuntimeProviderChannelsWrite(listener: (config: ServerConfig) => void): () => void {
  providerChannelWriteListeners.add(listener);
  return () => providerChannelWriteListeners.delete(listener);
}

export async function readRuntimeProviderChannels(config: ServerConfig): Promise<RuntimeProviderChannels> {
  const db = await runtimeDb(config);
  const row = db.getProviderChannels();
  return row ? parseRuntimeProviderChannels(row.channelsJson) : {};
}

export async function writeRuntimeProviderChannels(
  config: ServerConfig,
  updater: (current: RuntimeProviderChannels) => RuntimeProviderChannels,
): Promise<{ channels: RuntimeProviderChannels; changed: boolean }> {
  const path = runtimeDbPath(config);
  const previous = providerChannelWriteQueueByPath.get(path) ?? Promise.resolve();
  const mutation = previous.then(async () => {
    const db = await runtimeDb(config);
    const row = db.getProviderChannels();
    const current = row ? parseRuntimeProviderChannels(row.channelsJson) : {};
    const channels = normalizeRuntimeProviderChannels(updater(current));
    const channelsJson = JSON.stringify(channels);
    if (row?.channelsJson === channelsJson) return { channels, changed: false };
    db.upsertProviderChannels({ channelsJson, updatedAt: Date.now() });
    for (const listener of providerChannelWriteListeners) listener(config);
    return { channels, changed: true };
  });
  providerChannelWriteQueueByPath.set(path, mutation.then(
    () => undefined,
    () => undefined,
  ));
  return mutation;
}

/**
 * Per-provider merge for runtime config patches: record values upsert the
 * provider, explicit `null` deletes it (so clients can remove runtime-managed
 * providers, e.g. cloud imports, without racing a read-modify-write of the
 * whole map). Returns undefined when the resulting map is empty.
 */
export function mergeRuntimeProviderUpdate(
  current: unknown,
  update: Record<string, unknown>,
): RuntimeProviderChannels | undefined {
  const next = normalizeRuntimeProviderChannels(current);
  for (const [providerId, value] of Object.entries(update)) {
    if (value === null) {
      delete next[providerId];
    } else if (isRecord(value)) {
      next[providerId] = value;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

export async function readRuntimeOpencodeConfig(config: ServerConfig, workspaceId: string): Promise<RuntimeOpencodeConfig> {
  const db = await runtimeDb(config);
  const row = db.get(workspaceId);
  if (!row) return {};
  return parseRuntimeOpencodeConfig(row.configJson);
}

export async function writeRuntimeOpencodeConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: RuntimeOpencodeConfig) => RuntimeOpencodeConfig,
): Promise<{ config: RuntimeOpencodeConfig; changed: boolean }> {
  const db = await runtimeDb(config);
  const row = db.get(workspaceId);
  const current = row ? parseRuntimeOpencodeConfig(row.configJson) : {};
  const next = normalizeRuntimeOpencodeConfig(updater(current));
  const now = Date.now();
  const configJson = JSON.stringify(next);
  if (row?.configJson === configJson) {
    return { config: next, changed: false };
  }
  db.upsert({ workspaceId, configJson, updatedAt: now });
  for (const listener of writeListeners) listener(config, workspaceId, current, next);
  return { config: next, changed: true };
}

export function mergeOpencodeConfigs(
  persisted: Record<string, unknown>,
  runtime: RuntimeOpencodeConfig,
  providerChannels: RuntimeProviderChannels = {},
): Record<string, unknown> {
  const persistedPermission = isRecord(persisted.permission) ? persisted.permission : {};
  const persistedExternalDirectory = isRecord(persistedPermission.external_directory)
    ? persistedPermission.external_directory
    : {};
  return {
    ...persisted,
    plugin: [
      ...(Array.isArray(persisted.plugin) ? persisted.plugin.filter((item) => typeof item === "string") : []),
      ...runtimePluginList(runtime),
    ],
    disabled_providers: [
      ...(Array.isArray(persisted.disabled_providers) ? persisted.disabled_providers.filter((item) => typeof item === "string") : []),
      ...runtimeDisabledProviderList(runtime),
    ].filter((item, index, list) => list.indexOf(item) === index),
    mcp: {
      ...(isRecord(persisted.mcp) ? persisted.mcp : {}),
      ...runtimeMcpMap(runtime),
    },
    permission: {
      ...persistedPermission,
      external_directory: {
        ...persistedExternalDirectory,
        ...runtimeExternalDirectory(runtime),
      },
    },
    ...(runtime.provider || Object.keys(providerChannels).length ? {
      provider: {
        ...(isRecord(persisted.provider) ? persisted.provider : {}),
        ...runtime.provider,
        ...providerChannels,
      },
    } : {}),
    ...(runtime.default_agent ? { default_agent: runtime.default_agent } : {}),
  };
}
