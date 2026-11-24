// The Bookmarks tab of the navigation pane: `DocxEditor.Navigation.GoTo`.
//
// A search box that is a combobox over the document's bookmarks. Typing filters the list, the
// arrow keys move through it, and Enter or a click jumps: the bookmark's text is selected in
// whichever story holds it, scrolled into view, and the document takes focus so typing goes
// on there. A name no bookmark has says so in the pane rather than in a dialog. Escape clears
// the search first; with nothing typed it closes the pane, the same as on the other tabs.
//
// Nothing here moves on the keyboard: no list animation, no transition on the active row.
//
// Bookmark names come from the file. They go into `textContent` only, never into markup.

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import type { BookmarkPlace, BookmarkSummary } from '@docx-editor.dev/core/contracts/editor';
import { goToBookmarkGroups, goToBookmarkMatch } from '@docx-editor.dev/core/editor';
import { MaterialSymbol } from '../../components/ui/Icons';
import { selectDocumentAbsent } from '../document-presence';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';
import { useNavigationContext } from './navigation-context';
import type { NavigationPartProps } from './parts';
import { useGoToBookmark } from './useGoToBookmark';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** The tag for a place that is not the main text, on a row of the list sorted by name. */
const PLACE_KEYS: Record<Exclude<BookmarkPlace, 'body'>, string> = {
  header: 'navigation.goTo.places.header',
  footer: 'navigation.goTo.places.footer',
  footnote: 'navigation.goTo.places.footnote',
  endnote: 'navigation.goTo.places.endnote',
};

/** The section heading for each place, on the list sorted by location. */
const GROUP_KEYS: Record<BookmarkPlace, string> = {
  body: 'navigation.goTo.groups.body',
  header: 'navigation.goTo.groups.header',
  footer: 'navigation.goTo.groups.footer',
  footnote: 'navigation.goTo.groups.footnote',
  endnote: 'navigation.goTo.groups.endnote',
};

/** A thin I-beam: the icon of a bookmark that marks a point, not a range of text. */
function PointIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M5.5 2.5h5M5.5 13.5h5M8 2.5v11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The name, with the part the search matched in medium weight. */
function MatchedName({ name, query }: { name: string; query: string }): ReactNode {
  const match = goToBookmarkMatch(name, query);
  if (!match) return name;
  return (
    <>
      {name.slice(0, match.start)}
      <span className="docx-nav__goto-match">{name.slice(match.start, match.end)}</span>
      {name.slice(match.end)}
    </>
  );
}

/**
 * The Bookmarks panel: a bookmark search box, the sort order and hidden-bookmarks toggle, and
 * the bookmarks it offers, grouped by place when sorted by location.
 *
 * @public
 */
