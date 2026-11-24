// Go To for bookmarks, with no UI attached: what was typed, the bookmarks it offers, the
// highlighted row, and the jump. The Go to tab of `DocxEditor.Navigation` is built on it; call
// it directly to drive a Go To UI of your own.
//
// The list is the `bookmarks` query, so it follows every change to the document, a
// collaborator's included. It is read only while `enabled`: a closed pane does not walk the
// document on every keystroke. The jump is the `goToBookmark` command: it selects the
// bookmark's text in whichever story holds it and scrolls it into view, in a read-only
// document too.

import { useCallback, useMemo, useState } from 'react';
import type {
  BookmarkSummary,
  EditorSnapshot,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import {
  goToBookmarkRows,
  goToBookmarkTarget,
  type BookmarkSortOrder,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { sameBookmarks } from '../useBookmarks';

/**
 * Why a Go To jump did not happen: nothing was typed, no bookmark has the name, or the editor
 * refused the jump for another reason (it is not ready, or the story could not be shown).
 *
 * @public
 */
export type GoToBookmarkProblem = 'empty' | 'notFound' | 'failed';

/** How `useGoToBookmark` is configured. @public */
export interface UseGoToBookmarkOptions {
  /**
   * Whether to read the document's bookmarks. Defaults to `true`. Pass `false` while your UI
   * is hidden: the list is then empty and the document is not read on each change.
   */
  readonly enabled?: boolean;
}

/** What `useGoToBookmark` answers. @public */
export interface UseGoToBookmarkReturn {
  /** The text in the name box. */
  readonly query: string;
  /** Change the text. The highlight goes back to none. */
  readonly setQuery: (query: string) => void;
  readonly sortBy: BookmarkSortOrder;
  readonly setSortBy: (sortBy: BookmarkSortOrder) => void;
  /** Whether hidden bookmarks (names starting with an underscore) are offered. */
  readonly showHidden: boolean;
  readonly setShowHidden: (showHidden: boolean) => void;
  /** The bookmarks offered for the query: names that start with it first. */
  readonly rows: readonly BookmarkSummary[];
  /** Every bookmark the document declares, hidden ones included. Empty while disabled. */
  readonly bookmarks: readonly BookmarkSummary[];
  /**
   * Index into `rows` of the highlighted row, or -1 when none is. The highlight follows its
   * bookmark when rows move, and clears when that bookmark goes away.
   */
  readonly activeIndex: number;
  /** Move the highlight by `delta` rows, wrapping at either end. */
  readonly move: (delta: number) => void;
  /** Highlight the row at `index` of `rows`, or none with -1. */
  readonly setActiveIndex: (index: number) => void;
  /**
   * Jump to `name`, or else to what the name box means: the highlighted row, the bookmark
   * named exactly as typed, or the first row offered. Answers the `goToBookmark` result and
   * sets `problem` when it is refused.
   */
  readonly go: (name?: string) => ExecResult;
  /** Why the last jump did not happen, or null. Cleared when the query changes. */
  readonly problem: GoToBookmarkProblem | null;
  /** The name the last refused jump asked for, for a message. Empty when nothing was typed. */
  readonly problemName: string;
}

const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };
const NONE: readonly BookmarkSummary[] = Object.freeze([]);

/**
 * Go To for bookmarks: filter by name, move through the offered rows, and jump.
 *
 * @public
 */
export function useGoToBookmark(options: UseGoToBookmarkOptions = {}): UseGoToBookmarkReturn {
  const enabled = options.enabled ?? true;
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): readonly BookmarkSummary[] =>
      enabled ? (editor?.query({ type: 'bookmarks' }) ?? NONE) : NONE,
    [editor, enabled]
  );
  const bookmarks = useEditorState(select, sameBookmarks);
  const [query, setQueryState] = useState('');
  const [sortBy, setSortByState] = useState<BookmarkSortOrder>('name');
  const [showHidden, setShowHiddenState] = useState(false);
  // The highlighted bookmark's name, not its index: rows move when a collaborator edits.
  const [highlight, setHighlight] = useState<string | null>(null);
  const [problem, setProblem] = useState<GoToBookmarkProblem | null>(null);
  const [problemName, setProblemName] = useState('');

  const rows = useMemo(
    () => goToBookmarkRows(bookmarks, { query, sortBy, showHidden }),
    [bookmarks, query, sortBy, showHidden]
  );
  const activeIndex = useMemo(() => {
    if (highlight === null) return -1;
    return rows.findIndex((row) => row.name === highlight);
  }, [rows, highlight]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setHighlight(null);
    setProblem(null);
  }, []);
  const setSortBy = useCallback((next: BookmarkSortOrder) => {
    setSortByState(next);
    setHighlight(null);
    setProblem(null);
  }, []);
  const setShowHidden = useCallback((next: boolean) => {
    setShowHiddenState(next);
    setHighlight(null);
    setProblem(null);
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const from = activeIndex < 0 ? (delta > 0 ? -1 : 0) : activeIndex;
      setHighlight(rows[(from + delta + rows.length) % rows.length]!.name);
    },
    [rows, activeIndex]
  );
  const setActiveIndex = useCallback(
    (index: number) => setHighlight(rows[index]?.name ?? null),
    [rows]
  );

  const go = useCallback(
    (name?: string): ExecResult => {
      if (!editor) return NOT_READY;
      const target =
        name ?? rows[activeIndex]?.name ?? goToBookmarkTarget(bookmarks, query, rows)?.name;
      if (target === undefined || target.trim().length === 0) {
        const typed = query.trim();
        setProblem(typed.length === 0 ? 'empty' : 'notFound');
        setProblemName(typed);
        return { ok: false, code: 'notFound', reason: 'no bookmark is named that' };
      }
      const result = editor.exec({ type: 'goToBookmark', name: target });
      setProblem(result.ok ? null : result.code === 'notFound' ? 'notFound' : 'failed');
      setProblemName(result.ok ? '' : target);
      return result;
    },
    [editor, rows, activeIndex, bookmarks, query]
  );

  return {
    query,
    setQuery,
    sortBy,
    setSortBy,
    showHidden,
    setShowHidden,
    rows,
    bookmarks,
    activeIndex,
    move,
    setActiveIndex,
    go,
    problem,
    problemName,
  };
}
