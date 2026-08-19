import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type { PluginEngineCompatibility } from "@ipollowork/types/plugins";
import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";
import { parse, stringify } from "yaml";

import type {
  PluginPackageManifest,
  PluginResourceType,
} from "./plugin-package-manifest.js";
import { ApiError } from "./errors.js";
import { deepSeekHarnessManagedPluginPatchPath } from "./deepseek-harness-runtime.js";
import { addMcp, removeMcp } from "./mcp.js";
import { addPlugin, removePlugin } from "./plugins.js";
import type { ServerConfig } from "./types.js";
import constants from "../../../constants.json" with { type: "json" };

export type PluginOwnedFile = { path: string; sha256: string };

export type PluginEngineVersion = {
  manifest: PluginPackageManifest;
  artifactRoot: string;
  files: PluginOwnedFile[];
};

export type PluginWorkspaceFile = PluginOwnedFile & {
  sourcePath: string;
  targetPath: string;
};

export type PluginCompatibilityCheck = {
  name: string;
  version: string;
  range: string | undefined;
};

type PluginEngineContext = {
  config: ServerConfig;
  workspaceId: string;
  resolvePath(root: string, relativePath: string): string;
};

export interface PluginEngineAdapter {
  readonly id: string;
  /** Portable package resources this engine can consume through this adapter. */
  readonly portableResourceTypes: ReadonlySet<PluginResourceType>;
  /** Native engine-binding capability kinds implemented by this adapter. */
  readonly nativeCapabilityKinds: ReadonlySet<string>;
  validate?(manifest: PluginPackageManifest): void;
  compatibility(manifest: PluginPackageManifest): PluginCompatibilityCheck[];
  workspaceFiles(version: PluginEngineVersion): PluginWorkspaceFile[];
  skillTargetPath(version: PluginEngineVersion, resourceId: string): string | null;
  syncRuntime(input: PluginEngineContext & {
    current: PluginEngineVersion | null;
    next: PluginEngineVersion | null;
    enabled: boolean;
  }): Promise<void>;
}

const APP_MANAGED_PLUGIN_RESOURCE_TYPES = new Set<PluginResourceType>([
  "ui",
  "local-service",
]);

const PASSIVE_PLUGIN_RESOURCE_TYPES = new Set<PluginResourceType>([
  "file",
  "secret",
]);

function adapterSupportsResource(
  adapter: PluginEngineAdapter,
  resource: PluginPackageManifest["resources"][number],
): boolean {
  if (APP_MANAGED_PLUGIN_RESOURCE_TYPES.has(resource.type) || PASSIVE_PLUGIN_RESOURCE_TYPES.has(resource.type)) return true;
  if (!adapter.portableResourceTypes.has(resource.type)) return false;
  return !(adapter.id === DEEPSEEK_HARNESS_ENGINE_ID && resource.type === "mcp" && resource.oauth === true);
}

export function pluginEngineCompatibility(
  adapter: PluginEngineAdapter,
  manifest: PluginPackageManifest,
): PluginEngineCompatibility {
  const supportedResourceIds = manifest.resources
    .filter((resource) => adapterSupportsResource(adapter, resource))
    .map((resource) => resource.id);
  const unsupportedResources = manifest.resources.filter((resource) => !adapterSupportsResource(adapter, resource));
  const binding = manifest.engineBindings?.find((entry) => entry.engine === adapter.id);
  const unsupportedCapabilityIds = binding?.capabilities
    .filter((capability) => !adapter.nativeCapabilityKinds.has(capability.kind))
    .map((capability) => capability.id) ?? [];
  const nativeEngineOnly = Boolean(manifest.package?.engines?.length && !manifest.package.engines.includes(adapter.id));
  const canActivate = supportedResourceIds.length > 0
    || Boolean(binding?.capabilities.some((capability) => adapter.nativeCapabilityKinds.has(capability.kind)));
  const hasLimitations = nativeEngineOnly || unsupportedResources.length > 0 || unsupportedCapabilityIds.length > 0;
  return {
    engineId: adapter.id,
    status: !canActivate ? "unsupported" : hasLimitations ? "partial" : "ready",
    supportedResourceIds,
    unsupportedResourceIds: unsupportedResources.map((resource) => resource.id),
    unsupportedRequiredResourceIds: unsupportedResources.filter((resource) => resource.required).map((resource) => resource.id),
    unsupportedCapabilityIds,
    nativeEngineOnly,
  };
}

