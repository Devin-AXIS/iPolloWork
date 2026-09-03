import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { ServerConfig } from "./types.js";

export function runtimeDbPath(config: ServerConfig): string {
  const override = process.env.IPOLLOWORK_RUNTIME_DB?.trim();
  if (override) return resolve(override);
  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "ipollowork");
  return join(configDir, "runtime.sqlite");
}

/** Directory for engine-neutral server runtime state and derived files. */
export function runtimeStorageDir(config: ServerConfig): string {
  return dirname(runtimeDbPath(config));
}
