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
import { getSelectableChatProviderItems, useProviderListQuery } from "@/react-app/infra/provider-list-query";
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
  const { client, opencodeBaseUrl, selectedWorkspaceRoot } = useWorkspace();
  const checkDesktopRestriction = useCheckDesktopRestriction();

  const { data, refetch } = useProviderListQuery({
    client,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot,
    enabled: Boolean(client),
  });

  React.useEffect(() => {
    if (!open || !client) return;
    void refetch();
  }, [client, open, refetch]);

  React.useEffect(() => {
    if (!client) return;
    const handler = () => {
      void refetch();
    };
    window.addEventListener(newProvidersEvent, handler);
    return () => window.removeEventListener(newProvidersEvent, handler);
  }, [client, refetch]);

  // Apply org-level restrictions (dev #1505) on top of the raw model list
  // so the picker never surfaces blocked options:
  //   - `allowZenModel` hides the built-in OpenCode provider entries when false
  //   - `allowCustomProviders` hides providers that OpenCode does not report
  //     as connected through the provider list endpoint.
  return React.useMemo(() => {
    const restrictToCloud = checkDesktopRestriction({
      restriction: "allowCustomProviders",
    });

    const options = getSelectableChatProviderItems(data)
      .flatMap((provider) =>
        Object.entries(provider.models).map(([id, model]) => ({
          providerID: provider.id,
          modelID: id,
          title: model.name,
          description: provider.name,
          behaviorTitle: t("model_behavior.title_reasoning_effort"),
          behaviorLabel: t("settings.provider_default_label"),
          behaviorDescription: "",
          behaviorValue: null,
          isFree: false,
          isConnected: true,
        })),
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
  }, [checkDesktopRestriction, data]);
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
  onConfigureModels?: () => void;
  disabled?: boolean;
}

export type ModelListContentProps = {
  value: ModelRef;
  onChange: (model: ModelRef) => void;
  onConfigureModels?: () => void;
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
  const modelOptions = useModelOptions(true);

  React.useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  const groups = React.useMemo(() => groupByProvider(modelOptions), [modelOptions]);

  const handleSelect = (option: ModelOption) => {
    onChange({ providerID: option.providerID, modelID: option.modelID });
    setSearch("");
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
              {(item: ModelSelectModelItem) => {
                const option = item.option;
                return (
                  <CommandItem
                    className="gap-2"
                    key={item.id}
                    value={`${option.providerID}:${option.modelID} ${option.title} ${option.description ?? ""}`}
                    onClick={() => handleSelect(option)}
                    data-checked={isSameModel(value, option)}
                  >
                    <ProviderIcon providerId={option.providerID} providerName={option.description} className="size-3.5 opacity-70" size={14} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{option.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description ?? getProviderDisplayName(option.providerID)}
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
  disabled = false,
}: ModelSelectProps) {
  const modelOptions = useModelOptions(open);
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
          onConfigureModels={() => {
            onOpenChange(false);
            if (onConfigureModels) {
              onConfigureModels();
              return;
            }
            window.dispatchEvent(new CustomEvent(openModelPickerEvent));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