/**
 * Native engine restrictions apply only to native bindings. Portable and
 * app-managed resources stay installable wherever an adapter can consume
 * them, which keeps one package inventory across present and future engines.
 */
export function pluginEngineCanActivate(
  adapter: PluginEngineAdapter,
  manifest: PluginPackageManifest,
): boolean {
  return pluginEngineCompatibility(adapter, manifest).status !== "unsupported";
}

export class PluginEngineAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, PluginEngineAdapter>;

  constructor(adapters: readonly PluginEngineAdapter[]) {
    const entries = new Map<string, PluginEngineAdapter>();
    for (const adapter of adapters) {
      const id = adapter.id.trim();
      if (!id) throw new Error("Plugin engine adapter ID is required");
      if (entries.has(id)) throw new Error(`Duplicate plugin engine adapter: ${id}`);
      entries.set(id, adapter);
    }
    this.#adapters = entries;
  }

  get(id: string): PluginEngineAdapter {
    const adapter = this.#adapters.get(id.trim());
    if (!adapter) {
      throw new ApiError(409, "plugin_engine_not_registered", `Plugin engine is not registered: ${id}`, {
        engine: id,
        registeredEngines: [...this.#adapters.keys()],
      });
    }
    return adapter;
  }

  ids(): string[] {
    return [...this.#adapters.keys()];
  }
}

const OPENCODE_TARGETS = {
  skills: ".opencode/skills/",
  agents: ".opencode/agents/",
  commands: ".opencode/commands/",
} as const;

const DEEPSEEK_HARNESS_TARGETS = {
  skills: ".dsh/skills/",
} as const;

const LEGACY_SOURCE_PREFIXES = [
  ["skills/", ".opencode/skills/"],
  ["agents/", ".opencode/agents/"],
  ["commands/", ".opencode/commands/"],
  ["mcp/", ".opencode/mcps/"],
  ["engines/opencode/plugins/", ".opencode/plugins/"],
] as const;

function projectedPath(sourcePath: string, targets: Readonly<Record<string, string>>): string | null {
  for (const [directory, target] of Object.entries(targets)) {
    if (sourcePath.startsWith(target)) return sourcePath;
    if (sourcePath.startsWith(`${directory}/`)) return `${target}${sourcePath.slice(directory.length + 1)}`;
  }
  return null;
}

export function pluginEngineSourcePath(version: PluginEngineVersion, portablePath: string): string | null {
  const ownedPaths = new Set(version.files.map((file) => file.path));
  if (ownedPaths.has(portablePath)) return portablePath;
  for (const [portablePrefix, legacyPrefix] of LEGACY_SOURCE_PREFIXES) {
    if (!portablePath.startsWith(portablePrefix)) continue;
    const legacyPath = `${legacyPrefix}${portablePath.slice(portablePrefix.length)}`;
    if (ownedPaths.has(legacyPath)) return legacyPath;
  }
  if (portablePath.startsWith("service/")) {
    const legacyPath = portablePath.slice("service/".length);
    if (ownedPaths.has(legacyPath)) return legacyPath;
  }
  return null;
}

export function pluginEnginePortablePath(sourcePath: string): string {
  for (const [portablePrefix, legacyPrefix] of LEGACY_SOURCE_PREFIXES) {
    if (sourcePath.startsWith(legacyPrefix)) return `${portablePrefix}${sourcePath.slice(legacyPrefix.length)}`;
  }
  return sourcePath;
}

function workspaceFiles(
  version: PluginEngineVersion,
  targets: Readonly<Record<string, string>>,
): PluginWorkspaceFile[] {
  return version.files.flatMap((file) => {
    const targetPath = projectedPath(file.path, targets);
    return targetPath ? [{ ...file, sourcePath: file.path, targetPath }] : [];
  });
}

function skillTargetPath(
  version: PluginEngineVersion,
  resourceId: string,
  targets: Readonly<Record<string, string>>,
): string | null {
  const resource = version.manifest.resources.find((entry) => entry.id === resourceId && entry.type === "skill");
  if (!resource?.path) return null;
  const portablePath = resource.path === "SKILL.md" || resource.path.endsWith("/SKILL.md")
    ? resource.path
    : `${resource.path.replace(/\/$/, "")}/SKILL.md`;
  const sourcePath = pluginEngineSourcePath(version, portablePath);
  return sourcePath ? projectedPath(sourcePath, targets) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePluginMcpEntries(
  payload: unknown,
  fallbackName: string,
  sourcePath: string,
): Array<{ name: string; config: Record<string, unknown> }> {
  if (!isRecord(payload)) {
    throw new ApiError(400, "plugin_package_mcp_invalid", `MCP resource must contain a JSON object: ${sourcePath}`);
  }
  const nested = isRecord(payload.mcpServers) ? payload.mcpServers : isRecord(payload.mcp) ? payload.mcp : null;
  if (!nested) return [{ name: fallbackName, config: payload }];
  return Object.entries(nested).map(([name, value]) => {
    if (!isRecord(value)) throw new ApiError(400, "plugin_package_mcp_invalid", `MCP config must be an object: ${name}`);
    return { name, config: value };
  });
}

async function mcpEntries(
  version: PluginEngineVersion | null,
  resolvePath: PluginEngineContext["resolvePath"],
  includeResource: (resource: PluginPackageManifest["resources"][number]) => boolean = () => true,
): Promise<Array<{ name: string; config: Record<string, unknown> }>> {
  if (!version) return [];
  const entries: Array<{ name: string; config: Record<string, unknown> }> = [];
  for (const resource of version.manifest.resources) {
    if (resource.type !== "mcp" || !resource.path || !includeResource(resource)) continue;
    const sourcePath = pluginEngineSourcePath(version, resource.path) ?? resource.path;
    const payload: unknown = JSON.parse(await readFile(resolvePath(version.artifactRoot, sourcePath), "utf8"));
    entries.push(...parsePluginMcpEntries(payload, resource.mcpServerName ?? resource.id, sourcePath));
  }
  return entries;
}

function pluginSpecs(version: PluginEngineVersion | null, resolvePath: PluginEngineContext["resolvePath"]): string[] {
  const binding = version?.manifest.engineBindings?.find((entry) => entry.engine === "opencode");
  if (!version || !binding) return [];
  return binding.capabilities.flatMap((capability) => {
    if (capability.kind !== "plugin") {
      if (capability.required) {
        throw new ApiError(409, "plugin_engine_capability_unsupported", `OpenCode adapter does not support ${capability.kind}`);
      }
      return [];
    }
    if (Boolean(capability.path) === Boolean(capability.packageName)) {
      throw new ApiError(400, "plugin_engine_capability_invalid", `OpenCode plugin ${capability.id} must declare exactly one path or packageName`);
    }
    if (!capability.path) return [capability.packageName ?? ""];
    const sourcePath = pluginEngineSourcePath(version, capability.path) ?? capability.path;
    return [pathToFileURL(resolvePath(version.artifactRoot, sourcePath)).href];
  });
}

export const openCodePluginEngineAdapter: PluginEngineAdapter = {
  id: "opencode",
  portableResourceTypes: new Set(["skill", "agent", "command", "mcp"]),
  nativeCapabilityKinds: new Set(["plugin"]),
  compatibility(manifest) {
    const binding = manifest.engineBindings?.find((entry) => entry.engine === "opencode");
    return [{ name: "OpenCode", version: constants.opencodeVersion, range: binding?.compatibility }];
  },
  workspaceFiles(version) {
    return workspaceFiles(version, OPENCODE_TARGETS);
  },
  skillTargetPath(version, resourceId) {
    return skillTargetPath(version, resourceId, OPENCODE_TARGETS);
  },
  async syncRuntime(input) {
    const currentSpecs = pluginSpecs(input.current, input.resolvePath);
    const nextSpecs = pluginSpecs(input.next, input.resolvePath);
    const nextSpecSet = new Set(nextSpecs);
    const currentMcpEntries = await mcpEntries(input.current, input.resolvePath);
    const nextMcpEntries = await mcpEntries(input.next, input.resolvePath);
    const nextMcpNames = new Set(nextMcpEntries.map((entry) => entry.name));

    for (const spec of currentSpecs) {
      if (!input.enabled || !nextSpecSet.has(spec)) await removePlugin(input.config, input.workspaceId, spec);
    }
    if (input.enabled) {
      for (const spec of nextSpecs) await addPlugin(input.config, input.workspaceId, spec);
    }
    for (const entry of currentMcpEntries) {
      if (!input.enabled || !nextMcpNames.has(entry.name)) await removeMcp(input.config, input.workspaceId, entry.name);
    }
    if (input.enabled) {
      for (const entry of nextMcpEntries) await addMcp(input.config, input.workspaceId, entry.name, entry.config);
    }
  },
};

type DeepSeekHarnessPatchPlugin = {
  id: string;
  name: "@deepseek-ai/dsh-mcp-client";
  config: {
    serverName: string;
    transport: "streamable-http";
    url: string;
    headers: Record<string, string>;
  };
};

let deepSeekHarnessPatchWrite = Promise.resolve();

function deepSeekHarnessPluginPrefix(pluginId: string): string {
  return `ipollowork-${createHash("sha256").update(pluginId).digest("hex").slice(0, 12)}-`;
}

function deepSeekHarnessServerName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "_") || "plugin";
  if (normalized.length <= 32) return normalized;
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${normalized.slice(0, 23)}-${suffix}`;
}

function deepSeekHarnessPatchPlugins(value: unknown): DeepSeekHarnessPatchPlugin[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((patch) => {
    if (!isRecord(patch) || !Array.isArray(patch.insert)) return [];
    return patch.insert.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string" || entry.name !== "@deepseek-ai/dsh-mcp-client" || !isRecord(entry.config)) return [];
      const serverName = entry.config.serverName;
      const transport = entry.config.transport;
      const url = entry.config.url;
      const headers = entry.config.headers;
      if (typeof serverName !== "string" || transport !== "streamable-http" || typeof url !== "string" || !isRecord(headers)) return [];
      const stringHeaders = Object.fromEntries(Object.entries(headers).filter((header): header is [string, string] => typeof header[1] === "string"));
      return [{ id: entry.id, name: entry.name, config: { serverName, transport, url, headers: stringHeaders } }];
    });
  });
}

async function syncDeepSeekHarnessMcpPatch(
  config: ServerConfig,
  pluginId: string,
  entries: Array<{ name: string; config: Record<string, unknown> }>,
): Promise<void> {
  const update = async () => {
    const path = deepSeekHarnessManagedPluginPatchPath(config);
    let current: DeepSeekHarnessPatchPlugin[] = [];
    try {
      current = deepSeekHarnessPatchPlugins(parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
    const prefix = deepSeekHarnessPluginPrefix(pluginId);
    const next = current.filter((entry) => !entry.id.startsWith(prefix));
    for (const entry of entries) {
      const url = typeof entry.config.url === "string" ? entry.config.url : "";
      const headers = entry.config.headers;
      if (
        entry.config.type !== "remote"
        || entry.config.enabled === false
        || !url
        || (isRecord(headers) && Object.keys(headers).length > 0)
      ) continue;
      next.push({
        id: `${prefix}mcp-${createHash("sha256").update(entry.name).digest("hex").slice(0, 10)}`,
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          serverName: deepSeekHarnessServerName(entry.name),
          transport: "streamable-http",
          url,
          headers: {},
        },
      });
    }
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, stringify(next.length > 0 ? [{ insert: next }] : []), "utf8");
    await rename(temporaryPath, path);
  };
  deepSeekHarnessPatchWrite = deepSeekHarnessPatchWrite.then(update, update);
  await deepSeekHarnessPatchWrite;
}

export const deepSeekHarnessPluginEngineAdapter: PluginEngineAdapter = {
  id: DEEPSEEK_HARNESS_ENGINE_ID,
  portableResourceTypes: new Set(["skill", "mcp"]),
  nativeCapabilityKinds: new Set(),
  compatibility(manifest) {
    const binding = manifest.engineBindings?.find((entry) => entry.engine === DEEPSEEK_HARNESS_ENGINE_ID);
    return [{
      name: "DeepSeek Harness",
      version: constants.deepseekHarnessVersion,
      range: binding?.compatibility,
    }];
  },
  workspaceFiles(version) {
    return workspaceFiles(version, DEEPSEEK_HARNESS_TARGETS);
  },
  skillTargetPath(version, resourceId) {
    return skillTargetPath(version, resourceId, DEEPSEEK_HARNESS_TARGETS);
  },
  async syncRuntime(input) {
    const nextEntries = input.enabled
      ? await mcpEntries(input.next, input.resolvePath, (resource) => resource.oauth !== true)
      : [];
    const pluginId = input.next?.manifest.id ?? input.current?.manifest.id;
    if (pluginId) await syncDeepSeekHarnessMcpPatch(input.config, pluginId, nextEntries);
  },
};

export const pluginEngineAdapters = new PluginEngineAdapterRegistry([
  openCodePluginEngineAdapter,
  deepSeekHarnessPluginEngineAdapter,
]);
