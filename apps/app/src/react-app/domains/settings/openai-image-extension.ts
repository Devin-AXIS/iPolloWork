import type { ProviderConfig } from "@opencode-ai/sdk/v2/client";

export type LocalProviderModelConfig = NonNullable<ProviderConfig["models"]>[string];

export type LocalProviderInstallInput = {
  providerId: string;
  name: string;
  baseURL?: string;
  api?: string;
  npm?: string;
  apiKey?: string;
  modelId: string;
  modelName: string;
  models?: Record<string, LocalProviderModelConfig>;
  userEnv?: Array<{ key: string; value: string }>;
  setDefault: boolean;
};

export const OLLAMA_PROVIDER_CONFIG = {
  providerId: "ollama",
  name: "Ollama (local)",
  baseURL: "http://localhost:11434/v1",
  defaultModelId: "qwen2.5-coder:7b",
};

export const OPENAI_IMAGE_EXTENSION_ID = "openai-image-generation";
export const OPENAI_IMAGE_MODEL = "gpt-image-2";
