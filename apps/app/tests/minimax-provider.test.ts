import { describe, expect, test } from "bun:test";

import { isRecommendedModel } from "../src/app/defaults/models";
import { BUILT_IN_IPOLLOWORK_EXTENSION_MANIFESTS } from "../src/app/extensions";
import {
  buildMiniMaxProviderConfig,
  buildMiniMaxRuntimeEnv,
  MINIMAX_ENDPOINTS,
  MINIMAX_PROVIDER,
} from "../src/react-app/domains/settings/minimax-provider";

describe("MiniMax provider preset", () => {
  test("keeps the supplied regional OpenAI and Anthropic endpoints", () => {
    expect(
      MINIMAX_ENDPOINTS.map(({ id, region, protocol, baseURL }) => ({
        id,
        region,
        protocol,
        baseURL,
      })),
    ).toEqual([
      {
        id: "global-openai",
        region: "global_en",
        protocol: "openai",
        baseURL: "https://api.minimax.io/v1",
      },
      {
        id: "global-anthropic",
        region: "global_en",
        protocol: "anthropic",
        baseURL: "https://api.minimax.io/anthropic",
      },
      {
        id: "cn-openai",
        region: "cn_zh",
        protocol: "openai",
        baseURL: "https://api.minimaxi.com/v1",
      },
      {
        id: "cn-anthropic",
        region: "cn_zh",
        protocol: "anthropic",
        baseURL: "https://api.minimaxi.com/anthropic",
      },
    ]);
  });

  test("keeps both current model fact sets without inventing an output limit", () => {
    expect(MINIMAX_PROVIDER.models).toEqual([
      {
        id: "MiniMax-M3",
        contextWindow: 1_000_000,
        pricingUsdPerMillionTokens: {
          input: 0.6,
          output: 2.4,
          cacheRead: 0.12,
          cacheWrite: null,
        },
        inputModalities: ["text", "image", "video"],
        thinking: ["adaptive", "disabled"],
      },
      {
        id: "MiniMax-M2.7",
        contextWindow: 204_800,
        pricingUsdPerMillionTokens: {
          input: 0.3,
          output: 1.2,
          cacheRead: 0.06,
          cacheWrite: 0.375,
        },
        inputModalities: ["text"],
        thinking: ["always_on"],
      },
    ]);

    const models = buildMiniMaxProviderConfig("global-openai").models;
    expect(models?.["MiniMax-M3"]).toMatchObject({
      attachment: true,
      reasoning: true,
      cost: { input: 0.6, output: 2.4, cache_read: 0.12 },
      modalities: { input: ["text", "image", "video"] },
    });
    expect(models?.["MiniMax-M3"]?.cost).not.toHaveProperty("cache_write");
    expect(models?.["MiniMax-M3"]).not.toHaveProperty("limit");
    expect(models?.["MiniMax-M2.7"]).toMatchObject({
      attachment: false,
      reasoning: true,
      cost: {
        input: 0.3,
        output: 1.2,
        cache_read: 0.06,
        cache_write: 0.375,
      },
      modalities: { input: ["text"] },
    });
  });

  test("builds the selected OpenCode provider package and API endpoint", () => {
    expect(buildMiniMaxProviderConfig("global-openai")).toMatchObject({
      id: "minimax",
      name: "MiniMax",
      npm: "@ai-sdk/openai-compatible",
      api: "https://api.minimax.io/v1",
    });
    expect(buildMiniMaxProviderConfig("cn-anthropic")).toMatchObject({
      id: "minimax",
      name: "MiniMax",
      npm: "@ai-sdk/anthropic",
      api: "https://api.minimaxi.com/anthropic",
    });
  });

  test("keeps image credentials server-side on the selected regional origin", () => {
    expect(buildMiniMaxRuntimeEnv("global-openai", "test-key")).toEqual([
      { key: "MINIMAX_API_KEY", value: "test-key" },
      { key: "MINIMAX_BASE_URL", value: "https://api.minimax.io" },
    ]);
    expect(buildMiniMaxRuntimeEnv("cn-anthropic", "test-key")).toEqual([
      { key: "MINIMAX_API_KEY", value: "test-key" },
      { key: "MINIMAX_BASE_URL", value: "https://api.minimaxi.com" },
    ]);
  });

  test("registers the executable extension and recommends both models", () => {
    const extension = BUILT_IN_IPOLLOWORK_EXTENSION_MANIFESTS.find(
      (manifest) => manifest.id === "minimax",
    );
    expect(extension?.resources).toContainEqual({
      type: "provider",
      id: "minimax",
      label: "MiniMax",
      providerId: "minimax",
      required: true,
    });
    expect(extension?.resources).toContainEqual({
      type: "tool",
      id: "minimax-image-generate",
      label: "Image generation",
      required: true,
    });
    expect(extension?.setup?.requiredEnv).toEqual(["MINIMAX_API_KEY"]);
    expect(extension?.contributions).toContainEqual({
      type: "settings-panel",
      ref: "ipollowork.minimax.settings",
      location: "settings-detail",
    });
    expect(isRecommendedModel("MiniMax-M3")).toBe(true);
    expect(isRecommendedModel("MiniMax-M2.7")).toBe(true);
  });
});
