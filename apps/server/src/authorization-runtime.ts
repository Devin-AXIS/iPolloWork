import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ApiError } from "./errors.js";
import { AuthorizationVault } from "./authorization-vault.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const vaults = new Map<string, Promise<AuthorizationVault>>();

function vaultPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "authorization.vault");
}

function keyPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "authorization.key");
}

function legacyKeyPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "plugin-authorization.key");
}

async function readKey(path: string): Promise<Buffer | null> {
  try {
    const key = Buffer.from((await readFile(path, "utf8")).trim(), "base64");
    if (key.byteLength !== 32) throw new ApiError(500, "authorization_key_invalid", "Authorization encryption key is invalid");
    return key;
  } catch (error) {
    if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") return null;
    throw error;
  }
}

export async function authorizationEncryptionKey(config: ServerConfig): Promise<Buffer> {
  const path = keyPath(config);
  const current = await readKey(path);
  if (current) return current;

  const legacyPath = legacyKeyPath(config);
  const legacy = await readKey(legacyPath);
  if (legacy) {
    await mkdir(dirname(path), { recursive: true });
    try {
      await rename(legacyPath, path);
      await chmod(path, 0o600).catch(() => undefined);
      return legacy;
    } catch (error) {
      if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "EEXIST") throw error;
      const concurrent = await readKey(path);
      if (!concurrent) throw new ApiError(500, "authorization_key_missing", "Authorization encryption key is unavailable");
      return concurrent;
    }
  }

  const key = randomBytes(32);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(path, 0o600).catch(() => undefined);
    return key;
  } catch (error) {
    if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "EEXIST") throw error;
    const concurrent = await readKey(path);
    if (!concurrent) throw new ApiError(500, "authorization_key_missing", "Authorization encryption key is unavailable");
    return concurrent;
  }
}

export async function authorizationVault(config: ServerConfig): Promise<AuthorizationVault> {
  const path = vaultPath(config);
  const existing = vaults.get(path);
  if (existing) return existing;
  const created = authorizationEncryptionKey(config).then((key) => new AuthorizationVault({ filePath: path, encryptionKey: key }));
  vaults.set(path, created);
  return created;
}

export function authorizationConsumerId(scope: string, ownerId: string): string {
  return `${scope}:${ownerId}`;
}

export const __test__ = { keyPath, legacyKeyPath, vaultPath };
