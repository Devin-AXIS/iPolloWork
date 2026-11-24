// One search session per editor: the state the Find pane, `useDocumentSearch`, and host code
// share.
//
// A host that calls `find('Supplier')` sees the open Find pane show the same query, results,
// and highlights, and a pane's next/previous moves the same active match the host reads.
// Two search interfaces on one editor cannot disagree or repaint each other's highlights,
// because there is only one session and it alone owns the `search` highlight set.
//
// Framework-free. The adapters wrap it in `useSyncExternalStore` and a shallow ref.

import type { Editor, TextMatch } from '../contracts/editor.ts';
import { searchResultTruncated } from './document-search-result.ts';
import { hostElementOfEditor, hostTimers } from './host-realm.ts';

/** Milliseconds of quiet before a typed query runs. @public */
export const SEARCH_DEBOUNCE_MS = 150;

/** Most matches one search reports; a full result reads as "at least this many". @public */
export const SEARCH_MATCH_LIMIT = 2000;

/** The highlight set name the search session owns. @public */
export const SEARCH_HIGHLIGHT_SET = 'search';

/** Stacking priority of search highlights, above host sets at the default `0`. @public */
export const SEARCH_HIGHLIGHT_PRIORITY = 10;

/** Which matches a search interface highlights. @public */
export type DocumentSearchHighlight = 'all' | 'active' | 'none';

/** Search options that narrow a query. @public */
export interface DocumentSearchOptions {
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
}

/** How a search moves to a match. @public */
export interface DocumentSearchNavigateOptions {
  /** Move focus to the document. Default: `false`. */
  readonly focus?: boolean;
}

/** Options for {@link DocumentSearch.find}. @public */
export interface DocumentSearchFindOptions extends DocumentSearchOptions {
  /**
   * Highlight the results until `clear()` or the next `find()`: `'all'`, `'active'`, or
   * `'none'`. Default: no request of its own, so highlights follow the Find pane and hooks.
   */
  readonly highlight?: DocumentSearchHighlight;
  /** Select the first match and scroll to it. Default: `false`. */
  readonly selectFirst?: boolean;
}

/** A snapshot of the shared search. The same object until something changes. @public */
export interface DocumentSearchState {
  /** The query as typed. It can lead the searched query by one debounce. */
  readonly query: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  /** Matches for the last searched query, in document order. */
  readonly matches: readonly TextMatch[];
  /** The search stopped at {@link SEARCH_MATCH_LIMIT} with matches still ahead. */
  readonly truncated: boolean;
  /** Index of the current match, or `-1` before any navigation. */
  readonly activeIndex: number;
  /** The current match, or `null` before any navigation. */
  readonly activeMatch: TextMatch | null;
  /** A typed query is waiting for its debounce. */
  readonly isPending: boolean;
}

/**
 * The shared search of one editor. Get it with {@link createDocumentSearch}.
 * @public
 */
export interface DocumentSearch {
  /** The current state. Returns the same object until the state changes. */
  getState(): DocumentSearchState;
  /** Observe state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /**
   * Search now, without a debounce, and return the matches. Clears the active match unless
   * `selectFirst` selects one. `highlight` highlights the results until `clear()`.
   */
  find(query: string, options?: DocumentSearchFindOptions): readonly TextMatch[];
  /** Update the typed query. The search runs after {@link SEARCH_DEBOUNCE_MS} of quiet. */
  setQuery(query: string): void;
  setMatchCase(value: boolean): void;
  setWholeWord(value: boolean): void;
  /**
   * Select a match and scroll to it. Focus stays where it is, so a search box keeps it and
   * Enter can move to the next match; pass `{ focus: true }` to move focus to the document.
   * Returns false for an index without a match.
   */
  goTo(index: number, options?: DocumentSearchNavigateOptions): boolean;
  /** Go to the next or previous match, wrapping at the ends. */
  next(options?: DocumentSearchNavigateOptions): boolean;
  previous(options?: DocumentSearchNavigateOptions): boolean;
  /** Empty the query and drop the results, without changing the selection. */
  clear(): void;
  /**
   * Highlight matches while the returned function is not called. With several requests,
   * the widest wins: `'all'`, then `'active'`. Without a request, nothing is highlighted.
   * The Find pane requests highlights while its Find tab is open.
   */
  showHighlights(mode: DocumentSearchHighlight): () => void;
}

