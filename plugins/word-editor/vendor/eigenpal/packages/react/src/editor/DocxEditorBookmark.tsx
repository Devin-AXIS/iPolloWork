import {
  createDialogParts,
  useDialogDocument,
  DialogFrame,
  type DialogCustomizationProps,
  type DialogPartProps,
  type UseDialogReturn,
} from './dialog-parts';
// The Bookmark dialog as a context-fed part (`DocxEditor.BookmarkDialog`).
//
// Lists the document's bookmarks, sorted by name or by location, with hidden bookmarks on
// request. Add bookmarks the selection under the typed name and closes; Delete removes the
// named bookmark; Go To selects it and keeps the dialog open. The list order and the name
// rules come from the engine (`bookmarkDialogRows`, `bookmarkDialogNameState`), so the React
// and Vue dialogs answer alike.

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  bookmarkDialogInitialName,
  bookmarkDialogNameState,
  bookmarkDialogRows,
  isHTMLElementNode,
  type BookmarkSortOrder,
} from '@docx-editor.dev/core/editor';
import type { BookmarkSummary } from '@docx-editor.dev/core/contracts/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useBookmarks } from './useBookmarks';

/** Props for `DocxEditor.BookmarkDialog`. @public */
export interface DocxEditorBookmarkDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Add. */
  onClose: () => void;
}

/** The Bookmark dialog's draft. @public */
export interface BookmarkDialogFields {
  /** The name typed or picked from the list. */
  name: string;
  sortBy: BookmarkSortOrder;
  /** Whether hidden bookmarks (names starting with an underscore) are listed. */
  showHidden: boolean;
}

/** Bookmark dialog draft and actions. `apply` is Add. @public */
export interface UseBookmarkDialogReturn extends UseDialogReturn<BookmarkDialogFields> {
  /** The bookmarks the list shows, in the chosen order. */
  readonly rows: readonly BookmarkSummary[];
  /** Whether Delete and Go To can act on the typed name. */
  readonly canDelete: boolean;
  readonly canGoTo: boolean;
  /**
   * How many other places carry the typed bookmark's name, which collaborators adding one name
   * offline can leave. 0 for a name with one bookmark, or no bookmark.
   */
  readonly duplicates: number;
  remove(): void;
  goTo(): void;
  /** Keep the first bookmark with the typed name and remove its copies. */
  keepFirst(): void;
}

const PROBLEM_KEYS = {
  empty: 'dialogs.bookmark.nameEmpty',
  tooLong: 'dialogs.bookmark.nameTooLong',
  invalidStart: 'dialogs.bookmark.nameInvalidStart',
  invalidCharacter: 'dialogs.bookmark.nameInvalidCharacter',
} as const satisfies Record<string, TranslationKey>;

/**
 * The dialog is mounted only while it is open, so a closed dialog reads no bookmarks on each
 * editor update. Each opening starts a fresh draft.
 */
function BookmarkDialogRoot(props: DocxEditorBookmarkDialogProps): ReactElement | null {
  return props.open ? <OpenBookmarkDialog {...props} /> : null;
}

