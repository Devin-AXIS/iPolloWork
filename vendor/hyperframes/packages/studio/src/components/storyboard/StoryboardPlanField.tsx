import { useEffect, useRef, useState } from "react";

const INPUT =
  "w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-xs leading-5 text-[var(--hf-panel-text-0)] outline-none placeholder:text-[var(--hf-panel-text-4)] hover:border-[var(--hf-panel-border-input)] focus:border-studio-accent focus:bg-[var(--hf-panel-surface)]";

/** Preserve in-progress whitespace while the canonical Markdown draft updates. */
export function StoryboardPlanField({
  id,
  label,
  placeholder,
  value,
  onChange,
  multiline = false,
  rows = 3,
  disabled = false,
}: {
  id?: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const props = {
    id,
    "aria-label": label,
    placeholder: placeholder ?? label,
    value: text,
    disabled,
    className: INPUT,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      setText(value);
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(event.target.value);
      onChange(event.target.value);
    },
  };
  return multiline ? (
    <textarea {...props} rows={rows} className={`${INPUT} resize-y`} />
  ) : (
    <input {...props} />
  );
}
