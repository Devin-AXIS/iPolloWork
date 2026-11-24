import type { DocxEditorChildren } from '../../docx-editor-children';
import type { ReactNode } from 'react';
// The generic toolbar control: one chrome slot as a live button.
//
// State comes from `useEditorCommand` (the shared can-before-exec table — enabled,
// active, and the ENGINE'S disabled reason, never an adapter paraphrase). Presentation
// comes from the chrome registry: the slot's `labelKey` resolves through the toolbar's
// `t` (falling back to the key, never to English), and the icon falls back to the
// registry's Material Symbols paths rendered as inline SVG — the same rendering the Vue
// registry toolbar uses, so the two adapters draw the same glyphs.

import type { MouseEvent } from 'react';
import {
  CHROME_GROUPS,
  chromeSlotId,
  chromeSlotIsToggle,
  type ChromeControl,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import { warnDeprecatedButtonSlot, warnMissingButtonSlot } from '../menu/menu-warnings';

/** The registry control behind one slot id, for its labelKey and icon paths. */
export function chromeControlForSlot(slotId: ChromeSlotId): ChromeControl | null {
  for (const group of CHROME_GROUPS) {
    for (const control of group.controls) {
      if (chromeSlotId(group, control) === slotId) return control;
    }
  }
  return null;
}

/** Registry icon paths as inline SVG (Material Symbols viewBox), aria-hidden. */
export function chromeIcon(paths: readonly string[] | null | undefined): ReactNode {
  if (!paths) return null;
  return (
    <svg viewBox="0 -960 960 960" width={18} height={18} aria-hidden="true" focusable="false">
      {paths.map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Keep the caret: a mousedown that bubbles to the editor moves it, so toolbar controls
 * prevent the default — EXCEPT on form fields, which need the mousedown to focus.
 */
export function guardToolbarMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** The slot a toolbar button names: `slotId`, else the deprecated `slot`. @internal */
export function toolbarButtonSlotId(props: {
  readonly slotId?: ChromeSlotId | undefined;
  readonly slot?: ChromeSlotId | undefined;
}): ChromeSlotId | undefined {
  if (props.slotId) return props.slotId;
  if (props.slot) {
    warnDeprecatedButtonSlot(props.slot);
    return props.slot;
  }
  warnMissingButtonSlot();
  return undefined;
}

/** Props for `DocxEditorToolbar.Button`. @public */
export interface ToolbarButtonProps {
  /**
   * The chrome slot this button drives (`'text.bold'`, `'history.undo'`, ...). A button with
   * neither `slotId` nor the deprecated `slot` renders nothing, with a development warning.
   */
  slotId?: ChromeSlotId;
  /** @deprecated Use `slotId`. Still read in this release, with a development warning. */
  slot?: ChromeSlotId;
  /** Icon override; falls back to `children`, then to the registry's icon paths. */
  icon?: DocxEditorChildren;
  /** Merge the button's behavior into the single child element instead of a <button>. */
  asChild?: boolean;
  className?: string;
  children?: DocxEditorChildren;
  /**
   * Render nothing: inside the default arrangement this removes the slot in place. A named
   * part is shorthand for the slot override, so `<Toolbar.Bold hidden />` is
   * `<Toolbar.Slot slotId="text.bold" hidden />`.
   */
  hidden?: boolean;
}

/**
 * One chrome slot as a live toolbar button: enabled/active from the engine's
 * can-before-exec answer, labelled from the registry's i18n key, `data-active` /
 * `data-disabled` presence attributes for styling, `aria-pressed` on toggles.
 *
 * @public
 */
export function ToolbarButton(props: ToolbarButtonProps) {
  const { icon, asChild, className, children, hidden } = props;
  const slot = toolbarButtonSlotId(props) ?? ('' as ChromeSlotId);
  const { execute, isActive, isEnabled, disabledReason, value } = useEditorCommand(slot);
  const label = useToolbarLabel();
  const shortcut = usePlatformShortcut();
  if (hidden || !slot) return null;

  const control = chromeControlForSlot(slot);
  // A registry label is tooltip-shaped and often NAMES its chord ("Bold (Ctrl+B)"). The
  // catalogue can only state one spelling, and the engine's accelerator is Ctrl OR Cmd —
  // so the printed name is corrected for this keyboard rather than translated twice.
  const text = shortcut(label(control?.labelKey ?? slot));
  // `aria-pressed` only where pressed-ness is meaningful. The rule is the ENGINE's, because
  // it is not derivable from the command table alone — see `chromeSlotIsToggle`.
  const isToggle = chromeSlotIsToggle(slot);

  const shared = {
    onClick: () => execute(),
    onMouseDown: guardToolbarMousedown,
    disabled: !isEnabled,
    // Stable slot identity for hosts, tests, and e2e — control ids alone collide
    // (`image.insert` / `table.insert`), so the full slot id is the marker.
    'data-slot': slot,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    // Presence attributes: present (empty string) when on, absent when off.
    ...(isActive ? { 'data-active': '' } : {}),
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    ...(isToggle ? { 'aria-pressed': isActive } : {}),
    // The slot's reported value, for the controls whose state is more than pressed-or-not:
    // the format painter renders `once` and `locked` differently, and only the engine knows
    // which is live. Absent for every slot that reports none, so nothing else gains an
    // attribute.
    ...(value !== null ? { 'data-value': value } : {}),
    'aria-label': text,
    // The engine's own reason surfaces as the tooltip when disabled.
    title: disabledReason ?? text,
  };

  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return (
    <button type="button" {...shared}>
      {icon ?? children ?? chromeIcon(control?.paths)}
    </button>
  );
}

// Part marker: the toolbar root recognizes a `<ToolbarButton slotId="...">` child by
// this static plus its `slotId` (or deprecated `slot`) prop (never by displayName, which minifies away).
ToolbarButton.docxToolbarPart = true as const;
