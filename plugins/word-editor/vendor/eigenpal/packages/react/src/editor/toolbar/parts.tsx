// The named simple toolbar parts, the inert pickers, save, and the separator.
//
// Each part is pinned to one slot, carrying that slot as a STATIC (`docxSlot`) so the
// toolbar root can recognize it among children and replace the matching entry of the
// default arrangement in place. The static is the marker on purpose — displayName is
// stripped by minifiers and was never identity.
//
// Two part species live here:
//
// - `definePart(slot)`: a live `ToolbarButton` for an ICON-shaped chrome control. A
//   slot the engine has not wired renders disabled with the engine's own reason — the
//   registry's parity rule (visible, never dropped, never faked).

import { useContext } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { ToolbarContext, useToolbarLabel } from './toolbar-context';
import { Slot } from './Slot';
import {
  ToolbarButton,
  chromeControlForSlot,
  chromeIcon,
  guardToolbarMousedown,
  type ToolbarButtonProps,
} from './ToolbarButton';
import {
  ToolbarImageInsert,
  ToolbarImageProperties,
  ToolbarImageWrap,
  ToolbarImageAltText,
} from '../images';

/** Props for the named parts (`DocxEditorToolbar.Bold`, ...): the slot is pinned. @public */
export type ToolbarPartProps = Omit<ToolbarButtonProps, 'slot'>;

export interface ToolbarPartComponent {
  (props: ToolbarPartProps): ReturnType<typeof ToolbarButton>;
  readonly docxSlot: ChromeSlotId;
}

/**
 * Props for the non-button parts (pickers, steppers, color splits, save). @public
 */
export interface ToolbarSlotPartProps {
  className?: string;
  /**
   * Render nothing: inside the default arrangement this removes the slot in place. A named
   * part is shorthand for the slot override, so `<Toolbar.Bold hidden />` is
   * `<Toolbar.Slot slotId="text.bold" hidden />`.
   */
  hidden?: boolean;
}

/** A non-button part pinned to one slot. @public */
export interface ToolbarSlotPartComponent {
  (props: ToolbarSlotPartProps): ReturnType<typeof ToolbarButton>;
  readonly docxSlot: ChromeSlotId;
}

function definePart(slot: ChromeSlotId): ToolbarPartComponent {
  const Part = (props: ToolbarPartProps) => <ToolbarButton slotId={slot} {...props} />;
  return Object.assign(Part, { docxSlot: slot });
}

export const ToolbarUndo = definePart('history.undo');
export const ToolbarRedo = definePart('history.redo');
export const ToolbarBold = definePart('text.bold');
export const ToolbarItalic = definePart('text.italic');
export const ToolbarUnderline = definePart('text.underline');
export const ToolbarStrike = definePart('text.strike');
export const ToolbarClearFormatting = definePart('format.clear');
export const ToolbarSuperscript = definePart('script.super');
export const ToolbarSubscript = definePart('script.sub');
export const ToolbarAlignLeft = definePart('alignment.left');
export const ToolbarAlignCenter = definePart('alignment.center');
export const ToolbarAlignRight = definePart('alignment.right');
export const ToolbarAlignJustify = definePart('alignment.justify');
export const ToolbarLeftToRight = definePart('direction.ltr');
export const ToolbarRightToLeft = definePart('direction.rtl');
export const ToolbarBulletList = definePart('list.bullet');
export const ToolbarNumberedList = definePart('list.numbered');
export const ToolbarOutdent = definePart('list.outdent');
export const ToolbarIndent = definePart('list.indent');
export { ToolbarImageInsert, ToolbarImageProperties, ToolbarImageWrap, ToolbarImageAltText };
export { ToolbarTableInsert } from './TableInsert';
export { ToolbarAddComment } from './AddComment';
export const ToolbarComments = definePart('review.comments');

/**
 * Insert Link.
 *
 * Enabled state comes from the engine like every other control: `text.link` is enabled while
 * the selection could become a link and a link UI is registered. The CLICK runs no edit,
 * because a link needs a target and only that UI can supply one; it opens the same panel
 * Ctrl/Cmd+K opens, seeded from the link at the caret when there is one.
 */
function ToolbarLinkImpl({ className, hidden, icon, asChild, children }: ToolbarPartProps) {
  const { execute, isEnabled, disabledReason } = useEditorCommand('text.link');
  const label = useToolbarLabel();
  const shortcut = usePlatformShortcut();
  if (hidden) return null;
  const control = chromeControlForSlot('text.link');
  const text = shortcut(label(control?.labelKey ?? 'text.link'));
  const shared = {
    type: 'button' as const,
    className: `docx-toolbar__button${className ? ` ${className}` : ''}`,
    'data-slot': 'text.link',
    disabled: !isEnabled,
    ...(!isEnabled ? { 'data-disabled': '' } : {}),
    'aria-label': text,
    title: disabledReason ?? text,
    onMouseDown: guardToolbarMousedown,
    // Exactly what Ctrl/Cmd+K does — one behaviour, so the button and the shortcut cannot
    // drift: edit mode pre-filled when the caret is in a link, a fresh insert seeded with
    // the selected text otherwise, anchored at the caret either way.
    onClick: () => execute(),
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <button {...shared}>{icon ?? children ?? chromeIcon(control?.paths)}</button>;
}

export const ToolbarLink: ToolbarPartComponent = Object.assign(ToolbarLinkImpl, {
  docxSlot: 'text.link' as ChromeSlotId,
});

/**
 * The save control. Save is not an engine command (`Editor.save()` returns bytes the
 * HOST must do something with), so this part is live only when the toolbar was given
 * an `onSave` handler — the same contract as the Vue registry toolbar.
 */
function ToolbarSaveImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const { onSave } = useContext(ToolbarContext);
  const label = useToolbarLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('file.save');
  const text = label(control?.labelKey ?? 'file.save');
  const disabled = !editor || !onSave;
  return (
    <button
      type="button"
      className={`docx-toolbar__button${className ? ` ${className}` : ''}`}
      data-slot="file.save"
      disabled={disabled}
      {...(disabled ? { 'data-disabled': '' } : {})}
      aria-label={text}
      title={text}
      onMouseDown={guardToolbarMousedown}
      onClick={() => onSave?.()}
    >
      {chromeIcon(control?.paths)}
    </button>
  );
}

export const ToolbarSave: ToolbarSlotPartComponent = Object.assign(ToolbarSaveImpl, {
  docxSlot: 'file.save' as ChromeSlotId,
});

/** Props for `DocxEditorToolbar.Separator`. @public */
export interface ToolbarSeparatorProps {
  className?: string;
}

/** A vertical rule between toolbar groups. @public */
export function ToolbarSeparator({ className }: ToolbarSeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`docx-toolbar__separator${className ? ` ${className}` : ''}`}
    />
  );
}
