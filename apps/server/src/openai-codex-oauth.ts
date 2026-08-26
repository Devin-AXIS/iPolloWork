import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { resolveOpencodeAuthPath } from "./opencode-db.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import type { ServerConfig } from "./types.js";

export type OpenAiCodexOAuthCredential = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
};

export type OpenAiCodexOAuthSession = {
  accessToken: string;
  accountId?: string;
};

export type OpenAiCodexOAuthCredentialCandidate = {
  source: "account" | "official-codex";
  credential: OpenAiCodexOAuthCredential;
};

const OPENAI_CODEX_AUTH_PROVIDER_ID = "openai";
const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_REFRESH_SKEW_MS = 60_000;
const OPENAI_CODEX_REFRESH_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function oauthExpiry(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function accessTokenLifetime(accessToken: string): { issuedAt: number; expiresAt: number } | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isRecord(parsed)) return null;
    const issuedAt = oauthExpiry(parsed.iat);
    const expiresAt = oauthExpiry(parsed.exp);
    return issuedAt && expiresAt && expiresAt > issuedAt ? { issuedAt, expiresAt } : null;
  } catch {
    return null;
  }
}

/** Parse the auth.json format owned by the official Codex desktop/CLI client. */
export function officialCodexOAuthCredential(value: unknown): OpenAiCodexOAuthCredential | null {
  if (!isRecord(value)) return null;
  const authMode = nonEmptyString(value.auth_mode)?.toLowerCase();
  if (authMode && authMode !== "chatgpt") return null;
  if (!isRecord(value.tokens)) return null;
  const access = nonEmptyString(value.tokens.access_token);
  const refresh = nonEmptyString(value.tokens.refresh_token);
  if (!access || !refresh) return null;
  const lifetime = accessTokenLifetime(access);
  if (!lifetime) return null;
  const accountId = nonEmptyString(value.tokens.account_id);
  return {
    type: "oauth",
    access,
    refresh,
    expires: lifetime.expiresAt,
    ...(accountId ? { accountId } : {}),
  };
}

/** Prefer the freshest account credential, regardless of which supported client obtained it. */
export function orderOpenAiCodexOAuthCredentials(input: {
  account?: OpenAiCodexOAuthCredential | null;
  officialCodex?: OpenAiCodexOAuthCredential | null;
}, options: { allowOfficialCodexFallback?: boolean } = {}): OpenAiCodexOAuthCredentialCandidate[] {
  const candidates: OpenAiCodexOAuthCredentialCandidate[] = [];
  if (input.account) candidates.push({ source: "account", credential: input.account });
  if (options.allowOfficialCodexFallback !== false && input.officialCodex) {
    candidates.push({ source: "official-codex", credential: input.officialCodex });
  }
  return candidates.sort((left, right) => (
    right.credential.expires - left.credential.expires
    || Number(left.source !== "account") - Number(right.source !== "account")
  ));
}

export function resolveOfficialCodexAuthPath(options: {
  codexHome?: string;
  homeDir?: string;
} = {}): string {
  const root = options.codexHome?.trim()
    || (options.homeDir ? join(options.homeDir, ".codex") : "")
    || process.env.CODEX_HOME?.trim()
    || join(homedir(), ".codex");
  return join(root, "auth.json");
}

export function openAiCodexOAuthCredential(value: unknown): OpenAiCodexOAuthCredential | null {
  if (!isRecord(value) || value.type !== "oauth") return null;
  const access = nonEmptyString(value.access);
  const refresh = nonEmptyString(value.refresh);
  const expires = oauthExpiry(value.expires);
  if (!access || !refresh || !expires) return null;
  const accountId = nonEmptyString(value.accountId);
  return {
    type: "oauth",
    access,
    refresh,
    expires,
    ...(accountId ? { accountId } : {}),
  };
}

/**
 * Refresh subscription OAuth before its advertised expiry. Some upstream
 * sessions are invalidated earlier than the JWT timestamp, so non-OpenCode
 * runtimes should not keep a token for its entire nominal lifetime.
 */
export function openAiCodexOAuthCredentialNeedsRefresh(
  credential: OpenAiCodexOAuthCredential,
  now = Date.now(),
): boolean {
  if (credential.expires <= now + OPENAI_CODEX_REFRESH_SKEW_MS) return true;
  const lifetime = accessTokenLifetime(credential.access);
  if (!lifetime) return false;
  return now >= lifetime.issuedAt + (lifetime.expiresAt - lifetime.issuedAt) / 2;
}

