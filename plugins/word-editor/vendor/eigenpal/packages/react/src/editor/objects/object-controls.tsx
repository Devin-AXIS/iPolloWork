// The building blocks of the shape and chart parts: `useObjectControl`, which binds one
// `shape.*` or `chart.*` slot to its live state, and the field shapes every part renders as (a
// colour, a list, a text field, a toggle). A part works in a toolbar, a menu, a popover, a
// drawer, or a pane. `variant="field"` shows a visible label and the disabled reason under the
// control; `variant="compact"` keeps the label for screen readers only and puts the reason in
// the tooltip, for a toolbar. Enabled state, the disabled reason, and the value come only from
// `toolbarCommandState`; a change runs `runToolbarCommand`. The Vue twin is
// `packages/vue/src/editor/objects/object-controls.tsx`.

import { createContext, useCallback, useContext, useId, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  CHROME_GROUPS,
  chartSlotIsToggle,
  chromeSlotId,
  objectSlotOptions,
  objectSlotValue,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
  type ColorPick,
  type ObjectSlotReadValueMap,
  type ObjectSlotValueMap,
  type ObjectToggleSlotId,
  type ToolbarCommandState,
} from '@docx-editor.dev/core/editor';
import type { EditorExecOptions, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason, type TranslationKey } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useChromeScopeClassName } from '../color-mode-context';
import { ScopedByAncestorContext } from '../scope-context';
import { chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { ChartField } from '../charts/chart-fields';
import { ColorPicker, type ColorPickerValue } from '../color/ColorPicker';

/** A `shape.*` or `chart.*` slot. @public */
export type ObjectSlotId = keyof ObjectSlotValueMap;

/** How a part renders: with a visible label (`field`), or as a toolbar control (`compact`). @public */
export type ObjectControlVariant = 'field' | 'compact';

/**
 * The variant a part takes when its own `variant` prop is absent. `DocxEditor.Toolbar` provides
 * `compact`, so a part placed in the toolbar renders as a toolbar control.
 */
export const ObjectControlVariantContext = createContext<ObjectControlVariant>('field');

/** The variant of a part: its own prop, else the one its container provides. */
export function useObjectControlVariant(variant: ObjectControlVariant | undefined) {
  const inherited = useContext(ObjectControlVariantContext);
  return variant ?? inherited;
}

/** The props every shape and chart part takes. @public */
export interface ObjectControlProps {
  /** A class name added to the part's root. */
  className?: string;
  /** Replaces the label, which defaults to the slot's translated name. */
  label?: string;
  /** Default `field`, or `compact` inside `DocxEditor.Toolbar`. */
  variant?: ObjectControlVariant;
  /** Renders nothing, so a toolbar override can remove the slot. */
  hidden?: boolean;
}

/**
 * The props of a part whose control is a button: the colour parts and the toggle parts. @public
 */
export interface ObjectButtonPartProps extends ObjectControlProps {
  /** Replaces the slot's icon in the compact variant. */
  icon?: DocxEditorChildren;
  /** Renders the one child element as the button, with the part's props merged into it. */
  asChild?: boolean;
  /** With `asChild`, the element that becomes the button. */
  children?: DocxEditorChildren;
}

/** What `useObjectControl` returns for every slot. @public */
export interface ObjectControlState<K extends ObjectSlotId> {
  readonly slotId: K;
  /** The slot's translated name. */
  readonly label: string;
  /**
   * The value the object shows now, typed for the slot, or null when nothing is selected, the
   * object shows several values, or the slot has no single value (`chart.seriesColor`,
   * `chart.data`).
   */
  readonly value: ObjectSlotReadValueMap[K] | null;
  /** The values a list slot offers, in list order; empty for other slots. */
  readonly options: readonly ObjectSlotValueMap[K][];
  /** Whether a toggle is on, or whether the object shows the property. */
  readonly isActive: boolean;
  readonly isEnabled: boolean;
  /** Why the control is disabled, translated, or null. */
  readonly disabledReason: string | null;
  /** Run the slot with `value`, as `runToolbarCommand` does. */
  readonly execute: (value: ObjectSlotValueMap[K], options?: EditorExecOptions) => ExecResult;
}

/** The member a toggle slot adds: a run with no value turns the element on or off. @public */
export interface ObjectToggleControl {
  readonly toggle: (options?: EditorExecOptions) => ExecResult;
}

/**
 * What `useObjectControl` returns: the state and `execute`, and `toggle` for the toggle slots
 * (`chart.dataLabels`, `chart.axes`, `chart.gridlines`). @public
 */
export type UseObjectControlReturn<K extends ObjectSlotId> = ObjectControlState<K> &
  (K extends ObjectToggleSlotId ? ObjectToggleControl : unknown);

const sameState = (a: ToolbarCommandState, b: ToolbarCommandState) =>
  a.value === b.value &&
  a.enabled === b.enabled &&
  a.active === b.active &&
  a.disabledReason === b.disabledReason;

const LABEL_KEYS = new Map<string, string>(
  CHROME_GROUPS.flatMap((group) =>
    group.controls.map((control) => [chromeSlotId(group, control), control.labelKey] as const)
  )
);
const ICONS = new Map<string, readonly string[] | null>(
  CHROME_GROUPS.flatMap((group) =>
    group.controls.map((control) => [chromeSlotId(group, control), control.paths] as const)
  )
);

/** What the parts read: the public control, the value as text, and a run with its refusal. */
interface ObjectSlotBinding<K extends ObjectSlotId> {
  readonly control: UseObjectControlReturn<K>;
  /** The value as the toolbar state carries it, or empty text. */
  readonly text: string;
  /** Run the slot with any value it reads; the refusal translated, or null when it applied. */
  readonly apply: (value: unknown) => string | null;
}

/** The binding of one slot, shared by `useObjectControl` and the parts. */
export function useObjectSlot<K extends ObjectSlotId>(slotId: K): ObjectSlotBinding<K> {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const select = useCallback(() => toolbarCommandState(editor, slotId), [editor, slotId]);
  const state = useEditorState(select, sameState);
  return useMemo(() => {
    const run = (value: unknown, options?: EditorExecOptions): ExecResult =>
      runToolbarCommand(editor, slotId as ChromeSlotId as never, value as never, options);
    const control = {
      slotId,
      label: t((LABEL_KEYS.get(slotId) ?? slotId) as TranslationKey),
      value: objectSlotValue(slotId, state.value),
      options: objectSlotOptions(slotId),
      isActive: state.active,
      isEnabled: state.enabled,
      disabledReason: localizeDisabledReason(state.disabledReason, t),
      execute: (value: ObjectSlotValueMap[K], options?: EditorExecOptions) => run(value, options),
      ...(chartSlotIsToggle(slotId)
        ? { toggle: (options?: EditorExecOptions) => run(undefined, options) }
        : {}),
    } as UseObjectControlReturn<K>;
    return {
      control,
      text: state.value ?? '',
      apply: (value: unknown) => {
        const result = run(value);
        return result.ok ? null : (localizeDisabledReason(result.reason, t) ?? '');
      },
    };
  }, [editor, slotId, state, t]);
}

/**
 * Bind one `shape.*` or `chart.*` slot: its typed value, the values a list offers, the enabled
 * state, the translated reason, and `execute`. Use it to build a control the packaged parts do
 * not cover. @public
 */
export function useObjectControl<K extends ObjectSlotId>(slotId: K): UseObjectControlReturn<K> {
  return useObjectSlot(slotId).control;
}

/** A part component: it renders one slot, and `docxSlot` names the slot for toolbar overrides. @public */
export type ObjectPartComponent<P, S extends ObjectSlotId> = ((props: P) => ReactElement | null) & {
  readonly docxSlot: S;
};

/** Mark a part with its slot, so `DocxEditor.Toolbar` replaces that slot with it. */
export function objectPart<P, S extends ObjectSlotId>(
  slot: S,
  render: (props: P) => ReactElement | null
): ObjectPartComponent<P, S> {
  return Object.assign(render, { docxSlot: slot });
}

/** The root of a part: its label, its control, and the disabled reason of a field. */
export function ObjectControlFrame(props: {
  slotId: ObjectSlotId;
  variant: ObjectControlVariant;
  className: string | undefined;
  reason: string | null;
  reasonId: string;
  active?: boolean;
  children: ReactNode;
}): ReactElement {
  const { variant, reason } = props;
  // A part placed outside every scoped element (a host toolbar beside `Root`) carries the
  // scope itself, so the chrome tokens, dark mode, and the popover position apply there too.
  const scope = useChromeScopeClassName();
  return (
    <ScopedByAncestorContext.Provider value={true}>
      <div
        className={`${scope}docx-object-control docx-object-control--${variant}${props.className ? ` ${props.className}` : ''}`}
        data-slot={props.slotId}
        data-active={props.active ? '' : undefined}
        data-disabled={reason !== null ? '' : undefined}
        title={variant === 'compact' ? (reason ?? undefined) : undefined}
        onMouseDown={variant === 'compact' ? guardToolbarMousedown : undefined}
      >
        {props.children}
        {reason !== null && variant === 'field' ? (
          <p className="docx-chart-pane__note" id={props.reasonId}>
            {reason}
          </p>
        ) : null}
      </div>
    </ScopedByAncestorContext.Provider>
  );
}

/** A colour part: a trigger that names the colour, and the shared grid. */
export function ColorControl<K extends 'shape.fill' | 'shape.outlineColor'>(
  props: ObjectButtonPartProps & {
    slotId: K;
    /** What the trigger says: the colour's name, No fill, Gradient. */
    summary: string;
    noneLabel: string;
    /** Text under the control in a field, such as a note about a fill it cannot show. */
    after?: ReactNode;
  }
): ReactElement | null {
  const { control, text, apply } = useObjectSlot(props.slotId);
  const reasonId = useId();
  const labelId = useId();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const label = props.label ?? control.label;
  const value: ColorPickerValue = text === '' ? null : (text as ColorPick);
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      <ColorPicker.Root value={value} disabled={!control.isEnabled} onPick={apply}>
        <span
          className={`docx-chart-pane__label${variant === 'compact' ? ' docx-editor-sr-only' : ''}`}
          id={labelId}
        >
          {label}
        </span>
        <ColorPicker.Trigger
          asChild={props.asChild}
          aria-labelledby={labelId}
          aria-describedby={
            control.disabledReason !== null && variant === 'field' ? reasonId : undefined
          }
          title={variant === 'compact' ? `${label}: ${props.summary}` : undefined}
        >
          {props.asChild ? (
            props.children
          ) : (
            <>
              {variant === 'compact' ? (
                <span className="docx-object-control__icon" aria-hidden="true">
                  {props.icon ?? chromeIcon(ICONS.get(props.slotId))}
                </span>
              ) : null}
              <span className="docx-color-picker__summary docx-shape-pane__summary">
                {props.summary}
              </span>
            </>
          )}
        </ColorPicker.Trigger>
        <ColorPicker.Content aria-label={label}>
          <ColorPicker.NoColor>{props.noneLabel}</ColorPicker.NoColor>
          <ColorPicker.Grid />
          <ColorPicker.HexInput />
        </ColorPicker.Content>
      </ColorPicker.Root>
      {variant === 'field' ? props.after : null}
    </ObjectControlFrame>
  );
}

