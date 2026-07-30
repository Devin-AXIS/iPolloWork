import { desktopFetchViaMain } from "./desktop";
import { isDesktopRuntime } from "./runtime-env";

const ENTERPRISE_CONNECTIONS_KEY = "ipollowork.enterprise-connections.v1";
const ENTERPRISE_CONNECTION_LIMIT = 12;
const ENTERPRISE_TIMEOUT_MS = 12_000;

export const enterpriseConnectionsChangedEvent = "ipollowork:enterprise-connections-changed";

type JsonRecord = Record<string, unknown>;

export type EnterpriseMemberRole = "owner" | "admin" | "member";

export type EnterpriseServer = {
  id: string;
  name: string;
  shortName: string;
  origin: string;
  logoUrl: string | null;
  accent: "blue" | "neutral";
  authMode: "bootstrap" | "ipollo_oidc";
};

export type EnterpriseConnection = EnterpriseServer & {
  membership: {
    id: string;
    role: EnterpriseMemberRole;
  };
  session: {
    token: string;
    expiresAt: string;
  };
};

export type EnterpriseResourceType = "template" | "extension";

export type EnterpriseResource = {
  id: string;
  type: EnterpriseResourceType;
  slug: string;
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
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function parseRole(value: unknown): EnterpriseMemberRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
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
  return { id, name, shortName, logoUrl, accent };
}

function endpoint(origin: string, path: string) {
  return `${origin.replace(/\/+$/u, "")}${path}`;
}

