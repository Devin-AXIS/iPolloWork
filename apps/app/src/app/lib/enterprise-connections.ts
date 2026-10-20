import type { EnterpriseResourceType } from "@ipollowork/types/enterprise";
export type { EnterpriseResourceType } from "@ipollowork/types/enterprise";
import { comparePluginPackageVersions } from "@ipollowork/types/plugins";
import { enterpriseFeaturesSchema, enterpriseMemberSchema, enterpriseMemberRoleSchema, enterpriseMembershipResponseSchema, type EnterpriseFeatures, type EnterpriseMember } from "@ipollowork/types/enterprise";
import { enterpriseRequest } from "./enterprise-client";
import { readPluginPackageArchive } from "./plugin-package-archive";
import type { iPolloWorkPluginPackageItem, iPolloWorkServerClient } from "./ipollowork-server";
import { desktopFetchBinaryViaMain, desktopFetchViaMain } from "./desktop";
import { normalizeDenBaseUrl, readDenSettings } from "./den";
import { isDesktopRuntime } from "./runtime-env";
import {
  IPOLLOWORK_PACKAGE_EXTENSION,
  IPOLLOWORK_PACKAGE_MEDIA_TYPE,
  LEGACY_TEMPLATE_PACKAGE_EXTENSION,
  MAX_TEMPLATE_PACKAGE_BYTES,
} from "@ipollowork/types/templates";

const ENTERPRISE_CONNECTIONS_KEY = "ipollowork.enterprise-connections.v1";
let connectionAccount: { storageKey: string; baseUrl: string; token: string } | null = null;
const ENTERPRISE_CONNECTION_LIMIT = 12;
const ENTERPRISE_TIMEOUT_MS = 12_000;
const ENTERPRISE_DOWNLOAD_TIMEOUT_MS = 120_000;
const ENTERPRISE_RESOURCE_PAGE_SIZE = 50;
const ENTERPRISE_RESOURCE_PAGE_LIMIT = 20;
const ENTERPRISE_EXTENSION_PACKAGE_EXTENSION = ".ipollowork-plugin";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const CLOUD_RESOURCE_PATH_PREFIX = "/api/v1/enterprise-resources/";
const ENTERPRISE_RESOURCE_PATH_PREFIX = "/api/v1/resources/";

export const enterpriseConnectionsChangedEvent = "ipollowork:enterprise-connections-changed";

type JsonRecord = Record<string, unknown>;

export type EnterpriseMemberRole = EnterpriseMember["role"];

export type EnterpriseServer = {
  id: string;
  name: string;
  shortName: string;
  origin: string;
  logoUrl: string | null;
  accent: "blue" | "neutral";
  authMode: "bootstrap" | "ipollo_oidc";
  features?: EnterpriseFeatures;
};

export type EnterpriseConnection = EnterpriseServer & {
  membership: {
    id: string;
    role: EnterpriseMemberRole;
    status?: EnterpriseMember["status"];
    departmentId?: string | null;
  };
  session: {
    token: string;
    expiresAt: string;
  };
};



export type EnterpriseResource = {
  id: string;
  type: EnterpriseResourceType;
  slug: string;
  manifestId: string | null;
  name: string;
  description: string;
  category: string;
  enterpriseCategory: string;
  iconPath: string | null;
  featured: boolean;
  updatedAt: string;
  latestVersion: {
    version: string;
    digest: string;
    downloadPath: string;
  } | null;
};

type EnterpriseDiscovery = {
  serverId: string;
  name: string;
  origin: string;
  authMode: EnterpriseServer["authMode"];
};

type EnterpriseManifest = {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  accent: EnterpriseServer["accent"];
  features?: EnterpriseFeatures;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function parseRole(value: unknown): EnterpriseMemberRole | null {
  const parsed = enterpriseMemberRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeEnterpriseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

export function normalizeEnterpriseJoinCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/gu, "");
}

