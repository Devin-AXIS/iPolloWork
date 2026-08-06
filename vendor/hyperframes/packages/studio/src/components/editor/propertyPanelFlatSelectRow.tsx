import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, RotateCcw } from "../../icons/SystemIcons";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import {
  VALUE_TIER_LABEL_CLASS,
  VALUE_TIER_VALUE_CLASS,
  type PropertyValueTier,
} from "./propertyPanelValueTier";

/* ------------------------------------------------------------------ */
/*  FlatDropdown — shared Layers-panel select menu                     */
/* ------------------------------------------------------------------ */

export interface FlatDropdownOption {
  value: string;
  label: string;
}

export function FlatDropdown({
  ariaLabel,
  value,
  options,
  disabled,
  className = "",
  valueClassName = "",
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: FlatDropdownOption[];
  disabled?: boolean;
  className?: string;
  valueClassName?: string;
  onChange: (nextValue: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedLabel = options[selectedIndex]?.label ?? value;

  const close = () => setOpen(false);
  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setAnchorRect(rect);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!open) {
            const rect = buttonRef.current?.getBoundingClientRect();
            if (rect) setAnchorRect(rect);
          }
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            close();
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          selectIndex((selectedIndex + delta + options.length) % options.length);
        }}
        className={`flex min-w-0 items-center justify-between gap-1.5 text-left outline-none disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      >
        <span className={`min-w-0 truncate ${valueClassName}`}>{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={`flex-shrink-0 text-[#858a94] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open &&
        anchorRect &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[220] max-h-[min(280px,calc(100vh-24px))] overflow-y-auto rounded-[6px] border border-[#ebebeb] bg-white p-1 shadow-[0_8px_24px_rgba(25,28,33,0.14)] dark:border-panel-hairline dark:bg-panel-bg"
            style={{
              left: Math.min(
                anchorRect.left,
                Math.max(8, window.innerWidth - anchorRect.width - 8),
              ),
              top: Math.min(anchorRect.bottom + 4, window.innerHeight - 48),
              width: Math.max(anchorRect.width, 120),
            }}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectIndex(index)}
                  className={`flex h-[32px] w-full items-center justify-between gap-2 rounded-[5px] px-2 text-left text-[12px] transition-colors ${
                    selected
                      ? "bg-[#f5f6f9] text-[#24262b] dark:bg-panel-input dark:text-panel-text-1"
                      : "text-[#50535a] hover:bg-[#f5f6f9] active:bg-[#eceef2] dark:text-panel-text-3 dark:hover:bg-panel-input"
                  }`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  {selected && <Check size={14} className="flex-shrink-0 text-[#20bbc0]" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  FlatSelectRow — label/value row backed by FlatDropdown             */
/* ------------------------------------------------------------------ */

export function FlatSelectRow({
  label,
  ariaLabel,
  value,
  options,
  tier,
  disabled,
  large = true,
  valueOnly = false,
  onChange,
  onReset,
}: {
  label: string;
  /** Accessible name when a caller renders the visible label OUTSIDE this
   *  row (label="" to avoid a duplicate) — e.g. Grade's "Preset" row, which
   *  shows its own label span and would otherwise leave the <select>
   *  unnamed. Falls back to `label` when omitted. */
  ariaLabel?: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  tier: PropertyValueTier;
  disabled?: boolean;
  /** Figma's 34px inspector control used by the expanded Layer sections. */
  large?: boolean;
  /** Show only the selected option, for controls whose Figma design omits a field label. */
  valueOnly?: boolean;
  onChange: (nextValue: string) => void;
  onReset?: () => void;
}) {
  const track = useTrackDesignInput();
  const trackName = ariaLabel || label;
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  // A valid authored value outside the preset list (e.g. a `mix-blend-mode`
  // or `object-position` this row doesn't offer as a preset) must not be
  // silently misrepresented as the first option — the native <select> falls
  // back to selectedIndex 0 when `value` matches no <option>, and reselecting
  // that visible-but-wrong preset overwrites the real persisted value. Prepend
  // the current value so it's always representable, matching legacy
  // `SelectField`'s same guard.
  const renderedOptions =
    value && !normalizedOptions.some((option) => option.value === value)
      ? [{ value, label: value }, ...normalizedOptions]
      : normalizedOptions;
  return (
    <div
      className={`group flex min-w-0 items-center justify-between gap-1.5 bg-panel-input ${
        large ? "h-[34px] rounded-[6px] pl-2 pr-4" : "h-6 rounded-[4px] px-2"
      }`}
    >
      {!valueOnly && (
        <span
          className={`flex-shrink-0 ${
            large
              ? "text-[10px] font-normal text-[#858a94]"
              : `text-[8px] ${VALUE_TIER_LABEL_CLASS[tier]}`
          }`}
        >
          {label}
        </span>
      )}
      <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <FlatDropdown
          ariaLabel={ariaLabel || label}
          value={value}
          options={renderedOptions}
          disabled={disabled}
          className={large || valueOnly ? "flex-1" : ""}
          valueClassName={`font-sans ${
            large
              ? `text-[13px] font-normal text-[#24262b] dark:text-panel-text-1 ${valueOnly ? "capitalize" : ""}`
              : `text-[10px] ${VALUE_TIER_VALUE_CLASS[tier]}`
          }`}
          onChange={(nextValue) => {
            track("select", trackName);
            onChange(nextValue);
          }}
        />
        {tier === "explicitCustom" && onReset && (
          <button
            type="button"
            data-flat-select-reset="true"
            title="Remove — fall back to default"
            disabled={disabled}
            onClick={() => {
              track("button", `Reset ${trackName}`);
              onReset();
            }}
            className="relative z-10 flex-shrink-0 text-panel-text-3 opacity-0 transition-opacity hover:text-panel-text-1 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </span>
    </div>
  );
}
