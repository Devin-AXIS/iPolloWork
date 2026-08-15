import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type { PluginPackageManifest } from "./plugin-package-manifest.js";
import { ApiError } from "./errors.js";
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
  compatibility(manifest: PluginPackageManifest): PluginCompatibilityCheck[];
  workspaceFiles(version: PluginEngineVersion): PluginWorkspaceFile[];
  skillTargetPath(version: PluginEngineVersion, resourceId: string): string | null;
  syncRuntime(input: PluginEngineContext & {
    current: PluginEngineVersion | null;
    next: PluginEngineVersion | null;
    enabled: boolean;
  }): Promise<void>;
}

const OPENCODE_TARGETS = {
  skills: ".opencode/skills/",
  agents: ".opencode/agents/",
  commands: ".opencode/commands/",
} as const;

function projectedPath(sourcePath: string): string | null {
  for (const [directory, target] of Object.entries(OPENCODE_TARGETS)) {
    if (sourcePath.startsWith(`${directory}/`)) return `${target}${sourcePath.slice(directory.length + 1)}`;
  }
  return null;
}

function workspaceFiles(version: PluginEngineVersion): PluginWorkspaceFile[] {
  return version.files.flatMap((file) => {
    const targetPath = projectedPath(file.path);
    return targetPath ? [{ ...file, sourcePath: file.path, targetPath }] : [];
  });
}

function skillTargetPath(version: PluginEngineVersion, resourceId: string): string | null {
  const resource = version.manifest.resources.find((entry) => entry.id === resourceId && entry.type === "skill");
  if (!resource?.path) return null;
  const ownedPaths = new Set(version.files.map((file) => file.path));
  const sourcePath = ownedPaths.has(resource.path) && (resource.path === "SKILL.md" || resource.path.endsWith("/SKILL.md"))
    ? resource.path
    : `${resource.path.replace(/\/$/, "")}/SKILL.md`;
  return ownedPaths.has(sourcePath) ? projectedPath(sourcePath) : null;
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
): Promise<Array<{ name: string; config: Record<string, unknown> }>> {
  if (!version) return [];
  const entries: Array<{ name: string; config: Record<string, unknown> }> = [];
  for (const resource of version.manifest.resources) {
    if (resource.type !== "mcp" || !resource.path) continue;
    const payload: unknown = JSON.parse(await readFile(resolvePath(version.artifactRoot, resource.path), "utf8"));
    entries.push(...parsePluginMcpEntries(payload, resource.mcpServerName ?? resource.id, resource.path));
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
    return [capability.path
      ? pathToFileURL(resolvePath(version.artifactRoot, capability.path)).href
      : capability.packageName ?? ""];
  });
}

export const openCodePluginEngineAdapter: PluginEngineAdapter = {
  id: "opencode",
  compatibility(manifest) {
    const binding = manifest.engineBindings?.find((entry) => entry.engine === "opencode");
    return [{ name: "OpenCode", version: constants.opencodeVersion, range: binding?.compatibility }];
  },
  workspaceFiles,
  skillTargetPath,
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

export const pluginEngineAdapter: PluginEngineAdapter = openCodePluginEngineAdapter;
