// The line-spacing dropdown: Word's control, which is a line-spacing menu AND the
// paragraph space-before/after commands under one caret.
//
// Both halves are engine commands, and both write the SAME `w:spacing` element — the line
// rule, the space before and the space after are three independent settings in one
// attribute set, which is why the writes merge rather than replace (see
// `setParagraphProperty`'s `mergeAttributes`). The ticked row and the add/remove wording
// come off the snapshot, so the menu reflects the paragraph the caret is in rather than
// showing a fixed list of things to apply.

import { useCallback, useRef, useState } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  lineSpacingMenuRowLabel,
  lineSpacingMenuRows,
  type LineSpacingMenuRow,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useParagraphDialog } from '../paragraph-dialog-host';
import { useTranslation } from '../../i18n';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartProps, ToolbarSlotPartComponent } from './parts';
import { useDropdownClose } from './useDropdownClose';

/**
 * What Word's "Add space before/after paragraph" writes: a flat 10pt.
 *
 * The ribbon command's own constant, not a value read from the document — a paragraph given
 * space this way lands on 10pt whatever its style states, so the pair is not a round trip
 * back to a Normal that states 8pt.
 */
const DEFAULT_PARAGRAPH_SPACE_PT = 10;

/**
 * Word's "Remove space before/after paragraph" writes an explicit ZERO, not nothing.
 *
 * The two are different answers, and the command draws the same distinction: dropping the
 * attribute lets the paragraph inherit again, so on a paragraph whose SPACE CAME FROM ITS
 * STYLE — every Word default document, whose Normal states 8pt after — Remove gave the space
 * straight back and the row went on offering to remove it. A zero blocks the cascade, which
 * is what the row says it does.
 */
const REMOVED_PARAGRAPH_SPACE_PT = 0;

const selectSpacing = (snapshot: EditorSnapshot) => ({
  lineSpacing: snapshot.formatting?.lineSpacing ?? null,
  spaceBeforePt: snapshot.formatting?.spaceBeforePt ?? null,
  spaceAfterPt: snapshot.formatting?.spaceAfterPt ?? null,
});

const sameSpacing = (a: ReturnType<typeof selectSpacing>, b: ReturnType<typeof selectSpacing>) =>
  a.spaceBeforePt === b.spaceBeforePt &&
  a.spaceAfterPt === b.spaceAfterPt &&
  a.lineSpacing?.rule === b.lineSpacing?.rule &&
  a.lineSpacing?.value === b.lineSpacing?.value;

