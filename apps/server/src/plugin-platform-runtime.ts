import { ApiError } from "./errors.js";
import { authorizationMethodFingerprint } from "./authorization-method.js";
import { authorizationConsumerId, authorizationVault } from "./authorization-runtime.js";
import {
  exchangeDeviceCode,
  exchangeOAuthAuthorizationCode,
  refreshOAuthCredential,
  startPluginAuthorizationFlow,
  tokenValues,
} from "./authorization-protocol.js";
import { type AuthorizationVault, type ConnectionStatus } from "./authorization-vault.js";
import { listInstalledPluginPackages } from "./plugin-package-lifecycle.js";
import type { PluginAuthorizationMethod, PluginPackageManifest } from "./plugin-package-manifest.js";
import type { ServerConfig } from "./types.js";

const credentialRefreshesByStore = new WeakMap<AuthorizationVault, Map<string, Promise<Readonly<Record<string, string>>>>>();

export function pluginAuthorizationConsumerId(pluginId: string): string {
  return authorizationConsumerId("plugin", pluginId);
}

export type BoundPluginAuthorizationRuntime = {
  listConnections(): Promise<ConnectionStatus[]>;
  getCredential(methodId: string, accountId?: string): Promise<Readonly<Record<string, string>> | null>;
  readCredential(accountId: string, methodId: string): Promise<Readonly<Record<string, string>> | null>;
  setActiveAccount(methodId: string, accountId: string): Promise<boolean>;
};

