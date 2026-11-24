// Header/footer lifecycle + page-field commits for the paginated surface.
//
// Keeps package-level furniture ops and allowlisted field insertion off the composition
// root so paginated-surface stays under the max-lines budget.

import type { TreeApplyResult } from '@docx-editor.dev/core/binding';
import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import type { SurfaceLifecycleOp } from './surface-hf-editing.ts';

export function createHeaderFooterOps(deps: {
  applyOps: (
    ops: readonly TreeDocOp[],
    before?: { paragraphId: string; start: number; end: number } | null,
    after?: { paragraphId: string; start: number; end: number } | null
  ) => TreeApplyResult;
  commit: (
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  deleteSelectionOps: () => readonly TreeDocOp[];
  /**
   * The removal ops AND the position they leave to insert at.
   *
   * `orderedStart()` is not that position: a plan that takes a table with it removes the
   * paragraph the range started in, and an op naming a paragraph the same transaction
   * deleted vetoes all of it.
   */
  deleteSelectionPlan: () => {
    readonly ops: readonly TreeDocOp[];
    readonly collapseTo: { paragraphId: string; offset: number };
    readonly replaceAt?: { paragraphId: string; offset: number };
  };
  orderedStart: () => { paragraphId: string; offset: number };
  selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  collapsedAt: (pos: { paragraphId: string; offset: number }) => SemanticSelection;
  isHeaderFooterOpen: () => boolean;
  lastRejection: () => string | null;
}): {
  applyHeaderFooterLifecycle: (
    op: SurfaceLifecycleOp
  ) => { readonly ok: true } | { readonly ok: false; readonly reason: string };
  insertPageField: (field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y') => boolean;
} {
  return {
    applyHeaderFooterLifecycle(op) {
      let refused: string | null = null;
      deps.commit(() => {
        const result = deps.applyOps([op]);
        if (result.rejected) refused = String(result.reason ?? 'rejected');
        return result;
      });
      return refused ? { ok: false as const, reason: refused } : { ok: true as const };
    },

    insertPageField(field) {
      if (!deps.isHeaderFooterOpen()) return false;
      // The plan's `replaceAt`, never the range start: in suggesting mode the struck words
      // stay and the field belongs after them, and a deletion that takes a block with it
      // leaves no paragraph at the start to insert into — one refused op vetoes the whole
      // transaction, so the field did not appear AND the deletion did not happen.
      const plan = deps.deleteSelectionPlan();
      const start = plan.replaceAt ?? plan.collapseTo;
      deps.commit(
        () =>
          deps.applyOps(
            [
              ...plan.ops,
              {
                op: 'insertPageField',
                paragraphId: start.paragraphId,
                offset: start.offset,
                field,
              },
            ],
            deps.selectionMark()
          ),
        () =>
          deps.collapsedAt({
            paragraphId: start.paragraphId,
            offset: start.offset + (field === 'PAGE_X_OF_Y' ? 1 + ' of '.length + 1 : 1),
          })
      );
      return deps.lastRejection() === null;
    },
  };
}