function ToolbarLineSpacingImpl({ className, hidden }: ToolbarSlotPartProps) {
  const editor = useDocxEditor();
  const spacing = useEditorState(selectSpacing, sameSpacing);
  const { isEnabled, disabledReason } = useEditorCommand('list.lineSpacing');
  // The row opens a `setParagraphFormat` editor, so THAT is the command whose availability
  // decides whether it works — not `list.lineSpacing`, whose gate it used to borrow. Asked
  // through the same hook the dialog itself uses, so there is still one answer.
  // Through the registry, so the row's enabled state has the same single source every
  // other control does — `toolbarCommandState`, via the `paragraph.dialog` slot's probe.
  const paragraphDialogCommand = useEditorCommand('paragraph.dialog');
  const paragraphDialog = useParagraphDialog();
  const label = useToolbarLabel();
  const { lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useDropdownClose(open, setOpen, rootRef, hidden);

  const applyRow = useCallback(
    (row: LineSpacingMenuRow) => {
      setOpen(false);
      // The selected row has no command: it already holds (see `LineSpacingMenuRow`).
      if (!editor || !row.command) return;
      if (editor.can(row.command).ok) editor.exec(row.command);
    },
    [editor]
  );

  const applySpace = useCallback(
    (field: 'beforePt' | 'afterPt', points: number | null) => {
      setOpen(false);
      if (!editor) return;
      const command = { type: 'setParagraphSpacing' as const, [field]: points };
      if (editor.can(command).ok) editor.exec(command);
    },
    [editor]
  );

  if (hidden) return null;
  const control = chromeControlForSlot('list.lineSpacing');
  // Word's rows flip between Add and Remove on what the paragraph actually has, so the menu
  // never offers to add space that is already there.
  const hasBefore = (spacing.spaceBeforePt ?? 0) > 0;
  const hasAfter = (spacing.spaceAfterPt ?? 0) > 0;
  // The spacing in force always shows as a ticked row, even one no preset matches; a mixed
  // selection ticks none.
  const rows = lineSpacingMenuRows(spacing.lineSpacing);

  return (
    <span ref={rootRef} className="docx-toolbar__line-spacing" data-slot="list.lineSpacing">
      <button
        ref={triggerRef}
        type="button"
        className={`docx-toolbar__button docx-toolbar__line-spacing-trigger${className ? ` ${className}` : ''}`}
        disabled={!isEnabled}
        {...(!isEnabled ? { 'data-disabled': '' } : {})}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label('lineSpacing.label')}
        title={disabledReason ?? label('lineSpacing.label')}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((current) => !current)}
      >
        {chromeIcon(control?.paths)}
        <span className="docx-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && isEnabled ? (
        <div className="docx-toolbar__menu docx-toolbar__line-spacing-menu" role="menu">
          {rows.map((row) => {
            const selected = row.selected;
            return (
              <button
                key={`${row.spacing.rule}:${row.spacing.value}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                {...(selected ? { 'data-selected': '' } : {})}
                className="docx-toolbar__menu-item"
                onMouseDown={guardToolbarMousedown}
                onClick={() => applyRow(row)}
              >
                {lineSpacingMenuRowLabel(row, label, lang)}
                {selected ? (
                  <span className="docx-toolbar__menu-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
          <div className="docx-toolbar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="docx-toolbar__menu-item"
            // Its own slot, so the row is addressable like any other control and its
            // enabled state comes from `toolbarCommandState` rather than a second
            // implementation beside it.
            data-slot="paragraph.dialog"
            disabled={!paragraphDialogCommand.isEnabled}
            title={paragraphDialogCommand.disabledReason ?? undefined}
            onMouseDown={guardToolbarMousedown}
            onClick={() => {
              setOpen(false);
              // The dialog lives above the toolbar: this part moves between the bar and the
              // overflow panel, and a dialog mounted inside it went with it, mid-edit.
              // The trigger, not the menu item: the menu closes in this same gesture, so
              // the row the user clicked is gone by the time the dialog does.
              paragraphDialog?.open(triggerRef.current);
            }}
          >
            {label('lineSpacing.options')}
          </button>
          <div className="docx-toolbar__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() =>
              applySpace(
                'beforePt',
                hasBefore ? REMOVED_PARAGRAPH_SPACE_PT : DEFAULT_PARAGRAPH_SPACE_PT
              )
            }
          >
            {label(hasBefore ? 'lineSpacing.removeSpaceBefore' : 'lineSpacing.addSpaceBefore')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="docx-toolbar__menu-item"
            onMouseDown={guardToolbarMousedown}
            onClick={() =>
              applySpace(
                'afterPt',
                hasAfter ? REMOVED_PARAGRAPH_SPACE_PT : DEFAULT_PARAGRAPH_SPACE_PT
              )
            }
          >
            {label(hasAfter ? 'lineSpacing.removeSpaceAfter' : 'lineSpacing.addSpaceAfter')}
          </button>
        </div>
      ) : null}
    </span>
  );
}

/** The line-spacing part (`DocxEditorToolbar.LineSpacing`): wired to `list.lineSpacing`. */
export const ToolbarLineSpacing: ToolbarSlotPartComponent = Object.assign(ToolbarLineSpacingImpl, {
  docxSlot: 'list.lineSpacing' as const,
});
