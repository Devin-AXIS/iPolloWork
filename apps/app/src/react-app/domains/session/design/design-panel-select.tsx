/** @jsxImportSource react */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type DesignPanelSelectOption<T extends string = string> = {
  label: string;
  value: T;
  disabled?: boolean;
};

type DesignPanelSelectProps<T extends string> = {
  value: T;
  options: readonly DesignPanelSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  menuClassName?: string;
  textClassName?: string;
  showValue?: boolean;
};

/** Design fields retain their layout API, but delegate interaction to the public Select. */
export function DesignPanelSelect<T extends string>({
  value, options, onChange, ariaLabel, className, menuClassName, textClassName, showValue = true,
}: DesignPanelSelectProps<T>) {
  const selected = options.find(option => option.value === value) ?? options[0];
  return (
    <div data-slot="design-panel-select" className={cn("relative min-w-0", className)}>
      <Select value={selected?.value ?? value} onValueChange={next => {
        const option = options.find(option => option.value === next);
        if (option && !option.disabled) onChange(option.value);
      }}>
        <SelectTrigger aria-label={ariaLabel} className={cn("h-full! w-full border-0 bg-transparent px-2 text-xs font-normal shadow-none focus-visible:ring-0", !showValue && "justify-center p-0")}>
          {showValue ? <SelectValue className={cn("min-w-0 truncate", textClassName)}>{selected?.label ?? value}</SelectValue> : null}
        </SelectTrigger>
        <SelectContent align="start" className={cn("w-(--anchor-width) min-w-0 p-1 [&_[role=option]]:min-h-7 [&_[role=option]]:py-1 [&_[role=option]]:text-xs", menuClassName)}>
          {options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
