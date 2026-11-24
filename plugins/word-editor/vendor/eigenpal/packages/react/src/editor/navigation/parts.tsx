import type { DocxEditorChildren } from '../../docx-editor-children';
// The navigation pane's parts: `DocxEditor.Navigation.Header` / `.Close` / `.Title` /
// `.Tabs` / `.Tab` / `.Headings` / `.Find` / `.Toggle`.
//
// Each reads the pane state from context and renders only its own markup, so a host can
// keep the packaged Headings list while replacing the header, or drop the tab strip and
// pin one tab. Class names carry the look (core stylesheet, `--doc-*` tokens); nothing
// here hard-codes a colour.
//
// EVERY STRING THAT LANDS IN A ROW IS ALREADY BOUNDED. Heading text arrives from
// `Editor.getOutline()` and match text/context from `Editor.findMatches()`, both validated
// at the engine's derivation boundary (length-capped, control characters flattened). These
// components put them in `textContent` only — never in a style string, never in markup.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react';
import type { TextMatch } from '@docx-editor.dev/core/contracts/editor';
import { MaterialSymbol } from '../../components/ui/Icons';
import { selectDocumentAbsent } from '../document-presence';
import { useEditorState } from '../useEditorState';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { useNavigationContext } from './navigation-context';
import { findKeyShortcuts, goToKeyShortcuts, goToShortcutLabel } from './navigation-keys';
// Aliased: this module also EXPORTS a component called `NavigationTab`, and the two
// declarations would collide in the generated .d.ts.
import type { NavigationTab as NavigationTabId } from './useNavigationPane';

/** Shared props for the pane's structural parts. @public */
export interface NavigationPartProps {
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}

/** The tabs the pane supports, in strip order. Module-level so the keyboard handler
 * does not rebuild it (and its dependency identity) on every render. */
const TABS: NavigationTabId[] = ['headings', 'find', 'goto'];

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

// ─── Header ──────────────────────────────────────────────────────────────────────────

/**
 * The pane's title row. With no children it renders the close arrow and the title.
 *
 * @public
 */
export function NavigationHeader({
  className,
  style,
  children,
}: NavigationPartProps): ReactElement {
  return (
    <div className={cx('docx-nav__header', className)} style={style}>
      {children ?? (
        <>
          <NavigationClose />
          <NavigationTitle />
        </>
      )}
    </div>
  );
}

/** The back arrow that closes the pane. @public */
export function NavigationClose({ className, style, children }: NavigationPartProps): ReactElement {
  const { intents, t } = useNavigationContext('Close');
  return (
    <button
      type="button"
      className={cx('docx-nav__close', className)}
      style={style}
      aria-label={t('navigation.closeAriaLabel')}
      title={t('navigation.closeTitle')}
      onClick={intents.close}
    >
      {children ?? <MaterialSymbol name="arrow_back" size={20} />}
    </button>
  );
}

/** The pane's heading text. @public */
export function NavigationTitle({ className, style, children }: NavigationPartProps): ReactElement {
  const { t } = useNavigationContext('Title');
  return (
    <h2 className={cx('docx-nav__title', className)} style={style}>
      {children ?? t('navigation.title')}
    </h2>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────────────

/**
 * The tab strip. With no children it renders one `Tab` per tab the pane supports.
 *
 * A real `role="tablist"`, so arrow keys move between tabs and a screen reader announces
 * the panel each one controls.
 *
 * @public
 */
export function NavigationTabs({ className, style, children }: NavigationPartProps): ReactElement {
  const { pane, t } = useNavigationContext('Tabs');

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const index = TABS.indexOf(pane.tab);
      pane.setTab(TABS[(index + delta + TABS.length) % TABS.length]!);
    },
    [pane]
  );

  return (
    <div
      className={cx('docx-nav__tabs', className)}
      style={style}
      role="tablist"
      aria-label={t('navigation.title')}
      onKeyDown={onKeyDown}
    >
      {children ?? TABS.map((value) => <NavigationTab key={value} value={value} />)}
    </div>
  );
}

/** Props for one tab. @public */
export interface NavigationTabProps extends NavigationPartProps {
  value: NavigationTabId;
}

