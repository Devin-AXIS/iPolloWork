import { minimatch } from "minimatch";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpItem, ServerConfig } from "./types.js";
import { readJsoncFile } from "./jsonc.js";
import { opencodeConfigPath } from "./workspace-files.js";
import { validateMcpConfig, validateMcpName } from "./validators.js";
import { forgetMcpAuthorizationConsumer, publicMcpConfig, secureMcpAuthorizationConfig } from "./mcp-authorization.js";
import { readRuntimeMcpConfig, writeRuntimeMcpConfig } from "./runtime-capability-store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function globalOpenCodeConfigPath(): string {
  const base = join(homedir(), ".config", "opencode");
  const jsonc = join(base, "opencode.jsonc");
  const json = join(base, "opencode.json");
  if (existsSync(jsonc)) return jsonc;
  if (existsSync(json)) return json;
  return jsonc; // fall back to jsonc (readJsoncFile handles missing files gracefully)
}

function getMcpConfig(config: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const mcp = config.mcp;
  if (!mcp || typeof mcp !== "object") return {};
  return mcp as Record<string, Record<string, unknown>>;
}

function getDeniedToolPatterns(config: Record<string, unknown>): string[] {
  const tools = config.tools;
  if (!tools || typeof tools !== "object") return [];
  const deny = (tools as { deny?: unknown }).deny;
  if (!Array.isArray(deny)) return [];
  return deny.filter((item) => typeof item === "string") as string[];
}

function isMcpDisabledByTools(config: Record<string, unknown>, name: string): boolean {
  const patterns = getDeniedToolPatterns(config);
  if (patterns.length === 0) return false;
  const candidates = [`mcp.${name}`, `mcp.${name}.*`, `mcp:${name}`, `mcp:${name}:*`, "mcp.*", "mcp:*"];
  return patterns.some((pattern) => candidates.some((candidate) => minimatch(candidate, pattern)));
}

export async function listMcp(serverConfig: ServerConfig, workspaceId: string, workspaceRoot: string): Promise<McpItem[]> {
  const { data: config } = await readJsoncFile(opencodeConfigPath(workspaceRoot), {} as Record<string, unknown>, { allowInvalid: true });
  const { data: globalConfig } = await readJsoncFile(globalOpenCodeConfigPath(), {} as Record<string, unknown>, { allowInvalid: true });

  const projectMcpMap = getMcpConfig(config);
  const globalMcpMap = getMcpConfig(globalConfig);
  const runtimeMap = await readRuntimeMcpConfig(serverConfig, workspaceId);

  const items: McpItem[] = [];

  // Global MCPs first; project-level entries override global ones with the same name.
  for (const [name, entry] of Object.entries(globalMcpMap)) {
    if (Object.prototype.hasOwnProperty.call(projectMcpMap, name) || Object.prototype.hasOwnProperty.call(runtimeMap, name)) continue;
    items.push({
      name,
      config: entry,
      source: "config.global",
      disabledByTools:
        (isMcpDisabledByTools(globalConfig, name) || isMcpDisabledByTools(config, name)) || undefined,
    });
  }

  // Project MCPs (highest priority).
  for (const [name, entry] of Object.entries(projectMcpMap)) {
    if (Object.prototype.hasOwnProperty.call(runtimeMap, name)) continue;
    items.push({
      name,
      config: entry,
      source: "config.project",
      disabledByTools: isMcpDisabledByTools(config, name) || undefined,
    });
  }

  // iPolloWork-owned MCPs are stored by the server and injected at runtime.
  const runtimeItems = await listRuntimeMcp(serverConfig, workspaceId);
  items.push(...await Promise.all(runtimeItems.map(async (item) => ({
    ...item,
    config: await publicMcpConfig(serverConfig, workspaceId, item.name, item.config),
    disabledByTools: isMcpDisabledByTools(config, item.name) || undefined,
  }))));

  return items;
}

export async function listRuntimeMcp(serverConfig: ServerConfig, workspaceId: string): Promise<McpItem[]> {
  const items: McpItem[] = [];
  for (const [name, entry] of Object.entries(await readRuntimeMcpConfig(serverConfig, workspaceId))) {
    items.push({
      name,
      // Engine adapters need the actual runtime projection. In particular,
      // OAuth MCPs use the iPolloWork proxy URL plus its scoped capability
      // header. listMcp() converts this to a safe public representation for UI.
      config: entry,
      source: "config.remote",
    });
  }
  return items;
}

export async function addMcp(
  serverConfig: ServerConfig,
  workspaceId: string,
  name: string,
  config: Record<string, unknown>,
): Promise<{ action: "added" | "updated" }> {
  validateMcpName(name);
  validateMcpConfig(config);
  const mcpMap = { ...await readRuntimeMcpConfig(serverConfig, workspaceId) };
  const existed = Object.prototype.hasOwnProperty.call(mcpMap, name);
  const usesWorkAuthorization = config.type === "remote" && (config.oauth === true || isRecord(config.oauth)) && !isRecord(config.headers);
  mcpMap[name] = usesWorkAuthorization
    ? await secureMcpAuthorizationConfig(serverConfig, workspaceId, name, config)
    : config;
  await writeRuntimeMcpConfig(serverConfig, workspaceId, () => mcpMap);
  return { action: existed ? "updated" : "added" };
}

export async function removeMcp(serverConfig: ServerConfig, workspaceId: string, name: string): Promise<boolean> {
  const mcpMap = { ...await readRuntimeMcpConfig(serverConfig, workspaceId) };
  if (!Object.prototype.hasOwnProperty.call(mcpMap, name)) return false;
  delete mcpMap[name];
  await writeRuntimeMcpConfig(serverConfig, workspaceId, () => mcpMap);
  await forgetMcpAuthorizationConsumer(serverConfig, workspaceId, name);
  return true;
}

// Flips `enabled` on a workspace MCP entry. Returns false for "toggle does
// not apply": missing, non-object, or malformed enough that OpenCode would
// fail to load it. The HTTP layer maps false to 404. Globals are out of
// scope by design — only workspace-level entries.
//
// `updateJsoncPath` (vs `updateJsoncTopLevel`) preserves inline comments
// inside the MCP entry — see the regression that motivated #1444.
export async function setMcpEnabled(
  serverConfig: ServerConfig,
  workspaceId: string,
  name: string,
  enabled: boolean,
): Promise<boolean> {
  validateMcpName(name);
  const mcpMap = { ...await readRuntimeMcpConfig(serverConfig, workspaceId) };
  if (!Object.prototype.hasOwnProperty.call(mcpMap, name)) return false;
  const current = mcpMap[name];
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  try {
    validateMcpConfig({ ...(current as Record<string, unknown>), enabled });
  } catch {
    return false;
  }
  mcpMap[name] = { ...(current as Record<string, unknown>), enabled };
  await writeRuntimeMcpConfig(serverConfig, workspaceId, () => mcpMap);
  return true;
}
