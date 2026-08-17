import { describe, expect, test } from "bun:test";
import { sharedProviderCredentialEnvKey } from "@ipollowork/types/provider-credentials";

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

  test("uses an explicitly shared Alibaba key while ignoring ambient DashScope", () => {
    expect(deepSeekHarnessProviderCredentials([
      { key: "DASHSCOPE_API_KEY", value: "ambient-key" },
      { key: sharedProviderCredentialEnvKey("alibaba"), value: "shared-key" },
    ]).get("alibaba-cn")?.apiKey).toBe("shared-key");
  });
});