/** One tab button. Children replace the label. @public */
export function NavigationTab({
  value,
  className,
  style,
  children,
}: NavigationTabProps): ReactElement {
  const { pane, t, goToShortcut } = useNavigationContext('Tab');
  const shortcut = usePlatformShortcut();
  const selected = pane.tab === value;
  // The Go to tab names its shortcut while it is bound.
  const goToTitle =
    value === 'goto' && goToShortcut
      ? t('navigation.goTo.tabTitle', { shortcut: shortcut(goToShortcutLabel()) })
      : undefined;
  return (
    <button
      type="button"
      role="tab"
      id={`docx-nav-tab-${value}`}
      aria-selected={selected}
      aria-controls={`docx-nav-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      className={cx('docx-nav__tab', selected && 'docx-nav__tab--selected', className)}
      style={style}
      {...(goToTitle ? { title: goToTitle, 'aria-keyshortcuts': goToKeyShortcuts() } : {})}
      onClick={() => pane.setTab(value)}
    >
      {children ?? t(`navigation.tabs.${value}`)}
    </button>
  );
}

// ─── Search box ──────────────────────────────────────────────────────────────────────

function SearchBox({
  value,
  onChange,
  onClear,
  placeholder,
  label,
  clearLabel,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Enter and Shift+Enter, with `backward` true for Shift. */
  onEnter?: (backward: boolean) => void;
  onClear: () => void;
  placeholder: string;
  label: string;
  clearLabel: string;
  autoFocus?: boolean;
}): ReactElement {
  // The find panel stays mounted (hidden or inert) so a typed query survives a close.
  // HTML `autoFocus` only runs on first mount, which is the closed pane — focus when
  // the field actually becomes the visible target.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="docx-nav__searchbox">
      <MaterialSymbol name="search" size={18} className="docx-nav__search-icon" />
      <input
        ref={inputRef}
        type="search"
        className="docx-nav__search-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (!onEnter || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onEnter(event.shiftKey);
        }}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="docx-nav__search-clear"
          aria-label={clearLabel}
          onClick={onClear}
        >
          <MaterialSymbol name="close" size={16} />
        </button>
      )}
    </div>
  );
}

// ─── Headings tab ────────────────────────────────────────────────────────────────────

/**
 * The heading list, indented by outline depth. Clicking a row moves the caret to that
 * heading and brings it into view.
 *
 * The filter box narrows the list CLIENT-SIDE — it hides rows whose text does not contain
 * what you typed. It is deliberately not the document search: filtering an outline and
 * searching a document are different questions, and the Find tab answers the second one.
 *
 * @public
 */
export function NavigationHeadings({ className, style }: NavigationPartProps): ReactElement {
  const { pane, outline, intents, t } = useNavigationContext('Headings');
  const [filter, setFilter] = useState('');
  // "This document has no headings" is a claim about the document; while there is none
  // (loading, parse failure, detached) the panel shows neither the claim nor the list.
  const documentAbsent = useEditorState(selectDocumentAbsent);

  const items = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return outline.items;
    return outline.items.filter((item) => item.heading.text.toLowerCase().includes(needle));
  }, [outline.items, filter]);

  const hidden = pane.tab !== 'headings';

  return (
    <div
      className={cx('docx-nav__panel', className)}
      style={style}
      role="tabpanel"
      id="docx-nav-panel-headings"
      aria-labelledby="docx-nav-tab-headings"
      hidden={hidden}
    >
      <SearchBox
        value={filter}
        onChange={setFilter}
        onClear={() => setFilter('')}
        placeholder={t('navigation.find.placeholder')}
        label={t('navigation.find.inputAriaLabel')}
        clearLabel={t('navigation.find.clearAriaLabel')}
      />
      {documentAbsent ? null : outline.isEmpty ? (
        <p className="docx-nav__empty">{t('navigation.headings.noHeadings')}</p>
      ) : items.length === 0 ? (
        <p className="docx-nav__empty">{t('navigation.find.noResults')}</p>
      ) : (
        <ul className="docx-nav__list">
          {items.map((item, index) => (
            <li key={`${item.heading.blockId}-${index}`}>
              <button
                type="button"
                className={cx(
                  'docx-nav__heading',
                  outline.selectedBlockId === item.heading.blockId && 'docx-nav__heading--current'
                )}
                // Depth is a number the engine derived, not a file string: safe as a
                // computed inline value, and CSS reads it for the indent.
                style={{ paddingInlineStart: `${8 + item.depth * 14}px` }}
                title={item.heading.text}
                onClick={() => {
                  outline.goTo(item.heading.blockId);
                  intents.picked();
                }}
              >
                {/* Document text keeps its own direction inside the pane's (`bdi`). */}
                <bdi>{item.heading.text}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Find tab ────────────────────────────────────────────────────────────────────────

/** One result row: the match in context, with the matched span emphasised. */
function ResultRow({
  match,
  active,
  onSelect,
}: {
  match: TextMatch;
  active: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <li>
      <button
        type="button"
        className={cx('docx-nav__result', active && 'docx-nav__result--active')}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
      >
        <span className="docx-nav__result-text">
          <bdi>
            {match.contextBefore}
            <mark className="docx-nav__result-hit">{match.text}</mark>
            {match.contextAfter}
          </bdi>
        </span>
      </button>
    </li>
  );
}

/**
 * The find panel: a query box, a result counter with previous/next, the match-case and
 * whole-word toggles, and the result list. Selecting a result moves the caret onto the
 * match and reveals its page.
 *
 * @public
 */
export function NavigationFind({ className, style }: NavigationPartProps): ReactElement {
  const { pane, search, intents, t } = useNavigationContext('Find');
  const hidden = pane.tab !== 'find';
  const hasQuery = search.query.trim().length > 0;
  const autoFocus = pane.open && !hidden;

  // Before any navigation nothing is selected, so the readout is a TOTAL, not a position:
  // saying "Result 1 of 7" while the caret has not moved claims a selection that is not
  // there. Once next/previous or a row click has landed, it becomes the position.
  const counter =
    search.matches.length === 0
      ? null
      : search.activeIndex < 0
        ? t(search.truncated ? 'navigation.find.totalTruncated' : 'navigation.find.total', {
            total: search.matches.length,
          })
        : t(search.truncated ? 'navigation.find.counterTruncated' : 'navigation.find.counter', {
            current: search.activeIndex + 1,
            total: search.matches.length,
          });

  return (
    <div
      className={cx('docx-nav__panel', className)}
      style={style}
      role="tabpanel"
      id="docx-nav-panel-find"
      aria-labelledby="docx-nav-tab-find"
      hidden={hidden}
    >
      <SearchBox
        value={search.query}
        onChange={search.setQuery}
        onClear={search.clear}
        placeholder={t('navigation.find.placeholder')}
        label={t('navigation.find.inputAriaLabel')}
        clearLabel={t('navigation.find.clearAriaLabel')}
        autoFocus={autoFocus}
        onEnter={(backward) => {
          // Enter runs a query still waiting for its debounce, then moves to a match.
          if (search.isPending) search.find(search.query);
          if (backward) search.previous();
          else search.next();
        }}
      />

      <div
        className="docx-nav__options"
        role="group"
        aria-label={t('navigation.find.optionsAriaLabel')}
      >
        <label className="docx-nav__option">
          <input
            type="checkbox"
            checked={search.matchCase}
            onChange={(event) => search.setMatchCase(event.target.checked)}
          />
          {t('navigation.find.matchCase')}
        </label>
        <label className="docx-nav__option">
          <input
            type="checkbox"
            checked={search.wholeWord}
            onChange={(event) => search.setWholeWord(event.target.checked)}
          />
          {t('navigation.find.wholeWord')}
        </label>
      </div>

      <div className="docx-nav__resultbar">
        <span className="docx-nav__count" aria-live="polite">
          {/* Nothing typed says nothing: an empty box is not "no results". */}
          {!hasQuery
            ? ''
            : search.isPending
              ? t('navigation.find.searching')
              : (counter ?? t('navigation.find.noResults'))}
        </span>
        <span className="docx-nav__steppers">
          <button
            type="button"
            className="docx-nav__stepper"
            aria-label={t('navigation.find.previousAriaLabel')}
            disabled={search.matches.length === 0}
            onClick={search.previous}
          >
            <MaterialSymbol name="keyboard_arrow_up" size={18} />
          </button>
          <button
            type="button"
            className="docx-nav__stepper"
            aria-label={t('navigation.find.nextAriaLabel')}
            disabled={search.matches.length === 0}
            onClick={search.next}
          >
            <MaterialSymbol name="keyboard_arrow_down" size={18} />
          </button>
        </span>
      </div>

      {search.matches.length > 0 && (
        <ul className="docx-nav__list" aria-label={t('navigation.find.resultsAriaLabel')}>
          {search.matches.map((match, index) => (
            <ResultRow
              key={`${match.blockId}-${match.start}-${index}`}
              match={match}
              active={index === search.activeIndex}
              onSelect={() => {
                search.goTo(index);
                intents.picked();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────────────────────────

/**
 * The collapsed pane's disc button. `DocxEditor.Navigation` renders one for you while the
 * pane is closed; place it yourself (a toolbar, a menu) with `toggle={false}` on the root.
 *
 * @public
 */
export function NavigationToggle({
  className,
  style,
  children,
}: NavigationPartProps): ReactElement {
  const { pane, intents, findShortcut, t } = useNavigationContext('Toggle');
  const shortcut = usePlatformShortcut();
  // Names the Find shortcut, the one way to open the pane besides this disc, only while it
  // is bound.
  const label = shortcut('Ctrl+F');
  const keyShortcuts = findShortcut ? findKeyShortcuts(label) : undefined;
  const title = findShortcut
    ? // The resolved label goes in as a parameter, never as catalog text: a translated
      // modifier (German "Strg") would name a key that does not open Find on macOS.
      t('navigation.openShortcutTitle', { shortcut: label })
    : t('navigation.openTitle');
  return (
    <button
      type="button"
      className={cx('docx-nav__toggle', className)}
      style={style}
      aria-label={t('navigation.openAriaLabel')}
      aria-expanded={pane.open}
      aria-keyshortcuts={keyShortcuts}
      title={title}
      // A mousedown that reaches the document surface moves the caret; the pane opening
      // must leave the user's place in the text alone.
      onMouseDown={(event) => event.preventDefault()}
      onClick={intents.toggle}
    >
      {children ?? <MaterialSymbol name="toc" size={20} />}
    </button>
  );
}
