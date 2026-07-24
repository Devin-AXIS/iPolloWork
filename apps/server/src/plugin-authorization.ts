import { createHash, randomBytes, randomUUID } from "node:crypto";

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

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function flowId(): string {
  return `plugin_auth_${randomUUID()}`;
}

function stateToken(): string {
  return base64Url(randomBytes(32));
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
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
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
    const body = new URLSearchParams({ client_id: input.method.clientId });
    if (input.method.scopes.length) body.set("scope", input.method.scopes.join(" "));
    const fetcher = "fetcher" in input ? input.fetcher ?? fetch : fetch;
    const response = await fetcher(input.method.deviceAuthorizationUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new ApiError(502, "plugin_device_authorization_failed", `Device authorization failed with HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError(502, "plugin_device_authorization_invalid", "Device authorization returned an invalid response");
    }
    const deviceCode = nonEmpty(Reflect.get(payload, "device_code"));
    const userCode = nonEmpty(Reflect.get(payload, "user_code"));
    const verificationUrl = nonEmpty(Reflect.get(payload, "verification_uri"));
    const verificationComplete = nonEmpty(Reflect.get(payload, "verification_uri_complete"));
    const expiresIn = positiveNumber(Reflect.get(payload, "expires_in"));
    const interval = positiveNumber(Reflect.get(payload, "interval")) ?? 5;
    if (!deviceCode || !userCode || !verificationUrl || !expiresIn) {
      throw new ApiError(502, "plugin_device_authorization_invalid", "Device authorization response is missing required fields");
    }
    return {
      public: {
        flowId: id,
        kind: "device-code",
        methodId: input.method.id,
        status: "pending",
        userCode,
        verificationUrl,
        ...(input.method.qr && verificationComplete ? { qrValue: verificationComplete } : {}),
        pollIntervalMs: interval * 1_000,
        expiresAt: now + expiresIn * 1_000,
      },
      private: {
        deviceCode,
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
