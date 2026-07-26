const ENTERPRISE_CONNECTIONS_KEY = "ipollowork.enterprise-connections.v1";
const ENTERPRISE_CONNECTION_LIMIT = 12;

type JsonRecord = Record<string, unknown>;

export type EnterpriseConnection = {
  id: string;
  name: string;
  shortName: string;
  origin: string;
  logoUrl: string | null;
  accent: "blue" | "neutral";
  authMode: "bootstrap" | "ipollo_oidc";
};

type EnterpriseDiscovery = {
  serverId: string;
  name: string;
  origin: string;
  authMode: EnterpriseConnection["authMode"];
};

type EnterpriseManifest = {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
  accent: EnterpriseConnection["accent"];
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
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

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`enterprise_server_${response.status}`);
  return response.json();
}

export async function discoverEnterpriseConnection(
  input: string,
  fetcher: typeof fetch = fetch,
): Promise<EnterpriseConnection> {
  const requestedOrigin = normalizeEnterpriseOrigin(input);
  if (!requestedOrigin) throw new Error("invalid_enterprise_url");
  const signal = AbortSignal.timeout(8_000);

  const discovery = parseDiscovery(
    await readJson(
      await fetcher(endpoint(requestedOrigin, "/.well-known/ipollo-enterprise"), { signal }),
    ),
  );
  if (!discovery) throw new Error("invalid_enterprise_discovery");

  const manifest = parseManifest(
    await readJson(
      await fetcher(endpoint(discovery.origin, "/api/v1/client-manifest"), { signal }),
    ),
  );
  if (!manifest || manifest.id !== discovery.serverId) {
    throw new Error("enterprise_manifest_mismatch");
  }

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

function parseStoredConnection(value: unknown): EnterpriseConnection | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  const name = readString(value, "name");
  const shortName = readString(value, "shortName");
  const origin = normalizeEnterpriseOrigin(readString(value, "origin"));
  const logoValue = value.logoUrl;
  const logoUrl = typeof logoValue === "string" && logoValue.trim() ? logoValue.trim() : null;
  const accentValue = readString(value, "accent");
  const authModeValue = readString(value, "authMode");
  const accent = accentValue === "blue" || accentValue === "neutral" ? accentValue : null;
  const authMode = authModeValue === "bootstrap" || authModeValue === "ipollo_oidc" ? authModeValue : null;
  if (!id.startsWith("ent_") || !name || !shortName || !origin || !accent || !authMode) return null;
  return { id, name, shortName, origin, logoUrl, accent, authMode };
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
}
