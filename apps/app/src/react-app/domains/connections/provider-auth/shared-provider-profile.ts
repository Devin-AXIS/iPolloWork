import {
  serializeSharedProviderProfile,
  sharedProviderCredentialEnvKey,
  sharedProviderProfileEnvKey,
  type SharedProviderProfile,
} from "@ipollowork/types/provider-credentials";

type SharedProviderModel = { name?: string };

export type SharedProviderProfileInput = {
  providerId: string;
  displayName: string;
  api?: string;
  npm?: string;
  baseURL?: string;
  models: Readonly<Record<string, SharedProviderModel>>;
};

export function sharedProviderModels(
  models: Readonly<Record<string, SharedProviderModel>>,
): SharedProviderProfile["models"] {
  return Object.entries(models).map(([id, model]) => ({
    id,
    ...(model.name?.trim() ? { name: model.name.trim() } : {}),
  }));
}

/**
 * Build the engine-neutral description consumed by every agent adapter.
 * Provider SDK details stay optional; OpenAI-compatible endpoints are the
 * portable fallback when a future engine has no native provider binding.
 */
export function buildSharedProviderProfile(
  input: SharedProviderProfileInput,
): SharedProviderProfile {
  const configuredApi = input.api?.trim() ?? "";
  const explicitBaseURL = input.baseURL?.trim() ?? "";
  const baseURL = (/^https?:\/\//i.test(configuredApi) ? configuredApi : "") || explicitBaseURL;
  const npm = input.npm?.trim().toLowerCase() ?? "";
  const configuredProtocol = configuredApi === "openai-completions"
    || configuredApi === "openai-responses"
    || configuredApi === "anthropic-messages"
    ? configuredApi
    : null;
  const api = configuredProtocol
    ?? (npm.includes("anthropic") ? "anthropic-messages" : baseURL ? "openai-completions" : null);

  return {
    schemaVersion: 1,
    providerId: input.providerId,
    displayName: input.displayName.trim() || input.providerId,
    ...(api ? { api } : {}),
    ...(baseURL ? { baseURL } : {}),
    models: sharedProviderModels(input.models),
  };
}

export function sharedProviderConnectionEnvEntries(input: {
  apiKey: string;
  profile: SharedProviderProfile;
}): Array<{ key: string; value: string }> {
  return [
    {
      key: sharedProviderCredentialEnvKey(input.profile.providerId),
      value: input.apiKey,
    },
    {
      key: sharedProviderProfileEnvKey(input.profile.providerId),
      value: serializeSharedProviderProfile(input.profile),
    },
  ];
}
