import { describe, expect, test } from "bun:test";
import {
  serializeSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderProfileEnvKey,
} from "@ipollowork/types/provider-credentials";

import {
  deepSeekHarnessProviderCredentials,
  deepSeekHarnessWebArgs,
  sharedProviderApiCredentials,
} from "./deepseek-harness-runtime.js";

describe("DeepSeek Harness provider credential sync", () => {
  test("places launcher patch options before web-app options", () => {
    expect(deepSeekHarnessWebArgs("", "C:/runtime/plugins.patch.yml")).toEqual([
      "web",
      "--patch",
      "C:/runtime/plugins.patch.yml",
      "--port",
      "0",
    ]);
    expect(deepSeekHarnessWebArgs("C:/runtime/dsh.js", "C:/runtime/plugins.patch.yml")).toEqual([
      "C:/runtime/dsh.js",
      "web",
      "--patch",
      "C:/runtime/plugins.patch.yml",
      "--port",
      "0",
    ]);
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
    ])]).toEqual([[
      "opencode",
      {
        apiKey: "public",
        bridge: {
          providerId: "opencode",
          displayName: "iPolloWork Built-in Models",
          api: "openai-completions",
          baseURL: "https://opencode.ai/zen/v1",
          discoverModels: true,
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
        discoverModels: true,
      },
    });
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
        discoverModels: true,
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
});
