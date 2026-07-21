import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ApiError } from "./errors.js";
import { startPluginAuthorizationFlow } from "./plugin-authorization.js";
import { PluginAuthorizationStore, type PluginConnectionStatus } from "./plugin-authorization-store.js";
import { listInstalledPluginPackages } from "./plugin-package-lifecycle.js";
import type { PluginAuthorizationMethod, PluginPackageManifest } from "./plugin-package-manifest.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const storeByPath = new Map<string, Promise<PluginAuthorizationStore>>();
const credentialRefreshesByStore = new WeakMap<PluginAuthorizationStore, Map<string, Promise<Readonly<Record<string, string>>>>>();

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function storePath(config: ServerConfig, workspaceId: string): string {
  return join(runtimeStorageDir(config), "plugin-authorization", `${safeSegment(workspaceId)}.vault`);
}

function keyPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), "plugin-authorization.key");
}

async function encryptionKey(config: ServerConfig): Promise<Buffer> {
  const path = keyPath(config);
  try {
    const key = Buffer.from((await readFile(path, "utf8")).trim(), "base64");
    if (key.byteLength !== 32) throw new ApiError(500, "plugin_authorization_key_invalid", "Plugin authorization encryption key is invalid");
    return key;
  } catch (error) {
    if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "ENOENT") throw error;
  }
  const key = randomBytes(32);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(path, 0o600).catch(() => undefined);
    return key;
  } catch (error) {
    if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "EEXIST") throw error;
    const existing = Buffer.from((await readFile(path, "utf8")).trim(), "base64");
    if (existing.byteLength !== 32) throw new ApiError(500, "plugin_authorization_key_invalid", "Plugin authorization encryption key is invalid");
    return existing;
  }
}

export async function pluginAuthorizationStore(config: ServerConfig, workspaceId: string): Promise<PluginAuthorizationStore> {
  const path = storePath(config, workspaceId);
  const existing = storeByPath.get(path);
  if (existing) return existing;
  const created = encryptionKey(config).then((key) => new PluginAuthorizationStore({ filePath: path, encryptionKey: key }));
  storeByPath.set(path, created);
  return created;
}

export function pluginInstallationId(workspaceId: string, pluginId: string): string {
  return `${workspaceId}:${pluginId}`;
}

export type BoundPluginAuthorizationRuntime = {
  listConnections(): Promise<PluginConnectionStatus[]>;
  getCredential(methodId: string, accountId?: string): Promise<Readonly<Record<string, string>> | null>;
  readCredential(accountId: string, methodId: string): Promise<Readonly<Record<string, string>> | null>;
  setActiveAccount(methodId: string, accountId: string): Promise<boolean>;
};

type BoundPluginAuthorizationOptions = {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};

/**
 * Creates a capability bound to one installed plugin. Local-service adapters can
 * pass this object to the plugin without exposing workspace or plugin selectors,
 * so the plugin cannot address another installation through the bridge.
 */
export async function bindPluginAuthorizationRuntime(
  config: ServerConfig,
  workspaceId: string,
  pluginId: string,
  options: BoundPluginAuthorizationOptions = {},
): Promise<BoundPluginAuthorizationRuntime> {
  const manifest = await installedManifest(config, workspaceId, pluginId);
  const installationId = pluginInstallationId(workspaceId, manifest.id);
  const store = await pluginAuthorizationStore(config, workspaceId);
  const getCredential = async (methodId: string, accountId?: string) => {
    const method = authorizationMethod(manifest, methodId);
    const credential = accountId
      ? { accountId, values: await store.readCredentialForAccount({ installationId, accountId, methodId }) }
      : await store.readActiveCredential({ installationId, methodId });
    if (!credential?.values) return null;
    const values = await refreshCredentialIfNeeded({
      installationId,
      accountId: credential.accountId,
      method,
      values: credential.values,
      store,
      fetcher: options.fetcher ?? fetch,
      now: options.now?.() ?? Date.now(),
    });
    return Object.freeze({ ...values });
  };
  return {
    listConnections: () => store.listConnections(installationId),
    getCredential,
    readCredential: (accountId, methodId) => getCredential(methodId, accountId),
    setActiveAccount: (methodId, accountId) => store.setActiveAccount({ installationId, methodId, accountId }),
  };
}

