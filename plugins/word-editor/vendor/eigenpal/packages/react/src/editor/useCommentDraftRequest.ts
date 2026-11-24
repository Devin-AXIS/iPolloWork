// Serve Add comment requests from the host's own comment UI.
//
// The `review.addComment` control runs no engine command: a comment needs its text first, and
// the text comes from a draft that chrome owns. The engine enables the control only while some
// chrome is registered to open that draft. The packaged review rail registers itself; a host
// that renders its own comment UI registers with this hook.
//
// The handler rides in a ref, like `useEditorEvent`: a fresh inline closure every render does
// not register again, and the latest closure is always the one called.

import { useEffect, useRef } from 'react';
import { useDocxEditor } from './context';

/**
 * Open the host's own comment draft when the `review.addComment` control is pressed.
 *
 * While the component is mounted and `handler` is set, the control is enabled (subject to the
 * engine's other rules: the review module, the editing mode, and a selection). Without any
 * registration the control is disabled, because nothing could open the draft. The most recent
 * registration receives each request. Pass `null` to stop serving requests, for example while
 * your comment UI cannot open a draft.
 *
 * The handler takes no arguments. Read the selection with `editor.getSelectionPlacement()`,
 * and pin it with `editor.retainSelection()` while the draft is open.
 *
 * @example
 * ```tsx
 * function CommentButton() {
 *   const [drafting, setDrafting] = useState(false);
 *   useCommentDraftRequest(() => setDrafting(true));
 *   const addComment = useEditorCommand('review.addComment');
 *   return (
 *     <>
 *       <button
 *         disabled={!addComment.isEnabled}
 *         title={addComment.disabledReason ?? 'Add comment'}
 *         onClick={() => addComment.execute()}
 *       >
 *         Add comment
 *       </button>
 *       {drafting ? <MyCommentDraft onClose={() => setDrafting(false)} /> : null}
 *     </>
 *   );
 * }
 * ```
 *
 * @public
 */
export function useCommentDraftRequest(handler: (() => void) | null | undefined): void {
  const editor = useDocxEditor();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const serving = typeof handler === 'function';

  useEffect(() => {
    if (!editor || !serving) return undefined;
    return editor.setCommentDraftChrome({ onRequest: () => handlerRef.current?.() });
  }, [editor, serving]);
}
