import { randomUUID } from "node:crypto";

import * as oauth from "oauth4webapi";

import { ApiError } from "./errors.js";
import type { PluginAuthorizationMethod } from "./plugin-package-manifest.js";

type OAuthMethod = Extract<PluginAuthorizationMethod, { kind: "oauth-pkce" }>;
type DeviceMethod = Extract<PluginAuthorizationMethod, { kind: "device-code" }>;
type HostedMethod = Extract<PluginAuthorizationMethod, { kind: "hosted-browser" }>;

type FlowBase<TMethod extends PluginAuthorizationMethod> = {
  installationId: string;
  accountId: string;
  method: TMethod;
  now?: number;
  callbackUrl?: string;
};

type OAuthFlowInput = FlowBase<OAuthMethod>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type DeviceFlowInput = FlowBase<DeviceMethod> & { fetcher?: FetchLike };
type HostedFlowInput = FlowBase<HostedMethod>;

type OAuthTokenMethod = OAuthMethod | DeviceMethod;
type OAuthTokenPayload = {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  expires_in?: number;
};

type OAuthStartedFlow = {
  public: {
    flowId: string;
    kind: "oauth-pkce";
    methodId: string;
    status: "pending";
    authorizationUrl: string;
    expiresAt: number;
  };
  private: {
    state: string;
    pkceVerifier: string;
    tokenUrl: string;
    clientId: string;
    redirectUri: string;
  };
};

type DeviceStartedFlow = {
  public: {
    flowId: string;
    kind: "device-code";
    methodId: string;
    status: "pending";
    userCode: string;
    verificationUrl: string;
    qrValue?: string;
    pollIntervalMs: number;
    expiresAt: number;
  };
  private: {
    deviceCode: string;
    tokenUrl: string;
    clientId: string;
  };
};

type HostedStartedFlow = {
  public: {
    flowId: string;
    kind: "hosted-browser";
    methodId: string;
    status: "pending";
    authorizationUrl: string;
    expiresAt: number;
  };
  private: {
    state: string;
    callbackOrigin: string;
    callbackUrl: string;
  };
};

function flowId(): string {
  return `plugin_auth_${randomUUID()}`;
}

function stateToken(): string {
  return oauth.generateRandomState();
}

function oauthRequestOptions(fetcher: FetchLike | undefined) {
  return fetcher
    ? { [oauth.customFetch]: (url: string, init: oauth.CustomFetchOptions<"POST", URLSearchParams>) => fetcher(url, init) }
    : undefined;
}

function authorizationServer(method: OAuthTokenMethod): oauth.AuthorizationServer {
  return {
    issuer: new URL(method.tokenUrl).origin,
    token_endpoint: method.tokenUrl,
    ...(method.kind === "oauth-pkce" ? { authorization_endpoint: method.authorizationUrl } : {}),
    ...(method.kind === "device-code" ? { device_authorization_endpoint: method.deviceAuthorizationUrl } : {}),
  };
}

function oauthClient(method: OAuthTokenMethod): oauth.Client {
  return { client_id: method.clientId, token_endpoint_auth_method: "none" };
}

function authorizationError(code: string, message: string, error: unknown): ApiError {
  return new ApiError(502, code, message, {
    cause: error instanceof Error ? error.message : String(error),
  });
}

export function tokenValues(payload: OAuthTokenPayload, now = Date.now()): Record<string, string> {
  const values: Record<string, string> = {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
  };
  if (payload.refresh_token) values.refreshToken = payload.refresh_token;
  if (payload.scope) values.scope = payload.scope;
  if (payload.id_token) values.idToken = payload.id_token;
  if (typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)) {
    values.expiresAt = String(now + payload.expires_in * 1_000);
  }
  return values;
}

export async function exchangeOAuthAuthorizationCode(input: {
  method: OAuthMethod;
  code: string;
  state: string;
  expectedState: string;
  redirectUri: string;
  verifier: string;
  fetcher?: FetchLike;
  now?: number;
}): Promise<Record<string, string>> {
  const server = authorizationServer(input.method);
  const client = oauthClient(input.method);
  try {
    const callback = new URL(input.redirectUri);
    callback.searchParams.set("code", input.code);
    callback.searchParams.set("state", input.state);
    const parameters = oauth.validateAuthResponse(server, client, callback, input.expectedState);
    const response = await oauth.authorizationCodeGrantRequest(
      server,
      client,
      oauth.None(),
      parameters,
      input.redirectUri,
      input.verifier,
      oauthRequestOptions(input.fetcher),
    );
    return tokenValues(await oauth.processAuthorizationCodeResponse(server, client, response), input.now);
  } catch (error) {
    throw authorizationError("plugin_authorization_token_failed", "OAuth token exchange failed", error);
  }
}

