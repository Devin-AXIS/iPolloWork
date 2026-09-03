/** @jsxImportSource react */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import {
  menuDensityClassNames,
  menuInteractionClassName,
  menuSurfaceClassName,
} from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";

export type SelectMenuOption = {
  value: string;
  label: string;
};

type SelectMenuProps = {
  options: SelectMenuOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  ariaLabelledBy?: string;
  ariaLabel?: string;
};

const triggerClass =
  "flex h-[34px] w-full items-center justify-between gap-1.5 rounded-[8px] border border-transparent bg-[#f5f6f9] px-3 text-left text-[13px] text-dls-text shadow-none transition-colors hover:bg-[#f6f7fb] focus:border-[#1FBAC0] focus:outline-none focus:ring-2 focus:ring-[#1FBAC0]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.06] dark:hover:bg-white/[0.09]";

const panelClass = cn(
  menuSurfaceClassName,
  menuInteractionClassName,
  menuDensityClassNames.compact.content,
  "absolute left-0 right-0 top-[calc(100%+4px)] z-[100] max-h-56 overflow-auto",
);

const optionRowClass = cn(
  menuDensityClassNames.compact.item,
  "flex w-full items-center gap-2 text-left text-dls-secondary transition-colors hover:bg-foreground/10 hover:text-dls-text",
);

export function SelectMenu(props: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const displayLabel = useMemo(() => {
    const match = props.options.find((o) => o.value === props.value);
    if (match) return match.label;
    return props.placeholder?.trim() || "";
  }, [props.options, props.placeholder, props.value]);

  const close = useEffectEvent(() => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        close();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        id={props.id}
        className={triggerClass}
        disabled={props.disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={props.ariaLabelledBy}
        aria-label={props.ariaLabel}
        onClick={() => {
          if (props.disabled) return;
          setOpen((o) => !o);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-dls-secondary transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open && !props.disabled ? (
        <div className={panelClass} role="listbox">
          {props.options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === props.value}
              className={`${optionRowClass} ${
                opt.value === props.value ? "bg-[#f6f7fb] text-dls-text dark:bg-white/[0.08]" : ""
              }`}
              onClick={() => {
                props.onChange(opt.value);
                close();
              }}
            >
              <span className="min-w-0 flex-1 truncate">{opt.label}</span>
              {opt.value === props.value ? (
                <Check
                  size={14}
                  className="shrink-0 text-[#1FBAC0]"
                  aria-hidden
                />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