/** A list part. `other` names a value that is none of `options` (mixed, custom). */
export function ChoiceControl<K extends ObjectSlotId>(
  props: ObjectControlProps & {
    slotId: K;
    options: readonly (readonly [string, string])[];
    other?: string;
    /** Turns the picked option text into the slot value. Default the text itself. */
    parse?: (text: string) => ObjectSlotValueMap[K];
    /** Text under the list, such as a note after a change. */
    after?: ReactNode;
    onApplied?: (refusal: string | null) => void;
  }
): ReactElement | null {
  const { control, text: value, apply } = useObjectSlot(props.slotId);
  const id = useId();
  const reasonId = useId();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const label = props.label ?? control.label;
  const listed = props.options.some(([option]) => option === value);
  // With nothing selected, a compact list names itself, as its label is hidden.
  const placeholder =
    !control.isEnabled && value === '' && variant === 'compact' ? label : (props.other ?? '');
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      <div className="docx-chart-pane__field">
        <label
          className={`docx-chart-pane__label${variant === 'compact' ? ' docx-editor-sr-only' : ''}`}
          htmlFor={id}
        >
          {label}
        </label>
        <select
          id={id}
          className="docx-dialog__select"
          value={listed ? value : ''}
          disabled={!control.isEnabled}
          aria-describedby={
            control.disabledReason !== null && variant === 'field' ? reasonId : undefined
          }
          onChange={(event) => {
            const text = event.currentTarget.value;
            // Apply first: an optional call skips its argument when there is no listener.
            const refusal = apply(props.parse ? props.parse(text) : text);
            props.onApplied?.(refusal);
          }}
        >
          {listed ? null : (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {props.options.map(([option, text]) => (
            <option key={option} value={option}>
              {text}
            </option>
          ))}
        </select>
      </div>
      {props.after}
    </ObjectControlFrame>
  );
}

/** A text part that applies on Enter or blur; refused text stays with its reason. */
export function TextControl<K extends ObjectSlotId>(
  props: ObjectControlProps & {
    slotId: K;
    numeric?: boolean;
    /** The value the field shows; default the slot's value. */
    value?: string;
    /** Keeps unsaved text while it stays the same; default the slot id. */
    draftKey?: string;
    /** The id of more text that describes the field, such as a help note. */
    describedBy?: string;
  }
): ReactElement | null {
  const { control, text, apply } = useObjectSlot(props.slotId);
  const reasonId = useId();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const label = props.label ?? control.label;
  const described = [
    control.disabledReason !== null && variant === 'field' ? reasonId : null,
    props.describedBy ?? null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
    >
      <ChartField
        draftKey={props.draftKey ?? props.slotId}
        label={label}
        {...(variant === 'field' ? { visibleLabel: label } : {})}
        value={props.value ?? text}
        {...(props.numeric ? { numeric: true } : {})}
        disabled={!control.isEnabled}
        {...(described ? { describedBy: described } : {})}
        onCommit={apply}
      />
    </ObjectControlFrame>
  );
}

/** A toggle part: a check box row in a field, a pressed button in a toolbar. */
export function ToggleControl(
  props: ObjectButtonPartProps & { slotId: ObjectToggleSlotId }
): ReactElement | null {
  const { control, apply } = useObjectSlot(props.slotId);
  const reasonId = useId();
  const variant = useObjectControlVariant(props.variant);
  if (props.hidden) return null;
  const label = props.label ?? control.label;
  const button = {
    type: 'button' as const,
    className: 'docx-toolbar__button',
    'aria-label': label,
    title: label,
    'aria-pressed': control.isActive,
    disabled: !control.isEnabled,
    'data-active': control.isActive ? '' : undefined,
    onClick: () => control.toggle(),
  };
  return (
    <ObjectControlFrame
      slotId={props.slotId}
      variant={variant}
      className={props.className}
      reason={control.disabledReason}
      reasonId={reasonId}
      active={control.isActive}
    >
      {variant === 'compact' ? (
        props.asChild ? (
          <Slot {...button}>{props.children}</Slot>
        ) : (
          <button {...button}>{props.icon ?? chromeIcon(ICONS.get(props.slotId))}</button>
        )
      ) : (
        <label className="docx-dialog__checkbox-row">
          <input
            type="checkbox"
            checked={control.isActive}
            disabled={!control.isEnabled}
            aria-describedby={control.disabledReason !== null ? reasonId : undefined}
            onChange={(event) => apply(event.currentTarget.checked)}
          />
          {label}
        </label>
      )}
    </ObjectControlFrame>
  );
}
