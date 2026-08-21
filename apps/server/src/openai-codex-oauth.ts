import { readFile } from "node:fs/promises";
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
  const workspace = config.workspaces.find((entry) => entry.engineId === DEFAULT_ENGINE_ID);
  if (!workspace) throw new Error("OpenCode workspace is unavailable for OAuth refresh persistence");
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

let openAiCodexCredentialRefresh: Promise<OpenAiCodexOAuthSession | null> | null = null;

/**
 * Resolve the account-wide OpenAI OAuth session stored by the managed OpenCode
 * control plane. Agent runtimes receive only the short-lived access token and
 * account id; the refresh token remains in the account auth vault.
 */
export async function resolveOpenAiCodexOAuthSession(
  config: ServerConfig,
): Promise<OpenAiCodexOAuthSession | null> {
  if (openAiCodexCredentialRefresh) return openAiCodexCredentialRefresh;
  openAiCodexCredentialRefresh = (async () => {
    const authPath = resolveOpencodeAuthPath();
    if (!authPath) return null;
    let authStore: Record<string, unknown>;
    try {
      const parsed = JSON.parse(await readFile(authPath, "utf8")) as unknown;
      if (!isRecord(parsed)) return null;
      authStore = parsed;
    } catch {
      return null;
    }
    const credential = openAiCodexOAuthCredential(authStore[OPENAI_CODEX_AUTH_PROVIDER_ID]);
    if (!credential) return null;
    let active = credential;
    if (credential.expires <= Date.now() + OPENAI_CODEX_REFRESH_SKEW_MS) {
      try {
        active = await refreshOpenAiCodexOAuthCredential(credential);
        await persistOpenAiCodexOAuthCredential(config, active);
      } catch {
        if (credential.expires <= Date.now()) return null;
      }
    }
    return {
      accessToken: active.access,
      ...(active.accountId ? { accountId: active.accountId } : {}),
    };
  })().finally(() => {
    openAiCodexCredentialRefresh = null;
  });
  return openAiCodexCredentialRefresh;
}
