import { type ComponentPropsWithRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@ipollowork/ui/controls";

interface SearchInputProps extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /** Accessible name — placeholder alone is not one. */
  "aria-label": string;
}

/**
 * Shared search input — the public Input with a search icon for every
 * panel search box, with a required accessible name.
 */
export function SearchInput({ className = "", style, ...props }: SearchInputProps) {
  return (
    <div
      data-slot="studio-search"
      className={`relative min-w-0 ${className}`}
    >
      <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-panel-text-3" aria-hidden="true" />
      <Input
        type="search"
        style={{ ...style, paddingInlineStart: 32, fontSize: "var(--ui-meta-size)", lineHeight: "var(--ui-meta-line)" }}
        {...props}
      />
    </div>
  );
}
