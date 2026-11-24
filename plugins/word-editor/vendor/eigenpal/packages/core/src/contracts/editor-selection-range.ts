// Selection and caret reads: where the selection is, and where its insertion point paints.
// Split from `editor.ts`, which re-exports it.

import type { HighlightRect } from './editor-highlights.ts';
import type { ViewScope } from './editor-scope.ts';

/**
 * A text position: a paragraph and a UTF-16 offset in its model text.
 *
 * `blockId` is the paragraph id that `TextMatch.blockId`, `HighlightRange.blockId`, and
 * `ParagraphSummary.id` carry, so a position compares directly with a search result or a
 * highlight range. `offset` counts in the units of `TextMatch.start`, `HighlightRange.start`,
 * and `ParagraphSummary.text`; a field counts the way those count it.
 *
 * @public
 */
export interface TextPosition {
  /** The paragraph, as `TextMatch.blockId` names it. */
  readonly blockId: string;
  /** UTF-16 offset in the paragraph's model text. */
  readonly offset: number;
}

/**
 * The current text selection as two paragraph positions.
 *
 * It is a valid `range` for `exec({ type: 'setSelection', range })`, so a read can be passed
 * back unchanged to restore the selection. Passing it back opens the story it is in, such as
 * a header, a note, or a text box. Each position is a {@link TextPosition}.
 *
 * @example
 * ```ts
 * const range = editor.getSelectionRange();
 * if (range) {
 *   // ... the user works elsewhere ...
 *   editor.exec({ type: 'setSelection', range });
 * }
 * ```
 * @public
 */
export interface EditorSelectionRange {
  /** Where the selection started. */
  readonly anchor: TextPosition;
  /**
   * Where the selection ends: the caret. It comes before `anchor` in a backward selection.
   * A caret with no range has `head` equal to `anchor`.
   */
  readonly head: TextPosition;
  /**
   * The open story that holds both positions: the body, a header or footer, a note, or a text
   * box. A text box opens only for editing, so in viewing mode a selection inside one names
   * the story around the box.
   */
  readonly scope: ViewScope;
}

/**
 * Reads of the selection and the caret for host chrome, such as proofing tools and menus.
 *
 * @public
 */
export interface EditorSelectionReads {
  /**
   * The current text selection, or null when the editor has none.
   *
   * The result is `null` before a document opens, while a picture or another drawing is
   * selected, and while table cells are selected as a block. The selection stays readable
   * when focus leaves the editor, because the editor keeps it for the next edit. The
   * result is reference-stable while the selection does not move, and it is also on
   * `snapshot().selectionRange`, so `selectionChange` handlers and adapter state hooks can
   * read it. Edits before the caret, including remote edits in a collaboration session,
   * move `offset` with the text. The offsets describe the committed document text. While
   * fast typing is buffered, the buffered characters count once they commit, and
   * `selectionChange` fires then. The call never forces a layout pass for local typing.
   *
   * @example
   * ```ts
   * // Flag matches, but skip the word the user is typing.
   * const caret = editor.getSelectionRange()?.head;
   * const flagged = editor.findMatches('teh').filter(
   *   (match) =>
   *     caret?.blockId !== match.blockId ||
   *     caret.offset < match.start ||
   *     caret.offset > match.start + match.length
   * );
   * ```
   */
  getSelectionRange(): EditorSelectionRange | null;

  /**
   * The caret's rectangle in client coordinates, for anchoring a popover or menu at it.
   *
   * The rectangle is the insertion point at the selection head, also for a range selection.
   * It has zero width and the height of the line, except in bottom-to-top table cell text,
   * where it has zero height. It comes from layout geometry, so it is available while the
   * editor is not focused and matches the caret the editor paints. Read it again after a
   * scroll or zoom change; the values describe the moment of the call.
   *
   * The result is `null` before a document opens, when the editor is not attached, and when
   * the caret's page is not painted, such as a page far outside the viewport.
   */
  getCaretRect(): HighlightRect | null;

  /**
   * Where a comment on the current selection would sit, in the same space as
   * `ReviewItemPlacement.anchorY`, or null when nothing is selected.
   *
   * Published so a host can place an "add a comment" affordance beside the selected text
   * without deriving document geometry, which is the one thing an adapter must not do.
   */
  getSelectionPlacement(): { readonly anchorY: number; readonly pageIndex: number } | null;
}
