"use client";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Settings2 } from "lucide-react";

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

type TokenStarEntry = {
  kind: "tokenstar";
  id: "tokenstar-models";
};

type ModelSelectItem = ModelSelectModelItem | TokenStarEntry;

type ModelSelectGroup = {
  value: string;
  items: ModelSelectItem[];
};

function groupByProvider(modelOptions: ModelOption[]): ModelSelectGroup[] {
  const groups = new Map<string, ModelSelectModelItem[]>();

  for (const option of modelOptions) {
    if (option.providerID === "tokenstar") continue;
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
  const openCodeZen = grouped.find((group) => group.value === "OpenCode Zen");
  const tokenStarEntry: TokenStarEntry = { kind: "tokenstar", id: "tokenstar-models" };

  if (openCodeZen) {
    openCodeZen.items.unshift(tokenStarEntry);
  } else {
    grouped.unshift({ value: "OpenCode Zen", items: [tokenStarEntry] });
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
  onConfigureModels?: () => void;
  onConfigureTokenStar?: () => void;
  disabled?: boolean;
}

export type ModelListContentProps = {
  value: ModelRef;
  onChange: (model: ModelRef) => void;
  onConfigureModels?: () => void;
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
  const [tokenStarView, setTokenStarView] = React.useState<"root" | "family" | "gpt" | "gpt-5.6" | "kimi">("root");
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
  const tokenStarOptions = React.useMemo(
    () => modelOptions.filter((option) => option.providerID === "tokenstar"),
    [modelOptions],
  );

  const handleSelect = (option: ModelOption) => {
    onChange({ providerID: option.providerID, modelID: option.modelID });
    setSearch("");
  };

  const handleTokenStarOpen = () => {
    setSearch("");
    if (tokenStarOptions.length > 0) {
      setTokenStarView("family");
      return;
    }
    onConfigureTokenStar?.();
  };

  const tokenStarGpt = tokenStarOptions.filter((option) => option.modelID.startsWith("gpt-"));
  const tokenStarKimi = tokenStarOptions.filter((option) => option.modelID.startsWith("kimi-"));
  const gpt56Variants = tokenStarGpt.filter((option) => option.modelID.startsWith("gpt-5.6-"));
  const gpt56Base = tokenStarGpt.find((option) => option.modelID === "gpt-5.6") ?? null;

  if (tokenStarView !== "root") {
    const title = tokenStarView === "family"
      ? "TokenStar"
      : tokenStarView === "gpt"
        ? "TokenStar / GPT"
        : tokenStarView === "gpt-5.6"
          ? "TokenStar / GPT / GPT 5.6"
          : "TokenStar / Kimi";
    const back = tokenStarView === "family"
      ? () => setTokenStarView("root")
      : tokenStarView === "gpt" || tokenStarView === "kimi"
        ? () => setTokenStarView("family")
        : () => setTokenStarView("gpt");
    const modelItems = tokenStarView === "kimi"
      ? tokenStarKimi
      : tokenStarView === "gpt-5.6"
        ? gpt56Variants
        : [];

    return (
      <div className="flex h-full min-h-0 flex-col">
        <button type="button" className="flex items-center gap-2 border-b border-border px-3 py-2 text-left text-sm font-medium hover:bg-accent" onClick={back}>
          <ChevronLeft className="size-4" />
          {title}
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {tokenStarView === "family" ? (
            <>
              <TokenStarNavigationItem label="GPT" onClick={() => setTokenStarView("gpt")} />
              <TokenStarNavigationItem label="Kimi" onClick={() => setTokenStarView("kimi")} />
              <TokenStarNavigationItem label="Manage API key" onClick={() => onConfigureTokenStar?.()} />
            </>
          ) : null}
          {tokenStarView === "gpt" ? (
            <>
              {tokenStarGpt.filter((option) => option.modelID !== "gpt-5.6" && !option.modelID.startsWith("gpt-5.6-")).map((option) => (
                <TokenStarModelItem key={option.modelID} option={option} onClick={() => handleSelect(option)} />
              ))}
              {gpt56Variants.length > 0 ? (
                <TokenStarNavigationItem label="GPT 5.6" onClick={() => setTokenStarView("gpt-5.6")} />
              ) : gpt56Base ? (
                <TokenStarModelItem option={gpt56Base} onClick={() => handleSelect(gpt56Base)} />
              ) : null}
            </>
          ) : null}
          {modelItems.map((option) => (
            <TokenStarModelItem key={option.modelID} option={option} onClick={() => handleSelect(option)} />
          ))}
        </div>
      </div>
    );
  }

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
                if (item.kind === "tokenstar") {
                  return (
                    <CommandItem className="gap-2" key={item.id} value="tokenstar models gpt kimi" onClick={handleTokenStarOpen}>
                      <ProviderIcon providerId="tokenstar" providerName="TokenStar" className="size-3.5 opacity-70" size={14} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">TokenStar Models</span>
                        <span className="block truncate text-xs text-muted-foreground">GPT and Kimi</span>
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </CommandItem>
                  );
                }
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

function TokenStarNavigationItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent" onClick={onClick}>
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function TokenStarModelItem({ option, onClick }: { option: ModelOption; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent" onClick={onClick}>
      <ProviderIcon providerId="tokenstar" providerName="TokenStar" className="size-3.5 opacity-70" size={14} />
      <span className="min-w-0 flex-1 truncate">{option.title}</span>
    </button>
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
            onConfigureModels?.();
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
