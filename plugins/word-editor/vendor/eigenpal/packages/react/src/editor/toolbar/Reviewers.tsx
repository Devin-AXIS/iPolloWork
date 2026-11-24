// Word for Mac's Review > Markup Options > Reviewers menu.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import {
  hostDocumentOf,
  listenForOutsidePress,
  toolbarCommandState,
} from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useReviewAuthors } from '../useReviewAuthors';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { usePopupEscape } from './usePopupEscape';

const selectHiddenAuthors = (snapshot: EditorSnapshot): readonly string[] =>
  snapshot.hiddenReviewAuthors ?? [];

/** Props for `DocxEditor.Toolbar.Reviewers`. @public */
export type ToolbarReviewersProps = {
  className?: string;
  hidden?: boolean;
  /** Custom trigger icon. */
  icon?: DocxEditorChildren;
};

/** The reviewer visibility menu. It changes view state only. @public */
export function ToolbarReviewers({ className, hidden, icon }: ToolbarReviewersProps) {
  const editor = useDocxEditor();
  const authors = useReviewAuthors();
  const hiddenAuthors = useEditorState(selectHiddenAuthors);
  const hiddenSet = new Set(hiddenAuthors);
  const allVisible = authors.every((info) => !hiddenSet.has(info.author));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const label = useToolbarLabel();
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
    return listenForOutsidePress({
      popup: rootRef.current,
      close: () => setOpen(false),
    });
  }, [open]);
  // Escape through the shared rule: a host input keeps its own Escape.
  usePopupEscape(open, rootRef, (fromInside) => {
    setOpen(false);
    if (fromInside) triggerRef.current?.focus();
  });

  const onMenuKeyDown = useCallback((event: React.KeyboardEvent): void => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ?? []),
    ];
    const at = items.indexOf(hostDocumentOf(menuRef.current).activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Tab') setOpen(false);
  }, []);

  if (hidden) return null;
  const control = chromeControlForSlot('review.authors');
  const state = toolbarCommandState(editor, 'review.authors');
  const disabledReason = localizeDisabledReason(state.disabledReason, t);
  const text = label(control?.labelKey ?? 'reviewers.label');
  return (
    <div
      ref={rootRef}
      className={`docx-toolbar__reviewers${className ? ` ${className}` : ''}`}
      data-slot="review.authors"
    >
      <button
        ref={triggerRef}
        type="button"
        className="docx-toolbar__picker"
        data-testid="reviewers-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={text}
        disabled={!state.enabled}
        title={disabledReason ?? text}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((value) => !value)}
      >
        {icon ?? chromeIcon(control?.paths)}
        <span className="docx-toolbar__picker-value">{text}</span>
        <span className="docx-toolbar__picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="docx-toolbar__reviewers-menu"
          role="menu"
          aria-label={text}
          data-testid="reviewers-menu"
          onKeyDown={onMenuKeyDown}
        >
          <ReviewerRow
            checked={allVisible}
            label={t('reviewers.all')}
            testId="reviewer-all"
            onChoose={() => editor?.setAllReviewAuthorsVisible(!allVisible)}
          />
          <div className="docx-toolbar__menu-separator" role="separator" />
          {authors.map((info) => (
            <ReviewerRow
              key={info.author}
              checked={!hiddenSet.has(info.author)}
              label={info.author || '—'}
              testId={`reviewer-${info.slot}`}
              color={info.color}
              onChoose={() =>
                editor?.setReviewAuthorVisible(info.author, hiddenSet.has(info.author))
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
ToolbarReviewers.docxSlot = 'review.authors' as const;

function ReviewerRow(props: {
  checked: boolean;
  label: string;
  testId: string;
  color?: string;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={props.checked}
      className="docx-toolbar__reviewer-item"
      data-testid={props.testId}
      onMouseDown={guardToolbarMousedown}
      onClick={props.onChoose}
    >
      <span className="docx-toolbar__menu-check" aria-hidden="true">
        {props.checked ? '✓' : ''}
      </span>
      {props.color ? (
        <span className="docx-toolbar__reviewer-swatch" style={{ background: props.color }} />
      ) : null}
      <span className="docx-toolbar__reviewer-name">{props.label}</span>
    </button>
  );
}