function enterpriseFetcher(fetcher: typeof fetch) {
  return isDesktopRuntime() && fetcher === globalThis.fetch ? desktopFetchViaMain : fetcher;
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
  fetcher: typeof fetch = fetch,
): Promise<EnterpriseServer> {
  const requestedOrigin = normalizeEnterpriseOrigin(input);
  if (!requestedOrigin) throw new Error("invalid_enterprise_url");

  const discovery = parseDiscovery(
    await fetchJson(endpoint(requestedOrigin, "/.well-known/ipollo-enterprise"), {}, fetcher),
  );
  if (!discovery) throw new Error("invalid_enterprise_discovery");

  const manifest = parseManifest(
    await fetchJson(endpoint(discovery.origin, "/api/v1/client-manifest"), {}, fetcher),
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
  };
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

function parseEnterpriseResource(value: unknown, expectedType: EnterpriseResourceType): EnterpriseResource | null {
  if (!isRecord(value) || readString(value, "type") !== expectedType) return null;
  const id = readString(value, "id");
  const slug = readString(value, "slug");
  const name = readString(value, "name");
  const category = readString(value, "category");
  const enterpriseCategory = readString(value, "enterpriseCategory");
  const updatedAt = readString(value, "updatedAt");
  if (!id || !slug || !name || !category || !enterpriseCategory || !updatedAt) return null;
  const iconPath = typeof value.iconPath === "string" && value.iconPath.startsWith("/api/v1/resources/")
    ? value.iconPath
    : null;
  const latest = isRecord(value.latestVersion) ? value.latestVersion : null;
  const version = latest ? readString(latest, "version") : "";
  const digest = latest ? readString(latest, "digest") : "";
  const downloadPath = latest ? readString(latest, "downloadPath") : "";
  return {
    id,
    type: expectedType,
    slug,
    name,
    description: readString(value, "description"),
    category,
    enterpriseCategory,
    iconPath,
    featured: value.featured === true,
    updatedAt,
    latestVersion: version && digest && downloadPath.startsWith("/api/v1/resources/")
      ? { version, digest, downloadPath }
      : null,
  };
}

export function enterpriseResourceUrl(connection: EnterpriseConnection, path: string | null): string | null {
  if (!path?.startsWith("/api/v1/resources/")) return null;
  return endpoint(connection.origin, path);
}

export async function listEnterpriseResources(
  connection: EnterpriseConnection,
  type: EnterpriseResourceType,
  fetcher: typeof fetch = fetch,
): Promise<EnterpriseResource[]> {
  const payload = await fetchJson(
    endpoint(connection.origin, `/api/v1/resources?type=${encodeURIComponent(type)}&limit=50`),
    { headers: { Authorization: `Bearer ${connection.session.token}` } },
    enterpriseFetcher(fetcher),
  );
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw new Error("invalid_enterprise_resource_catalog");
  return payload.items.flatMap((item) => {
    const parsed = parseEnterpriseResource(item, type);
    return parsed ? [parsed] : [];
  });
}

export async function downloadEnterpriseResource(
  connection: EnterpriseConnection,
  resource: EnterpriseResource,
  fetcher: typeof fetch = fetch,
): Promise<File> {
  const downloadUrl = enterpriseResourceUrl(connection, resource.latestVersion?.downloadPath ?? null);
  if (!downloadUrl || !resource.latestVersion) throw new Error("enterprise_resource_version_unavailable");
  const response = await enterpriseFetcher(fetcher)(downloadUrl, {
    headers: { Authorization: `Bearer ${connection.session.token}` },
    signal: AbortSignal.timeout(ENTERPRISE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code = isRecord(payload) ? readString(payload, "error") : "";
    throw new Error(code || `enterprise_server_${response.status}`);
  }
  const extension = resource.type === "template" ? "ipwt" : "zip";
  return new File([await response.arrayBuffer()], `${resource.slug}-${resource.latestVersion.version}.${extension}`, {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
}

export async function joinEnterpriseWithCode(
  input: { joinCode: string; cloudBaseUrl: string; cloudToken: string; enterpriseBaseUrl: string },
  fetcher: typeof fetch = fetch,
): Promise<EnterpriseConnection> {
  const joinCode = normalizeEnterpriseJoinCode(input.joinCode);
  const cloudOrigin = normalizeEnterpriseOrigin(input.cloudBaseUrl);
  const enterpriseOrigin = normalizeEnterpriseOrigin(input.enterpriseBaseUrl);
  const cloudToken = input.cloudToken.trim();
  if (!cloudOrigin || !cloudToken) throw new Error("cloud_signin_required");
  if (!enterpriseOrigin) throw new Error("invalid_enterprise_url");
  if (!/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/u.test(joinCode)) throw new Error("invalid_join_code");

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
  saveEnterpriseConnection(connection);
  return connection;
}

function parseStoredConnection(value: unknown): EnterpriseConnection | null {
  if (!isRecord(value)) return null;
  const server = parseManifest({ enterprise: value });
  const origin = normalizeEnterpriseOrigin(readString(value, "origin"));
  const authModeValue = readString(value, "authMode");
  const authMode = authModeValue === "bootstrap" || authModeValue === "ipollo_oidc" ? authModeValue : null;
  if (!server || !origin || !authMode || !isRecord(value.membership) || !isRecord(value.session)) return null;
  const memberId = readString(value.membership, "id");
  const role = parseRole(value.membership.role);
  const token = readString(value.session, "token");
  const expiresAt = readString(value.session, "expiresAt");
  if (!memberId || !role || !token || !expiresAt) return null;
  return { ...server, origin, authMode, membership: { id: memberId, role }, session: { token, expiresAt } };
}

function dispatchConnectionsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(enterpriseConnectionsChangedEvent));
}

export function readEnterpriseConnections(): EnterpriseConnection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ENTERPRISE_CONNECTIONS_KEY);
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
  const existing = readEnterpriseConnections().filter((item) => item.id !== connection.id);
  window.localStorage.setItem(
    ENTERPRISE_CONNECTIONS_KEY,
    JSON.stringify([connection, ...existing].slice(0, ENTERPRISE_CONNECTION_LIMIT)),
  );
  dispatchConnectionsChanged();
}

export async function leaveEnterpriseConnection(
  connection: EnterpriseConnection,
  fetcher: typeof fetch = fetch,
) {
  await fetchJson(endpoint(connection.origin, "/api/v1/membership"), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${connection.session.token}` },
  }, enterpriseFetcher(fetcher));
  if (typeof window === "undefined") return;
  const remaining = readEnterpriseConnections().filter((item) => item.id !== connection.id);
  window.localStorage.setItem(ENTERPRISE_CONNECTIONS_KEY, JSON.stringify(remaining));
  dispatchConnectionsChanged();
}
