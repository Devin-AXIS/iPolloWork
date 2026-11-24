// The document's author roster, live.
//
// Authors depend on the loaded file, so a legend or a per-reviewer colour picker cannot be
// configured up front — it has to read who is actually in the document. This hook is that
// read, reactive: a document load, an edit that introduces a reviewer, and a
// `setRevisionStyles` call all re-render the consumer.

import { useCallback, useSyncExternalStore } from 'react';
import type { ReviewAuthorInfo } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { deferredNotifier } from './useEditorState';

const EMPTY: readonly ReviewAuthorInfo[] = [];
const NOOP_UNSUBSCRIBE = () => {};

/**
 * Every author the review surface DRAWS, in Word's slot order, with the colour and style
 * each resolves to. `[]` before an editor or document exists.
 *
 * Both halves of review: authors of tracked changes first, numbered by where their first
 * change appears, then authors who only commented. One person is one colour across the two.
 * Once assigned, a slot stays with that author for the attached document session.
 *
 * The complete attached-document roster. An author remains here while the current review
 * view hides their revisions and comments, so reviewer chrome can turn them on again.
 *
 * The array is reference-stable between changes (the facade caches per layout and colour
 * state), so it is safe as a dependency and under `useSyncExternalStore`.
 *
 * Pairs with the declarative components: read the roster here, declare the styling as
 * `<DocxEditor.AuthorStyle>` elements.
 *
 * ```tsx
 * const authors = useReviewAuthors();
 * authors.map(({ author }) => (
 *   <DocxEditor.AuthorStyle key={author} author={author} color={myTeam[author]?.color} />
 * ));
 * ```
 *
 * @public
 */
export function useReviewAuthors(): readonly ReviewAuthorInfo[] {
  const editor = useDocxEditor();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!editor) return NOOP_UNSUBSCRIBE;
      // The SAME notifier `useEditorState` uses, not a hand-rolled microtask. It defers
      // because `change` fires mid-commit, before the layout publish the roster derives
      // from; it COALESCES, so one commit emitting both events notifies once; and it falls
      // back to a task while input is pending, so holding a key down cannot drive a
      // notification per keystroke without ever yielding.
      const notify = deferredNotifier(onStoreChange);
      const offChange = editor.on('change', notify);
      const offSelection = editor.on('selectionChange', notify);
      return () => {
        offChange();
        offSelection();
      };
    },
    [editor]
  );
  return useSyncExternalStore(
    subscribe,
    () => editor?.getReviewAuthors() ?? EMPTY,
    () => EMPTY
  );
}
