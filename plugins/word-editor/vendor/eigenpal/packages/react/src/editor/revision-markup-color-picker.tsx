import { ToolbarColorSwatch } from './toolbar/ColorSplit';
import { observeContentControlPopup } from '@docx-editor.dev/core/editor';
import { useId, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const revisionColor = (value: string) =>
  value === 'auto'
    ? 'currentColor'
    : value === 'byAuthor'
      ? 'var(--doc-review-author-0)'
      : value === 'none'
        ? 'transparent'
        : `var(--doc-revision-color-${value})`;

export function RevisionMarkupColorPicker({
  label,
  value,
  values,
  disabled,
  change,
  t,
}: {
  label: string;
  value: string;
  values: readonly string[];
  disabled?: boolean;
  change(value: string): void;
  t(key: string): string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !group.current || !trigger.current) return;
    const dispose = observeContentControlPopup(group.current, trigger.current);
    (
      group.current.querySelector<HTMLButtonElement>('[data-selected]') ??
      group.current.querySelector<HTMLButtonElement>('button')
    )?.focus();
    return dispose;
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
    if (!open) return;
    const doc = element.current?.ownerDocument;
    const outside = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) setOpen(false);
    };
    doc?.addEventListener('pointerdown', outside);
    return () => doc?.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      ref={element}
      className="docx-revision-color-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className="docx-revision-color-trigger"
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open && !disabled}
        aria-controls={`${id}-options`}
        onClick={() => setOpen(!open)}
      >
        <span
          className="docx-revision-color-swatch"
          aria-hidden="true"
          style={{ backgroundColor: revisionColor(value) }}
        />
        <span id={`${id}-value`}>{t(`values.${value}`)}</span>
      </button>
      <div
        ref={group}
        id={`${id}-options`}
        className="docx-revision-color-options"
        hidden={!open || disabled}
        role="group"
        aria-labelledby={`${id}-label`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
          );
          const current = buttons.indexOf(event.target as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : ['ArrowRight', 'ArrowDown'].includes(event.key)
                  ? (current + 1) % buttons.length
                  : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                    ? (current - 1 + buttons.length) % buttons.length
                    : null;
          if (next !== null) {
            event.preventDefault();
            event.stopPropagation();
            buttons[next]?.focus();
          }
        }}
      >
        <div className="docx-revision-color-special">
          {values
            .filter((color) => ['auto', 'none', 'byAuthor'].includes(color))
            .map((color) => (
              <button
                key={color}
                type="button"
                className="docx-toolbar__swatch-clear"
                aria-pressed={value === color}
                data-selected={value === color ? '' : undefined}
                onClick={() => {
                  change(color);
                  close();
                }}
              >
                <span
                  className="docx-revision-color-swatch"
                  aria-hidden="true"
                  style={{ backgroundColor: revisionColor(color) }}
                />
                {t(`values.${color}`)}
              </button>
            ))}
        </div>
        <div className="docx-toolbar__swatch-grid">
          {values
            .filter((color) => !['auto', 'none', 'byAuthor'].includes(color))
            .map((color) => (
              <ToolbarColorSwatch
                key={color}
                value={color}
                css={revisionColor(color)}
                title={t(`values.${color}`)}
                selected={value === color}
                apply={(next) => {
                  change(next);
                  close();
                }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
