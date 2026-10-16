export const DEEPSEEK_OFFICIAL_PROVIDER_ID = "deepseek-official";

const DEEPSEEK_OFFICIAL_MODEL_PROFILES = {
  "deepseek-v4-flash": {
    name: "DeepSeek-V4-Flash",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
  "deepseek-v4-pro": {
    name: "DeepSeek-V4-Pro",
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
} as const;

export function deepSeekOfficialModels(): Array<{
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}> {
  return Object.entries(DEEPSEEK_OFFICIAL_MODEL_PROFILES).map(([id, profile]) => ({
    id,
    ...profile,
  }));
}
