/** @jsxImportSource react */

import { Button } from "@/components/ui/button";

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
        <Button
          key={item.value}
          type="button"
          size="sm"
          variant={value === item.value ? "secondary" : "ghost"}
          role="tab"
          disabled={item.disabled}
          aria-selected={value === item.value}
          className="px-3"
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
