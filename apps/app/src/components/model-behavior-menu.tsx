import { useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { tokenStarModelSupportsEffort } from "@/app/lib/model-behavior";
import type { ModelRef } from "@/app/types";
import { resolveModelDisplayName } from "@/app/utils";
import { ModelListContent } from "@/components/model-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

type ModelBehaviorOption = {
  value: string | null;
  label: string;
};

type MenuView = "root" | "model" | "behavior";

export type ModelBehaviorMenuProps = {
  selectedModel: ModelRef;
  modelVariant: string | null;
  modelVariantLabel: string;
  options?: ModelBehaviorOption[];
  onModelChange: (model: ModelRef) => void;
  onModelVariantChange: (value: string | null) => void;
  onConfigureModels?: (providerId?: string) => void;
  onConfigureTokenStar?: () => void;
  disabled?: boolean;
  appearance?: "composer" | "field";
};

export function ModelBehaviorMenu({
  selectedModel,
  modelVariant,
  modelVariantLabel,
  options,
  onModelChange,
  onModelVariantChange,
  onConfigureModels,
  onConfigureTokenStar,
  disabled = false,
  appearance = "composer",
}: ModelBehaviorMenuProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("root");
  const behaviorOptions = options ?? [];
  const hasBehavior = behaviorOptions.length > 0;
  const modelLabel = resolveModelDisplayName(selectedModel.modelID) || t("model_picker.select_model");
  const summary = hasBehavior ? `${modelLabel} · ${modelVariantLabel}` : modelLabel;

  const close = () => {
    setOpen(false);
    setView("root");
  };

  const selectModel = (model: ModelRef) => {
    onModelChange(model);
    if (model.providerID === "tokenstar" && tokenStarModelSupportsEffort(model.modelID)) {
      onModelVariantChange("medium");
      return;
    }
    close();
  };

  const selectBehavior = (value: string | null) => {
    onModelVariantChange(value);
    close();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setView("root");
      }}
    >
      <PopoverTrigger
        type="button"
        disabled={disabled}
        aria-label={`${t("model_picker.change_model")} ${hasBehavior ? `· ${t("composer.behavior_label")}` : ""}`}
        className={cn(
          "inline-flex items-center gap-1.5 transition-colors disabled:pointer-events-none disabled:opacity-60",
          appearance === "composer"
            ? "me-1.5 h-8 min-w-0 max-w-72 flex-[0_1_auto] rounded-full bg-transparent px-2 text-[12px] leading-[18px] text-gray-10 hover:bg-gray-3 hover:text-gray-12 data-[state=open]:bg-gray-3 data-[state=open]:text-gray-12"
            : "h-9 w-full justify-between rounded-lg border border-border bg-background px-3 text-[13px] text-foreground shadow-xs hover:bg-gray-2 data-[state=open]:border-ring data-[state=open]:ring-3 data-[state=open]:ring-ring/30",
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        side={appearance === "composer" ? "top" : "bottom"}
        align="start"
        sideOffset={appearance === "composer" ? 8 : 6}
        className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-1.5"
      >
        {view === "root" ? (
          <div className="space-y-1">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-2"
              onClick={() => setView("model")}
            >
              <span className="flex-1 font-medium">{t("model_picker.change_model")}</span>
              <span className="max-w-44 truncate text-gray-10">{modelLabel}</span>
              <ChevronRight className="size-4 shrink-0 text-gray-9" />
            </button>
            {hasBehavior ? (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-2"
                onClick={() => setView("behavior")}
              >
                <span className="flex-1 font-medium">{t("model_behavior.title_reasoning_effort")}</span>
                <span className="max-w-44 truncate text-gray-10">{modelVariantLabel}</span>
                <ChevronRight className="size-4 shrink-0 text-gray-9" />
              </button>
            ) : null}
          </div>
        ) : null}
        {view === "model" ? (
          <div className="flex h-80 flex-col">
            <MenuBackButton label={t("model_picker.change_model")} onClick={() => setView("root")} />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ModelListContent
                value={selectedModel}
                onChange={selectModel}
                onConfigureModels={(providerId) => {
                  close();
                  onConfigureModels?.(providerId);
                }}
                onConfigureTokenStar={() => {
                  close();
                  onConfigureTokenStar?.();
                }}
              />
            </div>
          </div>
        ) : null}
        {view === "behavior" ? (
          <div className="space-y-1">
            <MenuBackButton label={t("model_behavior.title_reasoning_effort")} onClick={() => setView("root")} />
            {behaviorOptions.map((option) => {
              const active = option.value === modelVariant;
              return (
                <button
                  key={option.value ?? "default"}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-gray-2"
                  onClick={() => selectBehavior(option.value)}
                >
                  <span>{option.label}</span>
                  {active ? <Check className="size-4 text-gray-11" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function MenuBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-gray-2" onClick={onClick}>
      <ChevronLeft className="size-4" />
      {label}
    </button>
  );
}
