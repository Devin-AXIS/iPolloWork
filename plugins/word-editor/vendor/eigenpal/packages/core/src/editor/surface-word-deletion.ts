// Ctrl+Backspace and Ctrl+Delete: delete from the caret to the next word boundary
// (paginated-surface seam).
//
// A selection goes first, as it does for every deleting key, except a selected prompt, which a
// word deletion leaves as it is. A caret already at a boundary deletes one character instead.
// A word that reaches a prompt or an atomic control is that lane's to answer
// (`deleteAtomicControl`), so the word walk never takes part of one.

import {
  wordBoundary,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { wordMotionBoundaries } from '../layout/word-navigation-boundaries.ts';

type Direction = 'backward' | 'forward';

/** What the word lane borrows from the mount closure. Mutable state arrives as a getter. */
export interface SurfaceWordDeletionDeps {
  selection(): SemanticSelection;
  layout(): SemanticLayout;
  textOf(paragraphId: string): string;
  /** A form field's own word boundary, when the caret is in one. */
  fieldBoundary():
    | ((text: string, offset: number, direction: -1 | 1, stops: ReadonlySet<number>) => number)
    | undefined;
  /** The selection is exactly one prompt, which a word deletion leaves as it is. */
  promptIsSelected(): boolean;
  /** Deletes a non-empty selection; false when there is none. */
  deleteSelection(): boolean;
  deleteCharacter(direction: Direction): void;
  /** The prompt and atomic-control lane for a word ending at `reach`; true when it acted. */
  deleteAtomicControl(direction: Direction, reach: number): boolean;
  /** Commits the word's deletion; the caret lands at `caret` when one is named. */
  commitWord(ops: readonly TreeDocOp[], caret: SemanticPosition | undefined): void;
}

export function createSurfaceWordDeletion(deps: SurfaceWordDeletionDeps): {
  deleteWord(direction: Direction): void;
} {
  function deleteWord(direction: Direction): void {
    if (deps.promptIsSelected() || deps.deleteSelection()) return;
    const head = deps.selection().head;
    const backward = direction === 'backward';
    // Stopped at a struck half's edge, like every other word walk: Ctrl+Backspace at the
    // end of a replacement's new text must not reach back through the old text with it.
    const target = (deps.fieldBoundary() ?? wordBoundary)(
      deps.textOf(head.paragraphId),
      head.offset,
      backward ? -1 : 1,
      wordMotionBoundaries(deps.layout(), head.paragraphId)
    );
    if (target === head.offset) return deps.deleteCharacter(direction);
    if (deps.deleteAtomicControl(direction, target)) return;
    const [start, end] = backward ? [target, head.offset] : [head.offset, target];
    deps.commitWord(
      [{ op: 'deleteText', paragraphId: head.paragraphId, start, end }],
      backward ? { ...head, offset: target } : undefined
    );
  }
  return { deleteWord };
}
