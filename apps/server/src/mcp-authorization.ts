import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import * as oauth from "oauth4webapi";

import { tokenValues } from "./authorization-protocol.js";
import { authorizationConsumerId, authorizationVault } from "./authorization-runtime.js";
import { ApiError } from "./errors.js";
import { readRuntimeOpencodeConfig, runtimeMcpMap, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const CLIENT_METHOD_ID = "oauth-client";
const CLIENT_FINGERPRINT = "mcp-oauth-client-v1";
const TOKEN_METHOD_ID = "oauth-token";
const TOKEN_FINGERPRINT = "mcp-oauth-token-v1";
const ACCOUNT_ID = "default";
const FLOW_TTL_MS = 10 * 60_000;
const tokenRefreshes = new Map<string, Promise<Record<string, string>>>();

type McpOAuthClientValues = {
  connectionId: string;
  resourceUrl: string;
  capability: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalResourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "mcp_oauth_resource_invalid", "MCP resource URL is invalid");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
    throw new ApiError(400, "mcp_oauth_resource_invalid", "MCP OAuth requires HTTPS, except for local loopback servers");
  }
  url.hash = "";
  return url.toString();
}

function connectionId(resourceUrl: string): string {
  return `mcp:${createHash("sha256").update(resourceUrl).digest("base64url")}`;
}

function consumerId(workspaceId: string, name: string): string {
  return authorizationConsumerId("mcp", `${workspaceId}:${name}`);
}

function proxyUrl(config: ServerConfig, workspaceId: string, name: string): string {
  const host = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  return `http://${host}:${config.port}/mcp-proxy/${encodeURIComponent(workspaceId)}/${encodeURIComponent(name)}`;
}

function isProxyUrl(config: ServerConfig, value: string): boolean {
  try {
    return new URL(value).pathname.startsWith("/mcp-proxy/") && new URL(value).port === String(config.port);
  } catch {
    return false;
  }
}

function oauthConfig(config: Record<string, unknown>): Record<string, unknown> {
  return isRecord(config.oauth) ? config.oauth : {};
}

function customFetch(fetcher: typeof fetch) {
  return {
    [oauth.customFetch]: (url: string, init: RequestInit) => fetcher(url, init),
  };
}

function legacyAuthorizationPaths(): string[] {
  const paths = [
    process.env.XDG_DATA_HOME?.trim() ? join(process.env.XDG_DATA_HOME.trim(), "opencode", "mcp-auth.json") : "",
    join(homedir(), ".local", "share", "opencode", "mcp-auth.json"),
    process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "opencode", "mcp-auth.json") : "",
    process.platform === "win32" && process.env.APPDATA?.trim() ? join(process.env.APPDATA.trim(), "opencode", "mcp-auth.json") : "",
  ];
  return [...new Set(paths.filter(Boolean))];
}

function legacyTokenValues(value: Record<string, unknown>, resourceUrl: string, client: oauth.Client | null): Record<string, string> | null {
  const accessToken = stringValue(value.accessToken);
  if (!accessToken) return null;
  const values: Record<string, string> = {
    accessToken,
    tokenType: stringValue(value.tokenType) || "Bearer",
    resourceUrl,
    ...(client ? { client: JSON.stringify(client) } : {}),
  };
  const refreshToken = stringValue(value.refreshToken);
  const scope = stringValue(value.scope);
  const expiresAt = Number(value.expiresAt);
  if (refreshToken) values.refreshToken = refreshToken;
  if (scope) values.scope = scope;
  if (Number.isFinite(expiresAt) && expiresAt > 0) values.expiresAt = String(expiresAt < 1_000_000_000_000 ? expiresAt * 1_000 : expiresAt);
  return values;
}

function clientAuthentication(client: oauth.Client): oauth.ClientAuth {
  const secret = stringValue(client.client_secret);
  if (!secret) return oauth.None();
  return client.token_endpoint_auth_method === "client_secret_basic"
    ? oauth.ClientSecretBasic(secret)
    : oauth.ClientSecretPost(secret);
}