export function NavigationGoTo({ className, style }: NavigationPartProps): ReactElement {
  const { pane, intents, t } = useNavigationContext('GoTo');
  const editor = useDocxEditor();
  const hidden = pane.tab !== 'goto';
  // The document's bookmarks are read only while this tab is on screen.
  const goTo = useGoToBookmark({ enabled: pane.open && !hidden });
  const addBookmark = useEditorCommand('insert.bookmark');
  const documentAbsent = useEditorState(selectDocumentAbsent);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const labelId = `${baseId}-label`;
  const hintId = `${baseId}-hint`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  // The arrow keys move the highlight; keep that row in view in a long list.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (goTo.activeIndex < 0) return;
    const id = `${baseId}-option-${goTo.activeIndex}`;
    const row = listRef.current?.querySelector<HTMLElement>(`[id="${id}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [goTo.activeIndex, baseId]);

  const jump = (name?: string) => {
    if (!goTo.go(name).ok) return;
    // An overlaying pane closes on a pick; either way the document takes focus, so typing
    // goes on at the bookmark.
    intents.picked();
    editor?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      goTo.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if ((event.key === 'Home' || event.key === 'End') && goTo.activeIndex >= 0) {
      // Home and End move the caret in the text until a row is highlighted.
      event.preventDefault();
      goTo.setActiveIndex(event.key === 'Home' ? 0 : goTo.rows.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      jump();
    } else if (event.key === 'Escape' && goTo.query.length > 0) {
      // The first Escape clears the search; the pane's own Escape handling sees it prevented.
      event.preventDefault();
      goTo.setQuery('');
    }
  };

  const message =
    goTo.problem === 'notFound'
      ? t('navigation.goTo.notFound', { name: goTo.problemName })
      : goTo.problem === 'failed'
        ? t('navigation.goTo.failed')
        : goTo.problem === 'empty'
          ? t('navigation.goTo.typeName')
          : goTo.bookmarks.length > 0 && goTo.rows.length === 0
            ? t('navigation.goTo.noMatches')
            : '';
  const active = goTo.activeIndex >= 0 ? optionId(goTo.activeIndex) : undefined;
  const byLocation = goTo.sortBy === 'location';
  const noBookmarks = goTo.bookmarks.length === 0;

  const renderRow = (row: BookmarkSummary, index: number) => {
    const isActive = index === goTo.activeIndex;
    return (
      <li
        key={row.name}
        id={optionId(index)}
        role="option"
        aria-selected={isActive}
        className={cx('docx-nav__goto-row', isActive && 'docx-nav__goto-row--active')}
        data-point={row.empty || undefined}
        // Keep focus in the search box: a press on a row must not blur it first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => jump(row.name)}
      >
        <span className="docx-nav__goto-icon" aria-hidden="true">
          {row.empty ? <PointIcon /> : <MaterialSymbol name="bookmark" size={16} />}
        </span>
        <span className="docx-nav__result-text">
          <bdi>
            <MatchedName name={row.name} query={goTo.query} />
          </bdi>
        </span>
        {row.atSelection && (
          <span className="docx-nav__goto-here" title={t('navigation.goTo.atCaret')}>
            <span className="docx-editor-sr-only">{t('navigation.goTo.atCaret')}</span>
          </span>
        )}
        {!byLocation && row.place !== 'body' && (
          <span className="docx-nav__goto-place">{t(PLACE_KEYS[row.place])}</span>
        )}
      </li>
    );
  };

  return (
    <div
      className={cx('docx-nav__panel docx-nav__panel--goto', className)}
      style={style}
      role="tabpanel"
      id="docx-nav-panel-goto"
      aria-labelledby="docx-nav-tab-goto"
      hidden={hidden}
    >
      <div className="docx-nav__searchbox">
        <MaterialSymbol name="bookmark" size={18} className="docx-nav__search-icon" />
        <input
          type="text"
          role="combobox"
          className="docx-nav__search-input"
          value={goTo.query}
          placeholder={t('navigation.goTo.placeholder')}
          aria-label={t('navigation.goTo.label')}
          aria-describedby={active ? hintId : undefined}
          aria-expanded={goTo.rows.length > 0}
          aria-controls={goTo.rows.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={active}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => goTo.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {active && (
          <kbd className="docx-nav__goto-enter" aria-hidden="true">
            ↵
          </kbd>
        )}
        <span id={hintId} className="docx-editor-sr-only">
          {t('navigation.goTo.enterHint')}
        </span>
      </div>

      <div className="docx-nav__goto-controls">
        <div
          className="docx-nav__segmented"
          role="radiogroup"
          aria-label={t('dialogs.bookmark.sortBy')}
        >
          {(['name', 'location'] as const).map((order) => (
            <label
              key={order}
              className="docx-nav__segment"
              data-checked={goTo.sortBy === order || undefined}
            >
              <input
                type="radio"
                className="docx-nav__segment-input"
                name={`${baseId}-sort`}
                checked={goTo.sortBy === order}
                onChange={() => goTo.setSortBy(order)}
              />
              {t(order === 'name' ? 'dialogs.bookmark.sortName' : 'dialogs.bookmark.sortLocation')}
            </label>
          ))}
        </div>
        <label className="docx-nav__option">
          <input
            type="checkbox"
            checked={goTo.showHidden}
            onChange={(event) => goTo.setShowHidden(event.target.checked)}
          />
          {t('dialogs.bookmark.showHidden')}
        </label>
      </div>

      {noBookmarks && !documentAbsent && (
        <div className="docx-nav__goto-empty">
          <MaterialSymbol name="bookmark" size={24} className="docx-nav__goto-empty-icon" />
          <p className="docx-nav__goto-empty-title">{t('navigation.goTo.empty')}</p>
          <p className="docx-nav__goto-empty-hint">{t('navigation.goTo.emptyHint')}</p>
          <button
            type="button"
            className="docx-nav__goto-add"
            disabled={!addBookmark.isEnabled}
            title={addBookmark.disabledReason ?? undefined}
            onClick={() => addBookmark.execute()}
          >
            {t('navigation.goTo.add')}
          </button>
        </div>
      )}

      {!noBookmarks && (
        <div className="docx-nav__goto-heading">
          <span id={labelId}>{t('navigation.goTo.listAriaLabel')}</span>
          <span className="docx-nav__goto-count">
            {goTo.query.trim().length > 0
              ? t('navigation.goTo.countFiltered', {
                  shown: goTo.rows.length,
                  total: goTo.bookmarks.filter((row) => goTo.showHidden || !row.hidden).length,
                })
              : goTo.rows.length}
          </span>
        </div>
      )}

      <p className="docx-nav__goto-message" role="status">
        {message}
      </p>

      {goTo.rows.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          className="docx-nav__list docx-nav__goto-list"
          role="listbox"
          aria-labelledby={labelId}
        >
          {byLocation
            ? goToBookmarkGroups(goTo.rows).map((group) => (
                <li
                  key={group.place}
                  role="group"
                  aria-labelledby={`${baseId}-group-${group.place}`}
                  className="docx-nav__goto-group"
                >
                  <div id={`${baseId}-group-${group.place}`} className="docx-nav__goto-group-label">
                    {t(GROUP_KEYS[group.place])}
                  </div>
                  <ul role="none" className="docx-nav__goto-sublist">
                    {group.rows.map(({ row, index }) => renderRow(row, index))}
                  </ul>
                </li>
              ))
            : goTo.rows.map((row, index) => renderRow(row, index))}
        </ul>
      )}
    </div>
  );
}
