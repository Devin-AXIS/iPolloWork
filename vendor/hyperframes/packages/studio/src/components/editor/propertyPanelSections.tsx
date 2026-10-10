import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";

export function formatTextFieldPreview(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, " ");
  if (collapsed.length <= 56) return collapsed;
  return `${collapsed.slice(0, 55)}…`;
}

export function getTextFieldColor(
  field: { computedStyles: Record<string, string> },
  inheritedStyles: Record<string, string>,
): string {
  return field.computedStyles.color || inheritedStyles.color || "rgb(0, 0, 0)";
}

export function getTextStyleValue(
  field: { computedStyles: Record<string, string> },
  inheritedStyles: Record<string, string>,
  property: string,
  fallback: string,
): string {
  return field.computedStyles[property] || inheritedStyles[property] || fallback;
}

const ALL_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
export const WEIGHT_LABELS: Record<string, string> = {
  "100": "100 · Thin",
  "200": "200 · Extra Light",
  "300": "300 · Light",
  "400": "400 · Regular",
  "500": "500 · Medium",
  "600": "600 · Semi Bold",
  "700": "700 · Bold",
  "800": "800 · Extra Bold",
  "900": "900 · Black",
};

export function detectAvailableWeights(fontFamily: string): string[] {
  const fonts = document.fonts;
  if (!fonts) return ALL_WEIGHTS;
  const family = fontFamily.split(",")[0]?.trim().replace(/['"]/g, "");
  if (!family) return ALL_WEIGHTS;
  const available: string[] = [];
  for (const w of ALL_WEIGHTS) {
    if (fonts.check(`${w} 16px "${family}"`)) available.push(w);
  }
  return available.length > 0 ? available : ALL_WEIGHTS;
}

export function TextAreaField({
  label,
  value,
  disabled,
  autoFocus,
  onPreview,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onPreview?: (nextValue: string) => void;
  onCommit: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const interactionChangedRef = useRef(false);
  const focusedRef = useRef(false);
  const valueRef = useRef(value);
  // The selection observer can report our live preview as a new prop value.
  // Keep the focus-time baseline until blur so that preview still gets saved.
  if (!focusedRef.current) valueRef.current = value;

  useEffect(() => {
    if (focusedRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus]);

  const commitDraft = (d: string) => {
    if (interactionChangedRef.current) {
      interactionChangedRef.current = false;
      track("text", label);
    }
    if (d !== valueRef.current) onCommit(d);
  };

  const handleFocus = () => {
    focusedRef.current = true;
  };
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    draftRef.current = e.target.value;
    setDraft(e.target.value);
    interactionChangedRef.current = true;
    onPreview?.(e.target.value);
  };
  const handleBlur = () => {
    focusedRef.current = false;
    commitDraft(draftRef.current);
  };

  return (
    <div className="flex min-h-[43px] items-center rounded-[9px] border border-[#99b8f2] bg-panel-bg px-4 py-2 focus-within:border-[#4f8fe8] focus-within:ring-1 focus-within:ring-[#4f8fe8]/20">
      <textarea
        ref={textareaRef}
        value={draft}
        disabled={disabled}
        rows={1}
        aria-label={label}
        onFocus={handleFocus}
        onChange={handleChange}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }}
        onBlur={handleBlur}
        className="w-full resize-none bg-transparent font-sans text-[14px] font-normal leading-[20px] text-[#24262b] outline-none disabled:cursor-not-allowed disabled:text-panel-text-4 dark:text-panel-text-1"
      />
    </div>
  );
}