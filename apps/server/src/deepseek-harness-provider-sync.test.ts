import { describe, expect, test } from "bun:test";
import { sharedProviderCredentialEnvKey } from "@ipollowork/types/provider-credentials";

import {
  deepSeekHarnessChildEnvironment,
  deepSeekHarnessCompatibleProviderProfiles,
  deepSeekHarnessProviderCredentials,
  sharedProviderApiCredentials,
} from "./deepseek-harness-runtime.js";

describe("DeepSeek Harness provider credential sync", () => {
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

  test("does not turn the media-center DashScope credential into a chat provider", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: "DASHSCOPE_API_KEY", value: " dashscope-key " },
    ])]).toEqual([]);
  });

  test("bridges an explicitly shared Alibaba credential into a callable DSH provider", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: sharedProviderCredentialEnvKey("alibaba-cn"), value: " dashscope-key " },
    ])]).toEqual([[
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
    ]]);
  });

  test("uses an explicitly shared Alibaba key while ignoring ambient DashScope", () => {
    expect(deepSeekHarnessProviderCredentials([
      { key: "DASHSCOPE_API_KEY", value: "ambient-key" },
      { key: sharedProviderCredentialEnvKey("alibaba"), value: "shared-key" },
    ]).get("alibaba-cn")?.apiKey).toBe("shared-key");
  });

  test("maps the shared Kimi API channel to DSH's equivalent provider id", () => {
    expect([...deepSeekHarnessProviderCredentials([
      { key: sharedProviderCredentialEnvKey("kimi-for-coding"), value: " kimi-api-key " },
    ])]).toEqual([[
      "kimi-coding",
      { apiKey: "kimi-api-key", bridge: undefined },
    ]]);
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
