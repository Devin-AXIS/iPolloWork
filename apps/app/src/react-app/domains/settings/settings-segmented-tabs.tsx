/** @jsxImportSource react */

import { cn } from "@/lib/utils";

type SettingsSegmentedTabItem<Value extends string> = {
  value: Value;
  label: string;
  disabled?: boolean;
};

type SettingsSegmentedTabsProps<Value extends string> = {
  value: Value;
  items: SettingsSegmentedTabItem<Value>[];
  ariaLabel: string;
  onValueChange: (value: Value) => void;
};

export function SettingsSegmentedTabs<Value extends string>({
  value,
  items,
  ariaLabel,
  onValueChange,
}: SettingsSegmentedTabsProps<Value>) {
  return (
    <div className="inline-flex h-7 items-center gap-0.5" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          disabled={item.disabled}
          aria-selected={value === item.value}
          className={cn(
            "flex h-7 items-center justify-center rounded-[8px] px-3 text-ui-control font-medium transition-[color,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50",
            value === item.value
              ? "bg-[#f3f3f4] text-[#161e24] dark:bg-dls-hover dark:text-dls-text"
              : "text-[#5a6774] hover:bg-[#f6f7fb] active:bg-[#e7e7e9] active:text-[#161e24] dark:text-dls-secondary dark:hover:bg-dls-hover dark:active:bg-dls-hover/80 dark:active:text-dls-text",
          )}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
