export type MiniMaxEndpointId =
  | "global-openai"
  | "global-anthropic"
  | "cn-openai"
  | "cn-anthropic";

type MiniMaxModelPreset = {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  pricingNote: string;
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
      id: "MiniMax-M3.1-Flash",
      contextWindow: 1_000_000,
      maxOutputTokens: 524_288,
      pricingNote: "USD per million tokens; cache-write pricing is not published.",
      pricingUsdPerMillionTokens: {
        input: 0.15,
        output: 0.6,
        cacheRead: 0.015,
        cacheWrite: null,
      },
      inputModalities: ["text", "image", "video"],
      thinking: ["adaptive"],
    },
    {
      id: "MiniMax-M3",
      contextWindow: 1_000_000,
      maxOutputTokens: 524_288,
      // OpenCode's flat cost schema cannot represent the request-size pricing tiers.
      pricingNote: "Standard pricing for input <=512k; above 512k: $0.60 input, $2.40 output, $0.12 cache read per million tokens. Priority costs 1.5x. Cache-write pricing is not published.",
      pricingUsdPerMillionTokens: {
        input: 0.3,
        output: 1.2,
        cacheRead: 0.06,
        cacheWrite: null,
      },
      inputModalities: ["text", "image", "video"],
      thinking: ["adaptive", "disabled"],
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

export function buildMiniMaxProviderConfig(endpointId: MiniMaxEndpointId) {
  const endpoint = getMiniMaxEndpoint(endpointId);
  const models = Object.fromEntries(
    MINIMAX_PROVIDER.models.map((model) => {
      const flash = model.id === "MiniMax-M3.1-Flash";
      const effortOptions = (effort: string) => endpoint.protocol === "anthropic"
        ? { thinking: { type: "adaptive" }, effort }
        : { thinking: { type: "adaptive" }, reasoningEffort: effort };
      const modelConfig = {
        id: model.id,
        name: model.id,
        attachment: model.inputModalities.some((modality) => modality !== "text"),
        reasoning: model.thinking.length > 0,
        limit: { context: model.contextWindow, output: model.maxOutputTokens },
        options: flash
          ? effortOptions("max")
          : { thinking: { type: endpoint.protocol === "anthropic" ? "disabled" : "adaptive" } },
        variants: flash
          ? {
              // Override OpenCode's inherited M3 variants: Flash cannot disable thinking.
              none: { disabled: true },
              thinking: { disabled: true },
              ...Object.fromEntries(["low", "medium", "high", "xhigh", "max"].map(
                (effort) => [effort, effortOptions(effort)],
              )),
            }
          : {
              none: { thinking: { type: "disabled" } },
              thinking: { thinking: { type: "adaptive" } },
            },
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
