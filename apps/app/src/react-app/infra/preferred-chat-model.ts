import type { ModelRef } from "../../app/types";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

export type ChatModelStatus = "ready" | "loading" | "error" | "unavailable";

export function resolveChatModelStatus(input: {
  hasModel: boolean;
  catalogLoaded: boolean;
  fetching: boolean;
  error: unknown;
}): ChatModelStatus {
  if (!input.catalogLoaded) return input.error && !input.fetching ? "error" : "loading";
  return input.hasModel ? "ready" : "unavailable";
}

export type SelectableChatModelSnapshot = Array<{
  providerID: string;
  modelIDs: string[];
  freeModelIDs?: string[];
}>;

/**
 * Preserve every available selection, including the built-in OpenCode Zen
 * default. Only replace a stale selection that the provider list no longer
 * exposes, preferring a user-connected provider for that recovery path.
 */
export function resolvePreferredSelectableChatModel(input: {
  providers: SelectableChatModelSnapshot;
  defaults?: Record<string, string>;
  current: ModelRef | null | undefined;
}): ModelRef | null {
  const currentAvailable = Boolean(
    input.current &&
    input.providers.some(
      (provider) =>
        provider.providerID === input.current?.providerID &&
        provider.modelIDs.includes(input.current.modelID),
    ),
  );
  if (currentAvailable) return input.current ?? null;

  for (const provider of input.providers) {
    if (provider.providerID === "opencode" || provider.modelIDs.length === 0) continue;
    const preferredModel = input.defaults?.[provider.providerID];
    const modelID =
      preferredModel && provider.modelIDs.includes(preferredModel)
        ? preferredModel
        : provider.modelIDs[0];
    if (modelID) return { providerID: provider.providerID, modelID };
  }

  return currentAvailable ? (input.current ?? null) : null;
}

/**
 * Resolve the model an engine can execute without changing the app-wide
 * preference. OpenCode defaults to its live free models; a paid shared choice
 * inherited from another engine is not consent to use that route in OpenCode.
 * An available choice made in this engine remains authoritative.
 */
export function resolveEngineSelectableChatModel(input: {
  engineId?: string | null;
  providers: SelectableChatModelSnapshot;
  defaults?: Record<string, string>;
  preferred: ModelRef | null | undefined;
  selectedForEngine?: ModelRef | null;
}): ModelRef | null {
  const isOpenCode = (input.engineId?.trim() || DEFAULT_ENGINE_ID) === DEFAULT_ENGINE_ID;
  const provider = input.providers.find((provider) => provider.providerID === "opencode");
  const freeModels = provider?.freeModelIDs?.filter((id) => provider.modelIDs.includes(id)) ?? [];
  const current = input.selectedForEngine ?? (isOpenCode
    ? input.preferred?.providerID === "opencode" && freeModels.includes(input.preferred.modelID)
      ? input.preferred
      : null
    : input.preferred);
  if (current && input.providers.some((provider) => (
    provider.providerID === current.providerID && provider.modelIDs.includes(current.modelID)
  ))) return current;

  if (isOpenCode) {
    const defaultModel = input.defaults?.opencode;
    const modelID = defaultModel && freeModels.includes(defaultModel) ? defaultModel : freeModels[0];
    return modelID ? { providerID: "opencode", modelID } : null;
  }

  const preferred = resolvePreferredSelectableChatModel({
    providers: input.providers,
    defaults: input.defaults,
    current,
  });
  if (preferred) return preferred;

  for (const provider of input.providers) {
    const defaultModel = input.defaults?.[provider.providerID];
    const modelID = defaultModel && provider.modelIDs.includes(defaultModel)
      ? defaultModel
      : provider.modelIDs[0];
    if (modelID) return { providerID: provider.providerID, modelID };
  }

  return null;
}
