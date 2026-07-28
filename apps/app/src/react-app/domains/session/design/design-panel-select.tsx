/** @jsxImportSource react */
import * as React from "react";

import { cn } from "@/lib/utils";
import panelSelectChevron from "./assets/panel-select-chevron.svg";

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

export function DesignPanelSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  menuClassName,
  textClassName,
  showValue = true,
}: DesignPanelSelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [openAbove, setOpenAbove] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const toggleOpen = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const menuHeight = options.length * 34 + 24;
      setOpenAbove(window.innerHeight - rect.bottom < menuHeight + 12 && rect.top > menuHeight + 12);
    }
    setOpen((current) => !current);
  };

  React.useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target instanceof Node ? event.target : null)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        className={cn(
          "flex h-full w-full items-center rounded-[inherit] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#9cbdf0]",
          showValue ? "justify-between gap-2 px-2" : "justify-center p-0",
        )}
        onClick={toggleOpen}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {showValue ? <span className={cn("min-w-0 flex-1 truncate text-[13px] text-[#24262b]", textClassName)}>{selected?.label ?? value}</span> : null}
        <img src={panelSelectChevron} alt="" width="16" height="16" className={cn("block size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          className={cn("absolute left-0 z-50 w-full min-w-[120px] overflow-hidden rounded-xl border border-[#dedfe3] bg-white p-3 shadow-[0_8px_18px_rgba(37,41,49,0.11)]", openAbove ? "bottom-[calc(100%+12px)]" : "top-[calc(100%+12px)]", menuClassName)}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={cn("flex h-[34px] w-full items-center rounded-lg px-2.5 text-left text-[12px] text-black transition-colors hover:bg-[#f4f5f7] focus-visible:bg-[#f4f5f7] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40", option.value === value && "bg-[#f4f5f7]")}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