function parseDiscovery(value: unknown): EnterpriseDiscovery | null {
  if (!isRecord(value)) return null;
  const serverId = readString(value, "serverId");
  const name = readString(value, "name");
  const origin = normalizeEnterpriseOrigin(readString(value, "origin"));
  const authMode = readString(value, "authMode");
  if (!serverId.startsWith("ent_") || !name || !origin) return null;
  if (authMode !== "bootstrap" && authMode !== "ipollo_oidc") return null;
  return { serverId, name, origin, authMode };
}

function parseManifest(value: unknown): EnterpriseManifest | null {
  if (!isRecord(value) || !isRecord(value.enterprise)) return null;
  const enterprise = value.enterprise;
  const id = readString(enterprise, "id");
  const name = readString(enterprise, "name");
  const shortName = readString(enterprise, "shortName");
  const logoValue = enterprise.logoUrl;
  const logoUrl = typeof logoValue === "string" && logoValue.trim() ? logoValue.trim() : null;
  const accentValue = readString(enterprise, "accent");
  const accent = accentValue === "neutral" ? "neutral" : accentValue === "blue" ? "blue" : null;
  if (!id.startsWith("ent_") || !name || !shortName || !accent) return null;
  const features = enterpriseFeaturesSchema.safeParse(value.features);
  return { id, name, shortName, logoUrl, accent, ...(features.success ? { features: features.data } : {}) };
}

function endpoint(origin: string, path: string) {
  return `${origin.replace(/\/+$/u, "")}${path}`;
}

function enterpriseFetcher(fetcher?: typeof fetch) {
  if (fetcher) return fetcher;
  if (!isDesktopRuntime()) return globalThis.fetch;
  return (input: RequestInfo | URL, init?: RequestInit) => (
    desktopFetchViaMain(input, init, ENTERPRISE_TIMEOUT_MS)
  );
}

function enterpriseBinaryFetcher(fetcher?: typeof fetch) {
  if (fetcher) return fetcher;
  if (!isDesktopRuntime()) return globalThis.fetch;
  return (input: RequestInfo | URL, init?: RequestInit) => (
    desktopFetchBinaryViaMain(input, init, ENTERPRISE_DOWNLOAD_TIMEOUT_MS)
  );
}

async function readResponseJson(response: Response): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = isRecord(payload) ? readString(payload, "error") : "";
    throw new Error(code || `enterprise_server_${response.status}`);
  }
  return payload;
}

async function fetchJson(
  url: string,
  options: RequestInit,
  fetcher: typeof fetch,
) {
  return readResponseJson(await fetcher(url, {
    ...options,
    signal: AbortSignal.timeout(ENTERPRISE_TIMEOUT_MS),
  }));
}

export async function discoverEnterpriseConnection(
  input: string,
  fetcher?: typeof fetch,
): Promise<EnterpriseServer> {
  const requestedOrigin = normalizeEnterpriseOrigin(input);
  if (!requestedOrigin) throw new Error("invalid_enterprise_url");
  const requestFetcher = enterpriseFetcher(fetcher);

  const discovery = parseDiscovery(
    await fetchJson(endpoint(requestedOrigin, "/.well-known/ipollo-enterprise"), {}, requestFetcher),
  );
  if (!discovery) throw new Error("invalid_enterprise_discovery");

  const manifest = parseManifest(
    await fetchJson(endpoint(discovery.origin, "/api/v1/client-manifest"), {}, requestFetcher),
  );
  if (!manifest || manifest.id !== discovery.serverId) throw new Error("enterprise_manifest_mismatch");

  return {
    id: manifest.id,
    name: manifest.name,
    shortName: manifest.shortName,
    origin: discovery.origin,
    logoUrl: manifest.logoUrl,
    accent: manifest.accent,
    authMode: discovery.authMode,
    ...(manifest.features ? { features: manifest.features } : {}),
  };
}