const EMPTY_MATCHES: readonly TextMatch[] = Object.freeze([]);
/** Longest results wait while edits keep arriving. */
const SEARCH_REFRESH_MAX_WAIT_MS = 1000;

/**
 * The active match's index in a new result list. It follows the same occurrence: the match in
 * the same paragraph whose start is nearest the old one, so an edit that adds or removes an
 * earlier match never moves the cursor onto a different occurrence. Otherwise -1.
 */
function carriedActiveIndex(previous: DocumentSearchState, matches: readonly TextMatch[]): number {
  const active = previous.activeIndex >= 0 ? previous.matches[previous.activeIndex] : undefined;
  if (!active) return -1;
  let best = -1;
  for (const [index, match] of matches.entries()) {
    if (match.blockId !== active.blockId) continue;
    if (
      best < 0 ||
      Math.abs(match.start - active.start) < Math.abs(matches[best]!.start - active.start)
    ) {
      best = index;
    }
  }
  return best;
}
const sessions = new WeakMap<Editor, DocumentSearch>();

/**
 * The shared search session of an editor. Every call for the same editor returns the same
 * session, so the Find pane and your code read and drive one search.
 *
 * @example
 * ```ts
 * const search = createDocumentSearch(editor);
 * const stop = search.showHighlights('all');
 * search.find('Supplier', { wholeWord: true });
 * search.next();
 * ```
 * @public
 */