async function readClientValues(config: ServerConfig, resourceUrl: string): Promise<McpOAuthClientValues | null> {
  const values = await (await authorizationVault(config)).readCredentialForAccount({
    connectionId: connectionId(resourceUrl),
    accountId: ACCOUNT_ID,
    methodId: CLIENT_METHOD_ID,
    methodFingerprint: CLIENT_FINGERPRINT,
  });
  if (!values?.resourceUrl || !values.capability) return null;
  return {
    connectionId: connectionId(resourceUrl),
    resourceUrl: values.resourceUrl,
    capability: values.capability,
    ...(values.clientId ? { clientId: values.clientId } : {}),
    ...(values.clientSecret ? { clientSecret: values.clientSecret } : {}),
    ...(values.scope ? { scope: values.scope } : {}),
  };
}

async function readClientValuesForConsumer(config: ServerConfig, workspaceId: string, name: string): Promise<McpOAuthClientValues | null> {
  const current = runtimeMcpMap(await readRuntimeOpencodeConfig(config, workspaceId))[name];
  const url = current && stringValue(current.url);
  if (!url || !isProxyUrl(config, url)) return null;
  const active = await (await authorizationVault(config)).readActiveCredentialForConsumer({
    consumerId: consumerId(workspaceId, name),
    methodId: CLIENT_METHOD_ID,
    methodFingerprint: CLIENT_FINGERPRINT,
  });
  if (!active?.values.resourceUrl || !active.values.capability) return null;
  return {
    connectionId: active.connectionId,
    resourceUrl: active.values.resourceUrl,
    capability: active.values.capability,
    ...(active.values.clientId ? { clientId: active.values.clientId } : {}),
    ...(active.values.clientSecret ? { clientSecret: active.values.clientSecret } : {}),
    ...(active.values.scope ? { scope: active.values.scope } : {}),
  };
}

export async function secureMcpAuthorizationConfig(
  config: ServerConfig,
  workspaceId: string,
  name: string,
  source: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sourceUrl = canonicalResourceUrl(stringValue(source.url));
  const existing = await readClientValues(config, sourceUrl);
  const declared = oauthConfig(source);
  const values: McpOAuthClientValues = {
    connectionId: connectionId(sourceUrl),
    resourceUrl: sourceUrl,
    capability: existing?.capability ?? randomBytes(32).toString("base64url"),
    ...(stringValue(declared.clientId) ? { clientId: stringValue(declared.clientId) } : existing?.clientId ? { clientId: existing.clientId } : {}),
    ...(stringValue(declared.clientSecret) ? { clientSecret: stringValue(declared.clientSecret) } : existing?.clientSecret ? { clientSecret: existing.clientSecret } : {}),
    ...(stringValue(declared.scope) ? { scope: stringValue(declared.scope) } : existing?.scope ? { scope: existing.scope } : {}),
  };
  const id = values.connectionId;
  const vault = await authorizationVault(config);
  await vault.saveCredential({
    connectionId: id,
    accountId: ACCOUNT_ID,
    methodId: CLIENT_METHOD_ID,
    methodFingerprint: CLIENT_FINGERPRINT,
    values,
    secretFields: ["capability", ...(values.clientSecret ? ["clientSecret"] : [])],
  });
  await vault.setActiveAccount({
    consumerId: consumerId(workspaceId, name),
    connectionId: id,
    methodId: CLIENT_METHOD_ID,
    methodFingerprint: CLIENT_FINGERPRINT,
    accountId: ACCOUNT_ID,
  });
  const reusableToken = await vault.readCredentialForAccount({
    connectionId: id,
    accountId: ACCOUNT_ID,
    methodId: TOKEN_METHOD_ID,
    methodFingerprint: TOKEN_FINGERPRINT,
  });
  if (reusableToken?.accessToken) {
    await vault.setActiveAccount({
      consumerId: consumerId(workspaceId, name),
      connectionId: id,
      methodId: TOKEN_METHOD_ID,
      methodFingerprint: TOKEN_FINGERPRINT,
      accountId: ACCOUNT_ID,
    });
  }
  return {
    type: "remote",
    enabled: source.enabled !== false,
    url: proxyUrl(config, workspaceId, name),
    headers: { Authorization: `Bearer ${values.capability}` },
    oauth: false,
  };
}

export async function publicMcpConfig(config: ServerConfig, workspaceId: string, name: string, engineConfig: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = stringValue(engineConfig.url);
  if (!url || !isProxyUrl(config, url)) return engineConfig;
  const values = await readClientValuesForConsumer(config, workspaceId, name);
  if (!values) return { type: "remote", enabled: engineConfig.enabled !== false, oauth: true };
  return {
    type: "remote",
    enabled: engineConfig.enabled !== false,
    url: values.resourceUrl,
    oauth: values.clientId
      ? { clientId: values.clientId, ...(values.scope ? { scope: values.scope } : {}) }
      : {},
  };
}

