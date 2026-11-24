// The Bookmark dialog's logic, shared by the React and Vue dialogs so the two cannot drift:
// which bookmarks the list shows and in which order, and what the typed name allows.

import {
  bookmarkNameKey,
  bookmarkNameProblem,
  isHiddenBookmarkName,
  type BookmarkNameProblem,
} from '@docx-editor.dev/core/store';
import type { BookmarkPlace, BookmarkSummary } from '../contracts/editor-bookmarks.ts';

/**
 * How the Bookmark dialog orders its list: by name, or by where each bookmark is.
 *
 * @public
 */
export type BookmarkSortOrder = 'name' | 'location';

/** Without case, and digits by value, so `section2` comes before `section10`. */
const NAME_ORDER = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The bookmarks the dialog lists. Hidden bookmarks show only when asked for. Names sort
 * without case and with numbers in order, and location sorts by document order.
 *
 * @public
 */
export function bookmarkDialogRows(
  bookmarks: readonly BookmarkSummary[],
  options: { readonly sortBy: BookmarkSortOrder; readonly showHidden: boolean }
): readonly BookmarkSummary[] {
  const rows = bookmarks.filter((bookmark) => options.showHidden || !bookmark.hidden);
  return options.sortBy === 'location'
    ? [...rows].sort((a, b) => a.order - b.order)
    : [...rows].sort((a, b) => NAME_ORDER.compare(a.name, b.name) || a.order - b.order);
}

/** The order of the places on a Go To list sorted by location. */
const PLACE_ORDER: readonly BookmarkPlace[] = ['body', 'header', 'footer', 'footnote', 'endnote'];

/**
 * The bookmarks a Go To name box offers for what was typed: those whose name contains it,
 * compared without case, in the dialog's order. Names that start with it come first. An empty
 * query offers every row. Sorted by location, the rows are in the order
 * {@link goToBookmarkGroups} shows them: by place first, so moving through the list follows
 * the screen.
 *
 * @public
 */
export function goToBookmarkRows(
  bookmarks: readonly BookmarkSummary[],
  options: {
    readonly query: string;
    readonly sortBy: BookmarkSortOrder;
    readonly showHidden: boolean;
  }
): readonly BookmarkSummary[] {
  const rows = bookmarkDialogRows(bookmarks, options);
  const needle = bookmarkNameKey(options.query.trim());
  let offered: readonly BookmarkSummary[] = rows;
  if (needle.length > 0) {
    const starts: BookmarkSummary[] = [];
    const contains: BookmarkSummary[] = [];
    for (const row of rows) {
      const key = bookmarkNameKey(row.name);
      if (key.startsWith(needle)) starts.push(row);
      else if (key.includes(needle)) contains.push(row);
    }
    offered = [...starts, ...contains];
  }
  if (options.sortBy !== 'location') return offered;
  // Stable: within a place, the order above stays.
  return [...offered].sort((a, b) => PLACE_ORDER.indexOf(a.place) - PLACE_ORDER.indexOf(b.place));
}

/**
 * The bookmark a Go To name box means: the one whose name equals what was typed, compared
 * without case, hidden or not; else the first row offered. Null when there is none.
 *
 * @public
 */
export function goToBookmarkTarget(
  bookmarks: readonly BookmarkSummary[],
  query: string,
  offered: readonly BookmarkSummary[]
): BookmarkSummary | null {
  const key = bookmarkNameKey(query.trim());
  if (key.length === 0) return null;
  return bookmarks.find((bookmark) => bookmarkNameKey(bookmark.name) === key) ?? offered[0] ?? null;
}

/**
 * Where the typed text sits in a bookmark name, compared without case, for showing the match.
 * Null when the text is empty or the name does not contain it.
 *
 * @public
 */
export function goToBookmarkMatch(
  name: string,
  query: string
): { readonly start: number; readonly end: number } | null {
  const needle = bookmarkNameKey(query.trim());
  const key = bookmarkNameKey(name);
  // A lowercase form of another length cannot be mapped back onto the name.
  if (needle.length === 0 || key.length !== name.length) return null;
  const start = key.indexOf(needle);
  return start < 0 ? null : { start, end: start + needle.length };
}

/**
 * One section of a Go To list sorted by location: the rows of one place, each with its index
 * in the full list.
 *
 * @public
 */
export interface GoToBookmarkGroup {
  /** The place every row of the section is in. */
  readonly place: BookmarkPlace;
  /** The section's rows, each with its index in the full list (the one the highlight uses). */
  readonly rows: readonly { readonly row: BookmarkSummary; readonly index: number }[];
}

/**
 * The rows of a Go To list grouped by place: the main text, then headers, footers, footnotes
 * and endnotes. Places with no row are left out. Rows keep their order within a place.
 *
 * @public
 */
export function goToBookmarkGroups(rows: readonly BookmarkSummary[]): readonly GoToBookmarkGroup[] {
  return PLACE_ORDER.map((place) => ({
    place,
    rows: rows.flatMap((row, index) => (row.place === place ? [{ row, index }] : [])),
  })).filter((group) => group.rows.length > 0);
}

/**
 * The name the dialog starts with: the visible bookmark the selection is in, or an empty name.
 *
 * @public
 */
export function bookmarkDialogInitialName(bookmarks: readonly BookmarkSummary[]): string {
  return bookmarks.find((bookmark) => bookmark.atSelection && !bookmark.hidden)?.name ?? '';
}

/**
 * What the typed name allows in the Bookmark dialog.
 *
 * @public
 */
export interface BookmarkDialogNameState {
  /** Why Add cannot use the name, or null when it can. Hidden names cannot be added. */
  readonly problem: BookmarkNameProblem | null;
  /** The bookmark the name already belongs to, compared without case, or null. */
  readonly existing: BookmarkSummary | null;
  /** Add bookmarks the selection under the name; an existing bookmark moves. */
  readonly canAdd: boolean;
  /** Delete and Go To act on an existing bookmark. */
  readonly canDelete: boolean;
  readonly canGoTo: boolean;
}

/**
 * Evaluate the name typed in the Bookmark dialog against the document's bookmarks.
 * `writable` is whether the document accepts edits; Go To works either way.
 *
 * @public
 */
export function bookmarkDialogNameState(
  bookmarks: readonly BookmarkSummary[],
  name: string,
  writable: boolean
): BookmarkDialogNameState {
  const problem = bookmarkNameProblem(name) ?? (isHiddenBookmarkName(name) ? 'invalidStart' : null);
  const key = bookmarkNameKey(name);
  const existing =
    name.length === 0
      ? null
      : (bookmarks.find((bookmark) => bookmarkNameKey(bookmark.name) === key) ?? null);
  return {
    problem,
    existing,
    canAdd: writable && problem === null,
    canDelete: writable && existing !== null,
    canGoTo: existing !== null,
  };
}
