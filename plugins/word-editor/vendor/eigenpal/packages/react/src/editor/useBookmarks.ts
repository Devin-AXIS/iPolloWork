// The document's bookmarks as a hook: the list through the `bookmarks` query, and the
// insert, delete and go-to commands. The list is not part of the snapshot, so it is read on
// every tick and kept reference-stable while unchanged.

import { useCallback, useMemo } from 'react';
import type {
  BookmarkSummary,
  EditorSnapshot,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** What `useBookmarks` returns. @public */
export interface UseBookmarksReturn {
  /** Every bookmark, hidden ones included, in document order. Reference-stable while unchanged. */
  readonly bookmarks: readonly BookmarkSummary[];
  /** Whether the document accepts bookmark edits now. Go To works either way. */
  readonly isWritable: boolean;
  /** Bookmark the selection under `name`. A bookmark with the name moves. */
  readonly insert: (name: string) => ExecResult;
  /** Delete the bookmark with this name. The text stays. */
  readonly remove: (name: string) => ExecResult;
  /** Select the bookmark and scroll to it. */
  readonly goTo: (name: string) => ExecResult;
  /**
   * Keep the first bookmark with this name and remove its copies, which collaborators adding
   * one name offline can leave. The selection does not move.
   */
  readonly keepFirst: (name: string) => ExecResult;
}

const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };
const NONE: readonly BookmarkSummary[] = Object.freeze([]);

/** Whether two bookmark lists say the same. @internal */
export function sameBookmarks(
  a: readonly BookmarkSummary[],
  b: readonly BookmarkSummary[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (bookmark, index) =>
        bookmark.name === b[index]!.name &&
        bookmark.order === b[index]!.order &&
        bookmark.story === b[index]!.story &&
        bookmark.empty === b[index]!.empty &&
        bookmark.atSelection === b[index]!.atSelection &&
        bookmark.duplicates === b[index]!.duplicates &&
        bookmark.hidden === b[index]!.hidden &&
        bookmark.place === b[index]!.place
    )
  );
}

/**
 * The document's bookmarks plus the commands that change them.
 *
 * @public
 */
export function useBookmarks(): UseBookmarksReturn {
  const editor = useDocxEditor();
  const select = useCallback(
    (_snapshot: EditorSnapshot): readonly BookmarkSummary[] =>
      editor?.query({ type: 'bookmarks' }) ?? NONE,
    [editor]
  );
  const bookmarks = useEditorState(select, sameBookmarks);
  // Asked on every tick: the answer moves with the selection (a table of contents is
  // read-only) and with the editing mode.
  const selectWritable = useCallback(
    (snapshot: EditorSnapshot): boolean =>
      snapshot.editable &&
      editor !== null &&
      editor.can({ type: 'insertBookmark', name: 'Bookmark' }).ok,
    [editor]
  );
  const isWritable = useEditorState(selectWritable);
  const insert = useCallback(
    (name: string): ExecResult =>
      editor ? editor.exec({ type: 'insertBookmark', name }) : NOT_READY,
    [editor]
  );
  const remove = useCallback(
    (name: string): ExecResult =>
      editor ? editor.exec({ type: 'deleteBookmark', name }) : NOT_READY,
    [editor]
  );
  const goTo = useCallback(
    (name: string): ExecResult =>
      editor ? editor.exec({ type: 'goToBookmark', name }) : NOT_READY,
    [editor]
  );
  const keepFirst = useCallback(
    (name: string): ExecResult =>
      editor ? editor.exec({ type: 'keepFirstBookmark', name }) : NOT_READY,
    [editor]
  );
  return useMemo(
    () => ({ bookmarks, isWritable, insert, remove, goTo, keepFirst }),
    [bookmarks, isWritable, insert, remove, goTo, keepFirst]
  );
}
