import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type { PluginEngineCompatibility } from "@ipollowork/types/plugins";
import { DEEPSEEK_HARNESS_ENGINE_ID } from "@ipollowork/types/workspace";

import type {
  PluginPackageManifest,
  PluginResourceType,
} from "./plugin-package-manifest.js";
import { ApiError } from "./errors.js";
import { addMcp, removeMcp } from "./mcp.js";
import { registerOpencodePluginBinding, unregisterOpencodePluginBinding } from "./opencode-plugin-projection.js";
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
  return adapter.portableResourceTypes.has(resource.type);
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
  const hasEngineNativeCapabilities = Boolean(
    manifest.engineBindings?.some((entry) => entry.capabilities.length > 0)
    || manifest.resources.some((resource) => resource.provides?.includes("service:external-subagent")),
  );
  const nativeEngineOnly = Boolean(
    hasEngineNativeCapabilities
    && manifest.package?.engines?.length
    && !manifest.package.engines.includes(adapter.id),
  );
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

function projectedPath(sourcePath: string, targets: Readonly<Record<string, string>>): string | null {
  for (const [directory, target] of Object.entries(targets)) {
    if (sourcePath.startsWith(`${directory}/`)) return `${target}${sourcePath.slice(directory.length + 1)}`;
  }
  return null;
}

export function pluginEngineSourcePath(version: PluginEngineVersion, portablePath: string): string | null {
  return version.files.some((file) => file.path === portablePath) ? portablePath : null;
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

async function syncMcpRuntime(input: PluginEngineContext & {
  current: PluginEngineVersion | null;
  next: PluginEngineVersion | null;
  enabled: boolean;
}): Promise<void> {
  const currentEntries = await mcpEntries(input.current, input.resolvePath);
  const nextEntries = await mcpEntries(input.next, input.resolvePath);
  const nextNames = new Set(nextEntries.map((entry) => entry.name));
  for (const entry of currentEntries) {
    if (!input.enabled || !nextNames.has(entry.name)) {
      await removeMcp(input.config, input.workspaceId, entry.name);
    }
  }
  if (input.enabled) {
    for (const entry of nextEntries) {
      await addMcp(input.config, input.workspaceId, entry.name, entry.config);
    }
  }
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

    for (const spec of currentSpecs) {
      if (!input.enabled || !nextSpecSet.has(spec)) await unregisterOpencodePluginBinding(input.config, input.workspaceId, spec);
    }
    if (input.enabled) {
      for (const spec of nextSpecs) await registerOpencodePluginBinding(input.config, input.workspaceId, spec);
    }
    await syncMcpRuntime(input);
  },
};

export const deepSeekHarnessPluginEngineAdapter: PluginEngineAdapter = {
  id: DEEPSEEK_HARNESS_ENGINE_ID,
  // Skills and MCPs are projected into the Harness runtime. Commands and
  // agents are consumed through the server-owned prompt adapter, preserving
  // one portable package contract without pretending they are native DSH
  // plugins.
  portableResourceTypes: new Set(["skill", "agent", "command", "mcp"]),
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
    await syncMcpRuntime(input);
  },
};

export const pluginEngineAdapters = new PluginEngineAdapterRegistry([
  openCodePluginEngineAdapter,
  deepSeekHarnessPluginEngineAdapter,
]);