async function installedManifest(config: ServerConfig, workspaceId: string, pluginId: string): Promise<PluginPackageManifest> {
  const installed = (await listInstalledPluginPackages({ serverConfig: config, workspaceId })).find((entry) => entry.pluginId === pluginId);
  if (!installed) throw new ApiError(404, "plugin_package_not_installed", "Plugin package is not installed");
  return installed.manifest;
}

function authorizationMethod(manifest: PluginPackageManifest, methodId: string): PluginAuthorizationMethod {
  const method = manifest.authorization?.methods.find((entry) => entry.id === methodId);
  if (!method) throw new ApiError(404, "plugin_authorization_method_not_found", "Plugin authorization method was not found");
  return method;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "plugin_authorization_values_invalid", "Authorization values must be an object");
  }
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new ApiError(400, "plugin_authorization_values_invalid", `Authorization field must be text: ${key}`);
    output[key] = entry;
  }
  return output;
}

export async function listPluginAuthorization(config: ServerConfig, workspaceId: string, pluginId: string) {
  const manifest = await installedManifest(config, workspaceId, pluginId);
  const installationId = pluginInstallationId(workspaceId, pluginId);
  const store = await pluginAuthorizationStore(config, workspaceId);
  const connections = await store.listConnections(installationId);
  const requiredMethodIds = [...new Set(manifest.resources.flatMap((resource) =>
    resource.requires?.flatMap((requirement) => requirement.startsWith("authorization:") ? [requirement.slice("authorization:".length)] : []) ?? []
  ))];
  const connectedMethodIds = new Set(connections.map((connection) => connection.methodId));
  const required = manifest.authorization?.required === true || requiredMethodIds.length > 0;
  const ready = requiredMethodIds.length
    ? requiredMethodIds.every((methodId) => connectedMethodIds.has(methodId))
    : !required || connections.length > 0;
  return {
    required,
    ready,
    requiredMethodIds,
    methods: manifest.authorization?.methods.map((method) => ({ id: method.id, kind: method.kind, label: method.label, description: method.description ?? null })) ?? [],
    connections,
    flows: await store.listPendingFlows(installationId),
  };
}

export async function savePluginSecretAuthorization(input: {
  config: ServerConfig;
  workspaceId: string;
  pluginId: string;
  methodId: string;
  accountId: string;
  values: unknown;
}) {
  const manifest = await installedManifest(input.config, input.workspaceId, input.pluginId);
  const method = authorizationMethod(manifest, input.methodId);
  if (method.kind !== "secret-form") throw new ApiError(400, "plugin_authorization_method_invalid", "This method does not accept a secret form");
  const values = stringRecord(input.values);
  const allowedFields = new Set(method.fields.map((field) => field.id));
  const unexpected = Object.keys(values).filter((field) => !allowedFields.has(field));
  if (unexpected.length) throw new ApiError(400, "plugin_authorization_field_unknown", `Unknown authorization field: ${unexpected[0]}`);
  const missing = method.fields.filter((field) => field.required !== false && !values[field.id]?.trim());
  if (missing.length) throw new ApiError(400, "plugin_authorization_field_required", `${missing[0]?.label ?? "Authorization field"} is required`);
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  const saved = await store.saveCredential({
    installationId: pluginInstallationId(input.workspaceId, input.pluginId),
    accountId: input.accountId,
    methodId: input.methodId,
    values,
    secretFields: method.fields.filter((field) => field.secret !== false).map((field) => field.id),
  });
  return saved.status;
}

export async function startIndependentPluginAuthorization(input: {
  config: ServerConfig;
  workspaceId: string;
  pluginId: string;
  methodId: string;
  accountId: string;
  callbackUrl: string;
}) {
  const manifest = await installedManifest(input.config, input.workspaceId, input.pluginId);
  const method = authorizationMethod(manifest, input.methodId);
  if (method.kind === "secret-form") throw new ApiError(400, "plugin_authorization_method_invalid", "Secret forms are saved directly and cannot be started");
  const installationId = pluginInstallationId(input.workspaceId, input.pluginId);
  let started;
  if (method.kind === "oauth-pkce") {
    started = await startPluginAuthorizationFlow({ installationId, accountId: input.accountId, method, callbackUrl: input.callbackUrl });
  } else if (method.kind === "device-code") {
    started = await startPluginAuthorizationFlow({ installationId, accountId: input.accountId, method });
  } else {
    started = await startPluginAuthorizationFlow({ installationId, accountId: input.accountId, method, callbackUrl: input.callbackUrl });
  }
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  const state = "state" in started.private ? started.private.state : started.public.flowId;
  await store.savePendingFlow({
    installationId,
    accountId: input.accountId,
    methodId: method.id,
    flowId: started.public.flowId,
    state,
    privateData: started.private,
    expiresAt: started.public.expiresAt,
  });
  return started.public;
}

