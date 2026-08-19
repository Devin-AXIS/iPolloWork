"use client";

import * as React from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

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
  ensureMergedProviderListQuery,
  getChatProviderCatalogItems,
  resolveModelRuntime,
  useProviderListQuery,
} from "@/react-app/infra/provider-list-query";
import { getReactQueryClient } from "@/react-app/infra/query-client";
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
import { newProvidersEvent } from "@/app/lib/provider-events";

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
    selectedWorkspaceRoot,
  } = useWorkspace();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const [catalog, setCatalog] = React.useState<Awaited<ReturnType<typeof ensureMergedProviderListQuery>> | null>(null);

  const { data, refetch } = useProviderListQuery({
    client,
    engineId,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot,
    enabled: Boolean(client),
  });

  const loadCatalog = React.useCallback(async () => {
    if (!client) return;
    await refetch();
    const sources = modelCatalogSources.length
      ? modelCatalogSources
      : [{ client, engineId, baseUrl: opencodeBaseUrl, directory: selectedWorkspaceRoot }];
    setCatalog(await ensureMergedProviderListQuery(
      getReactQueryClient(),
      sources,
      { force: true },
    ));
  }, [client, engineId, modelCatalogSources, opencodeBaseUrl, refetch, selectedWorkspaceRoot]);

  React.useEffect(() => {
    if (!open) return;
    void loadCatalog();
  }, [loadCatalog, open]);

  React.useEffect(() => {
    if (!client) return;
    const handler = () => {
      void loadCatalog();
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [client, loadCatalog]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  const options = React.useMemo(() => {
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });

    const catalogValue = catalog ?? data;
    const accountConnected = new Set([
      ...(catalogValue?.connected ?? []),
      ...connectedProviderIds,
    ]);
    const options = getChatProviderCatalogItems(catalogValue)
      .filter((provider) => accountConnected.has(provider.id))
      .flatMap((provider) =>
        Object.entries(provider.models).map(([id, model]) => {
          const runtime = resolveModelRuntime(data, {
            providerID: provider.id,
            modelID: id,
          }, engineId);
          return {
            providerID: provider.id,
            modelID: id,
            title: model.name,
            description: provider.name,
            behaviorTitle: t("model_behavior.title_reasoning_effort"),
            behaviorLabel: t("settings.provider_default_label"),
            behaviorDescription: "",
            behaviorValue: null,
            isFree: provider.id.trim().toLowerCase() === "opencode",
            isConnected: true,
            disabled: runtime.status !== "ready",
            footer: t("model_picker.engine_unavailable"),
            supportsVision: runtime.capabilities?.vision === true,
          };
        }),
      );

    return options.filter((option) => {
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
  }, [catalog, checkDesktopRestriction, connectedProviderIds, data, engineId]);

  return {
    options,
    includeTokenStar: (engineId?.trim() || DEFAULT_ENGINE_ID) === DEFAULT_ENGINE_ID,
  };
}

type ModelSelectModelItem = {
  kind: "model";
  id: string;
  option: ModelOption;
};

type TokenStarEntry = {
  kind: "tokenstar-connect";
  id: "tokenstar-connect";
};

type ModelSelectItem = ModelSelectModelItem | TokenStarEntry;

type ModelSelectGroup = {
  value: string;
  items: ModelSelectItem[];
};

function groupByProvider(modelOptions: ModelOption[], includeTokenStar: boolean): ModelSelectGroup[] {
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

  const grouped: ModelSelectGroup[] = [...groups.entries()]
    .map(([providerLabel, options]) => ({
      value: providerLabel,
      items: [...options].sort((a, b) => a.option.title.localeCompare(b.option.title)),
    }))
    .sort((a, b) => a.value.localeCompare(b.value));
  if (includeTokenStar && !modelOptions.some((option) => option.providerID === "tokenstar")) {
    const tokenStarEntry: TokenStarEntry = { kind: "tokenstar-connect", id: "tokenstar-connect" };
    grouped.push({ value: "TokenStar", items: [tokenStarEntry] });
    grouped.sort((a, b) => a.value.localeCompare(b.value));
  }

  return grouped;
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
  onConfigureTokenStar,
  autoFocus = true,
}: ModelListContentProps) {
  const [search, setSearch] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const { options: modelOptions, includeTokenStar } = useModelOptions(true);

  React.useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  const groups = React.useMemo(
    () => groupByProvider(modelOptions, includeTokenStar),
    [includeTokenStar, modelOptions],
  );

  const handleSelect = (option: ModelOption) => {
    onChange({ providerID: option.providerID, modelID: option.modelID });
    setSearch("");
  };

  const handleTokenStarConnect = () => {
    setSearch("");
    onConfigureTokenStar?.();
  };

  return (
    <Command items={groups} value={search} onValueChange={setSearch}>
      <CommandHeader>
        <CommandInput ref={searchInputRef} placeholder={t("model_picker.search_models")} />
      </CommandHeader>
      <CommandEmpty>{t("model_picker.no_results")}</CommandEmpty>
      <CommandList>
        {(group: ModelSelectGroup) => (
          <CommandGroup key={group.value} items={group.items}>
            <CommandGroupLabel>{group.value}</CommandGroupLabel>
            <CommandCollection>
              {(item: ModelSelectItem) => {
                if (item.kind === "tokenstar-connect") {
                  return (
                    <CommandItem className="gap-2" key={item.id} value="tokenstar connect" onClick={handleTokenStarConnect}>
                      <ProviderIcon providerId="tokenstar" providerName="TokenStar" className="size-3.5 opacity-70" size={14} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">Connect TokenStar</span>
                        <span className="block truncate text-xs text-muted-foreground">Configure API key</span>
                      </span>
                    </CommandItem>
                  );
                }
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
