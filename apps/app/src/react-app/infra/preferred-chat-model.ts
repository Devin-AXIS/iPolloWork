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
