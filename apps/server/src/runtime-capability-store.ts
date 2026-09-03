import {
  onRuntimeOpencodeConfigWrite,
  readRuntimeOpencodeConfig,
  runtimeMcpMap,
  writeRuntimeOpencodeConfig,
  type RuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

export type RuntimeMcpConfig = Record<string, Record<string, unknown>>;
export type RuntimeMcpConfigWriteListener = (config: ServerConfig, workspaceId: string) => void;

const mcpWriteListeners = new Set<RuntimeMcpConfigWriteListener>();

function sameMcpConfig(previous: RuntimeOpencodeConfig, next: RuntimeOpencodeConfig): boolean {
  return JSON.stringify(runtimeMcpMap(previous)) === JSON.stringify(runtimeMcpMap(next));
}

onRuntimeOpencodeConfigWrite((config, workspaceId, previous, next) => {
  if (sameMcpConfig(previous, next)) return;
  for (const listener of mcpWriteListeners) listener(config, workspaceId);
});

export function onRuntimeMcpConfigWrite(listener: RuntimeMcpConfigWriteListener): () => void {
  mcpWriteListeners.add(listener);
  return () => mcpWriteListeners.delete(listener);
}

export async function readRuntimeMcpConfig(
  config: ServerConfig,
  workspaceId: string,
): Promise<RuntimeMcpConfig> {
  return runtimeMcpMap(await readRuntimeOpencodeConfig(config, workspaceId));
}

export async function writeRuntimeMcpConfig(
  config: ServerConfig,
  workspaceId: string,
  updater: (current: RuntimeMcpConfig) => RuntimeMcpConfig,
): Promise<{ config: RuntimeMcpConfig; changed: boolean }> {
  const result = await writeRuntimeOpencodeConfig(config, workspaceId, (current) => ({
    ...current,
    mcp: updater(runtimeMcpMap(current)),
  }));
  return { config: runtimeMcpMap(result.config), changed: result.changed };
}
