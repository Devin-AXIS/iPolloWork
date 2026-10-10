import { type ComponentPropsWithRef } from "react";
import { Search } from "lucide-react";

interface SearchInputProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /** Accessible name — placeholder alone is not one. */
  "aria-label": string;
}

/**
 * Shared search input — one visual system (panel-input tokens) for every
 * panel search box, with a required accessible name.
 */
export function SearchInput({ className = "", ...props }: SearchInputProps) {
  return (
    <div
      data-slot="studio-search"
      className={`flex h-8 min-w-0 items-center gap-2 rounded-[8px] border border-panel-border-input bg-panel-bg px-2.5 text-panel-text-3 transition-colors ${className}`}
    >
      <Search size={16} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <input
        type="search"
        className="h-full min-w-0 w-full bg-transparent text-[12px] leading-4 text-panel-text-1 outline-none placeholder:text-panel-text-4"
        {...props}
      />
    </div>
  );
}
