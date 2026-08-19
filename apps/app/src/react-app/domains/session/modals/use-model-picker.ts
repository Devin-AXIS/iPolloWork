// Model picker modal state: lazy option loading (with "Recently added"
// provider flagging), open-event/localStorage triggers from the new-providers
// toast, and org-restriction filtering. Extracted verbatim from
// session-route.tsx; settings-route carries a sibling copy that should adopt
// this hook next.
import { useEffect, useMemo, useState } from "react";

import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import type { ModelOption } from "@/app/types";
import { modelSupportsVision } from "@/app/utils/model-capabilities";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import {
  ensureMergedProviderListQuery,
  ensureProviderListQuery,
  getSelectableChatProviderItems,
  isModelAvailableInConnectedProviders,
  type ProviderListQueryInput,
} from "@/react-app/infra/provider-list-query";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import {
  openModelPickerEvent,
  pendingModelPickerProviderIdsKey,
} from "@/react-app/shell/new-providers-listener";
import { t } from "@/i18n";

export type UseModelPickerInput = {
  client: unknown | null;
  engineId?: string | null;
  baseUrl: string;
  workspaceRoot: string;
  catalogSources?: readonly ProviderListQueryInput[];
  /** Optional: surface option-load failures (settings shows a toast; the session route stays silent). */
  onLoadError?: (error: unknown) => void;
};

export function useModelPicker(input: UseModelPickerInput) {
  const { client, engineId, baseUrl, workspaceRoot, catalogSources = [], onLoadError } = input;
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const [open, setOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  // Provider IDs that were just added — used to highlight them as
  // "Recently added" in the model picker even after they've been
  // marked as seen in localStorage.
  const [recentProviderIds, setRecentProviderIds] = useState<Set<string>>(new Set());

  // Open model picker when the global toast's "Pick a new default?" is clicked
  useEffect(() => {
    const handler = (event: Event) => {
      try {
        window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      } catch {}
      const detail = (event as CustomEvent<{ newProviderIds?: string[]; initialTab?: "default" | "available" }>).detail;
      const ids = detail?.newProviderIds;
      if (ids && ids.length > 0) {
        setRecentProviderIds(new Set(ids));
      }
      setOpen(true);
    };
    window.addEventListener(openModelPickerEvent, handler);
    return () => window.removeEventListener(openModelPickerEvent, handler);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(pendingModelPickerProviderIdsKey);
      if (!raw) return;
      window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      const parsed = JSON.parse(raw);
      const ids = Array.isArray(parsed) ? parsed : parsed?.newProviderIds;
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) {
        setRecentProviderIds(new Set(ids));
      }
      setOpen(true);
    } catch {
      // Ignore malformed pending-picker state.
    }
  }, []);

  // Load the picker list lazily when either presentation opens. The composer
  // uses the compact picker, while settings uses the full modal; both consume
  // the same model options and must work on their first open.
  useEffect(() => {
    if ((!open && !compactOpen) || !client) return;
    let cancelled = false;
    void (async () => {
      try {
        const activeSource = {
          client,
          engineId,
          baseUrl,
          directory: workspaceRoot || undefined,
        } satisfies ProviderListQueryInput;
        const [data, active] = await Promise.all([
          ensureMergedProviderListQuery(
            getReactQueryClient(),
            catalogSources.length ? catalogSources : [activeSource],
          ),
          ensureProviderListQuery(getReactQueryClient(), activeSource),
        ]);
        if (cancelled || !data.all) return;
        // Flag models from recently-added providers so they appear in
        // the "Recently added" section at the top of the picker.
        // Two sources: (1) providers not yet in the localStorage seen-set,
        // (2) providers passed via the openModelPickerEvent from the toast.
        let seenIds: Set<string>;
        try {
          const raw = window.localStorage.getItem("ipollowork.seenProviderIds");
          seenIds = new Set(raw ? JSON.parse(raw) : []);
        } catch {
          seenIds = new Set();
        }
        const options: ModelOption[] = [];
        for (const provider of getSelectableChatProviderItems(data)) {
          const modelIds = Object.keys(provider.models);
          const isNew = !seenIds.has(provider.id) || recentProviderIds.has(provider.id);
          for (const id of modelIds) {
            const model = provider.models[id];
            options.push({
              providerID: provider.id,
              modelID: id,
              title: model.name || id,
              description: provider.name,
              behaviorTitle: t("model_behavior.title_reasoning_effort"),
              behaviorLabel: t("settings.provider_default_label"),
              behaviorDescription: "",
              behaviorValue: null,
              isFree: false,
              isConnected: true,
              disabled: !isModelAvailableInConnectedProviders(active, {
                providerID: provider.id,
                modelID: id,
              }),
              footer: t("model_picker.engine_unavailable"),
              isRecommended: isNew,
              supportsVision: modelSupportsVision(model),
              source: /^lpr_/i.test(provider.id) ? "cloud" as const : undefined,
            });
          }
        }
        setModelOptions(options);
      } catch (error) {
        // Default: silent — the picker surfaces an empty list rather than
        // blocking the UI. Callers can opt into surfacing the failure.
        onLoadError?.(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, compactOpen, baseUrl, catalogSources, client, engineId, recentProviderIds, workspaceRoot]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  const options = useMemo(() => {
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });
    return modelOptions.filter((option) => {
      if (
        isDesktopProviderBlocked({
          providerId: option.providerID,
          checkRestriction: checkDesktopRestriction,
        })
      ) {
        return false;
      }
      if (restrictToCloud && !option.isConnected) {
        return false;
      }
      return true;
    });
  }, [checkDesktopRestriction, modelOptions]);

  return {
    open,
    setOpen,
    compactOpen,
    setCompactOpen,
    query,
    setQuery,
    options,
    setRecentProviderIds,
  };
}
