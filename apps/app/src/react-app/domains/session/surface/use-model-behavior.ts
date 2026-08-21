// Provider catalog cache + behavior (reasoning/thinking variant) options for
// the active default model — what the composer renders as its variant pill.
// Extracted verbatim from session-route.tsx; the catalog is also consumed by
// the model picker's lazy option loader until that moves into its own hook.
import { useMemo } from "react";

import { getModelBehaviorSummary } from "@/app/lib/model-behavior";
import type { ModelRef, ProviderListItem } from "@/app/types";
import { t } from "@/i18n";
import { tokenStarModelSupportsEffort } from "@/react-app/domains/connections/provider-auth/tokenstar-provider";

type ProviderModel = ProviderListItem["models"][string];

export type ProviderCatalog = Record<string, Record<string, ProviderModel>>;

export function modelSupportsAttachments(
  providerCatalog: ProviderCatalog,
  model: ModelRef | null,
) {
  if (!model) return false;
  return providerCatalog[model.providerID]?.[model.modelID]?.capabilities.attachment === true;
}

const emptyModelBehaviorOptions: { value: string | null; label: string }[] = [];

export type UseModelBehaviorInput = {
  /** Result of useProviderListQuery().data — refreshed by the route. */
  providerList: { all: ProviderListItem[] } | undefined;
  defaultModel: ModelRef | null;
  modelVariant: string | null;
};

export function useModelBehavior(input: UseModelBehaviorInput) {
  const { providerList, defaultModel, modelVariant } = input;
  // This catalog is derived entirely from the query response. Keeping it as
  // state caused a render loop whenever account projection returned a fresh
  // provider-list object (most visible while switching to DSH).
  const providerCatalog = useMemo<ProviderCatalog>(() => {
    const next: ProviderCatalog = {};
    for (const provider of providerList?.all ?? []) {
      next[provider.id] = { ...(provider.models ?? {}) };
    }
    return next;
  }, [providerList]);

  // Compute behavior (reasoning/thinking variant) options for the current
  // default model.
  const { modelVariantLabel, modelBehaviorOptions, modelVariantValue } = useMemo(() => {
    const variant = modelVariant ?? null;
    if (!defaultModel) {
      return {
        modelVariantLabel: t("settings.default_label"),
        modelBehaviorOptions: emptyModelBehaviorOptions,
        modelVariantValue: null,
      };
    }
    const model = providerCatalog[defaultModel.providerID]?.[defaultModel.modelID];
    const tokenStarEffortModel = defaultModel.providerID === "tokenstar" && tokenStarModelSupportsEffort(defaultModel.modelID);
    if (!model) {
      return {
        modelVariantLabel: tokenStarEffortModel ? variant ?? "Medium" : variant ?? t("settings.default_label"),
        modelBehaviorOptions: tokenStarEffortModel
          ? [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]
          : emptyModelBehaviorOptions,
        modelVariantValue: tokenStarEffortModel ? variant ?? "medium" : variant,
      };
    }
    const summary = getModelBehaviorSummary(defaultModel.providerID, model, variant);
    return {
      modelVariantLabel: summary.label,
      modelBehaviorOptions: summary.options,
      modelVariantValue: summary.value,
    };
  }, [defaultModel, modelVariant, providerCatalog]);

  return { providerCatalog, modelVariantLabel, modelBehaviorOptions, modelVariantValue };
}