export async function exchangeDeviceCode(input: {
  method: DeviceMethod;
  deviceCode: string;
  fetcher?: FetchLike;
  now?: number;
}): Promise<Record<string, string> | { pending: true }> {
  const server = authorizationServer(input.method);
  const client = oauthClient(input.method);
  try {
    const response = await oauth.deviceCodeGrantRequest(
      server,
      client,
      oauth.None(),
      input.deviceCode,
      oauthRequestOptions(input.fetcher),
    );
    return tokenValues(await oauth.processDeviceCodeResponse(server, client, response), input.now);
  } catch (error) {
    if (error instanceof oauth.ResponseBodyError && (error.error === "authorization_pending" || error.error === "slow_down")) {
      return { pending: true };
    }
    throw authorizationError("plugin_authorization_token_failed", "Device token exchange failed", error);
  }
}

export async function refreshOAuthCredential(input: {
  method: OAuthTokenMethod;
  refreshToken: string;
  fetcher?: FetchLike;
  now?: number;
}): Promise<Record<string, string>> {
  const server = authorizationServer(input.method);
  const client = oauthClient(input.method);
  try {
    const response = await oauth.refreshTokenGrantRequest(
      server,
      client,
      oauth.None(),
      input.refreshToken,
      oauthRequestOptions(input.fetcher),
    );
    return tokenValues(await oauth.processRefreshTokenResponse(server, client, response), input.now);
  } catch (error) {
    throw authorizationError("plugin_authorization_refresh_failed", "OAuth credential refresh failed", error);
  }
}

function requireCallbackUrl(value: string | undefined): string {
  if (!value) throw new ApiError(400, "plugin_authorization_callback_required", "A callback URL is required for this authorization method");
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !localHttp) {
    throw new ApiError(400, "plugin_authorization_callback_invalid", "The callback URL must use HTTPS unless it targets localhost");
  }
  return url.toString();
}

export function startPluginAuthorizationFlow(input: OAuthFlowInput): Promise<OAuthStartedFlow>;
export function startPluginAuthorizationFlow(input: DeviceFlowInput): Promise<DeviceStartedFlow>;
export function startPluginAuthorizationFlow(input: HostedFlowInput): Promise<HostedStartedFlow>;
export async function startPluginAuthorizationFlow(
  input: OAuthFlowInput | DeviceFlowInput | HostedFlowInput,
): Promise<OAuthStartedFlow | DeviceStartedFlow | HostedStartedFlow> {
  const now = input.now ?? Date.now();
  const id = flowId();

  if (input.method.kind === "oauth-pkce") {
    const redirectUri = requireCallbackUrl(input.callbackUrl);
    const verifier = oauth.generateRandomCodeVerifier();
    const challenge = await oauth.calculatePKCECodeChallenge(verifier);
    const state = stateToken();
    const authorizationUrl = new URL(input.method.authorizationUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", input.method.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (input.method.scopes.length) authorizationUrl.searchParams.set("scope", input.method.scopes.join(" "));
    if (input.method.audience) authorizationUrl.searchParams.set("audience", input.method.audience);
    return {
      public: {
        flowId: id,
        kind: "oauth-pkce",
        methodId: input.method.id,
        status: "pending",
        authorizationUrl: authorizationUrl.toString(),
        expiresAt: now + 10 * 60_000,
      },
      private: {
        state,
        pkceVerifier: verifier,
        tokenUrl: input.method.tokenUrl,
        clientId: input.method.clientId,
        redirectUri,
      },
    };
  }

  if (input.method.kind === "device-code") {
    const fetcher = "fetcher" in input ? input.fetcher ?? fetch : fetch;
    let payload: oauth.DeviceAuthorizationResponse;
    try {
      const response = await oauth.deviceAuthorizationRequest(
        authorizationServer(input.method),
        oauthClient(input.method),
        oauth.None(),
        input.method.scopes.length ? { scope: input.method.scopes.join(" ") } : {},
        oauthRequestOptions(fetcher),
      );
      payload = await oauth.processDeviceAuthorizationResponse(authorizationServer(input.method), oauthClient(input.method), response);
    } catch (error) {
      throw authorizationError("plugin_device_authorization_failed", "Device authorization failed", error);
    }
    const interval = payload.interval ?? 5;
    return {
      public: {
        flowId: id,
        kind: "device-code",
        methodId: input.method.id,
        status: "pending",
        userCode: payload.user_code,
        verificationUrl: payload.verification_uri,
        ...(input.method.qr && payload.verification_uri_complete ? { qrValue: payload.verification_uri_complete } : {}),
        pollIntervalMs: interval * 1_000,
        expiresAt: now + payload.expires_in * 1_000,
      },
      private: {
        deviceCode: payload.device_code,
        tokenUrl: input.method.tokenUrl,
        clientId: input.method.clientId,
      },
    };
  }

  const callbackUrl = requireCallbackUrl(input.callbackUrl);
  const state = stateToken();
  const authorizationUrl = new URL(input.method.startUrl);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("callback_url", callbackUrl);
  return {
    public: {
      flowId: id,
      kind: "hosted-browser",
      methodId: input.method.id,
      status: "pending",
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: now + 10 * 60_000,
    },
    private: {
      state,
      callbackOrigin: input.method.callbackOrigin,
      callbackUrl,
    },
  };
}