export async function refreshOpenAiCodexOAuthCredential(
  credential: OpenAiCodexOAuthCredential,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<OpenAiCodexOAuthCredential> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  const response = await fetcher(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credential.refresh,
      client_id: OPENAI_CODEX_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(OPENAI_CODEX_REFRESH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenAI Codex token refresh failed (${response.status})`);
  }
  const payload = await response.json() as Record<string, unknown>;
  const access = nonEmptyString(payload.access_token);
  const refresh = nonEmptyString(payload.refresh_token) ?? credential.refresh;
  const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
    ? payload.expires_in
    : null;
  if (!access || !expiresIn || expiresIn <= 0) {
    throw new Error("OpenAI Codex token refresh response is incomplete");
  }
  return {
    ...credential,
    access,
    refresh,
    expires: now + expiresIn * 1_000,
  };
}

async function persistOpenAiCodexOAuthCredential(
  config: ServerConfig,
  credential: OpenAiCodexOAuthCredential,
): Promise<void> {
  // Every workspace exposes the managed OpenCode control plane, even when its
  // conversation engine is Codex or DSH. Prefer a native OpenCode workspace,
  // then fall back to any mounted workspace instead of making account auth
  // depend on the current project's engine.
  const workspace = config.workspaces.find((entry) => entry.engineId === DEFAULT_ENGINE_ID)
    ?? config.workspaces[0];
  if (!workspace) throw new Error("A workspace is unavailable for OAuth refresh persistence");
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!connection.baseUrl) throw new Error("OpenCode provider endpoint is unavailable");
  const client = createOpencodeClient({
    baseUrl: connection.baseUrl,
    ...(connection.authHeader ? { headers: { Authorization: connection.authHeader } } : {}),
  });
  const result = await client.auth.set({
    providerID: OPENAI_CODEX_AUTH_PROVIDER_ID,
    auth: {
      type: "oauth",
      access: credential.access,
      refresh: credential.refresh,
      expires: credential.expires,
      ...(credential.accountId ? { accountId: credential.accountId } : {}),
    },
  });
  if (result.data !== true) {
    throw new Error(`OpenCode rejected refreshed OAuth credentials (${result.response.status})`);
  }
}

let openAiAccountCredentialRefresh: Promise<OpenAiCodexOAuthCredential | null> | null = null;

async function activeOpenAiAccountCredential(
  config: ServerConfig,
  credential: OpenAiCodexOAuthCredential,
  now: number,
): Promise<OpenAiCodexOAuthCredential | null> {
  if (!openAiCodexOAuthCredentialNeedsRefresh(credential, now)) return credential;
  if (openAiAccountCredentialRefresh) return openAiAccountCredentialRefresh;
  const pending = (async () => {
    try {
      const refreshed = await refreshOpenAiCodexOAuthCredential(credential, { now });
      await persistOpenAiCodexOAuthCredential(config, refreshed);
      return refreshed;
    } catch {
      return credential.expires > now ? credential : null;
    }
  })();
  openAiAccountCredentialRefresh = pending;
  try {
    return await pending;
  } finally {
    if (openAiAccountCredentialRefresh === pending) openAiAccountCredentialRefresh = null;
  }
}

const openAiCodexCredentialRefreshes = new Map<boolean, Promise<OpenAiCodexOAuthSession | null>>();

/**
 * Resolve the account-wide OpenAI OAuth session stored by the managed OpenCode
 * control plane. Agent runtimes receive only the short-lived access token and
 * account id; the refresh token remains in the account auth vault.
 */
export async function resolveOpenAiCodexOAuthSession(
  config: ServerConfig,
  options: {
    explicitlyDisconnected?: boolean;
    allowOfficialCodexFallback?: boolean;
  } = {},
): Promise<OpenAiCodexOAuthSession | null> {
  // The official Codex auth file is a credential source, not permission to
  // reconnect a provider that the user explicitly disconnected in iPolloWork.
  if (options.explicitlyDisconnected) return null;
  const allowOfficialCodexFallback = options.allowOfficialCodexFallback !== false;
  const activeRefresh = openAiCodexCredentialRefreshes.get(allowOfficialCodexFallback);
  if (activeRefresh) return activeRefresh;
  const pending = (async () => {
    const accountAuthPath = resolveOpencodeAuthPath({ managedOnly: true })
      ?? resolveOpencodeAuthPath();
    const officialAuthPath = allowOfficialCodexFallback ? resolveOfficialCodexAuthPath() : null;
    const readAuthStore = async (path: string | null): Promise<Record<string, unknown> | null> => {
      if (!path) return null;
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    };
    const [accountAuthStore, officialAuthStore] = await Promise.all([
      readAuthStore(accountAuthPath),
      !officialAuthPath || accountAuthPath === officialAuthPath
        ? Promise.resolve(null)
        : readAuthStore(officialAuthPath),
    ]);
    const accountCredential = openAiCodexOAuthCredential(
      accountAuthStore?.[OPENAI_CODEX_AUTH_PROVIDER_ID],
    );
    const officialCredential = officialCodexOAuthCredential(officialAuthStore);
    const now = Date.now();

    for (const candidate of orderOpenAiCodexOAuthCredentials({
      account: accountCredential,
      officialCodex: officialCredential,
    }, {
      allowOfficialCodexFallback,
    })) {
      let active = candidate.credential;
      if (candidate.source === "official-codex") {
        // The official client remains the refresh owner of this source. Import
        // only a still-valid credential into the account control plane so we
        // never rotate its refresh token behind the client's back.
        if (active.expires <= now + OPENAI_CODEX_REFRESH_SKEW_MS) continue;
        if (
          accountCredential?.access !== active.access
          || accountCredential.refresh !== active.refresh
          || accountCredential.expires !== active.expires
        ) {
          await persistOpenAiCodexOAuthCredential(config, active).catch(() => undefined);
        }
      } else {
        const accountCredential = await activeOpenAiAccountCredential(config, active, now);
        if (!accountCredential) continue;
        active = accountCredential;
      }
      return {
        accessToken: active.access,
        ...(active.accountId ? { accountId: active.accountId } : {}),
      };
    }
    return null;
  })();
  const refresh = pending.finally(() => {
    if (openAiCodexCredentialRefreshes.get(allowOfficialCodexFallback) === refresh) {
      openAiCodexCredentialRefreshes.delete(allowOfficialCodexFallback);
    }
  });
  openAiCodexCredentialRefreshes.set(allowOfficialCodexFallback, refresh);
  return refresh;
}
