import type { ModelRef } from "../../app/types";

export type SelectableChatModelSnapshot = Array<{
  providerID: string;
  modelIDs: string[];
}>;

/**
 * The historical Big Pickle default can be advertised by OpenCode even when
 * no backend route is available, which surfaces as a delayed 401. Prefer a
 * user-connected provider for that implicit default and for stale selections.
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
  const isLegacyImplicitDefault =
    input.current?.providerID === "opencode" && input.current.modelID === "big-pickle";
  if (currentAvailable && !isLegacyImplicitDefault) return input.current ?? null;

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
