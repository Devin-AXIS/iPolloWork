export const OFFCN_PROVIDER = {
  providerId: "offcn",
  name: "Offcn",
  api: "anthropic-messages" as const,
  baseURL: "https://oneapi.eoffcn.com",
  npm: "@ai-sdk/anthropic",
  models: {
    "deepseek-v4-pro-260425": {
      name: "DeepSeek V4 Pro",
      attachment: true,
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      // Conservative client budgets; the gateway controls the actual limits.
      limit: { context: 128_000, output: 8_192 },
    },
  },
};
