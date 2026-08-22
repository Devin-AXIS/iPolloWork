import { pathToFileURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { EnvService } from "./env-file.js";
import { ApiError } from "./errors.js";
import { bindPluginAuthorizationRuntime, type BoundPluginAuthorizationRuntime } from "./plugin-platform-runtime.js";
import {
  listInstalledPluginPackages,
  resolveInstalledPluginService,
} from "./plugin-package-lifecycle.js";
import type { PluginPackageManifest } from "./plugin-package-manifest.js";
import { runtimeStorageDir } from "./runtime-storage.js";
import type { ServerConfig } from "./types.js";

export type PluginServiceAction = {
  extensionId: string;
  action: string;
  title: string;
  description: string;
  effect: "read" | "write" | "destructive";
  inputSchema: Record<string, unknown>;
};

export type PluginServiceRuntime = {
  plugin: Readonly<{ id: string; version: string }>;
  authorization: BoundPluginAuthorizationRuntime;
  environment: Readonly<{
    get(name: string): Promise<string | null>;
  }>;
  storage: Readonly<{
    dataDir: string;
  }>;
  workspace: Readonly<{
    root: string;
  }>;
  host: Readonly<{
    callAction(
      reference: string,
      args: Record<string, unknown>,
    ): Promise<unknown>;
  }>;
};

type PluginService = {
  actions: Record<string, (args: Record<string, unknown>, context: Record<string, unknown>) => unknown | Promise<unknown>>;
  dispose?: () => unknown | Promise<unknown>;
};

type PluginServiceFactory = (runtime: PluginServiceRuntime) => PluginService | Promise<PluginService>;

type PluginHostActionDispatch = (
  reference: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const pluginHostActionScope = new AsyncLocalStorage<PluginHostActionDispatch | undefined>();

type CachedPluginService = {
  workspaceId: string;
  pluginId: string;
  version: string;
  service: Promise<PluginService>;
};

const serviceCacheByConfig = new WeakMap<ServerConfig, Map<string, CachedPluginService>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serviceResource(manifest: PluginPackageManifest) {
  return manifest.resources.find((resource) => resource.type === "local-service" && resource.path);
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_") || "default";
}

export function pluginServiceDataDirectory(config: ServerConfig, workspaceId: string, pluginId: string): string {
  return join(runtimeStorageDir(config), "plugin-data", safeSegment(workspaceId), safeSegment(pluginId));
}

export async function deletePluginServiceData(config: ServerConfig, workspaceId: string, pluginId: string): Promise<void> {
  await rm(pluginServiceDataDirectory(config, workspaceId, pluginId), { recursive: true, force: true });
}

function bindPluginEnvironmentRuntime(manifest: PluginPackageManifest, env?: EnvService): PluginServiceRuntime["environment"] {
  const allowed = new Set(serviceResource(manifest)?.environment ?? []);
  return Object.freeze({
    async get(name: string): Promise<string | null> {
      if (!allowed.has(name)) {
        throw new ApiError(403, "plugin_environment_denied", `Plugin service did not declare environment access: ${name}`);
      }
      const stored = env ? (await env.list()).find((entry) => entry.key === name)?.value : undefined;
      return stored ?? process.env[name] ?? null;
    },
  });
}

function actionsForManifest(manifest: PluginPackageManifest): PluginServiceAction[] {
  return serviceResource(manifest)?.actions?.map((action) => ({
    extensionId: manifest.id,
    action: action.id,
    title: action.title,
    description: action.description,
    effect: action.effect ?? "read",
    inputSchema: action.inputSchema ?? { type: "object", properties: {}, additionalProperties: false },
  })) ?? [];
}

export function workspaceIdForPluginContext(config: ServerConfig, context: unknown): string {
  const record = isRecord(context) ? context : {};
  const candidates = [record.directory, record.worktree]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => resolve(value));
  for (const candidate of candidates) {
    const workspace = config.workspaces.find((entry) => {
      const root = resolve(entry.path);
      return candidate === root || candidate.startsWith(`${root}${sep}`);
    });
    if (workspace) return workspace.id;
  }
  const workspace = config.workspaces[0];
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found for plugin service");
  return workspace.id;
}

export async function listPluginServiceActions(
  config: ServerConfig,
  workspaceId: string,
  pluginId = "",
): Promise<PluginServiceAction[]> {
  const installed = await listInstalledPluginPackages({ serverConfig: config });
  return installed
    .filter((entry) => entry.enabled && (!pluginId || entry.pluginId === pluginId))
    .flatMap((entry) => actionsForManifest(entry.manifest));
}

async function loadService(factoryPath: string, runtime: PluginServiceRuntime): Promise<PluginService> {
  const loaded: unknown = await import(pathToFileURL(factoryPath).href);
  const factory = isRecord(loaded) ? loaded.default : null;
  if (typeof factory !== "function") {
    throw new ApiError(500, "plugin_service_invalid", "Plugin service must export a default factory function");
  }
  const service: unknown = await (factory as PluginServiceFactory)(runtime);
  if (!isRecord(service) || !isRecord(service.actions)) {
    throw new ApiError(500, "plugin_service_invalid", "Plugin service factory must return an actions object");
  }
  return service as PluginService;
}

function serviceCache(config: ServerConfig): Map<string, CachedPluginService> {
  const current = serviceCacheByConfig.get(config);
  if (current) return current;
  const created = new Map<string, CachedPluginService>();
  serviceCacheByConfig.set(config, created);
  return created;
}

async function persistentService(input: {
  config: ServerConfig;
  workspaceId: string;
  pluginId: string;
  version: string;
  modulePath: string;
  runtime: PluginServiceRuntime;
}): Promise<PluginService> {
  const cache = serviceCache(input.config);
  const key = `${input.workspaceId}\0${input.pluginId}\0${input.version}`;
  const current = cache.get(key);
  if (current) return current.service;
  const service = loadService(input.modulePath, input.runtime);
  const entry = { workspaceId: input.workspaceId, pluginId: input.pluginId, version: input.version, service };
  cache.set(key, entry);
  try {
    return await service;
  } catch (error) {
    if (cache.get(key) === entry) cache.delete(key);
    throw error;
  }
}

export async function disposePluginServices(config: ServerConfig, workspaceId: string, pluginId: string): Promise<number> {
  const cache = serviceCacheByConfig.get(config);
  if (!cache) return 0;
  const matches = [...cache.entries()].filter(([, entry]) => entry.workspaceId === workspaceId && entry.pluginId === pluginId);
  for (const [key] of matches) cache.delete(key);
  for (const [, entry] of matches) {
    const service = await entry.service.catch(() => null);
    if (service?.dispose) await service.dispose();
  }
  return matches.length;
}

export async function disposeAllPluginServices(config: ServerConfig): Promise<number> {
  const cache = serviceCacheByConfig.get(config);
  if (!cache) return 0;
  const entries = [...cache.values()];
  serviceCacheByConfig.delete(config);
  for (const entry of entries) {
    const service = await entry.service.catch(() => null);
    if (service?.dispose) await service.dispose();
  }
  return entries.length;
}

async function assertServiceAuthorizationReady(
  manifest: PluginPackageManifest,
  authorization: BoundPluginAuthorizationRuntime,
): Promise<void> {
  const requirements = serviceResource(manifest)?.requires ?? [];
  const requiredMethods = requirements
    .filter((requirement) => requirement.startsWith("authorization:"))
    .map((requirement) => requirement.slice("authorization:".length));
  if (!requiredMethods.length) return;
  const connected = new Set((await authorization.listConnections()).map((connection) => connection.methodId));
  const missing = requiredMethods.find((methodId) => !connected.has(methodId));
  if (missing) {
    throw new ApiError(401, "plugin_authorization_required", `Connect the plugin authorization method before use: ${missing}`);
  }
}

export async function callPluginServiceAction(input: {
  config: ServerConfig;
  env?: EnvService;
  workspaceId: string;
  pluginId: string;
  action: string;
  args: Record<string, unknown>;
  context: Record<string, unknown>;
  callHostAction?: (
    reference: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}) {
  const installed = await resolveInstalledPluginService({
    serverConfig: input.config,
    pluginId: input.pluginId,
  });
  const declared = actionsForManifest(installed.manifest).find((entry) => entry.action === input.action);
  if (!declared) throw new ApiError(404, "plugin_service_action_not_found", "Plugin service action is not declared");
  const authorization = await bindPluginAuthorizationRuntime(input.config, input.pluginId);
  await assertServiceAuthorizationReady(installed.manifest, authorization);
  const dataDir = pluginServiceDataDirectory(input.config, input.workspaceId, input.pluginId);
  const workspace = input.config.workspaces.find((entry) => entry.id === input.workspaceId);
  if (!workspace) throw new ApiError(404, "workspace_not_found", "Workspace not found for plugin service");
  const hostActionsAllowed = installed.manifest.source.origin === "builtin" && installed.manifest.source.trusted;
  const allowedHostActions = new Set(hostActionsAllowed
    ? (serviceResource(installed.manifest)?.requires ?? []).filter((requirement) => requirement.startsWith("action:"))
    : []);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const runtime = {
    plugin: Object.freeze({ id: input.pluginId, version: installed.version }),
    authorization,
    environment: bindPluginEnvironmentRuntime(installed.manifest, input.env),
    storage: Object.freeze({ dataDir }),
    workspace: Object.freeze({ root: resolve(workspace.path) }),
    host: Object.freeze({
      callAction: async (
        reference: string,
        args: Record<string, unknown>,
      ) => {
        const requirement = reference.startsWith("action:") ? reference : `action:${reference}`;
        if (!allowedHostActions.has(requirement)) {
          throw new ApiError(403, "plugin_host_action_denied", `Plugin service did not declare host action access: ${requirement}`);
        }
        const dispatch = pluginHostActionScope.getStore();
        if (!dispatch) {
          throw new ApiError(503, "plugin_host_action_unavailable", "Host action dispatch is not available in this runtime");
        }
        return dispatch(requirement, args);
      },
    }),
  };
  const service = await persistentService({
    config: input.config,
    workspaceId: input.workspaceId,
    pluginId: input.pluginId,
    version: installed.version,
    modulePath: installed.modulePath,
    runtime,
  });
  const handler = service.actions[input.action];
  if (typeof handler !== "function") throw new ApiError(500, "plugin_service_action_missing", "Plugin service does not implement its declared action");
  return {
    ok: true,
    extensionId: input.pluginId,
    action: input.action,
    result: await pluginHostActionScope.run(input.callHostAction, () => handler(input.args, input.context)),
    context: input.context,
  };
}
