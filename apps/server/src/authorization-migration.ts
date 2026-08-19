import { createDecipheriv } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { authorizationMethodFingerprint } from "./authorization-method.js";
import { authorizationConsumerId, authorizationEncryptionKey, authorizationVault } from "./authorization-runtime.js";
import { pluginAuthorizationMethodSchema, type PluginAuthorizationMethod } from "./plugin-package-manifest.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const legacyCredentialSchema = z.object({
  handle: z.string(),
  installationId: z.string(),
  accountId: z.string(),
  methodId: z.string(),
  values: z.record(z.string(), z.string()),
  secretFields: z.array(z.string()),
  updatedAt: z.number(),
});

const legacyActiveAccountSchema = z.object({
  installationId: z.string(),
  methodId: z.string(),
  accountId: z.string(),
});

const legacyStoreSchema = z.object({
  schemaVersion: z.literal(1),
  credentials: z.array(legacyCredentialSchema),
  pendingFlows: z.array(z.unknown()),
  activeAccounts: z.array(legacyActiveAccountSchema).default([]),
});

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});

type InstalledMethod = { pluginId: string; connectionId: string; method: PluginAuthorizationMethod };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? Reflect.get(error, "code") as string
    : null;
}

function methodFromManifest(value: unknown, pluginId: string): PluginAuthorizationMethod | null {
  if (!isRecord(value)) return null;
  const parsed = pluginAuthorizationMethodSchema.safeParse({
    ...value,
    connectionId: typeof value.connectionId === "string" && value.connectionId.trim() ? value.connectionId : pluginId,
  });
  return parsed.success ? parsed.data : null;
}

async function installedMethods(config: ServerConfig, workspaceId: string): Promise<Map<string, InstalledMethod>> {
  const inventoryRoot = join(runtimeStorageDir(config), "plugin-packages");
  const paths = [join(inventoryRoot, "state.json"), join(inventoryRoot, safeSegment(workspaceId), "state.json")];
  let state: unknown;
  for (const path of paths) {
    try {
      state = JSON.parse(await readFile(path, "utf8"));
      break;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  if (!state) return new Map();
  const packages = isRecord(state) && isRecord(state.packages) ? state.packages : {};
  const methods = new Map<string, InstalledMethod>();
  for (const [pluginId, packageValue] of Object.entries(packages)) {
    if (!isRecord(packageValue) || typeof packageValue.currentVersion !== "string" || !isRecord(packageValue.versions)) continue;
    const version = packageValue.versions[packageValue.currentVersion];
    if (!isRecord(version) || !isRecord(version.manifest)) continue;
    const authorization = isRecord(version.manifest.authorization) ? version.manifest.authorization : null;
    const manifestMethods = authorization && Array.isArray(authorization.methods) ? authorization.methods : [];
    for (const value of manifestMethods) {
      const method = methodFromManifest(value, pluginId);
      if (!method) continue;
      methods.set(`${workspaceId}:${pluginId}\0${method.id}`, { pluginId, connectionId: method.connectionId, method });
    }
  }
  return methods;
}

async function readLegacyVault(path: string, key: Buffer) {
  const envelope = envelopeSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return legacyStoreSchema.parse(JSON.parse(decrypted));
}

export async function migrateLegacyPluginAuthorization(config: ServerConfig): Promise<number> {
  const directory = join(runtimeStorageDir(config), "plugin-authorization");
  let files: string[];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".vault"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }
  if (!files.length) return 0;

  const key = await authorizationEncryptionKey(config);
  const vault = await authorizationVault(config);
  let migrated = 0;
  for (const workspace of config.workspaces) {
    const file = files.find((entry) => entry === `${safeSegment(workspace.id)}.vault`);
    if (!file) continue;
    const legacy = await readLegacyVault(join(directory, file), key);
    const methods = await installedMethods(config, workspace.id);
    for (const credential of legacy.credentials) {
      const installed = methods.get(`${credential.installationId}\0${credential.methodId}`);
      if (!installed) continue;
      await vault.saveCredential({
        connectionId: installed.connectionId,
        accountId: credential.accountId,
        methodId: credential.methodId,
        methodFingerprint: authorizationMethodFingerprint(installed.method),
        values: credential.values,
        secretFields: credential.secretFields,
        now: credential.updatedAt,
      });
      migrated += 1;
    }
    for (const active of legacy.activeAccounts) {
      const installed = methods.get(`${active.installationId}\0${active.methodId}`);
      if (!installed) continue;
      await vault.setActiveAccount({
        consumerId: authorizationConsumerId("plugin", installed.pluginId),
        connectionId: installed.connectionId,
        methodId: active.methodId,
        methodFingerprint: authorizationMethodFingerprint(installed.method),
        accountId: active.accountId,
      });
    }
    await rm(join(directory, file), { force: true });
  }
  if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true });
  return migrated;
}