export function createDocumentSearch(editor: Editor): DocumentSearch {
  const existing = sessions.get(editor);
  if (existing) return existing;

  let state: DocumentSearchState = {
    query: '',
    matchCase: false,
    wholeWord: false,
    matches: EMPTY_MATCHES,
    truncated: false,
    activeIndex: -1,
    activeMatch: null,
    isPending: false,
  };
  let searched = '';
  // The highlight request `find({ highlight })` holds, until `clear()` or the next `find()`.
  const findRequest = {};
  // The editor's own window: an opener's timers are throttled while it is hidden.
  const timers = hostTimers(() => hostElementOfEditor(editor));
  let timer: number | undefined;
  const listeners = new Set<() => void>();
  const requests = new Map<object, DocumentSearchHighlight>();
  let painted = false;

  function highlightMode(): DocumentSearchHighlight {
    let mode: DocumentSearchHighlight = 'none';
    for (const value of requests.values()) {
      if (value === 'all') return 'all';
      if (value === 'active') mode = 'active';
    }
    return mode;
  }

  function paint(): void {
    const mode = highlightMode();
    const { matches, activeIndex } = state;
    const active = activeIndex >= 0 ? matches[activeIndex] : undefined;
    const ranges = mode === 'all' ? matches : mode === 'active' && active ? [active] : [];
    // Leave the set alone until this session has painted it, so a host set of the same
    // name survives a search nobody is showing.
    if (ranges.length === 0 && !painted) return;
    editor.setHighlights(SEARCH_HIGHLIGHT_SET, ranges, {
      activeIndex: mode === 'all' ? activeIndex : ranges.length > 0 ? 0 : -1,
      priority: SEARCH_HIGHLIGHT_PRIORITY,
    });
    painted = ranges.length > 0;
  }

  function commit(next: Partial<DocumentSearchState>): void {
    const merged = { ...state, ...next };
    if (merged.matches !== state.matches && next.activeIndex === undefined) {
      merged.activeIndex = carriedActiveIndex(state, merged.matches);
    }
    merged.truncated =
      searchResultTruncated(merged.matches) ?? merged.matches.length >= SEARCH_MATCH_LIMIT;
    merged.activeMatch = merged.matches[merged.activeIndex] ?? null;
    const changed = (Object.keys(merged) as (keyof DocumentSearchState)[]).some(
      (key) => merged[key] !== state[key]
    );
    if (!changed) return;
    state = merged;
    paint();
    for (const listener of [...listeners]) listener();
  }

  function derive(query = searched, options: DocumentSearchOptions = state): readonly TextMatch[] {
    if (query.length === 0) return EMPTY_MATCHES;
    return editor.findMatches(query, {
      matchCase: options.matchCase ?? false,
      wholeWord: options.wholeWord ?? false,
    });
  }

  function cancelDebounce(): void {
    timers.clearTimeout(timer);
    timer = undefined;
  }

  function run(): void {
    cancelDebounce();
    searched = state.query;
    commit({ matches: derive(), isPending: false });
  }

  // Results follow the document under the same query, after typing pauses: a rescan on every
  // keystroke would cost a document walk per character. Highlights stay on their text in
  // between, because the engine maps them through each edit. A load refreshes at once.
  let refreshTimer: number | undefined;
  let refreshFirstAt = 0;
  const refreshNow = () => {
    timers.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    refreshFirstAt = 0;
    if (searched.length > 0) commit({ matches: derive() });
  };
  const flushRefresh = () => {
    if (refreshTimer !== undefined) refreshNow();
  };
  editor.on('change', (change) => {
    if (searched.length === 0) return;
    if (change.source) return refreshNow();
    const now = Date.now();
    if (refreshFirstAt === 0) refreshFirstAt = now;
    timers.clearTimeout(refreshTimer);
    const wait = Math.min(SEARCH_DEBOUNCE_MS, SEARCH_REFRESH_MAX_WAIT_MS - (now - refreshFirstAt));
    refreshTimer = timers.setTimeout(refreshNow, Math.max(0, wait));
  });
  // The editing mode narrows which stories search can reach.
  let editingMode = editor.snapshot().editingMode;
  editor.on('selectionChange', (snapshot) => {
    if (snapshot.editingMode === editingMode) return;
    editingMode = snapshot.editingMode;
    refreshNow();
  });

  const step = (delta: number, options?: DocumentSearchNavigateOptions): boolean => {
    flushRefresh();
    const count = state.matches.length;
    if (count === 0) return false;
    const from = state.activeIndex < 0 ? (delta > 0 ? -1 : 0) : state.activeIndex;
    return session.goTo((from + delta + count) % count, options);
  };

  const session: DocumentSearch = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    find(query, options = {}) {
      cancelDebounce();
      searched = query;
      const matchCase = options.matchCase ?? state.matchCase;
      const wholeWord = options.wholeWord ?? state.wholeWord;
      const matches = derive(query, { matchCase, wholeWord });
      if (options.highlight === undefined || options.highlight === 'none') {
        requests.delete(findRequest);
      } else {
        requests.set(findRequest, options.highlight);
      }
      commit({ query, matchCase, wholeWord, matches, activeIndex: -1, isPending: false });
      // A request change with unchanged results still repaints.
      paint();
      if (options.selectFirst) session.goTo(0);
      return state.matches;
    },
    setQuery(query) {
      if (query === state.query) return;
      cancelDebounce();
      // Typing back to the searched query needs no new search.
      if (query !== searched) timer = timers.setTimeout(run, SEARCH_DEBOUNCE_MS);
      commit({ query, isPending: query !== searched });
    },
    setMatchCase(value) {
      commit({ matchCase: value, matches: derive(searched, { ...state, matchCase: value }) });
    },
    setWholeWord(value) {
      commit({ wholeWord: value, matches: derive(searched, { ...state, wholeWord: value }) });
    },
    goTo(index, options) {
      // Never select a match from results an edit has made stale.
      flushRefresh();
      const match = state.matches[index];
      if (!match) return false;
      if (options?.focus) editor.focus();
      const result = editor.selectMatch(match);
      if (!result.ok) return false;
      commit({ activeIndex: index });
      return true;
    },
    next: (options) => step(1, options),
    previous: (options) => step(-1, options),
    clear() {
      cancelDebounce();
      searched = '';
      requests.delete(findRequest);
      commit({ query: '', matches: EMPTY_MATCHES, activeIndex: -1, isPending: false });
    },
    showHighlights(mode) {
      const token = {};
      requests.set(token, mode);
      paint();
      return () => {
        if (!requests.delete(token)) return;
        paint();
      };
    },
  };
  sessions.set(editor, session);
  return session;
}
