import type { SelectionMark, TransactionContext, TreeDocumentStore } from './tree-store.ts';
import type { HistoryPointer } from './story-retention.ts';

/** Read either history unit through the same selection contract. */
export function selectionForHistory(
  pointer: HistoryPointer | undefined,
  body: TreeDocumentStore,
  stories: ReadonlyMap<string, TreeDocumentStore>,
  direction: 'undo' | 'redo'
): SelectionMark | null {
  if (!pointer) return null;
  if (pointer.kind === 'package') {
    return (direction === 'undo' ? pointer.selectionBefore : pointer.selectionAfter) ?? null;
  }
  const store = pointer.partName === body.part.name ? body : stories.get(pointer.partName);
  return (direction === 'undo' ? store?.selectionForUndo() : store?.selectionForRedo()) ?? null;
}

/** Keep the gesture's selections when a story transaction promotes to package history. */
export function capturePackageSelections(ctx: TransactionContext) {
  let before: SelectionMark | null = null;
  let after: SelectionMark | null | undefined;
  return {
    context: {
      selectionBefore(selection: SelectionMark | null) {
        before = selection;
        ctx.selectionBefore(selection);
      },
      selectionAfter(selection: SelectionMark | null) {
        after = selection;
        ctx.selectionAfter(selection);
      },
    },
    snapshot(caret: SelectionMark | undefined) {
      return {
        selectionBefore: before,
        selectionAfter: after === undefined ? (caret ?? null) : after,
      };
    },
  };
}
