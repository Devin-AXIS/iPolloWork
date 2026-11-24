// The find half of the navigation pane, UI-free.
//
// A thin binding over the editor's shared search session (`createDocumentSearch`). Every
// `useDocumentSearch` call and the packaged Find pane read and drive the same session, so a
// host that calls `find()` updates the open pane, and the pane's arrows move the match the
// host reads. Finding is a read and selecting is a write: typing never moves the caret.
//
// TYPING IS DEBOUNCED, RESULTS ARE NOT. `setQuery` waits one debounce; `find` runs now. Once
// a query has run, its results follow the document under it.
//
// MATCHES ARE MARKED IN THE DOCUMENT while a consumer asks for it. The `highlight` option is
// that request; the pane asks only while its Find tab is open.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { TextMatch } from '@docx-editor.dev/core/contracts/editor';
import {
  createDocumentSearch,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_PRIORITY,
  SEARCH_HIGHLIGHT_SET,
  SEARCH_MATCH_LIMIT,
  type DocumentSearchFindOptions,
  type DocumentSearchHighlight,
  type DocumentSearchNavigateOptions,
  type DocumentSearchOptions,
  type DocumentSearchState,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';

export {
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_PRIORITY,
  SEARCH_HIGHLIGHT_SET,
  SEARCH_MATCH_LIMIT,
  type DocumentSearchFindOptions,
  type DocumentSearchHighlight,
  type DocumentSearchNavigateOptions,
  type DocumentSearchOptions,
};

const IDLE_STATE: DocumentSearchState = Object.freeze({
  query: '',
  matchCase: false,
  wholeWord: false,
  matches: Object.freeze([]) as readonly TextMatch[],
  truncated: false,
  activeIndex: -1,
  activeMatch: null,
  isPending: false,
});
const noSubscription = () => () => {};
const idleState = () => IDLE_STATE;

/** How `useDocumentSearch` behaves. @public */
export interface UseDocumentSearchOptions {
  /**
   * Which matches to mark: every match with the active one emphasized (`'all'`), only the
   * active match (`'active'`), or none (`'none'`). Default: `'all'`.
   */
  readonly highlight?: DocumentSearchHighlight;
}

/** What `useDocumentSearch` answers. @public */
export interface UseDocumentSearchResult {
  /** The text in the search box, updated synchronously as the user types. */
  readonly query: string;
  /** Update the typed query. The search runs after a short debounce. */
  readonly setQuery: (query: string) => void;
  /**
   * Search now and return the matches. `selectFirst` selects the first match; `highlight`
   * highlights the results until `clear()`, even without this hook's own request.
   */
  readonly find: (query: string, options?: DocumentSearchFindOptions) => readonly TextMatch[];
  readonly matchCase: boolean;
  readonly setMatchCase: (value: boolean) => void;
  readonly wholeWord: boolean;
  readonly setWholeWord: (value: boolean) => void;
  /** Matches for the last RUN query, in document order. */
  readonly matches: readonly TextMatch[];
  /**
   * Whether the engine stopped at its cap with matches still ahead of it, so a count
   * should read "2000+" rather than an exact total. A search that lands on exactly the cap
   * reports true; over-reporting by one is the honest direction.
   */
  readonly truncated: boolean;
  /** Index of the match the caret was last sent to, or `-1` before any navigation. */
  readonly activeIndex: number;
  /** The current match, or `null` before any navigation. */
  readonly activeMatch: TextMatch | null;
  /**
   * Select a match by index and bring its page into view. Focus stays where it is, so a
   * search box keeps it. Returns false for an index without a match.
   */
  readonly goTo: (index: number) => boolean;
  /** Next / previous match, wrapping at the ends the way Word's arrows do. */
  readonly next: () => boolean;
  readonly previous: () => boolean;
  /** Empty the box and drop the results, without touching the selection. */
  readonly clear: () => void;
  /** Whether a typed query is waiting for its debounce to elapse. */
  readonly isPending: boolean;
}

/**
 * The editor's shared search, with no UI attached. The packaged Find pane uses the same
 * session, so state set here shows there.
 *
 * @public
 */
export function useDocumentSearch(options: UseDocumentSearchOptions = {}): UseDocumentSearchResult {
  const highlight = options.highlight ?? 'all';
  const editor = useDocxEditor();
  const search = useMemo(() => (editor ? createDocumentSearch(editor) : null), [editor]);
  const state = useSyncExternalStore(
    search ? search.subscribe : noSubscription,
    search ? search.getState : idleState,
    search ? search.getState : idleState
  );

  // Ask for highlights for as long as this consumer wants them.
  useEffect(() => {
    if (!search || highlight === 'none') return undefined;
    return search.showHighlights(highlight);
  }, [search, highlight]);

  const actions = useMemo(
    () => ({
      setQuery: (query: string) => search?.setQuery(query),
      find: (query: string, findOptions?: DocumentSearchFindOptions) =>
        search?.find(query, findOptions) ?? IDLE_STATE.matches,
      setMatchCase: (value: boolean) => search?.setMatchCase(value),
      setWholeWord: (value: boolean) => search?.setWholeWord(value),
      // No options: a handler such as `onClick={search.next}` passes its event here.
      goTo: (index: number) => search?.goTo(index) ?? false,
      next: () => search?.next() ?? false,
      previous: () => search?.previous() ?? false,
      clear: () => search?.clear(),
    }),
    [search]
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
