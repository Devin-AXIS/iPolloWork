import type { DocxEditorChildren } from '../../docx-editor-children';
// A toolbar control for an action the CHROME REGISTRY does not describe.
//
// `ToolbarButton` is deliberately slot-bound: it takes a `ChromeSlotId` and derives its
// label, icon, command and enabled state from the registry, which is what keeps a toolbar
// button and its menu twin from describing the same capability two different ways. That is
// the right default and the wrong constraint for a host's OWN action — "Send for review",
// "Insert clause", "Attach to matter" — which has no slot and never will.
//
// Without this, such a host hand-wrote `<button className="docx-toolbar__button">` and
// re-derived our hover, active and disabled treatment from the stylesheet by reading it.
// That is a private class name doing public API's job: it pins the host to our CSS
// internals, and every one of them re-implements the caret guard (or forgets to, and the
// button steals the selection on mousedown). The menu already had `Menu.Row` for exactly
// this; the toolbar had nothing, and the asymmetry was the gap.
//
// It is NOT a way to fake a chrome slot. There is no `slot` prop and no engine wiring:
// enabled state, pressed state and the action are the host's to supply, because the engine
// has no opinion about an action it does not model. A control the ENGINE owns still belongs
// on a slot.

import type { MouseEvent } from 'react';
import { Slot } from './Slot';
import { guardToolbarMousedown } from './ToolbarButton';
import { useToolbarPlacement } from './ToolbarGroup';
import { useToolbarOverflowClose } from './ToolbarOverflow';

/** Props for `DocxEditorToolbar.Action`. @public */
export interface ToolbarActionProps {
  /**
   * Accessible name and tooltip. A resolved STRING, not an i18n key: the label belongs to
   * the host's own action, so the host's own catalogue resolves it. (Registry controls go
   * the other way — they carry keys and the toolbar's `t` resolves them.)
   */
  label: string;
  /** Icon content. Inline SVG sized ~18px matches the packaged controls. */
  icon?: DocxEditorChildren;
  /** Pressed state, for an action that toggles. Sets `aria-pressed` and `data-active`. */
  active?: boolean;
  disabled?: boolean;
  /** Tooltip when disabled — say why, the way the engine's controls do. */
  disabledReason?: string;
  onSelect?: () => void;
  /** Merge the behavior onto the single child element instead of rendering a `<button>`. */
  asChild?: boolean;
  className?: string;
  children?: DocxEditorChildren;
}

/**
 * A host-owned toolbar action, styled and behaved like the packaged controls.
 *
 * Inside `<DocxEditor.Toolbar>` it appends after the default arrangement and never
 * collapses. Put it in a `Toolbar.Group` to have it collapse into the "⋯" panel, where it
 * renders as a row with its icon and `label`. Under `preset={false}` it renders as written.
 *
 * @public
 */
export function ToolbarAction(props: ToolbarActionProps) {
  const { label, icon, active, disabled, disabledReason, onSelect, asChild, className, children } =
    props;
  const placement = useToolbarPlacement();
  const close = useToolbarOverflowClose();
  if (placement === 'panel' && !asChild) {
    // A collapsed host group: the same row the panel's own commands use, icon and label.
    return (
      <button
        type="button"
        className={`docx-toolbar__more-command${className ? ` ${className}` : ''}`}
        disabled={disabled}
        {...(active ? { 'data-active': '' } : {})}
        {...(active !== undefined ? { 'aria-pressed': active } : {})}
        {...(disabled && disabledReason ? { title: disabledReason } : {})}
        onMouseDown={(event) => guardToolbarMousedown(event)}
        onClick={(event) => {
          onSelect?.();
          close(event.detail === 0);
        }}
      >
        <span className="docx-toolbar__more-command-icon" aria-hidden="true">
          {icon ?? children}
        </span>
        <span className="docx-toolbar__more-command-label">{label}</span>
      </button>
    );
  }
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    disabled,
    // Same presence-attribute vocabulary as the registry controls, so a host's CSS and
    // ours select the same way.
    ...(active ? { 'data-active': '' } : {}),
    ...(disabled ? { 'data-disabled': '' } : {}),
    ...(active !== undefined ? { 'aria-pressed': active } : {}),
    'aria-label': label,
    title: disabled ? (disabledReason ?? label) : label,
    // The caret guard is the reason this exists as a component rather than as a
    // documented class name: a hand-rolled button that forgets it moves the selection on
    // every press, and the bug looks like an editor bug.
    onMouseDown: (event: MouseEvent) => guardToolbarMousedown(event),
    onClick: disabled ? undefined : onSelect,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon ?? children}</button>;
}
