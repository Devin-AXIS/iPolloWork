// Model picker modal state: lazy option loading (with "Recently added"
// provider flagging), open-event/localStorage triggers from the new-providers
// toast, and org-restriction filtering. Extracted verbatim from
// session-route.tsx; settings-route carries a sibling copy that should adopt
// this hook next.
import { useEffect, useMemo, useState } from "react";

import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import { filterProviderList } from "@/app/utils/providers";
import type { ModelOption } from "@/app/types";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import {
  getChatModelCatalogEntries,
  projectAccountProviderConnections,
  resolveModelRuntime,
  type ProviderListQueryInput,
  useMergedProviderListQuery,
  useProviderListQuery,
} from "@/react-app/infra/provider-list-query";
import {
  openModelPickerEvent,
  pendingModelPickerProviderIdsKey,
} from "@/react-app/shell/new-providers-listener";
import { t } from "@/i18n";

const EMPTY_PROVIDER_SOURCES: readonly ProviderListQueryInput[] = [];
const EMPTY_PROVIDER_IDS: readonly string[] = [];

export type UseModelPickerInput = {
  client: unknown | null;
  engineId?: string | null;
  baseUrl: string;
  workspaceRoot: string;
  catalogSources?: readonly ProviderListQueryInput[];
  runtimeSource?: ProviderListQueryInput | null;
  connectedProviderIds?: readonly string[];
  disabledProviderIds?: readonly string[];
  /** Optional: surface option-load failures (settings shows a toast; the session route stays silent). */
  onLoadError?: (error: unknown) => void;
};

export function useModelPicker(input: UseModelPickerInput) {
  const {
    client,
    engineId,
    baseUrl,
    workspaceRoot,
    catalogSources = EMPTY_PROVIDER_SOURCES,
    runtimeSource = null,
    connectedProviderIds = EMPTY_PROVIDER_IDS,
    disabledProviderIds = EMPTY_PROVIDER_IDS,
    onLoadError,
  } = input;
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const [open, setOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  // The account catalog is the immediate selection source. Runtime discovery
  // refines known failures in the background, but it must never make an
  // already configured account model wait behind an engine cold start.
  const activeSource = useMemo<ProviderListQueryInput | null>(() => client ? ({
    client,
    engineId,
    baseUrl,
    directory: workspaceRoot || undefined,
  }) : null, [baseUrl, client, engineId, workspaceRoot]);
  const catalogQuerySources = catalogSources.length
    ? catalogSources
    : activeSource
      ? [activeSource]
      : EMPTY_PROVIDER_SOURCES;
  const resolvedRuntimeSource = runtimeSource ?? activeSource;
  const pickerOpen = open || compactOpen;
  const catalogQuery = useMergedProviderListQuery({
    sources: catalogQuerySources,
    enabled: pickerOpen && catalogQuerySources.length > 0,
  });
  const runtimeQuery = useProviderListQuery({
    client: resolvedRuntimeSource?.client ?? null,
    engineId: resolvedRuntimeSource?.engineId,
    baseUrl: resolvedRuntimeSource?.baseUrl,
    directory: resolvedRuntimeSource?.directory,
    enabled: pickerOpen && Boolean(resolvedRuntimeSource?.client),
  });
  useEffect(() => {
    // Runtime discovery is advisory while the account catalog is available.
    // Prompt delivery still reports a real runtime failure at the send
    // boundary; opening the picker should not emit a cold-start error toast.
    const error = catalogQuery.error ?? (catalogQuery.data ? null : runtimeQuery.error);
    if (error) onLoadError?.(error);
  }, [catalogQuery.data, catalogQuery.error, onLoadError, runtimeQuery.error]);

  const modelOptions = useMemo(() => {
    const data = catalogQuery.data;
    if (!data) return [];
    const accountData = filterProviderList(
      projectAccountProviderConnections(data, connectedProviderIds) ?? data,
      [...disabledProviderIds],
    );
    let seenIds: Set<string>;
    try {
      const raw = window.localStorage.getItem("ipollowork.seenProviderIds");
      seenIds = new Set(raw ? JSON.parse(raw) : []);
    } catch {
      seenIds = new Set();
    }
    // The account catalog owns selection. Runtime discovery only enriches
    // capability metadata; it must never hide or lock an account model while
    // a sidecar is cold-starting or has not projected credentials yet.
    const entries = getChatModelCatalogEntries(accountData).map((entry) => ({
      ...entry,
      runtime: runtimeQuery.data
        ? resolveModelRuntime(
            runtimeQuery.data,
            { providerID: entry.provider.id, modelID: entry.modelId },
            engineId,
          )
        : null,
    }));
    return entries.map(({ provider, modelId, model, runtime }): ModelOption => {
      const runtimePending = runtime === null;
      return {
        providerID: provider.id,
        modelID: modelId,
        title: model.name || modelId,
        description: provider.name,
        behaviorTitle: t("model_behavior.title_reasoning_effort"),
        behaviorLabel: t("settings.provider_default_label"),
        behaviorDescription: "",
        behaviorValue: null,
        isFree: provider.id.trim().toLowerCase() === "opencode",
        isConnected: true,
        runtimePending,
        disabled: false,
        footer: undefined,
        isRecommended: !seenIds.has(provider.id) || recentProviderIds.has(provider.id),
        supportsVision: runtime?.capabilities?.vision === true
          || model.capabilities.input?.image === true,
        source: /^lpr_/i.test(provider.id) ? "cloud" : undefined,
      };
    });
  }, [catalogQuery.data, connectedProviderIds, disabledProviderIds, engineId, recentProviderIds, runtimeQuery.data]);

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
      if (restrictToCloud && !option.isConnected && !option.runtimePending) {
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
