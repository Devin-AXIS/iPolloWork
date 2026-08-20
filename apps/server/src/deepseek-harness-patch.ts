import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { stringify as stringifyYaml } from "yaml";

import { listRuntimeMcp } from "./mcp.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

function mcpServerName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp";
  if (normalized.length <= 32) return normalized;
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return `${normalized.slice(0, 23)}-${suffix}`;
}

function uniqueMcpServerName(name: string, usedNames: Set<string>): string {
  const preferred = mcpServerName(name);
  if (!usedNames.has(preferred)) return preferred;
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  return mcpServerName(`${name}-${suffix}`);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === "string" ? [[key, entry]] : []
  ));
}

function localCommand(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string") && value.length > 0) return value;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return null;
}

export async function buildDeepSeekHarnessPatch(
  config: ServerConfig,
  workspace: WorkspaceInfo,
): Promise<unknown[]> {
  const patches: unknown[] = [
    { id: "skill-filesystem", disabled: false },
    { id: "tool-skill", disabled: false },
  ];
  const hostPluginPath = process.env.IPOLLOWORK_DSH_HOST_PLUGIN?.trim();
  if (hostPluginPath && existsSync(hostPluginPath)) {
    patches.push({
      insert: [{
        id: "ipollowork-host-tools",
        name: pathToFileURL(hostPluginPath).href,
      }],
    });
  }

  const rows: unknown[] = [];
  const usedNames = new Set<string>();
  for (const item of await listRuntimeMcp(config, workspace.id)) {
    const mcpConfig = item.config;
    if (mcpConfig.enabled === false || item.disabledByTools) continue;
    const serverName = uniqueMcpServerName(item.name, usedNames);
    usedNames.add(serverName);
    if (mcpConfig.type === "local") {
      const command = localCommand(mcpConfig.command);
      if (!command) continue;
      rows.push({
        id: `ipollowork-mcp-${serverName}`,
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          transport: "stdio",
          serverName,
          command: command[0],
          args: command.slice(1),
          env: { ...stringRecord(mcpConfig.environment), ...stringRecord(mcpConfig.env) },
          cwd: typeof mcpConfig.cwd === "string" && mcpConfig.cwd.trim() ? mcpConfig.cwd : workspace.path,
          toolCallTimeoutMs: 120_000,
          failOnStartupError: false,
        },
      });
      continue;
    }
    if (mcpConfig.type === "remote" && typeof mcpConfig.url === "string" && mcpConfig.url.trim()) {
      rows.push({
        id: `ipollowork-mcp-${serverName}`,
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          transport: "streamable-http",
          serverName,
          url: mcpConfig.url,
          headers: stringRecord(mcpConfig.headers),
          toolCallTimeoutMs: 120_000,
          failOnStartupError: false,
        },
      });
    }
  }
  if (rows.length > 0) patches.push({ insert: rows });
  return patches;
}

export async function writeDeepSeekHarnessPatchFile(input: {
  config: ServerConfig;
  workspace: WorkspaceInfo;
  path: string;
}): Promise<void> {
  await writeFile(
    input.path,
    stringifyYaml(await buildDeepSeekHarnessPatch(input.config, input.workspace)),
    "utf8",
  );
}
