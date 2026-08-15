/** @jsxImportSource react */

type SettingsSegmentedTabItem<Value extends string> = {
  value: Value;
  label: string;
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
    <div className="inline-flex rounded-lg bg-dls-hover p-0.5" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${value === item.value ? "bg-dls-surface text-dls-text shadow-sm" : "text-dls-secondary hover:text-dls-text"}`}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
