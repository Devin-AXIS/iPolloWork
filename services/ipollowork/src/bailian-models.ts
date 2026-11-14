/** Current Alibaba-hosted and third-party chat presets, priced for Beijing pay-as-you-go. */
import { rateSchema, type ModelRate } from "./pricing.js";
import type { ServiceModel } from "./model-catalog.js";

function chat(id: string, name: string, vendor: string, input: number, output: number, cached: number, contextWindow = 1000000, extra: Partial<ModelRate> = {}) {
  return {
    model: { id, name, vendor, category: "language", recommended: true, enabled: true, contextWindow, maxTokens: 8192 } satisfies ServiceModel,
    rate: rateSchema.parse({ model: id, unit: "token", inputPerMillion: input * 1000000, outputPerMillion: output * 1000000, cachedInputPerMillion: cached * 1000000, maxInputTokens: contextWindow, maxOutputTokens: 8192, ...extra }),
  };
}

/** Reviewed primary versions; historical snapshots remain available through directory sync. */
export const bailianChatPresets = [
  chat("qwen3.8-flash", "千问 3.8 Flash", "qwen", .8, 2.7, .1, 1000000, { cacheWritePerMillion: 1250000 }),
  chat("qwen3.8-max", "千问 3.8 Max", "qwen", 12, 36, 1.5, 1000000, { cacheWritePerMillion: 15000000 }),
  chat("qwen3.7-plus", "千问 3.7 Plus", "qwen", 6, 24, 1.2, 1000000, {
    cacheWritePerMillion: 7500000,
    tiers: rateSchema.shape.tiers.parse([
      { upToInputTokens: 256000, inputPerMillion: 2000000, outputPerMillion: 8000000, cachedInputPerMillion: 400000, cacheWritePerMillion: 2500000 },
      { upToInputTokens: 1000000, inputPerMillion: 6000000, outputPerMillion: 24000000, cachedInputPerMillion: 1200000, cacheWritePerMillion: 7500000 },
    ]),
  }),
  chat("deepseek-v4.1-flash", "DeepSeek V4.1 Flash", "deepseek", 2, 8, .04),
  chat("deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek", 12, 24, 1),
  chat("MiniMax/MiniMax-M3.1-Flash", "MiniMax M3.1 Flash", "mini-max", 1, 4, .1),
  chat("MiniMax/MiniMax-M3", "MiniMax M3", "mini-max", 4.2, 16.8, .84, 1048576),
  chat("kimi-k3.1-pro", "Kimi K3.1 Pro", "moonshot-ai", 13, 68, 1.3, 1048576),
  chat("glm-5.3", "GLM 5.3", "zhipu-ai", 8, 28, 2, 1048576),
  chat("xiaomi/mimo-v2.6-pro-ultraspeed", "MiMo V2.6 Pro UltraSpeed", "xiaomi", 30, 60, .25, 1048576, { audioInputPerMillion: 30000000, cachedAudioInputPerMillion: 250000 }),
];