async function resourceMetadata(resourceUrl: URL, fetcher: typeof fetch): Promise<oauth.ResourceServer> {
  try {
    const response = await oauth.resourceDiscoveryRequest(resourceUrl, customFetch(fetcher));
    return await oauth.processResourceDiscoveryResponse(resourceUrl, response);
  } catch {
    const challenge = await fetcher(resourceUrl, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "ipollowork-oauth-discovery", method: "initialize", params: {} }),
      redirect: "manual",
    });
    const header = challenge.headers.get("www-authenticate") ?? "";
    const metadataUrl = /resource_metadata="([^"]+)"/i.exec(header)?.[1];
    if (!metadataUrl) throw new ApiError(400, "mcp_oauth_metadata_missing", "MCP server did not publish OAuth protected-resource metadata");
    const response = await fetcher(metadataUrl, { headers: { accept: "application/json" }, redirect: "error" });
    return await oauth.processResourceDiscoveryResponse(resourceUrl, response);
  }
}

async function authorizationServerMetadata(issuer: URL, fetcher: typeof fetch): Promise<oauth.AuthorizationServer> {
  try {
    const response = await oauth.discoveryRequest(issuer, { algorithm: "oauth2", ...customFetch(fetcher) });
    return await oauth.processDiscoveryResponse(issuer, response);
  } catch {
    const response = await oauth.discoveryRequest(issuer, { algorithm: "oidc", ...customFetch(fetcher) });
    return oauth.processDiscoveryResponse(issuer, response);
  }
}

async function authorizationServerForResource(resourceUrl: string, fetcher: typeof fetch) {
  const resource = await resourceMetadata(new URL(resourceUrl), fetcher);
  const issuer = resource.authorization_servers?.[0];
  if (!issuer) throw new ApiError(400, "mcp_oauth_server_missing", "MCP server did not publish an OAuth authorization server");
  return { resource, authorizationServer: await authorizationServerMetadata(new URL(issuer), fetcher) };
}

