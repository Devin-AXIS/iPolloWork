import { readRuntimeOpencodeConfig, runtimePluginList, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import { validatePluginSpec } from "./validators.js";

function normalizePluginSpec(spec: string): string {
  const trimmed = spec.trim();
  if (
    trimmed.startsWith("file:")
    || trimmed.startsWith("http:")
    || trimmed.startsWith("https:")
    || trimmed.startsWith("git:")
    || trimmed.startsWith("/")
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("@")) {
    const atIndex = trimmed.indexOf("@", 1);
    return atIndex > 0 ? trimmed.slice(0, atIndex) : trimmed;
  }
  const atIndex = trimmed.indexOf("@");
  return atIndex > 0 ? trimmed.slice(0, atIndex) : trimmed;
}

export async function registerOpencodePluginBinding(
  serverConfig: ServerConfig,
  workspaceId: string,
  spec: string,
): Promise<boolean> {
  validatePluginSpec(spec);
  const runtimeConfig = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
  const pluginSpecs = runtimePluginList(runtimeConfig);
  const normalized = normalizePluginSpec(spec);
  if (pluginSpecs.some((item) => normalizePluginSpec(item) === normalized)) return false;
  pluginSpecs.push(spec);
  await writeRuntimeOpencodeConfig(serverConfig, workspaceId, (current) => ({ ...current, plugin: pluginSpecs }));
  return true;
}

export async function unregisterOpencodePluginBinding(
  serverConfig: ServerConfig,
  workspaceId: string,
  spec: string,
): Promise<boolean> {
  const runtimeConfig = await readRuntimeOpencodeConfig(serverConfig, workspaceId);
  const pluginSpecs = runtimePluginList(runtimeConfig);
  const normalized = normalizePluginSpec(spec);
  const filtered = pluginSpecs.filter((item) => normalizePluginSpec(item) !== normalized);
  if (filtered.length === pluginSpecs.length) return false;
  await writeRuntimeOpencodeConfig(serverConfig, workspaceId, (current) => ({ ...current, plugin: filtered }));
  return true;
}
