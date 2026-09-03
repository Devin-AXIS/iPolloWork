"use client";

import * as React from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import type { ModelOption, ModelRef } from "@/app/types";
import { t } from "@/i18n";
import { ProviderIcon } from "@/react-app/design-system/provider-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWorkspace } from "@/react-app/shell/workspace-provider";
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
  Command,
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { isDesktopProviderBlocked } from "@/app/cloud/desktop-app-restrictions";
import { openModelPickerEvent } from "@/react-app/shell/new-providers-listener";
import { ModelDirectoryLoadingStatus } from "@/components/model-directory-loading-status";

function getProviderDisplayName(providerId: string) {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function useModelOptions(open: boolean) {
  const {
    client,
    engineId,
    modelCatalogSources,
    opencodeBaseUrl,
    connectedProviderIds,
    hiddenProviderIds,
    selectedWorkspaceRoot,
  } = useWorkspace();
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const catalogSources = React.useMemo<readonly ProviderListQueryInput[]>(() => {
    if (modelCatalogSources.length) return modelCatalogSources;
    return client
      ? [{ client, engineId, baseUrl: opencodeBaseUrl, directory: selectedWorkspaceRoot }]
      : [];
  }, [client, engineId, modelCatalogSources, opencodeBaseUrl, selectedWorkspaceRoot]);

  const catalogQuery = useMergedProviderListQuery({
    sources: catalogSources,
    enabled: open && catalogSources.length > 0,
  });

  // This query is prewarmed by SessionRoute and shares the same cache key.
  // It refines known runtime failures in the background; the cached account
  // catalog stays selectable while a cold engine is still starting.
  const runtimeQuery = useProviderListQuery({
    client,
    engineId,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot,
    enabled: Boolean(client),
  });

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  const options = React.useMemo(() => {
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });
    const hidden = new Set(
      hiddenProviderIds.map((providerId) => providerId.trim().toLowerCase()),
    );

    const catalogValue = projectAccountProviderConnections(
      catalogQuery.data,
      connectedProviderIds,
    );
    const entries = getChatModelCatalogEntries(catalogValue).map((entry) => ({
      ...entry,
      runtime: runtimeQuery.data
        ? resolveModelRuntime(
            runtimeQuery.data,
            { providerID: entry.provider.id, modelID: entry.modelId },
            engineId,
          )
        : null,
    }));
    const options = entries.map(({ provider, modelId, model, runtime }) => {
      const runtimePending = runtime === null;
      return {
        providerID: provider.id,
        modelID: modelId,
        title: model.name,
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
        supportsVision: runtime?.capabilities?.vision === true
          || model.capabilities.input?.image === true,
      };
    });

    return options.filter((option) => {
      if (hidden.has(option.providerID.trim().toLowerCase())) return false;
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
  }, [catalogQuery.data, checkDesktopRestriction, connectedProviderIds, engineId, hiddenProviderIds, runtimeQuery.data]);

  return {
    engineId,
    options,
    loading: (catalogQuery.isFetching || runtimeQuery.isFetching) && options.length === 0,
    loadingMore: (catalogQuery.isFetching || runtimeQuery.isFetching) && options.length > 0,
  };
}

type ModelSelectModelItem = {
  kind: "model";
  id: string;
  option: ModelOption;
};

type ModelSelectGroup = {
  value: string;
  items: ModelSelectModelItem[];
};

function groupByProvider(modelOptions: ModelOption[]): ModelSelectGroup[] {
  const groups = new Map<string, ModelSelectModelItem[]>();

  for (const option of modelOptions) {
    const providerLabel = option.description ?? getProviderDisplayName(option.providerID);
    const item: ModelSelectModelItem = {
      kind: "model",
      id: `${option.providerID}:${option.modelID}`,
      option,
    };
    const existing = groups.get(providerLabel);

    if (existing) {
      existing.push(item);
      continue;
    }

    groups.set(providerLabel, [item]);
  }

  return [...groups.entries()]
    .map(([providerLabel, options]) => ({
      value: providerLabel,
      items: [...options].sort((a, b) => a.option.title.localeCompare(b.option.title)),
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function isSameModel(a: ModelRef, b: ModelRef) {
  return a.providerID === b.providerID && a.modelID === b.modelID;
}

interface ModelSelectProps {
  open: boolean;
  value: ModelRef;
  onOpenChange: (open: boolean) => void;
  onChange: (model: ModelRef) => void;
  onConfigureModels?: (providerId?: string) => void;
  onConfigureTokenStar?: () => void;
  disabled?: boolean;
}

export type ModelListContentProps = {
  value: ModelRef;
  onChange: (model: ModelRef) => void;
  onConfigureModels?: (providerId?: string) => void;
  onConfigureTokenStar?: () => void;
  autoFocus?: boolean;
};

export function ModelListContent({
  value,
  onChange,
  onConfigureModels,
  autoFocus = true,
}: ModelListContentProps) {
  const [search, setSearch] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const { engineId, loading, loadingMore, options: modelOptions } = useModelOptions(true);

  React.useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  const groups = React.useMemo(
    () => groupByProvider(modelOptions),
    [modelOptions],
  );

  const handleSelect = (option: ModelOption) => {
    onChange({ providerID: option.providerID, modelID: option.modelID });
    setSearch("");
  };

  return (
    <Command items={groups} value={search} onValueChange={setSearch}>
      <CommandHeader>
        <CommandInput ref={searchInputRef} placeholder={t("model_picker.search_models")} />
        {loadingMore ? (
          <ModelDirectoryLoadingStatus
            className="px-3 pb-1 text-xs"
            engineId={engineId}
            hasModels
          />
        ) : null}
      </CommandHeader>
      <CommandEmpty>
        {loading
          ? (
              <ModelDirectoryLoadingStatus
                className="px-3 py-2 text-xs"
                engineId={engineId}
                hasModels={false}
              />
            )
          : search.trim()
            ? t("model_picker.no_results")
            : t("model_picker.no_models_available")}
      </CommandEmpty>
      <CommandList>
        {(group: ModelSelectGroup) => (
          <CommandGroup key={group.value} items={group.items}>
            <CommandGroupLabel>{group.value}</CommandGroupLabel>
            <CommandCollection>
              {(item: ModelSelectModelItem) => {
                const option = item.option;
                const visionBadgeLabel = option.supportsVision ? t("model_picker.badge_vision") : null;
                return (
                  <CommandItem
                    className="gap-2 data-disabled:opacity-50"
                    key={item.id}
                    value={`${option.providerID}:${option.modelID} ${option.title} ${option.description ?? ""}`}
                    disabled={option.disabled && (option.isConnected || !onConfigureModels)}
                    onClick={() => {
                      if (option.disabled && !option.isConnected) {
                        setSearch("");
                        onConfigureModels?.(option.providerID);
                        return;
                      }
                      if (option.disabled) return;
                      handleSelect(option);
                    }}
                    data-checked={isSameModel(value, option)}
                  >
                    <ProviderIcon providerId={option.providerID} providerName={option.description} className="size-3.5 opacity-70" size={14} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-foreground">{option.title}</span>
                        {visionBadgeLabel ? (
                          <span className="shrink-0 rounded-md bg-emerald-3/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-11">
                            {visionBadgeLabel}
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.disabled
                          ? option.footer
                          : option.description ?? getProviderDisplayName(option.providerID)}
                      </span>
                    </span>
                  </CommandItem>
                );
              }}
            </CommandCollection>
          </CommandGroup>
        )}
      </CommandList>
      <div className="border-t border-border px-2 py-1.5">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            setSearch("");
            if (onConfigureModels) {
              onConfigureModels();
              return;
            }
            window.dispatchEvent(new CustomEvent(openModelPickerEvent));
          }}
        >
          <Settings2 className="size-3.5" />
          {t("model_picker.configure_models")}
        </button>
      </div>
    </Command>
  );
}

export function ModelSelect({
  open,
  value,
  onOpenChange,
  onChange,
  onConfigureModels,
  onConfigureTokenStar,
  disabled = false,
}: ModelSelectProps) {
  const { options: modelOptions } = useModelOptions(open);
  const selectedOption = modelOptions.find((option) => isSameModel(value, option));

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label={t("model_picker.change_model")}
              aria-keyshortcuts="Meta+Alt+/"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12 disabled:pointer-events-none disabled:opacity-60"
            />
          }
        >
          <span className="max-w-48 truncate">
            {selectedOption?.title ?? value.modelID ?? t("model_picker.select_model")}
          </span>
          <ChevronDown className="h-3 w-3" />
        </TooltipTrigger>
        <TooltipContent>
          {t("model_picker.change_model")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="h-80 max-h-(--available-height) w-72 gap-0 overflow-hidden p-px **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-0.5"
        align="start"
        initialFocus={false}
      >
        <ModelListContent
          value={value}
          onChange={(model) => {
            onChange(model);
            onOpenChange(false);
          }}
          onConfigureModels={(providerId) => {
            onOpenChange(false);
            onConfigureModels?.(providerId);
          }}
          onConfigureTokenStar={() => {
            onOpenChange(false);
            onConfigureTokenStar?.();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