async function resolveClient(input: {
  metadata: oauth.AuthorizationServer;
  values: McpOAuthClientValues;
  callbackUrl: string;
  fetcher: typeof fetch;
}): Promise<oauth.Client> {
  if (input.values.clientId) {
    return {
      client_id: input.values.clientId,
      ...(input.values.clientSecret ? { client_secret: input.values.clientSecret, token_endpoint_auth_method: "client_secret_post" } : { token_endpoint_auth_method: "none" }),
    };
  }
  if (!input.metadata.registration_endpoint) {
    throw new ApiError(400, "mcp_oauth_client_registration_required", "This MCP server requires a client ID. Add it in Advanced OAuth settings.");
  }
  const response = await oauth.dynamicClientRegistrationRequest(input.metadata, {
    client_name: "iPolloWork",
    redirect_uris: [input.callbackUrl],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, customFetch(input.fetcher));
  return oauth.processDynamicClientRegistrationResponse(response);
}

export async function startMcpAuthorization(input: {
  config: ServerConfig;
  workspaceId: string;
  name: string;
  source: Record<string, unknown>;
  callbackUrl: string;
  fetcher?: typeof fetch;
}) {
  const engineConfig = await secureMcpAuthorizationConfig(input.config, input.workspaceId, input.name, input.source);
  await writeRuntimeOpencodeConfig(input.config, input.workspaceId, (current) => ({
    ...current,
    mcp: { ...runtimeMcpMap(current), [input.name]: engineConfig },
  }));
  const values = await readClientValuesForConsumer(input.config, input.workspaceId, input.name);
  if (!values) throw new ApiError(500, "mcp_oauth_client_missing", "MCP OAuth client configuration is unavailable");
  const fetcher = input.fetcher ?? fetch;
  const resourceUrl = new URL(values.resourceUrl);
  const { resource, authorizationServer } = await authorizationServerForResource(resourceUrl.toString(), fetcher);
  if (!authorizationServer.authorization_endpoint || !authorizationServer.token_endpoint) {
    throw new ApiError(400, "mcp_oauth_server_invalid", "MCP authorization server metadata is incomplete");
  }
  const client = await resolveClient({ metadata: authorizationServer, values, callbackUrl: input.callbackUrl, fetcher });
  const state = oauth.generateRandomState();
  const verifier = oauth.generateRandomCodeVerifier();
  const challenge = await oauth.calculatePKCECodeChallenge(verifier);
  const authorizationUrl = new URL(authorizationServer.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", client.client_id);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", input.callbackUrl);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("resource", values.resourceUrl);
  const scope = values.scope || resource.scopes_supported?.join(" ") || "";
  if (scope) authorizationUrl.searchParams.set("scope", scope);
  const expiresAt = Date.now() + FLOW_TTL_MS;
  await (await authorizationVault(input.config)).savePendingFlow({
    consumerId: consumerId(input.workspaceId, input.name),
    connectionId: values.connectionId,
    accountId: ACCOUNT_ID,
    methodId: TOKEN_METHOD_ID,
    flowId: randomUUID(),
    state,
    privateData: {
      workspaceId: input.workspaceId,
      name: input.name,
      callbackUrl: input.callbackUrl,
      verifier,
      resourceUrl: values.resourceUrl,
      authorizationServer: JSON.stringify(authorizationServer),
      client: JSON.stringify(client),
    },
    expiresAt,
  });
  return { authorizationUrl: authorizationUrl.toString(), expiresAt };
}

export async function completeMcpAuthorization(config: ServerConfig, callbackUrl: URL, fetcher: typeof fetch = fetch) {
  const state = callbackUrl.searchParams.get("state") ?? "";
  const flow = state ? await (await authorizationVault(config)).consumePendingFlowByState(state) : null;
  if (!flow) throw new ApiError(400, "mcp_oauth_callback_invalid", "MCP authorization callback is invalid or expired");
  const redirectUri = stringValue(flow.privateData.callbackUrl);
  const verifier = stringValue(flow.privateData.verifier);
  const resourceUrl = stringValue(flow.privateData.resourceUrl);
  const authorizationServer = JSON.parse(stringValue(flow.privateData.authorizationServer)) as oauth.AuthorizationServer;
  const client = JSON.parse(stringValue(flow.privateData.client)) as oauth.Client;
  const parameters = oauth.validateAuthResponse(authorizationServer, client, callbackUrl.searchParams, state);
  const response = await oauth.authorizationCodeGrantRequest(
    authorizationServer,
    client,
    clientAuthentication(client),
    parameters,
    redirectUri,
    verifier,
    { additionalParameters: { resource: resourceUrl }, ...customFetch(fetcher) },
  );
  const token = await oauth.processAuthorizationCodeResponse(authorizationServer, client, response);
  const values = {
    ...tokenValues(token),
    resourceUrl,
    authorizationServer: JSON.stringify(authorizationServer),
    client: JSON.stringify(client),
  };
  const vault = await authorizationVault(config);
  await vault.saveCredential({
    connectionId: flow.connectionId,
    accountId: ACCOUNT_ID,
    methodId: TOKEN_METHOD_ID,
    methodFingerprint: TOKEN_FINGERPRINT,
    values,
    secretFields: Object.keys(values),
  });
  await vault.setActiveAccount({
    consumerId: flow.consumerId,
    connectionId: flow.connectionId,
    methodId: TOKEN_METHOD_ID,
    methodFingerprint: TOKEN_FINGERPRINT,
    accountId: ACCOUNT_ID,
  });
  return { workspaceId: stringValue(flow.privateData.workspaceId), name: stringValue(flow.privateData.name) };
}

export async function mcpAuthorizationStatus(config: ServerConfig, workspaceId: string, name: string) {
  const client = await readClientValuesForConsumer(config, workspaceId, name);
  if (!client) return { connected: false };
  const token = await (await authorizationVault(config)).readActiveCredential({
    consumerId: consumerId(workspaceId, name),
    connectionId: client.connectionId,
    methodId: TOKEN_METHOD_ID,
    methodFingerprint: TOKEN_FINGERPRINT,
  });
  return { connected: Boolean(token?.values.accessToken) };
}

export async function revokeMcpAuthorization(config: ServerConfig, workspaceId: string, name: string): Promise<boolean> {
  const client = await readClientValuesForConsumer(config, workspaceId, name);
  if (!client) return false;
  return (await authorizationVault(config)).revokeCredential({
    connectionId: client.connectionId,
    accountId: ACCOUNT_ID,
    methodId: TOKEN_METHOD_ID,
  });
}

export async function forgetMcpAuthorizationConsumer(config: ServerConfig, workspaceId: string, name: string): Promise<boolean> {
  return (await authorizationVault(config)).deleteConsumer(consumerId(workspaceId, name));
}

async function activeToken(config: ServerConfig, workspaceId: string, name: string, fetcher: typeof fetch): Promise<Record<string, string>> {
  const clientValues = await readClientValuesForConsumer(config, workspaceId, name);
  if (!clientValues) throw new ApiError(404, "mcp_connection_not_found", "MCP connection was not found");
  const id = clientValues.connectionId;
  const vault = await authorizationVault(config);
  const active = await vault.readActiveCredential({
    consumerId: consumerId(workspaceId, name),
    connectionId: id,
    methodId: TOKEN_METHOD_ID,
    methodFingerprint: TOKEN_FINGERPRINT,
  });
  if (!active?.values.accessToken) throw new ApiError(401, "mcp_authorization_required", "MCP authorization is required");
  const expiresAt = Number(active.values.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000 || !active.values.refreshToken) return active.values;
  const refreshKey = `${id}\0${active.accountId}`;
  const running = tokenRefreshes.get(refreshKey);
  if (running) return running;
  const refresh = (async () => {
    const authorizationServer = active.values.authorizationServer
      ? JSON.parse(active.values.authorizationServer) as oauth.AuthorizationServer
      : (await authorizationServerForResource(clientValues.resourceUrl, fetcher)).authorizationServer;
    const client = active.values.client ? JSON.parse(active.values.client) as oauth.Client : null;
    if (!client?.client_id) throw new ApiError(401, "mcp_authorization_required", "MCP authorization must be renewed");
    const response = await oauth.refreshTokenGrantRequest(
      authorizationServer,
      client,
      clientAuthentication(client),
      active.values.refreshToken,
      { additionalParameters: { resource: clientValues.resourceUrl }, ...customFetch(fetcher) },
    );
    const token = await oauth.processRefreshTokenResponse(authorizationServer, client, response);
    const refreshed = { ...active.values, ...tokenValues(token), authorizationServer: JSON.stringify(authorizationServer) };
    await vault.saveCredential({
      connectionId: id,
      accountId: active.accountId,
      methodId: TOKEN_METHOD_ID,
      methodFingerprint: TOKEN_FINGERPRINT,
      values: refreshed,
      secretFields: Object.keys(refreshed),
    });
    return refreshed;
  })();
  tokenRefreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    tokenRefreshes.delete(refreshKey);
  }
}