export async function refreshEnterpriseConnection(
  connection: EnterpriseConnection,
  fetcher?: typeof fetch,
): Promise<EnterpriseConnection> {
  const accountKey = connectionStorageKey();
  const storedAtStart = readEnterpriseConnections().find((item) => item.id === connection.id);
  const server = await discoverEnterpriseConnection(connection.origin, fetcher);
  if (server.id !== connection.id) throw new Error("enterprise_manifest_mismatch");
  if (accountKey !== connectionStorageKey()) return connection;
  const current = readEnterpriseConnections().find((item) => item.id === connection.id) ?? connection;
  let refreshed = { ...current, ...server };
  if (!server.features) delete refreshed.features;
  if (server.features?.membership) {
    const result = await enterpriseRequest(refreshed, "/api/v1/membership", enterpriseMembershipResponseSchema, {}, fetcher);
    if (result.membership.id !== connection.membership.id) throw new Error("enterprise_manifest_mismatch");
    refreshed = { ...refreshed, membership: { id: result.membership.id, role: result.membership.role, status: result.membership.status, departmentId: result.membership.departmentId } };
  }
  if (accountKey !== connectionStorageKey()) return refreshed;
  const latest = readEnterpriseConnections().find((item) => item.id === connection.id);
  if (storedAtStart && !latest) return refreshed;
  if (latest && (latest.membership.id !== current.membership.id || latest.session.token !== current.session.token)) return latest;
  if (
    current.name !== refreshed.name
    || current.shortName !== refreshed.shortName
    || current.logoUrl !== refreshed.logoUrl
    || current.accent !== refreshed.accent
    || current.origin !== refreshed.origin
    || current.authMode !== refreshed.authMode
    || JSON.stringify(current.features) !== JSON.stringify(refreshed.features)
    || JSON.stringify(current.membership) !== JSON.stringify(refreshed.membership)
  ) {
    saveEnterpriseConnection(refreshed);
  }
  return refreshed;
}

function parseJoinResult(value: unknown, server: EnterpriseServer): EnterpriseConnection | null {
  if (!isRecord(value) || !isRecord(value.enterprise) || !isRecord(value.membership) || !isRecord(value.session)) {
    return null;
  }
  const enterpriseId = readString(value.enterprise, "id");
  const memberId = readString(value.membership, "id");
  const role = parseRole(value.membership.role);
  const token = readString(value.session, "token");
  const expiresAt = readString(value.session, "expiresAt");
  if (enterpriseId !== server.id || !memberId || !role || !token || !expiresAt) return null;
  return { ...server, membership: { id: memberId, role }, session: { token, expiresAt } };
}

type EnterpriseResourceSource = "cloud" | "enterprise";

function enterpriseResourcePathPrefix(source: EnterpriseResourceSource) {
  return source === "enterprise" ? ENTERPRISE_RESOURCE_PATH_PREFIX : CLOUD_RESOURCE_PATH_PREFIX;
}

function parseEnterpriseResource(
  value: unknown,
  expectedType: EnterpriseResourceType,
  source: EnterpriseResourceSource,
): EnterpriseResource | null {
  if (!isRecord(value) || readString(value, "type") !== expectedType) return null;
  if (source === "enterprise" && readString(value, "status") !== "published") return null;
  const id = readString(value, "id");
  const slug = readString(value, "slug");
  const name = readString(value, "name");
  const category = readString(value, "category");
  const enterpriseCategory = readString(value, "enterpriseCategory");
  const updatedAt = readString(value, "updatedAt");
  if (!id || !slug || !name || !category || !enterpriseCategory || !updatedAt) return null;
  const pathPrefix = enterpriseResourcePathPrefix(source);
  const iconValue = source === "enterprise" ? value.iconPath : value.iconUrl;
  const iconPath = typeof iconValue === "string" && iconValue.startsWith(pathPrefix)
    ? iconValue
    : null;
  const latestValue = source === "enterprise" ? value.latestVersion : value.latestArtifact;
  const latest = isRecord(latestValue) ? latestValue : null;
  const version = latest ? readString(latest, "version") : "";
  const manifestId = source === "enterprise"
    ? readString(value, "sourceTemplateId")
    : latest ? readString(latest, "manifestId") : "";
  const digest = latest ? readString(latest, source === "enterprise" ? "digest" : "sha256") : "";
  const downloadPath = latest ? readString(latest, "downloadPath") : "";
  return {
    id,
    type: expectedType,
    slug,
    manifestId: manifestId || null,
    name,
    description: readString(value, "description"),
    category,
    enterpriseCategory,
    iconPath,
    featured: value.featured === true,
    updatedAt,
    latestVersion: version && SHA256_HEX_PATTERN.test(digest) && downloadPath.startsWith(pathPrefix)
      ? { version, digest, downloadPath }
      : null,
  };
}

