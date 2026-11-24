// Word for Mac's Review > Markup Options > Reviewers hierarchy.

import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { toolbarCommandState } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useReviewAuthors } from '../useReviewAuthors';
import { useMenuLabel } from './menu-context';
import { Menu, MenuRow, MenuSubmenu, type MenuPartComponent, type MenuProps } from './parts';

const selectHiddenAuthors = (snapshot: EditorSnapshot): readonly string[] =>
  snapshot.hiddenReviewAuthors ?? [];

export type MenuReviewersProps = {
  className?: string;
  hidden?: boolean;
};

/** The document-dependent Reviewers submenu. It changes view state only. @public */
export function MenuReviewers({ className, hidden }: MenuReviewersProps) {
  const editor = useDocxEditor();
  const authors = useReviewAuthors();
  const hiddenAuthors = useEditorState(selectHiddenAuthors);
  const label = useMenuLabel();
  const { t } = useTranslation();
  if (hidden) return null;

  const text = label('reviewers.label');
  const state = toolbarCommandState(editor, 'review.authors');
  const disabledReason = localizeDisabledReason(state.disabledReason, t);
  if (!state.enabled) {
    return (
      <MenuRow disabled title={disabledReason ?? undefined} slot="review.authors">
        {text}
      </MenuRow>
    );
  }

  const hiddenSet = new Set(hiddenAuthors);
  const allVisible = authors.every((info) => !hiddenSet.has(info.author));
  return (
    <MenuSubmenu labelKey="reviewers.label" className={className}>
      <ReviewerRow
        checked={allVisible}
        label={label('reviewers.all')}
        slot="reviewer-all"
        onChoose={() => editor?.setAllReviewAuthorsVisible(!allVisible)}
      />
      <div className="docx-toolbar__menu-separator" role="separator" />
      {authors.map((info) => (
        <ReviewerRow
          key={info.author}
          checked={!hiddenSet.has(info.author)}
          label={info.author || '—'}
          slot={`reviewer-${info.slot}`}
          onChoose={() => editor?.setReviewAuthorVisible(info.author, hiddenSet.has(info.author))}
        />
      ))}
    </MenuSubmenu>
  );
}

function ReviewerRow(props: {
  checked: boolean;
  label: string;
  slot: string;
  onChoose: () => void;
}) {
  return (
    <MenuRow
      active={props.checked}
      slot={props.slot}
      className="docx-menubar__reviewer-item"
      icon={<span className="docx-menubar__reviewer-check">{props.checked ? '✓' : ''}</span>}
      onSelect={props.onChoose}
    >
      {props.label}
    </MenuRow>
  );
}

function MenuReviewImpl({ children, ...rest }: Omit<MenuProps, 'id'>) {
  return (
    <Menu id="review" {...rest}>
      <MenuSubmenu labelKey="reviewers.markupOptions" className="docx-menubar__markup-options">
        <MenuReviewers className="docx-menubar__reviewers-submenu" />
      </MenuSubmenu>
      {children}
    </Menu>
  );
}

/** The packaged top-level Review menu. @public */
export const MenuReview: MenuPartComponent = Object.assign(MenuReviewImpl, {
  docxMenu: 'review' as const,
});