function capabilityMatches(expected: string, received: string): boolean {
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

export async function proxyMcpRequest(config: ServerConfig, workspaceId: string, name: string, request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  const client = await readClientValuesForConsumer(config, workspaceId, name);
  if (!client) throw new ApiError(404, "mcp_connection_not_found", "MCP connection was not found");
  const capability = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!capability || !capabilityMatches(client.capability, capability)) throw new ApiError(401, "mcp_proxy_unauthorized", "MCP proxy capability is invalid");
  const token = await activeToken(config, workspaceId, name, fetcher);
  const headers = new Headers(request.headers);
  for (const header of ["authorization", "host", "content-length", "connection", "x-ipollowork-host-token"]) headers.delete(header);
  headers.set("authorization", `${token.tokenType || "Bearer"} ${token.accessToken}`);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const response = await fetcher(client.resourceUrl, { method: request.method, headers, body, redirect: "manual" });
  const responseHeaders = new Headers(response.headers);
  for (const header of ["content-length", "content-encoding", "transfer-encoding", "connection"]) responseHeaders.delete(header);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

export async function migrateRuntimeMcpAuthorization(config: ServerConfig): Promise<number> {
  let migrated = 0;
  for (const workspace of config.workspaces) {
    const runtime = await readRuntimeOpencodeConfig(config, workspace.id);
    const entries = runtimeMcpMap(runtime);
    const next = { ...entries };
    let changed = false;
    for (const [name, entry] of Object.entries(entries)) {
      const usesOAuth = entry.oauth === true || isRecord(entry.oauth);
      if (entry.type !== "remote" || !usesOAuth || isRecord(entry.headers) || !stringValue(entry.url) || isProxyUrl(config, stringValue(entry.url))) continue;
      next[name] = await secureMcpAuthorizationConfig(config, workspace.id, name, entry);
      changed = true;
      migrated += 1;
    }
    if (changed) await writeRuntimeOpencodeConfig(config, workspace.id, (current) => ({ ...current, mcp: next }));
  }
  return migrated;
}

export async function migrateLegacyMcpAuthorization(config: ServerConfig, paths = legacyAuthorizationPaths()): Promise<number> {
  let migrated = 0;
  for (const path of paths) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error && typeof error === "object" && Reflect.get(error, "code") === "ENOENT") continue;
      continue;
    }
    if (!isRecord(raw)) continue;
    let migratedFromPath = 0;
    for (const [name, value] of Object.entries(raw)) {
      if (!isRecord(value)) continue;
      const resourceValue = stringValue(value.serverUrl);
      if (!resourceValue) continue;
      let resourceUrl: string;
      try {
        resourceUrl = canonicalResourceUrl(resourceValue);
      } catch {
        continue;
      }
      const bindings: Array<{ workspaceId: string; entry: Record<string, unknown> }> = [];
      for (const workspace of config.workspaces) {
        const runtime = await readRuntimeOpencodeConfig(config, workspace.id);
        const entry = runtimeMcpMap(runtime)[name];
        if (!entry || entry.type !== "remote") continue;
        const currentUrl = stringValue(entry.url);
        let currentResourceUrl = currentUrl;
        if (isProxyUrl(config, currentUrl)) {
          currentResourceUrl = (await readClientValuesForConsumer(config, workspace.id, name))?.resourceUrl ?? "";
        } else {
          try {
            currentResourceUrl = canonicalResourceUrl(currentUrl);
          } catch {
            currentResourceUrl = "";
          }
        }
        if (currentResourceUrl === resourceUrl) bindings.push({ workspaceId: workspace.id, entry });
      }
      if (bindings.length === 0) continue;
      const clientInfo = isRecord(value.clientInfo) ? value.clientInfo : {};
      const clientId = stringValue(clientInfo.clientId);
      const clientSecret = stringValue(clientInfo.clientSecret);
      const client: oauth.Client | null = clientId
        ? { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret, token_endpoint_auth_method: "client_secret_post" } : { token_endpoint_auth_method: "none" }) }
        : null;
      const id = connectionId(resourceUrl);
      const vault = await authorizationVault(config);
      const existing = await readClientValues(config, resourceUrl);
      await vault.saveCredential({
        connectionId: id,
        accountId: ACCOUNT_ID,
        methodId: CLIENT_METHOD_ID,
        methodFingerprint: CLIENT_FINGERPRINT,
        values: {
          resourceUrl,
          capability: existing?.capability ?? randomBytes(32).toString("base64url"),
          ...(clientId ? { clientId } : {}),
          ...(clientSecret ? { clientSecret } : {}),
        },
        secretFields: ["capability", ...(clientSecret ? ["clientSecret"] : [])],
      });
      const tokens = isRecord(value.tokens) ? legacyTokenValues(value.tokens, resourceUrl, client) : null;
      if (tokens) {
        await vault.saveCredential({
          connectionId: id,
          accountId: ACCOUNT_ID,
          methodId: TOKEN_METHOD_ID,
          methodFingerprint: TOKEN_FINGERPRINT,
          values: tokens,
          secretFields: Object.keys(tokens),
        });
      }
      for (const binding of bindings) {
        const secured = await secureMcpAuthorizationConfig(config, binding.workspaceId, name, {
          type: "remote",
          url: resourceUrl,
          enabled: binding.entry.enabled !== false,
          oauth: clientId ? { clientId, ...(clientSecret ? { clientSecret } : {}) } : {},
        });
        await writeRuntimeOpencodeConfig(config, binding.workspaceId, (current) => ({
          ...current,
          mcp: { ...runtimeMcpMap(current), [name]: secured },
        }));
      }
      delete raw[name];
      migrated += 1;
      migratedFromPath += 1;
    }
    if (migratedFromPath === 0) continue;
    if (Object.keys(raw).length === 0) {
      await rm(path, { force: true });
    } else {
      await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  }
  return migrated;
}