function tokenValues(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(502, "plugin_authorization_token_invalid", "Authorization server returned an invalid token response");
  }
  const accessToken = Reflect.get(payload, "access_token");
  if (typeof accessToken !== "string" || !accessToken) {
    throw new ApiError(502, "plugin_authorization_token_failed", "Authorization server did not return an access token");
  }
  const values: Record<string, string> = { accessToken };
  for (const [source, target] of [
    ["refresh_token", "refreshToken"],
    ["token_type", "tokenType"],
    ["scope", "scope"],
    ["id_token", "idToken"],
  ]) {
    const value = Reflect.get(payload, source);
    if (typeof value === "string" && value) values[target] = value;
  }
  const expiresIn = Reflect.get(payload, "expires_in");
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) values.expiresAt = String(Date.now() + expiresIn * 1_000);
  return values;
}

async function refreshCredentialIfNeeded(input: {
  installationId: string;
  accountId: string;
  method: PluginAuthorizationMethod;
  values: Record<string, string>;
  store: PluginAuthorizationStore;
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now: number;
}): Promise<Readonly<Record<string, string>>> {
  const expiresAt = Number(input.values.expiresAt);
  if (input.method.kind === "secret-form" || !Number.isFinite(expiresAt) || expiresAt > input.now + 60_000) {
    return input.values;
  }
  const refreshToken = input.values.refreshToken;
  if (!refreshToken) throw new ApiError(401, "plugin_authorization_expired", "Plugin authorization expired; reconnect the plugin");
  const endpoint = input.method.kind === "hosted-browser" ? input.method.refreshUrl : input.method.tokenUrl;
  if (!endpoint) throw new ApiError(401, "plugin_authorization_expired", "Plugin authorization expired; reconnect the plugin");
  const refreshes = credentialRefreshesByStore.get(input.store) ?? new Map<string, Promise<Readonly<Record<string, string>>>>();
  credentialRefreshesByStore.set(input.store, refreshes);
  const refreshKey = `${input.installationId}\0${input.accountId}\0${input.method.id}`;
  const current = refreshes.get(refreshKey);
  if (current) return current;
  const refreshing = (async () => {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (input.method.kind === "oauth-pkce" || input.method.kind === "device-code") body.set("client_id", input.method.clientId);
    const response = await input.fetcher(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new ApiError(401, "plugin_authorization_refresh_failed", "Plugin authorization could not be refreshed; reconnect the plugin");
    const refreshed = { ...input.values, ...tokenValues(payload) };
    await input.store.saveCredential({
      installationId: input.installationId,
      accountId: input.accountId,
      methodId: input.method.id,
      values: refreshed,
      secretFields: Object.keys(refreshed),
      now: input.now,
    });
    return Object.freeze({ ...refreshed });
  })();
  refreshes.set(refreshKey, refreshing);
  try {
    return await refreshing;
  } finally {
    if (refreshes.get(refreshKey) === refreshing) refreshes.delete(refreshKey);
  }
}

export async function completePluginBrowserAuthorization(input: {
  config: ServerConfig;
  workspaceId: string;
  pluginId: string;
  state: string;
  code?: string;
  fetcher?: typeof fetch;
}) {
  const installationId = pluginInstallationId(input.workspaceId, input.pluginId);
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  const flow = await store.consumePendingFlow({ installationId, state: input.state });
  if (!flow) throw new ApiError(400, "plugin_authorization_callback_invalid", "Authorization callback is invalid, expired, or already used");
  const manifest = await installedManifest(input.config, input.workspaceId, input.pluginId);
  const method = authorizationMethod(manifest, flow.methodId);
  let values: Record<string, string>;
  if (method.kind === "oauth-pkce") {
    if (!input.code) throw new ApiError(400, "plugin_authorization_code_required", "Authorization code is required");
    const verifier = flow.privateData.pkceVerifier;
    const redirectUri = flow.privateData.redirectUri;
    if (typeof verifier !== "string" || typeof redirectUri !== "string") throw new ApiError(500, "plugin_authorization_flow_invalid", "OAuth flow state is invalid");
    const response = await (input.fetcher ?? fetch)(method.tokenUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: method.clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new ApiError(502, "plugin_authorization_token_failed", `Token exchange failed with HTTP ${response.status}`);
    values = tokenValues(payload);
  } else if (method.kind === "hosted-browser") {
    if (!input.code) throw new ApiError(400, "plugin_authorization_code_required", "Authorization code is required");
    const callbackUrl = flow.privateData.callbackUrl;
    if (typeof callbackUrl !== "string") throw new ApiError(500, "plugin_authorization_flow_invalid", "Hosted authorization flow state is invalid");
    const response = await (input.fetcher ?? fetch)(method.exchangeUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: input.code, redirect_uri: callbackUrl }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new ApiError(502, "plugin_authorization_token_failed", `Hosted token exchange failed with HTTP ${response.status}`);
    values = tokenValues(payload);
  } else {
    throw new ApiError(400, "plugin_authorization_callback_invalid", "This authorization method does not use a browser callback");
  }
  const saved = await store.saveCredential({
    installationId,
    accountId: flow.accountId,
    methodId: flow.methodId,
    values,
    secretFields: Object.keys(values),
  });
  return saved.status;
}

export async function pollPluginDeviceAuthorization(input: {
  config: ServerConfig;
  workspaceId: string;
  pluginId: string;
  flowId: string;
  fetcher?: typeof fetch;
}): Promise<PluginConnectionStatus | { status: "pending"; flowId: string; expiresAt: number }> {
  const installationId = pluginInstallationId(input.workspaceId, input.pluginId);
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  const flow = await store.readPendingFlow({ installationId, flowId: input.flowId });
  if (!flow) throw new ApiError(400, "plugin_authorization_flow_invalid", "Device authorization is invalid or expired");
  const manifest = await installedManifest(input.config, input.workspaceId, input.pluginId);
  const method = authorizationMethod(manifest, flow.methodId);
  if (method.kind !== "device-code") throw new ApiError(400, "plugin_authorization_method_invalid", "This flow is not device authorization");
  const deviceCode = flow.privateData.deviceCode;
  if (typeof deviceCode !== "string") throw new ApiError(500, "plugin_authorization_flow_invalid", "Device authorization flow state is invalid");
  const response = await (input.fetcher ?? fetch)(method.tokenUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: method.clientId,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok && payload && typeof payload === "object" && !Array.isArray(payload)) {
    const providerError = Reflect.get(payload, "error");
    if (providerError === "authorization_pending" || providerError === "slow_down") return { status: "pending", flowId: flow.flowId, expiresAt: flow.expiresAt };
  }
  if (!response.ok) throw new ApiError(502, "plugin_authorization_token_failed", `Device token exchange failed with HTTP ${response.status}`);
  const values = tokenValues(payload);
  await store.consumePendingFlow({ installationId, state: flow.state });
  const saved = await store.saveCredential({
    installationId,
    accountId: flow.accountId,
    methodId: flow.methodId,
    values,
    secretFields: Object.keys(values),
  });
  return saved.status;
}

export async function revokePluginAuthorization(input: { config: ServerConfig; workspaceId: string; pluginId: string; accountId: string }) {
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  return store.revokeAccount({ installationId: pluginInstallationId(input.workspaceId, input.pluginId), accountId: input.accountId });
}

export async function cancelPluginAuthorizationFlow(input: { config: ServerConfig; workspaceId: string; pluginId: string; flowId: string }) {
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  return store.cancelPendingFlow({ installationId: pluginInstallationId(input.workspaceId, input.pluginId), flowId: input.flowId });
}

export async function deletePluginAuthorization(input: { config: ServerConfig; workspaceId: string; pluginId: string }) {
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  return store.deleteInstallation(pluginInstallationId(input.workspaceId, input.pluginId));
}

export async function reconcilePluginAuthorization(input: { config: ServerConfig; workspaceId: string; pluginId: string }) {
  const manifest = await installedManifest(input.config, input.workspaceId, input.pluginId);
  const methodIds = new Set(manifest.authorization?.methods.map((method) => method.id) ?? []);
  const store = await pluginAuthorizationStore(input.config, input.workspaceId);
  return store.retainMethods(pluginInstallationId(input.workspaceId, input.pluginId), methodIds);
}
