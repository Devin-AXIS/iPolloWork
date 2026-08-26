import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  serializeSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderDisconnectedEnvKey,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";

import {
  deepSeekHarnessChildEnvironment,
  deepSeekHarnessCompatibleProviderProfiles,
  deepSeekHarnessProviderCredentials,
  deepSeekHarnessWebArgs,
  openAiCodexOAuthCredential,
  openAiCodexOAuthCredentialNeedsRefresh,
  refreshOpenAiCodexOAuthCredential,
  sharedProviderApiCredentials,
} from "./deepseek-harness-runtime.js";
import {
  officialCodexOAuthCredential,
  orderOpenAiCodexOAuthCredentials,
  resolveOpenAiCodexOAuthSession,
  resolveOfficialCodexAuthPath,
} from "./openai-codex-oauth.js";
import {
  isOpenCodeZenPublicModel,
  openCodeZenPublicModelName,
  openCodeZenPublicModels,
} from "@ipollowork/types/opencode-zen-public-models";

const OPENCODE_ZEN_PUBLIC_MODELS = [
  { id: "big-pickle", name: "Big Pickle" },
  { id: "hy3-free", name: "Hy3 Free" },
  { id: "mimo-v2.5-free", name: "MiMo-V2.5 Free" },
  { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free" },
  { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
  { id: "x-preview-f-free", name: "Ox Alpha Free" },
];

describe("DeepSeek Harness provider credential sync", () => {
  const accessToken = (issuedAt: number, expiresAt: number) => [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ iat: issuedAt, exp: expiresAt })).toString("base64url"),
    "signature",
  ].join(".");

  test("places launcher patch options before web-app options", () => {
    expect(deepSeekHarnessWebArgs("", "C:/runtime/plugins.patch.yml")).toEqual([
      "--profile",
      "web",
      "--patch",
      "C:/runtime/plugins.patch.yml",
      "--port",
      "0",
    ]);
    expect(deepSeekHarnessWebArgs("C:/runtime/dsh.js", "C:/runtime/plugins.patch.yml")).toEqual([
      "C:/runtime/dsh.js",
      "--profile",
      "web",
      "--patch",
      "C:/runtime/plugins.patch.yml",
      "--port",
      "0",
    ]);
  });

  test("keeps shared provider credentials out of the child process environment", () => {
    expect(deepSeekHarnessChildEnvironment([
      { key: sharedProviderCredentialEnvKey("openai"), value: "shared-secret" },
      { key: "IPOLLOWORK_TOKEN", value: "reserved-secret" },
      { key: "CUSTOM_RUNTIME_FLAG", value: "enabled" },
    ])).toEqual({ CUSTOM_RUNTIME_FLAG: "enabled" });
  });

  test("imports API keys without exposing OAuth credentials", () => {
    expect([...sharedProviderApiCredentials([
      { key: sharedProviderCredentialEnvKey("openai"), value: " sk-openai " },
      { key: sharedProviderCredentialEnvKey("anthropic"), value: "sk-anthropic" },
      { key: sharedProviderCredentialEnvKey("azure_openai"), value: "sk-azure" },
      { key: "OPENAI_API_KEY", value: "ignored" },
      { key: sharedProviderCredentialEnvKey("malformed"), value: " " },
    ])]).toEqual([
      ["openai", "sk-openai"],
      ["anthropic", "sk-anthropic"],
      ["azure_openai", "sk-azure"],
    ]);
  });

  test("keeps explicitly disconnected providers out of every shared runtime bridge", () => {
    expect([...sharedProviderApiCredentials([
      { key: sharedProviderCredentialEnvKey("openai"), value: "sk-openai" },
      { key: sharedProviderDisconnectedEnvKey("openai"), value: "1" },
      { key: sharedProviderCredentialEnvKey("anthropic"), value: "sk-anthropic" },
    ])]).toEqual([["anthropic", "sk-anthropic"]]);
    expect(deepSeekHarnessChildEnvironment([
      { key: sharedProviderDisconnectedEnvKey("openai"), value: "1" },
      { key: "CUSTOM_RUNTIME_FLAG", value: "enabled" },
    ])).toEqual({ CUSTOM_RUNTIME_FLAG: "enabled" });
  });

  test("does not import official Codex OAuth after an explicit OpenAI disconnect", async () => {
    await expect(resolveOpenAiCodexOAuthSession({} as never, {
      explicitlyDisconnected: true,
    })).resolves.toBeNull();
  });

  test("does not turn the media-center DashScope credential into a chat provider", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: "DASHSCOPE_API_KEY", value: " dashscope-key " },
    ])]).toEqual([[
      "opencode",
      {
        apiKey: "public",
        bridge: {
          providerId: "opencode",
          displayName: "iPolloWork Built-in Models",
          api: "openai-completions",
          baseURL: "https://opencode.ai/zen/v1",
          models: OPENCODE_ZEN_PUBLIC_MODELS,
        },
      },
    ]]);
  });

  test("always exposes OpenCode Zen free models to the DSH inference bridge", () => {
    expect(deepSeekHarnessProviderCredentials([]).get("opencode")).toEqual({
      apiKey: "public",
      bridge: {
        providerId: "opencode",
        displayName: "iPolloWork Built-in Models",
        api: "openai-completions",
        baseURL: "https://opencode.ai/zen/v1",
        models: OPENCODE_ZEN_PUBLIC_MODELS,
      },
    });
  });

  test("bridges an OpenCode Codex OAuth access token without copying its refresh token", () => {
    expect(deepSeekHarnessProviderCredentials([], {
      openAiCodexAccessToken: "codex-access-token",
    }).get("openai-codex")).toEqual({
      apiKey: "codex-access-token",
      bridge: {
        providerId: "openai-codex",
        displayName: "OpenAI",
        requiresCredentialBinding: true,
      },
    });
  });

  test("keeps only the current public OpenCode Zen models", () => {
    expect(openCodeZenPublicModels()).toEqual(OPENCODE_ZEN_PUBLIC_MODELS);
    expect([
      "big-pickle",
      "hy3-free",
      "mimo-v2.5-free",
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "x-preview-f-free",
    ].every(isOpenCodeZenPublicModel)).toBe(true);
    expect([
      "deepseek-v4-flash-free",
      "laguna-s-2.1-free",
      "ling-3.0-flash-free",
      "muse-spark-1.2-contributor-free",
      "north-mini-code-free",
    ].some(isOpenCodeZenPublicModel)).toBe(false);
    expect(openCodeZenPublicModelName("x-preview-f-free")).toBe("Ox Alpha Free");
  });

  test("parses and refreshes the persisted OpenCode Codex OAuth credential", async () => {
    const credential = openAiCodexOAuthCredential({
      type: "oauth",
      access: "old-access",
      refresh: "refresh-secret",
      expires: 1_800_000_000,
      accountId: "account-1",
    });
    expect(credential).toMatchObject({
      access: "old-access",
      refresh: "refresh-secret",
      expires: 1_800_000_000_000,
    });
    expect(credential).not.toBeNull();

    const requests: RequestInit[] = [];
    const refreshed = await refreshOpenAiCodexOAuthCredential(credential!, {
      now: 2_000_000,
      fetcher: (async (_input, init) => {
        requests.push(init ?? {});
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3_600,
        });
      }) as typeof fetch,
    });
    expect(refreshed).toEqual({
      type: "oauth",
      access: "new-access",
      refresh: "new-refresh",
      expires: 5_600_000,
      accountId: "account-1",
    });
    expect(String(requests[0]?.body)).toContain("grant_type=refresh_token");
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("imports the freshest official Codex login into the shared account credential", () => {
    const officialAccess = accessToken(2_000, 4_000);
    const official = officialCodexOAuthCredential({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: officialAccess,
        refresh_token: "official-refresh",
        account_id: "account-official",
      },
      last_refresh: "2026-08-25T02:56:59.807Z",
    });
    const account = openAiCodexOAuthCredential({
      type: "oauth",
      access: accessToken(1_000, 1_500),
      refresh: "account-refresh",
      expires: 1_500,
      accountId: "account-stale",
    });
    expect(official).not.toBeNull();
    expect(account).not.toBeNull();

    expect(official).toEqual({
      type: "oauth",
      access: officialAccess,
      refresh: "official-refresh",
      expires: 4_000_000,
      accountId: "account-official",
    });
    expect(orderOpenAiCodexOAuthCredentials({ account: account!, officialCodex: official! }))
      .toEqual([
        { source: "official-codex", credential: official! },
        { source: "account", credential: account! },
      ]);
  });

  test("can restrict OAuth candidates to the iPolloWork account vault", () => {
    const account = openAiCodexOAuthCredential({
      type: "oauth",
      access: "account-access",
      refresh: "account-refresh",
      expires: 4_000,
    });
    const official = openAiCodexOAuthCredential({
      type: "oauth",
      access: "official-access",
      refresh: "official-refresh",
      expires: 5_000,
    });
    expect(account).not.toBeNull();
    expect(official).not.toBeNull();

    expect(orderOpenAiCodexOAuthCredentials({
      account: account!,
      officialCodex: official!,
    }, {
      allowOfficialCodexFallback: false,
    })).toEqual([{ source: "account", credential: account! }]);
  });

  test("resolves the same official Codex auth store on Windows and macOS homes", () => {
    expect(resolveOfficialCodexAuthPath({ homeDir: "C:/Users/Ada" }))
      .toBe(join("C:/Users/Ada", ".codex", "auth.json"));
    expect(resolveOfficialCodexAuthPath({ codexHome: "/Users/ada/.codex" }))
      .toBe(join("/Users/ada/.codex", "auth.json"));
  });

  test("refreshes a shared Codex OAuth token halfway through its advertised lifetime", () => {
    const credential = openAiCodexOAuthCredential({
      type: "oauth",
      access: accessToken(1_000, 2_000),
      refresh: "refresh-secret",
      expires: 2_000,
    });
    expect(credential).not.toBeNull();
    expect(openAiCodexOAuthCredentialNeedsRefresh(credential!, 1_499_000)).toBe(false);
    expect(openAiCodexOAuthCredentialNeedsRefresh(credential!, 1_500_000)).toBe(true);
  });

  test("keeps opaque OAuth tokens on their explicit expiry schedule", () => {
    const credential = openAiCodexOAuthCredential({
      type: "oauth",
      access: "opaque-access-token",
      refresh: "refresh-secret",
      expires: 2_000,
    });
    expect(credential).not.toBeNull();
    expect(openAiCodexOAuthCredentialNeedsRefresh(credential!, 1_000_000)).toBe(false);
    expect(openAiCodexOAuthCredentialNeedsRefresh(credential!, 1_940_000)).toBe(true);
  });

  test("keeps the Zen bridge when the user replaces the public key with an account key", () => {
    expect(deepSeekHarnessProviderCredentials([{
      key: sharedProviderCredentialEnvKey("opencode"),
      value: "zen-account-key",
    }]).get("opencode")).toEqual({
      apiKey: "zen-account-key",
      bridge: {
        providerId: "opencode",
        displayName: "iPolloWork Built-in Models",
        api: "openai-completions",
        baseURL: "https://opencode.ai/zen/v1",
        models: OPENCODE_ZEN_PUBLIC_MODELS,
      },
    });
  });

  test("bridges an explicitly shared Alibaba credential into a callable DSH provider", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: sharedProviderCredentialEnvKey("alibaba-cn"), value: " dashscope-key " },
    ])].find(([providerId]) => providerId === "alibaba-cn")).toEqual([
      "alibaba-cn",
      {
        apiKey: "dashscope-key",
        bridge: {
          providerId: "alibaba-cn",
          displayName: "Qwen / Alibaba Cloud",
          api: "openai-completions",
          baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          discoverModels: true,
        },
      },
    ]);
  });

  test("preserves the shared Alibaba provider id while ignoring ambient DashScope", () => {
    expect(deepSeekHarnessProviderCredentials([
      { key: "DASHSCOPE_API_KEY", value: "ambient-key" },
      { key: sharedProviderCredentialEnvKey("alibaba"), value: "shared-key" },
    ]).get("alibaba")?.apiKey).toBe("shared-key");
  });

  test("bridges an engine-neutral compatible provider profile", () => {
    const providerId = "acme-gateway";
    expect([...deepSeekHarnessProviderCredentials([
      { key: sharedProviderCredentialEnvKey(providerId), value: "acme-key" },
      {
        key: sharedProviderProfileEnvKey(providerId),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId,
          displayName: "Acme Gateway",
          api: "openai-completions",
          baseURL: "https://gateway.acme.example/v1",
          models: [{ id: "acme-large", name: "Acme Large" }],
        }),
      },
    ])].find(([candidate]) => candidate === providerId)).toEqual([
      providerId,
      {
        apiKey: "acme-key",
        bridge: {
          providerId,
          displayName: "Acme Gateway",
          api: "openai-completions",
          baseURL: "https://gateway.acme.example/v1",
          models: [{ id: "acme-large", name: "Acme Large" }],
        },
      },
    ]);
  });

  test("ignores a profile whose encoded provider id does not match", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: sharedProviderCredentialEnvKey("acme"), value: "acme-key" },
      {
        key: sharedProviderProfileEnvKey("other"),
        value: serializeSharedProviderProfile({
          schemaVersion: 1,
          providerId: "acme",
          displayName: "Acme",
          api: "openai-completions",
          baseURL: "https://gateway.acme.example/v1",
          models: [{ id: "acme-large" }],
        }),
      },
    ])].find(([providerId]) => providerId === "acme")).toEqual([
      "acme",
      { apiKey: "acme-key" },
    ]);
  });

  test("maps the shared Kimi API channel to DSH's equivalent provider id", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: sharedProviderCredentialEnvKey("kimi-for-coding"), value: " kimi-api-key " },
    ])].find(([providerId]) => providerId === "kimi-coding")).toEqual([
      "kimi-coding",
      { apiKey: "kimi-api-key", bridge: undefined },
    ]);
  });

  test("projects OpenAI-compatible provider profiles without credentials", () => {
    expect([...deepSeekHarnessCompatibleProviderProfiles({
      tokenstar: {
        npm: "@ai-sdk/openai-compatible",
        name: "TokenStar",
        options: { baseURL: "https://api.tokenstar.io/v1/" },
        models: {
          "gpt-5.6-sol": {
            name: "GPT 5.6 Sol",
            limit: { context: 262_144, output: 32_768 },
            modalities: { input: ["text", "image", "video"] },
          },
        },
      },
    })]).toEqual([[
      "tokenstar",
      {
        providerId: "tokenstar",
        displayName: "TokenStar",
        api: "openai-completions",
        baseURL: "https://api.tokenstar.io/v1",
        models: [{
          id: "gpt-5.6-sol",
          name: "GPT 5.6 Sol",
          contextWindow: 262_144,
          maxTokens: 32_768,
          input: ["text", "image"],
        }],
      },
    ]]);
  });

  test("maps Anthropic-compatible channels and rejects incomplete profiles", () => {
    const profiles = deepSeekHarnessCompatibleProviderProfiles({
      minimax: {
        npm: "@ai-sdk/anthropic",
        name: "MiniMax",
        api: "https://api.minimax.io/anthropic",
        models: { "MiniMax-M3": { name: "MiniMax-M3" } },
      },
      incomplete: {
        npm: "@ai-sdk/openai-compatible",
        name: "Incomplete",
        models: { model: { name: "Model" } },
      },
      "Invalid Provider": {
        options: { baseURL: "https://example.com/v1" },
        models: { model: { name: "Model" } },
      },
    });

    expect(profiles.get("minimax")).toEqual({
      providerId: "minimax",
      displayName: "MiniMax",
      api: "anthropic-messages",
      baseURL: "https://api.minimax.io/anthropic",
      models: [{ id: "MiniMax-M3", name: "MiniMax-M3" }],
    });
    expect(profiles.has("incomplete")).toBe(false);
    expect(profiles.has("Invalid Provider")).toBe(false);
  });
});
