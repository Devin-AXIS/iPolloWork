import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Input, Textarea } from "@ipollowork/ui/controls";

const INPUT = "w-full min-w-0";

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
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const resize = () => {
      if (element.getBoundingClientRect().width === 0) return;
      element.style.height = "auto";
      const height = `${element.scrollHeight}px`;
      if (element.style.height !== height) element.style.height = height;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
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
    <Textarea {...props} ref={textarea} rows={rows} className={`${INPUT} resize-none overflow-hidden`} />
  ) : (
    <Input {...props} />
  );
}