export type EnterpriseResourceRequestOptions = {
  connection?: EnterpriseConnection;
  fetcher?: typeof fetch;
};

function enterpriseResourceAccess(connection?: EnterpriseConnection) {
  if (connection) {
    const token = connection.session.token.trim();
    if (!token) throw new Error("enterprise_signin_required");
    return { origin: connection.origin, token, source: "enterprise" as const };
  }
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  if (!token) throw new Error("cloud_signin_required");
  return { origin: settings.baseUrl, token, source: "cloud" as const };
}

export function enterpriseResourceUrl(
  path: string | null,
  connection?: EnterpriseConnection,
): string | null {
  const access = enterpriseResourceAccess(connection);
  if (!path?.startsWith(enterpriseResourcePathPrefix(access.source))) return null;
  return endpoint(access.origin, path);
}

export async function listEnterpriseResources(
  type: EnterpriseResourceType,
  options: EnterpriseResourceRequestOptions = {},
): Promise<EnterpriseResource[]> {
  const access = enterpriseResourceAccess(options.connection);
  const fetcher = enterpriseFetcher(options.fetcher);
  const authorization = { Authorization: `Bearer ${access.token}` };
  if (access.source === "cloud") {
    const query = new URLSearchParams({ type, limit: String(ENTERPRISE_RESOURCE_PAGE_SIZE) });
    const payload = await fetchJson(
      endpoint(access.origin, `/api/v1/enterprise-resources?${query.toString()}`),
      { headers: authorization },
      fetcher,
    );
    if (!isRecord(payload) || !Array.isArray(payload.resources)) throw new Error("invalid_enterprise_resource_catalog");
    return payload.resources.flatMap((item) => {
      const parsed = parseEnterpriseResource(item, type, access.source);
      return parsed ? [parsed] : [];
    });
  }

  const resources: EnterpriseResource[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < ENTERPRISE_RESOURCE_PAGE_LIMIT; page += 1) {
    const query = new URLSearchParams({ type, limit: String(ENTERPRISE_RESOURCE_PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const payload = await fetchJson(
      endpoint(access.origin, `/api/v1/resources?${query.toString()}`),
      { headers: authorization },
      fetcher,
    );
    if (!isRecord(payload) || !Array.isArray(payload.items)) throw new Error("invalid_enterprise_resource_catalog");
    resources.push(...payload.items.flatMap((item) => {
      const parsed = parseEnterpriseResource(item, type, access.source);
      return parsed ? [parsed] : [];
    }));
    if (payload.nextCursor === null) return resources;
    if (typeof payload.nextCursor !== "string") throw new Error("invalid_enterprise_resource_catalog");
    const nextCursor = payload.nextCursor.trim();
    if (!nextCursor || nextCursor.length > 128 || seenCursors.has(nextCursor)) {
      throw new Error("invalid_enterprise_resource_catalog");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error("enterprise_resource_catalog_too_large");
}

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function downloadEnterpriseResource(
  resource: EnterpriseResource,
  options: EnterpriseResourceRequestOptions = {},
): Promise<File> {
  const access = enterpriseResourceAccess(options.connection);
  const downloadUrl = enterpriseResourceUrl(
    resource.latestVersion?.downloadPath ?? null,
    options.connection,
  );
  if (!downloadUrl || !resource.latestVersion) throw new Error("enterprise_resource_version_unavailable");
  const response = await enterpriseBinaryFetcher(options.fetcher)(downloadUrl, {
    headers: { Authorization: `Bearer ${access.token}` },
    signal: AbortSignal.timeout(ENTERPRISE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code = isRecord(payload) ? readString(payload, "error") : "";
    throw new Error(code || `enterprise_server_${response.status}`);
  }
  const expectedDigest = resource.latestVersion.digest.toLowerCase();
  const responseDigestHeader = access.source === "enterprise"
    ? "x-ipollo-artifact-sha256"
    : "x-ipollowork-sha256";
  const responseDigest = response.headers.get(responseDigestHeader)?.trim().toLowerCase() ?? "";
  if (!SHA256_HEX_PATTERN.test(expectedDigest) || !SHA256_HEX_PATTERN.test(responseDigest)) {
    throw new Error("enterprise_resource_digest_missing");
  }
  const responseTypeHeader = access.source === "enterprise"
    ? "x-ipollo-resource-type"
    : "x-ipollowork-resource-type";
  if (response.headers.get(responseTypeHeader)?.trim() !== resource.type) {
    throw new Error("enterprise_resource_type_mismatch");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_TEMPLATE_PACKAGE_BYTES) {
    throw new Error("enterprise_resource_package_too_large");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_TEMPLATE_PACKAGE_BYTES) throw new Error("enterprise_resource_package_too_large");
  const actualDigest = await sha256Hex(bytes);
  if (actualDigest !== expectedDigest || actualDigest !== responseDigest) {
    throw new Error("enterprise_resource_digest_mismatch");
  }
  const canonicalPackage = response.headers.get("content-type")?.split(";", 1)[0]?.trim() === IPOLLOWORK_PACKAGE_MEDIA_TYPE
    || response.headers.get("content-disposition")?.toLowerCase().includes(IPOLLOWORK_PACKAGE_EXTENSION)
    || new URL(downloadUrl).pathname.toLowerCase().endsWith(IPOLLOWORK_PACKAGE_EXTENSION);
  const extension = resource.type === "template"
    ? (canonicalPackage ? IPOLLOWORK_PACKAGE_EXTENSION : LEGACY_TEMPLATE_PACKAGE_EXTENSION).slice(1)
    : resource.type === "skill" ? "ipollowork-skill" : ENTERPRISE_EXTENSION_PACKAGE_EXTENSION.slice(1);
  return new File([bytes], `${resource.slug}-${resource.latestVersion.version}.${extension}`, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

export async function joinEnterpriseWithCode(
  input: { joinCode: string; cloudBaseUrl: string; cloudToken: string; enterpriseBaseUrl: string },
  fetcher?: typeof fetch,
): Promise<EnterpriseConnection> {
  const joinCode = normalizeEnterpriseJoinCode(input.joinCode);
  const cloudOrigin = normalizeEnterpriseOrigin(input.cloudBaseUrl);
  const enterpriseOrigin = normalizeEnterpriseOrigin(input.enterpriseBaseUrl);
  const cloudToken = input.cloudToken.trim();
  if (!cloudOrigin || !cloudToken) throw new Error("cloud_signin_required");
  if (!enterpriseOrigin) throw new Error("invalid_enterprise_url");
  if (!/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/u.test(joinCode)) throw new Error("invalid_join_code");
  const accountKey = connectionStorageKey();
  if (!accountKey || connectionAccount?.token !== cloudToken
    || connectionAccount.baseUrl !== normalizeDenBaseUrl(input.cloudBaseUrl)) throw new Error("cloud_signin_required");

  const authorization = { Authorization: `Bearer ${cloudToken}` };
  const requestFetcher = enterpriseFetcher(fetcher);
  const discoveredServer = await discoverEnterpriseConnection(enterpriseOrigin, requestFetcher);

  const identityPayload = await fetchJson(endpoint(cloudOrigin, "/api/auth/token"), {
    headers: authorization,
  }, requestFetcher);
  const identityToken = isRecord(identityPayload) ? readString(identityPayload, "token") : "";
  if (!identityToken) throw new Error("enterprise_identity_token_missing");

  const joinPayload = await fetchJson(endpoint(discoveredServer.origin, "/api/v1/join"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ joinCode, identityToken }),
  }, requestFetcher);
  const connection = parseJoinResult(joinPayload, discoveredServer);
  if (!connection) throw new Error("invalid_enterprise_join_response");
  if (accountKey !== connectionStorageKey()) throw new Error("cloud_signin_required");
  saveEnterpriseConnection(connection);
  return connection;
}

function parseStoredConnection(value: unknown): EnterpriseConnection | null {
  if (!isRecord(value)) return null;
  const server = parseManifest({ enterprise: value, features: value.features });
  const origin = normalizeEnterpriseOrigin(readString(value, "origin"));
  const authModeValue = readString(value, "authMode");
  const authMode = authModeValue === "bootstrap" || authModeValue === "ipollo_oidc" ? authModeValue : null;
  if (!server || !origin || !authMode || !isRecord(value.membership) || !isRecord(value.session)) return null;
  const memberId = readString(value.membership, "id");
  const role = parseRole(value.membership.role);
  const token = readString(value.session, "token");
  const expiresAt = readString(value.session, "expiresAt");
  if (!memberId || !role || !token || !expiresAt) return null;
  const status = enterpriseMemberSchema.shape.status.safeParse(value.membership.status);
  const departmentId = value.membership.departmentId;
  return { ...server, origin, authMode, membership: { id: memberId, role, ...(status.success ? { status: status.data } : {}), ...(departmentId === null || typeof departmentId === "string" ? { departmentId } : {}) }, session: { token, expiresAt } };
}

function dispatchConnectionsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(enterpriseConnectionsChangedEvent));
}

function connectionStorageKey(): string | null {
  if (!connectionAccount) return null;
  const settings = readDenSettings();
  return settings.authToken?.trim() === connectionAccount.token
    && normalizeDenBaseUrl(settings.baseUrl) === connectionAccount.baseUrl
    ? connectionAccount.storageKey : null;
}

/** Select only after Cloud has verified the account; tokens never form the persistent cache key. */
export function setEnterpriseConnectionAccount(account: { userId: string; baseUrl: string; token: string } | null) {
  if (typeof window === "undefined") return;
  if (!account) {
    connectionAccount = null;
    dispatchConnectionsChanged();
    return;
  }
  const settings = readDenSettings();
  const baseUrl = normalizeDenBaseUrl(account.baseUrl);
  const userId = account.userId.trim();
  const token = account.token.trim();
  if (!baseUrl || !userId || !token || normalizeDenBaseUrl(settings.baseUrl) !== baseUrl
    || settings.authToken?.trim() !== token) return;
  const storageKey = `${ENTERPRISE_CONNECTIONS_KEY}:${encodeURIComponent(baseUrl)}:${encodeURIComponent(userId)}`;
  if (connectionAccount?.storageKey === storageKey && connectionAccount.token === token) return;
  // Adopt the pre-account format once, on the first verified session after upgrading.
  const legacy = window.localStorage.getItem(ENTERPRISE_CONNECTIONS_KEY);
  if (legacy && window.localStorage.getItem(storageKey) === null) window.localStorage.setItem(storageKey, legacy);
  window.localStorage.removeItem(ENTERPRISE_CONNECTIONS_KEY);
  connectionAccount = { storageKey, baseUrl, token };
  dispatchConnectionsChanged();
}

export function readEnterpriseConnections(): EnterpriseConnection[] {
  if (typeof window === "undefined") return [];
  const storageKey = connectionStorageKey();
  if (!storageKey) return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseStoredConnection)
      .filter((connection): connection is EnterpriseConnection => connection !== null)
      .slice(0, ENTERPRISE_CONNECTION_LIMIT);
  } catch {
    return [];
  }
}

export function saveEnterpriseConnection(connection: EnterpriseConnection) {
  if (typeof window === "undefined") return;
  const storageKey = connectionStorageKey();
  if (!storageKey) throw new Error("cloud_signin_required");
  const existing = readEnterpriseConnections().filter((item) => item.id !== connection.id);
  window.localStorage.setItem(
    storageKey,
    JSON.stringify([connection, ...existing].slice(0, ENTERPRISE_CONNECTION_LIMIT)),
  );
  dispatchConnectionsChanged();
}

export function removeEnterpriseConnection(connectionId: string) {
  if (typeof window === "undefined") return;
  const storageKey = connectionStorageKey();
  if (!storageKey) return;
  const remaining = readEnterpriseConnections().filter((item) => item.id !== connectionId);
  window.localStorage.setItem(storageKey, JSON.stringify(remaining));
  dispatchConnectionsChanged();
}

export async function leaveEnterpriseConnection(
  connection: EnterpriseConnection,
  fetcher?: typeof fetch,
) {
  await fetchJson(endpoint(connection.origin, "/api/v1/membership"), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${connection.session.token}` },
  }, enterpriseFetcher(fetcher));
  removeEnterpriseConnection(connection.id);
}

/** Match manifest identity and select semantic upgrades, never a different or older package. */
export function cloudPluginResourceId(resource: EnterpriseResource): string {
  return resource.manifestId ?? resource.slug;
}

export function cloudPluginUpdate(
  resources: readonly EnterpriseResource[],
  installed: Pick<iPolloWorkPluginPackageItem, "pluginId" | "version">,
): EnterpriseResource | undefined {
  let selected: EnterpriseResource | undefined;
  for (const resource of resources) {
    const version = resource.latestVersion?.version;
    if (resource.type !== "extension" || cloudPluginResourceId(resource) !== installed.pluginId || !version
      || (comparePluginPackageVersions(version, installed.version) ?? -1) <= 0) continue;
    if (!selected || (comparePluginPackageVersions(version, selected.latestVersion?.version ?? "") ?? -1) > 0) selected = resource;
  }
  return selected;
}

export function assertCloudPluginIdentity(
  resource: EnterpriseResource,
  manifest: { id: string; package?: { version: string } },
): void {
  if (manifest.id !== cloudPluginResourceId(resource)
    || manifest.package?.version !== resource.latestVersion?.version) {
    throw new Error("cloud_plugin_package_identity_mismatch");
  }
}

/** Public, Personal and enterprise downloads share the verified installation path. */
export async function installCloudPluginResource(
  resource: EnterpriseResource,
  client: Pick<iPolloWorkServerClient, "listPluginPackages" | "validatePluginPackageUpload" | "importPluginPackage">,
  workspaceId: string,
  options: EnterpriseResourceRequestOptions = {},
) {
  const latest = resource.latestVersion;
  if (resource.type !== "extension" || !latest
    || comparePluginPackageVersions(latest.version, latest.version) === null) throw new Error("enterprise_resource_version_unavailable");
  const current = (await client.listPluginPackages(workspaceId)).items
    .find(item => item.pluginId === cloudPluginResourceId(resource));
  if (current && (comparePluginPackageVersions(latest.version, current.version) ?? -1) <= 0) return null;
  const file = await downloadEnterpriseResource(resource, options);
  const upload = await readPluginPackageArchive(file, "install");
  const { preview } = await client.validatePluginPackageUpload(workspaceId, upload);
  assertCloudPluginIdentity(resource, preview.manifest);
  return client.importPluginPackage(workspaceId, upload);
}
