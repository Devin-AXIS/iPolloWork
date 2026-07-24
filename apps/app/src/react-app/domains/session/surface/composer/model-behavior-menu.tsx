import { useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import type { ModelRef } from "@/app/types";
import { resolveModelDisplayName } from "@/app/utils";
import { t } from "@/i18n";
import { ModelListContent } from "@/components/model-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ModelBehaviorOption = {
  value: string | null;
  label: string;
};

type MenuView = "root" | "model" | "behavior";

type ModelBehaviorMenuProps = {
  selectedModel: ModelRef;
  modelVariant: string | null;
  modelVariantLabel: string;
  options?: ModelBehaviorOption[];
  onModelChange: (model: ModelRef) => void;
  onModelVariantChange: (value: string | null) => void;
  onConfigureModels?: () => void;
  disabled?: boolean;
};

export function ModelBehaviorMenu({
  selectedModel,
  modelVariant,
  modelVariantLabel,
  options,
  onModelChange,
  onModelVariantChange,
  onConfigureModels,
  disabled = false,
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
        className="inline-flex max-w-72 items-center gap-1.5 rounded-full bg-gray-3 px-3 py-1.5 text-sm text-gray-11 transition-colors hover:bg-gray-4 hover:text-gray-12 disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-hidden p-1.5">
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
            <div className="min-h-0 flex-1 overflow-hidden">
              <ModelListContent
                value={selectedModel}
                onChange={selectModel}
                onConfigureModels={() => {
                  close();
                  onConfigureModels?.();
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
