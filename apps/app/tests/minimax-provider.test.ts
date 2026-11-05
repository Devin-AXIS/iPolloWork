import { describe, expect, test } from "bun:test";

import { isRecommendedModel } from "../src/app/defaults/models";
import { BUILT_IN_IPOLLOWORK_EXTENSION_MANIFESTS } from "../src/app/extensions";
import {
  buildMiniMaxProviderConfig,
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

  test("offers Flash first and carries verified limits and baseline prices", () => {
    expect(MINIMAX_PROVIDER.models.map((model) => model.id)).toEqual([
      "MiniMax-M3.1-Flash", "MiniMax-M3",
    ]);
    const models = buildMiniMaxProviderConfig("global-openai").models;
    expect(Object.keys(models)).toEqual(["MiniMax-M3.1-Flash", "MiniMax-M3"]);
    for (const model of Object.values(models)) {
      expect(model).toMatchObject({
        attachment: true,
        reasoning: true,
        limit: { context: 1_000_000, output: 524_288 },
        modalities: { input: ["text", "image", "video"] },
      });
      expect(model.cost).not.toHaveProperty("cache_write");
    }
    expect(models["MiniMax-M3.1-Flash"].cost).toEqual({ input: 0.15, output: 0.6, cache_read: 0.015 });
    expect(models["MiniMax-M3"].cost).toEqual({ input: 0.3, output: 1.2, cache_read: 0.06 });
    expect(MINIMAX_PROVIDER.models[1].pricingNote).toContain("above 512k");
    expect(MINIMAX_PROVIDER.models[1].pricingNote).toContain("1.5x");
  });

  test("maps effort by protocol and suppresses inherited Flash off variants", () => {
    for (const endpoint of MINIMAX_ENDPOINTS) {
      const models = buildMiniMaxProviderConfig(endpoint.id).models;
      const flash = models["MiniMax-M3.1-Flash"];
      const effortField = endpoint.protocol === "anthropic" ? "effort" : "reasoningEffort";
      expect(flash.options).toEqual({ thinking: { type: "adaptive" }, [effortField]: "max" });
      expect(flash.variants.none).toEqual({ disabled: true });
      expect(flash.variants.thinking).toEqual({ disabled: true });
      for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
        expect(flash.variants[effort]).toEqual({ thinking: { type: "adaptive" }, [effortField]: effort });
      }
      expect(models["MiniMax-M3"].options).toEqual({
        thinking: { type: endpoint.protocol === "anthropic" ? "disabled" : "adaptive" },
      });
      expect(models["MiniMax-M3"].variants).toEqual({
        none: { thinking: { type: "disabled" } },
        thinking: { thinking: { type: "adaptive" } },
      });
      expect(JSON.stringify(models)).not.toContain("service_tier");
      expect(JSON.stringify(models)).not.toContain("reasoning_split");
    }
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
    expect(extension?.contributions).toContainEqual({
      type: "settings-panel",
      ref: "ipollowork.minimax.settings",
      location: "settings-detail",
    });
    expect(isRecommendedModel("MiniMax-M3.1-Flash")).toBe(true);
    expect(isRecommendedModel("MiniMax-M3")).toBe(true);
    expect(isRecommendedModel("MiniMax-M2.7")).toBe(false);
  });
});
