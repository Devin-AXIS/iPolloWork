import { describe, expect, test } from "bun:test";
import {
  serializeSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";

import {
  deepSeekHarnessProviderCredentials,
  sharedProviderApiCredentials,
} from "./deepseek-harness-runtime.js";

describe("DeepSeek Harness provider credential sync", () => {
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
    ])]).toEqual([[
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
    ]]);
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
    ])]).toEqual([["acme", { apiKey: "acme-key" }]]);
  });
});
