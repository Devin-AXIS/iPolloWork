import type { ProviderConfig } from "@opencode-ai/sdk/v2/client";

export type MiniMaxEndpointId =
  | "global-openai"
  | "global-anthropic"
  | "cn-openai"
  | "cn-anthropic";

type MiniMaxModelPreset = {
  id: string;
  contextWindow: number;
  pricingUsdPerMillionTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number | null;
  };
  inputModalities: readonly ("text" | "image" | "video")[];
  thinking: readonly string[];
};

type MiniMaxEndpoint = {
  id: MiniMaxEndpointId;
  label: string;
  region: "global_en" | "cn_zh";
  protocol: "openai" | "anthropic";
  npm: string;
  baseURL: string;
};

export const MINIMAX_PROVIDER = {
  providerId: "minimax",
  name: "MiniMax",
  models: [
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
  ] satisfies readonly MiniMaxModelPreset[],
} as const;

export const MINIMAX_ENDPOINTS: readonly MiniMaxEndpoint[] = [
  {
    id: "global-openai",
    label: "Global - OpenAI-compatible",
    region: "global_en",
    protocol: "openai",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://api.minimax.io/v1",
  },
  {
    id: "global-anthropic",
    label: "Global - Anthropic",
    region: "global_en",
    protocol: "anthropic",
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.minimax.io/anthropic",
  },
  {
    id: "cn-openai",
    label: "China - OpenAI-compatible",
    region: "cn_zh",
    protocol: "openai",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://api.minimaxi.com/v1",
  },
  {
    id: "cn-anthropic",
    label: "China - Anthropic",
    region: "cn_zh",
    protocol: "anthropic",
    npm: "@ai-sdk/anthropic",
    baseURL: "https://api.minimaxi.com/anthropic",
  },
];

export function getMiniMaxEndpoint(endpointId: MiniMaxEndpointId): MiniMaxEndpoint {
  const endpoint = MINIMAX_ENDPOINTS.find((candidate) => candidate.id === endpointId);
  if (!endpoint) throw new Error(`Unknown MiniMax endpoint: ${endpointId}`);
  return endpoint;
}

export function buildMiniMaxProviderConfig(endpointId: MiniMaxEndpointId): ProviderConfig {
  const endpoint = getMiniMaxEndpoint(endpointId);
  const models = Object.fromEntries(
    MINIMAX_PROVIDER.models.map((model) => {
      const modelConfig: NonNullable<ProviderConfig["models"]>[string] = {
        id: model.id,
        name: model.id,
        attachment: model.inputModalities.some((modality) => modality !== "text"),
        reasoning: model.thinking.length > 0,
        cost: {
          input: model.pricingUsdPerMillionTokens.input,
          output: model.pricingUsdPerMillionTokens.output,
          cache_read: model.pricingUsdPerMillionTokens.cacheRead,
          ...(model.pricingUsdPerMillionTokens.cacheWrite === null
            ? {}
            : { cache_write: model.pricingUsdPerMillionTokens.cacheWrite }),
        },
        modalities: { input: [...model.inputModalities] },
      };
      return [model.id, modelConfig];
    }),
  );

  return {
    id: MINIMAX_PROVIDER.providerId,
    name: MINIMAX_PROVIDER.name,
    npm: endpoint.npm,
    api: endpoint.baseURL,
    models,
  };
}
