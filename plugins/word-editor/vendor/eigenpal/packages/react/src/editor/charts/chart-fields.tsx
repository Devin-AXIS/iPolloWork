// The fields of the Chart pane: a text field that applies on Enter or blur, a check box row, and
// a list. Colour fields are the shared `ColorPicker`. The Vue twin is `packages/vue/src/editor/charts/chart-fields.tsx`; both
// render the same markup.

import { useId, useState } from 'react';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';

/** A translator with a plain string key, as the core helpers take it. */
export function useChartTranslate(): (
  key: string,
  params?: Record<string, string | number>
) => string {
  const { t } = useTranslation();
  return (key, params) => t(key as TranslationKey, params);
}

/**
 * A text field that applies on Enter or blur and shows the chart's value otherwise. Text that
 * the pane or the editor refuses stays in the field with its reason; Escape restores the value.
 */
export function ChartField(props: {
  draftKey: string;
  label: string;
  /** The label over the field; without it, the field has only its accessible name. */
  visibleLabel?: string;
  value: string;
  numeric?: boolean;
  disabled: boolean;
  /** The id of the text that says why the field is disabled. */
  describedBy?: string;
  /** Marks the row for the pane's focus moves. */
  row?: number;
  /** Applies the text: null when it applied, else the reason to show. */
  onCommit: (text: string) => string | null;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState(props.draftKey);
  if (scope !== props.draftKey) {
    setScope(props.draftKey);
    setDraft(null);
    setError(null);
  }
  const reset = (): void => {
    setDraft(null);
    setError(null);
  };
  const commit = (): void => {
    if (draft === null) return;
    if (draft === props.value) return reset();
    const refused = props.onCommit(draft);
    if (refused === null) reset();
    else setError(refused);
  };
  const described = [error !== null ? errorId : null, props.describedBy ?? null]
    .filter(Boolean)
    .join(' ');
  return (
    <label className="docx-chart-pane__field">
      {props.visibleLabel ? (
        <span className="docx-chart-pane__label">{props.visibleLabel}</span>
      ) : null}
      <input
        className="docx-dialog__input"
        aria-label={props.label}
        inputMode={props.numeric ? 'decimal' : undefined}
        aria-invalid={error !== null}
        aria-describedby={described || undefined}
        value={draft ?? props.value}
        disabled={props.disabled}
        data-row={props.row}
        data-draft={draft !== null}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape' && draft !== null) {
            e.stopPropagation();
            reset();
          }
        }}
      />
      {error !== null ? (
        <span id={errorId} className="docx-chart-pane__error">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** A check box row of the Chart pane. */
export function ChartCheck(props: {
  label: string;
  checked: boolean;
  disabled: boolean;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="docx-dialog__checkbox-row">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        aria-describedby={props.describedBy}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

/** A list of the Chart pane. `other` names a value that is not one of `options`. */
export function ChartSelect<T extends string>(props: {
  label: string;
  value: T | '';
  options: readonly (readonly [T, string])[];
  other?: string;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const listed = props.options.some(([value]) => value === props.value);
  return (
    <div className="docx-chart-pane__field">
      <label className="docx-chart-pane__label" htmlFor={id}>
        {props.label}
      </label>
      <select
        id={id}
        className="docx-dialog__select"
        value={listed ? props.value : ''}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.value as T)}
      >
        {listed ? null : (
          <option value="" disabled>
            {props.other ?? ''}
          </option>
        )}
        {props.options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