type BoundPluginAuthorizationOptions = {
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Creates a capability bound to one installed plugin. Local-service adapters can
 * pass this object to the plugin without exposing workspace or plugin selectors,
 * so the plugin cannot address another installation through the bridge.
 */
export async function bindPluginAuthorizationRuntime(
  config: ServerConfig,
  pluginId: string,
  options: BoundPluginAuthorizationOptions = {},
): Promise<BoundPluginAuthorizationRuntime> {
  const manifest = await installedManifest(config, pluginId);
  const consumerId = pluginAuthorizationConsumerId(manifest.id);
  const store = await authorizationVault(config);
  const getCredential = async (methodId: string, accountId?: string) => {
    const method = authorizationMethod(manifest, methodId);
    const methodFingerprint = authorizationMethodFingerprint(method);
    const credential = accountId
      ? { accountId, values: await store.readCredentialForAccount({ connectionId: method.connectionId, accountId, methodId, methodFingerprint }) }
      : await store.readActiveCredential({ consumerId, connectionId: method.connectionId, methodId, methodFingerprint });
    if (!credential?.values) return null;
    const values = await refreshCredentialIfNeeded({
      connectionId: method.connectionId,
      accountId: credential.accountId,
      methodFingerprint,
      method,
      values: credential.values,
      store,
      fetcher: options.fetcher ?? fetch,
      now: options.now?.() ?? Date.now(),
    });
    return Object.freeze({ ...values });
  };
  return {
    listConnections: async () => (await Promise.all((manifest.authorization?.methods ?? []).map((method) =>
      store.listConnections({ connectionId: method.connectionId, methodId: method.id, methodFingerprint: authorizationMethodFingerprint(method) })
    ))).flat(),
    getCredential,
    readCredential: (accountId, methodId) => getCredential(methodId, accountId),
    setActiveAccount: (methodId, accountId) => {
      const method = authorizationMethod(manifest, methodId);
      return store.setActiveAccount({
        consumerId,
        connectionId: method.connectionId,
        methodId,
        methodFingerprint: authorizationMethodFingerprint(method),
        accountId,
      });
    },
  };
}

async function installedManifest(config: ServerConfig, pluginId: string): Promise<PluginPackageManifest> {
  const installed = (await listInstalledPluginPackages({ serverConfig: config })).find((entry) => entry.pluginId === pluginId);
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

export async function listPluginAuthorization(config: ServerConfig, pluginId: string) {
  const manifest = await installedManifest(config, pluginId);
  const consumerId = pluginAuthorizationConsumerId(pluginId);
  const store = await authorizationVault(config);
  const connections = (await Promise.all((manifest.authorization?.methods ?? []).map((method) =>
    store.listConnections({ connectionId: method.connectionId, methodId: method.id, methodFingerprint: authorizationMethodFingerprint(method) })
  ))).flat();
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
    flows: await store.listPendingFlows(consumerId),
  };
}

export async function savePluginSecretAuthorization(input: {
  config: ServerConfig;
  pluginId: string;
  methodId: string;
  accountId: string;
  values: unknown;
}) {
  const manifest = await installedManifest(input.config, input.pluginId);
  const method = authorizationMethod(manifest, input.methodId);
  if (method.kind !== "secret-form") throw new ApiError(400, "plugin_authorization_method_invalid", "This method does not accept a secret form");
  const values = stringRecord(input.values);
  const allowedFields = new Set(method.fields.map((field) => field.id));
  const unexpected = Object.keys(values).filter((field) => !allowedFields.has(field));
  if (unexpected.length) throw new ApiError(400, "plugin_authorization_field_unknown", `Unknown authorization field: ${unexpected[0]}`);
  const missing = method.fields.filter((field) => field.required !== false && !values[field.id]?.trim());
  if (missing.length) throw new ApiError(400, "plugin_authorization_field_required", `${missing[0]?.label ?? "Authorization field"} is required`);
  const store = await authorizationVault(input.config);
  const saved = await store.saveCredential({
    connectionId: method.connectionId,
    accountId: input.accountId,
    methodId: input.methodId,
    methodFingerprint: authorizationMethodFingerprint(method),
    values,
    secretFields: method.fields.filter((field) => field.secret !== false).map((field) => field.id),
  });
  await store.setActiveAccount({
    consumerId: pluginAuthorizationConsumerId(input.pluginId),
    connectionId: method.connectionId,
    methodId: method.id,
    methodFingerprint: authorizationMethodFingerprint(method),
    accountId: input.accountId,
  });
  return saved.status;
}

export async function startIndependentPluginAuthorization(input: {
  config: ServerConfig;
  pluginId: string;
  methodId: string;
  accountId: string;
  callbackUrl: string;
}) {
  const manifest = await installedManifest(input.config, input.pluginId);
  const method = authorizationMethod(manifest, input.methodId);
  if (method.kind === "secret-form") throw new ApiError(400, "plugin_authorization_method_invalid", "Secret forms are saved directly and cannot be started");
  const consumerId = pluginAuthorizationConsumerId(input.pluginId);
  let started;
  if (method.kind === "oauth-pkce") {
    started = await startPluginAuthorizationFlow({ installationId: consumerId, accountId: input.accountId, method, callbackUrl: input.callbackUrl });
  } else if (method.kind === "device-code") {
    started = await startPluginAuthorizationFlow({ installationId: consumerId, accountId: input.accountId, method });
  } else {
    started = await startPluginAuthorizationFlow({ installationId: consumerId, accountId: input.accountId, method, callbackUrl: input.callbackUrl });
  }
  const store = await authorizationVault(input.config);
  const state = "state" in started.private ? started.private.state : started.public.flowId;
  await store.savePendingFlow({
    consumerId,
    connectionId: method.connectionId,
    accountId: input.accountId,
    methodId: method.id,
    flowId: started.public.flowId,
    state,
    privateData: started.private,
    expiresAt: started.public.expiresAt,
  });
  return started.public;
}

async function refreshCredentialIfNeeded(input: {
  connectionId: string;
  accountId: string;
  methodFingerprint: string;
  method: PluginAuthorizationMethod;
  values: Record<string, string>;
  store: AuthorizationVault;
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now: number;
}): Promise<Readonly<Record<string, string>>> {
  const expiresAt = Number(input.values.expiresAt);
  if (input.method.kind === "secret-form" || !Number.isFinite(expiresAt) || expiresAt > input.now + 60_000) {
    return input.values;
  }
  const refreshToken = input.values.refreshToken;
  if (!refreshToken) throw new ApiError(401, "plugin_authorization_expired", "Plugin authorization expired; reconnect the plugin");
  if (input.method.kind === "hosted-browser" && !input.method.refreshUrl) {
    throw new ApiError(401, "plugin_authorization_expired", "Plugin authorization expired; reconnect the plugin");
  }
  const refreshes = credentialRefreshesByStore.get(input.store) ?? new Map<string, Promise<Readonly<Record<string, string>>>>();
  credentialRefreshesByStore.set(input.store, refreshes);
  const refreshKey = `${input.connectionId}\0${input.accountId}\0${input.methodFingerprint}`;
  const current = refreshes.get(refreshKey);
  if (current) return current;
  const refreshing = (async () => {
    let refreshedValues: Record<string, string>;
    if (input.method.kind === "hosted-browser") {
      const response = await input.fetcher(input.method.refreshUrl ?? "", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ApiError(401, "plugin_authorization_refresh_failed", "Plugin authorization could not be refreshed; reconnect the plugin");
      }
      const accessToken = Reflect.get(payload, "access_token");
      const tokenType = Reflect.get(payload, "token_type");
      if (typeof accessToken !== "string" || typeof tokenType !== "string") {
        throw new ApiError(401, "plugin_authorization_refresh_failed", "Plugin authorization could not be refreshed; reconnect the plugin");
      }
      refreshedValues = tokenValues({
        access_token: accessToken,
        token_type: tokenType.toLowerCase(),
        ...(typeof Reflect.get(payload, "refresh_token") === "string" ? { refresh_token: Reflect.get(payload, "refresh_token") } : {}),
        ...(typeof Reflect.get(payload, "scope") === "string" ? { scope: Reflect.get(payload, "scope") } : {}),
        ...(typeof Reflect.get(payload, "id_token") === "string" ? { id_token: Reflect.get(payload, "id_token") } : {}),
        ...(typeof Reflect.get(payload, "expires_in") === "number" ? { expires_in: Reflect.get(payload, "expires_in") } : {}),
      }, input.now);
    } else if (input.method.kind === "oauth-pkce" || input.method.kind === "device-code") {
      refreshedValues = await refreshOAuthCredential({
        method: input.method,
        refreshToken,
        fetcher: input.fetcher,
        now: input.now,
      });
    } else {
      throw new ApiError(401, "plugin_authorization_expired", "Plugin authorization expired; reconnect the plugin");
    }
    const refreshed = { ...input.values, ...refreshedValues };
    await input.store.saveCredential({
      connectionId: input.connectionId,
      accountId: input.accountId,
      methodId: input.method.id,
      methodFingerprint: input.methodFingerprint,
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
  pluginId: string;
  state: string;
  code?: string;
  fetcher?: typeof fetch;
}) {
  const consumerId = pluginAuthorizationConsumerId(input.pluginId);
  const store = await authorizationVault(input.config);
  const flow = await store.consumePendingFlow({ consumerId, state: input.state });
  if (!flow) throw new ApiError(400, "plugin_authorization_callback_invalid", "Authorization callback is invalid, expired, or already used");
  const manifest = await installedManifest(input.config, input.pluginId);
  const method = authorizationMethod(manifest, flow.methodId);
  let values: Record<string, string>;
  if (method.kind === "oauth-pkce") {
    if (!input.code) throw new ApiError(400, "plugin_authorization_code_required", "Authorization code is required");
    const verifier = flow.privateData.pkceVerifier;
    const redirectUri = flow.privateData.redirectUri;
    if (typeof verifier !== "string" || typeof redirectUri !== "string") throw new ApiError(500, "plugin_authorization_flow_invalid", "OAuth flow state is invalid");
    values = await exchangeOAuthAuthorizationCode({
      method,
      code: input.code,
      state: input.state,
      expectedState: flow.state,
      redirectUri,
      verifier,
      fetcher: input.fetcher,
    });
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
    if (!response.ok || !isRecord(payload)) throw new ApiError(502, "plugin_authorization_token_failed", `Hosted token exchange failed with HTTP ${response.status}`);
    const accessToken = Reflect.get(payload, "access_token");
    const tokenType = Reflect.get(payload, "token_type");
    if (typeof accessToken !== "string" || typeof tokenType !== "string") {
      throw new ApiError(502, "plugin_authorization_token_failed", "Hosted authorization server returned an invalid token response");
    }
    const refreshToken = Reflect.get(payload, "refresh_token");
    const scope = Reflect.get(payload, "scope");
    const idToken = Reflect.get(payload, "id_token");
    const expiresIn = Reflect.get(payload, "expires_in");
    values = tokenValues({
      access_token: accessToken,
      token_type: tokenType.toLowerCase(),
      ...(typeof refreshToken === "string" ? { refresh_token: refreshToken } : {}),
      ...(typeof scope === "string" ? { scope } : {}),
      ...(typeof idToken === "string" ? { id_token: idToken } : {}),
      ...(typeof expiresIn === "number" ? { expires_in: expiresIn } : {}),
    });
  } else {
    throw new ApiError(400, "plugin_authorization_callback_invalid", "This authorization method does not use a browser callback");
  }
  const saved = await store.saveCredential({
    connectionId: method.connectionId,
    accountId: flow.accountId,
    methodId: flow.methodId,
    methodFingerprint: authorizationMethodFingerprint(method),
    values,
    secretFields: Object.keys(values),
  });
  await store.setActiveAccount({
    consumerId,
    connectionId: method.connectionId,
    methodId: method.id,
    methodFingerprint: authorizationMethodFingerprint(method),
    accountId: flow.accountId,
  });
  return saved.status;
}

export async function pollPluginDeviceAuthorization(input: {
  config: ServerConfig;
  pluginId: string;
  flowId: string;
  fetcher?: typeof fetch;
}): Promise<ConnectionStatus | { status: "pending"; flowId: string; expiresAt: number }> {
  const consumerId = pluginAuthorizationConsumerId(input.pluginId);
  const store = await authorizationVault(input.config);
  const flow = await store.readPendingFlow({ consumerId, flowId: input.flowId });
  if (!flow) throw new ApiError(400, "plugin_authorization_flow_invalid", "Device authorization is invalid or expired");
  const manifest = await installedManifest(input.config, input.pluginId);
  const method = authorizationMethod(manifest, flow.methodId);
  if (method.kind !== "device-code") throw new ApiError(400, "plugin_authorization_method_invalid", "This flow is not device authorization");
  const deviceCode = flow.privateData.deviceCode;
  if (typeof deviceCode !== "string") throw new ApiError(500, "plugin_authorization_flow_invalid", "Device authorization flow state is invalid");
  const exchanged = await exchangeDeviceCode({ method, deviceCode, fetcher: input.fetcher });
  if ("pending" in exchanged) return { status: "pending", flowId: flow.flowId, expiresAt: flow.expiresAt };
  const values = exchanged;
  await store.consumePendingFlow({ consumerId, state: flow.state });
  const saved = await store.saveCredential({
    connectionId: method.connectionId,
    accountId: flow.accountId,
    methodId: flow.methodId,
    methodFingerprint: authorizationMethodFingerprint(method),
    values,
    secretFields: Object.keys(values),
  });
  await store.setActiveAccount({
    consumerId,
    connectionId: method.connectionId,
    methodId: method.id,
    methodFingerprint: authorizationMethodFingerprint(method),
    accountId: flow.accountId,
  });
  return saved.status;
}

export async function revokePluginAuthorization(input: { config: ServerConfig; pluginId: string; accountId: string }) {
  const manifest = await installedManifest(input.config, input.pluginId);
  const connectionIds = [...new Set((manifest.authorization?.methods ?? []).map((method) => method.connectionId))];
  const store = await authorizationVault(input.config);
  const removed = await Promise.all(connectionIds.map((connectionId) => store.revokeAccount({ connectionId, accountId: input.accountId })));
  return removed.some(Boolean);
}

export async function cancelPluginAuthorizationFlow(input: { config: ServerConfig; pluginId: string; flowId: string }) {
  const store = await authorizationVault(input.config);
  return store.cancelPendingFlow({ consumerId: pluginAuthorizationConsumerId(input.pluginId), flowId: input.flowId });
}

export async function deletePluginAuthorization(input: {
  config: ServerConfig;
  pluginId: string;
  methods: readonly PluginAuthorizationMethod[];
}) {
  const remainingMethodScopes = new Set((await listInstalledPluginPackages({ serverConfig: input.config }))
    .flatMap((entry) => entry.manifest.authorization?.methods ?? [])
    .map((method) => `${method.connectionId}\0${method.id}\0${authorizationMethodFingerprint(method)}`));
  const pruneCredentialScopes = input.methods
    .map((method) => ({
      connectionId: method.connectionId,
      methodId: method.id,
      methodFingerprint: authorizationMethodFingerprint(method),
    }))
    .filter((scope) => !remainingMethodScopes.has(`${scope.connectionId}\0${scope.methodId}\0${scope.methodFingerprint}`));
  const store = await authorizationVault(input.config);
  return store.deleteConsumer(pluginAuthorizationConsumerId(input.pluginId), pruneCredentialScopes);
}

export async function reconcilePluginAuthorization(input: { config: ServerConfig; pluginId: string }) {
  const manifest = await installedManifest(input.config, input.pluginId);
  const methods = new Map((manifest.authorization?.methods ?? []).map((method) => [method.id, method.connectionId]));
  const store = await authorizationVault(input.config);
  return store.retainMethods(pluginAuthorizationConsumerId(input.pluginId), methods);
}