function OpenBookmarkDialog({
  open,
  onClose,
  className,
  style,
  children,
  preset = true,
}: DocxEditorBookmarkDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const validDocument = useDialogDocument(open, onClose);
  const { bookmarks, isWritable, insert, remove, goTo, keepFirst } = useBookmarks();
  // Opened inside a bookmark, the dialog names it, ready for Go To or Delete.
  const [name, setName] = useState(() => bookmarkDialogInitialName(bookmarks));
  const [sortBy, setSortBy] = useState<BookmarkSortOrder>('name');
  const [showHidden, setShowHidden] = useState(false);
  const [refused, setRefused] = useState(false);
  const [attempted, setAttempted] = useState(false);
  // After Go To the dialog has done something, so its dismiss button reads Close.
  const [visited, setVisited] = useState(false);
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const listRef = useRef<HTMLSelectElement | null>(null);
  const nameId = useId();
  const messageId = useId();
  const sortGroup = useId();

  const rows = bookmarkDialogRows(bookmarks, { sortBy, showHidden });
  const nameState = bookmarkDialogNameState(bookmarks, name, isWritable);
  // A picked existing name (a hidden one, say) is for Go To and Delete: no complaint about it.
  const problem =
    nameState.problem && !nameState.existing && (attempted || name.length > 0)
      ? nameState.problem
      : null;
  const duplicates = nameState.existing?.duplicates ?? 0;
  const message = refused
    ? t('dialogs.bookmark.refused')
    : problem
      ? t(PROBLEM_KEYS[problem])
      : duplicates > 0
        ? t('dialogs.bookmark.duplicates', { count: duplicates })
        : nameState.existing && nameState.canAdd
          ? t('dialogs.bookmark.nameExists')
          : null;

  const handleAdd = useCallback(() => {
    setAttempted(true);
    if (!nameState.canAdd) return;
    if (!validDocument()) {
      onClose();
      return;
    }
    const result = insert(name);
    setRefused(!result.ok);
    if (result.ok) onClose();
  }, [nameState.canAdd, validDocument, insert, name, onClose]);

  const handleRemove = useCallback(() => {
    if (!nameState.canDelete || !nameState.existing) return;
    const result = remove(nameState.existing.name);
    setRefused(!result.ok);
    if (result.ok) setName('');
  }, [nameState, remove]);

  const handleGoTo = useCallback(() => {
    if (!nameState.canGoTo || !nameState.existing) return;
    const result = goTo(nameState.existing.name);
    setRefused(!result.ok);
    if (result.ok) setVisited(true);
  }, [nameState, goTo]);

  const handleKeepFirst = useCallback(() => {
    const existing = nameState.existing;
    if (!existing || !isWritable) return;
    setRefused(!keepFirst(existing.name).ok);
  }, [nameState.existing, isWritable, keepFirst]);

  const selected = nameState.existing?.name ?? '';
  // A list box with no matching value would show its first row as chosen; show none instead.
  useLayoutEffect(() => {
    if (!selected && listRef.current) listRef.current.selectedIndex = -1;
  });
  const state: UseBookmarkDialogReturn = {
    values: { name, sortBy, showHidden },
    setValue(field, value) {
      if (field === 'name') setName(value as string);
      else if (field === 'sortBy') setSortBy(value as BookmarkSortOrder);
      else setShowHidden(value as boolean);
      setRefused(false);
    },
    errors: problem
      ? { name: t(PROBLEM_KEYS[problem]) }
      : refused
        ? { form: t('dialogs.bookmark.refused') }
        : {},
    isEnabled: nameState.canAdd,
    apply: handleAdd,
    cancel: onClose,
    rows,
    canDelete: nameState.canDelete,
    canGoTo: nameState.canGoTo,
    duplicates,
    remove: handleRemove,
    goTo: handleGoTo,
    keepFirst: handleKeepFirst,
  };
  return (
    <DialogFrame
      kind="bookmark"
      className={className}
      style={style}
      panelRef={panelRef}
      label={t('dialogs.bookmark.title')}
      onClose={onClose}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          event.keyCode !== 229 &&
          isHTMLElementNode(event.target) &&
          event.target.localName === 'input' &&
          event.target.getAttribute('type') === 'text'
        ) {
          event.preventDefault();
          handleAdd();
        }
      }}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header" className="docx-dialog__header">
              <span data-docx-part="title" className="docx-dialog__title">
                {t('dialogs.bookmark.title')}
              </span>
            </div>

            <div data-docx-part="body" className="docx-dialog__body">
              <div data-docx-part="field" data-docx-field="name" className="docx-dialog__row">
                <label className="docx-dialog__label" htmlFor={nameId}>
                  {t('dialogs.bookmark.name')}
                </label>
                <input
                  id={nameId}
                  type="text"
                  className="docx-dialog__input"
                  value={name}
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={messageId}
                  onChange={(event) => state.setValue('name', event.target.value)}
                />
              </div>

              <div data-docx-part="field" data-docx-field="list" className="docx-dialog__row">
                <select
                  ref={listRef}
                  className="docx-dialog__input docx-dialog__input--full docx-bookmark-dialog__list"
                  size={8}
                  value={selected}
                  aria-label={t('dialogs.bookmark.list')}
                  onChange={(event) => state.setValue('name', event.target.value)}
                  onDoubleClick={handleGoTo}
                >
                  {rows.map((row) => (
                    <option key={row.name} value={row.name}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </div>
              {rows.length === 0 ? (
                <div className="docx-dialog__hint">{t('dialogs.bookmark.empty')}</div>
              ) : null}

              <div
                data-docx-part="field"
                data-docx-field="sortBy"
                className="docx-dialog__row"
                role="radiogroup"
                aria-label={t('dialogs.bookmark.sortBy')}
              >
                <span className="docx-dialog__label">{t('dialogs.bookmark.sortBy')}</span>
                {(['name', 'location'] as const).map((order) => (
                  <label key={order} className="docx-dialog__checkbox-row">
                    <input
                      type="radio"
                      name={sortGroup}
                      checked={sortBy === order}
                      onChange={() => state.setValue('sortBy', order)}
                    />
                    {t(
                      order === 'name'
                        ? 'dialogs.bookmark.sortName'
                        : 'dialogs.bookmark.sortLocation'
                    )}
                  </label>
                ))}
              </div>

              <div data-docx-part="field" data-docx-field="showHidden" className="docx-dialog__row">
                <label className="docx-dialog__checkbox-row">
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(event) => state.setValue('showHidden', event.target.checked)}
                  />
                  {t('dialogs.bookmark.showHidden')}
                </label>
              </div>

              {/* Its own row, so a long message never squeezes the buttons. Problems read as
                  errors; a note about an existing name or its copies reads as a hint. */}
              <div className="docx-dialog__row docx-bookmark-dialog__status">
                <span
                  id={messageId}
                  data-docx-part="error"
                  role="status"
                  className={problem || refused ? 'docx-dialog__error' : 'docx-dialog__hint'}
                >
                  {message}
                </span>
                {duplicates > 0 ? (
                  <button
                    type="button"
                    className="docx-dialog__button"
                    data-docx-part="keepfirst"
                    disabled={!isWritable}
                    onClick={handleKeepFirst}
                  >
                    {t('dialogs.bookmark.keepFirst')}
                  </button>
                ) : null}
              </div>
            </div>

            <div data-docx-part="footer" className="docx-dialog__footer">
              <button
                type="button"
                className="docx-dialog__button docx-dialog__apply"
                data-docx-part="apply"
                disabled={!nameState.canAdd}
                onClick={handleAdd}
              >
                {t('dialogs.bookmark.add')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="delete"
                disabled={!nameState.canDelete}
                onClick={handleRemove}
              >
                {t('dialogs.bookmark.delete')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="goto"
                disabled={!nameState.canGoTo}
                onClick={handleGoTo}
              >
                {t('dialogs.bookmark.goTo')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="cancel"
                onClick={onClose}
              >
                {t(visited ? 'common.close' : 'common.cancel')}
              </button>
            </div>
          </>
        }
      >
        {children}
      </parts.Composition>
    </DialogFrame>
  );
}

const parts = createDialogParts<
  'name' | 'list' | 'sortBy' | 'showHidden',
  UseBookmarkDialogReturn
>();

/** Read the enclosing Bookmark dialog draft. @public */
export function useBookmarkDialog(): UseBookmarkDialogReturn {
  return parts.useState();
}

type PartComponent = (props: DialogPartProps) => ReactNode;

/** The Bookmark dialog with replaceable controls and layout. @public */
export const DocxEditorBookmarkDialog = Object.assign(BookmarkDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  /** Add: bookmark the selection under the typed name. */
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
  Delete: parts.part('delete') as PartComponent,
  GoTo: parts.part('goto') as PartComponent,
  /** Shown while the typed name has copies: keep the first, remove the rest. */
  KeepFirst: parts.part('keepfirst') as PartComponent,
});
