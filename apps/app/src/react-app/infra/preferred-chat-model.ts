import type { ModelRef } from "../../app/types";

export type SelectableChatModelSnapshot = Array<{
  providerID: string;
  modelIDs: string[];
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
 * preference. Switching engines must not replace the user's shared model just
 * because one runtime lacks that route; the preferred model becomes active
 * again as soon as the user returns to an engine that supports it.
 */
export function resolveEngineSelectableChatModel(input: {
  providers: SelectableChatModelSnapshot;
  defaults?: Record<string, string>;
  preferred: ModelRef | null | undefined;
}): ModelRef | null {
  const preferred = resolvePreferredSelectableChatModel({
    providers: input.providers,
    defaults: input.defaults,
    current: input.preferred,
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
