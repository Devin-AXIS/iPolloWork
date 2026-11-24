// Bounded vertical-merge span resolution for laid-out table fragment rows.
//
// Restart→continuation spans are computed in one forward pass keyed by grid column
// start, O(total cells) work — never a per-restart scan of following rows with
// per-row `.find()`. Hostile / malformed chains (orphan continues, mid-span
// restarts, omitted columns) match the historical scan semantics: a merge ends
// at the first non-continue or missing cell at that column.

import { MAX_TABLE_COLUMNS } from './semantic-table.ts';

/**
 * All a cell has to expose to take part in a merge chain. Both a laid-out
 * `TableCellFragmentRecord` and an authored `SemanticTableCell` satisfy it, so the same
 * pass resolves a page fragment and the authored rows a table is about to be paginated from.
 */
export interface VMergeResolveCell {
  readonly id: string;
  readonly gridColumn: number;
  readonly vMergeContinue: boolean;
}

/** A row of {@link VMergeResolveCell}s, plus whether it is a repeated `w:tblHeader` copy. */
export interface VMergeResolveRow {
  readonly cells: readonly VMergeResolveCell[];
  readonly isHeaderRepeat?: boolean;
}

/**
 * Aggregate ceiling on cells visited during vMerge span resolve across one layout
 * pass (all tables, including nested finalize). Soft: exhaustion stops further
 * span extension; remaining restarts keep `rowSpan` 1 via the caller's `?? 1`.
 */
export const MAX_VMERGE_RESOLVE_CELLS = 1_048_576;

/** Shared remaining cell-visit budget for nested table finalization in one layout. */
export interface TableVMergeResolveBudget {
  cellsRemaining: number;
}

/** Test-only mutable counters; omitted by production call sites. Not package-public. */
export interface TableVMergeResolveWork {
  /** Laid-out cells examined by the merge pass. */
  cellsVisited: number;
  /** Active-column map probes (get/has/set/delete). */
  columnLookups: number;
  /** Restarts that opened or closed an active merge slot. */
  restartsFinalized: number;
}

export function createTableVMergeResolveBudget(
  limit: number = MAX_VMERGE_RESOLVE_CELLS
): TableVMergeResolveBudget {
  const n = limit | 0;
  return { cellsRemaining: n > 0 ? n : 0 };
}

interface ActiveMerge {
  readonly id: string;
  span: number;
}

export interface VMergeResolveOptions {
  /**
   * These rows are ONE PAGE FRAGMENT of a table rather than the whole table. Two things
   * follow, and neither can be seen from the rows alone in a whole-table resolve:
   *
   * - a continuation cell whose restart was placed on an EARLIER fragment heads the merge
   *   here. Word keeps drawing a vertically merged cell on every page the merge crosses
   *   (17.4.85 `w:vMerge`); dropping it leaves a hole in the continuation page's grid.
   * - a repeated `w:tblHeader` row (17.4.78) is a copy of a row already painted on an
   *   earlier page, so it hands no open merge to the body rows below it.
   */
  readonly pageFragment?: boolean;
}

/**
 * Map merge-head cell id → visual row span (≥ 1). Continuation / orphan cells are
 * omitted (callers treat missing as 1 for restarts only); under `pageFragment` a
 * carried-in continuation is itself a head and appears in the map.
 */
export function resolveVMergeSpans(
  rows: readonly VMergeResolveRow[],
  work?: TableVMergeResolveWork,
  budget?: TableVMergeResolveBudget,
  options?: VMergeResolveOptions
): Map<string, number> {
  const mergeSpanById = new Map<string, number>();
  const activeByColumn = new Map<number, ActiveMerge>();
  const pageFragment = options?.pageFragment === true;
  // Columns a cell of this fragment segment has already claimed. A continue at a column
  // nobody claimed yet came from the previous fragment; a continue after a claim is the
  // malformed mid-table case and keeps the historical ignore.
  const claimedColumns = pageFragment ? new Set<number>() : null;
  let inHeaderRepeatPrefix = pageFragment;

  const lookup = (): void => {
    if (work) work.columnLookups += 1;
  };

  const closeColumn = (col: number): void => {
    lookup();
    const active = activeByColumn.get(col);
    if (!active) return;
    mergeSpanById.set(active.id, active.span);
    if (work) work.restartsFinalized += 1;
    lookup();
    activeByColumn.delete(col);
  };

  const budgetExhausted = (): boolean => budget !== undefined && budget.cellsRemaining <= 0;

  const flushActives = (): void => {
    for (const col of [...activeByColumn.keys()]) closeColumn(col);
  };

  for (const row of rows) {
    if (budgetExhausted()) {
      // Fail soft: flush open merges at their current spans; later restarts stay span 1.
      flushActives();
      break;
    }

    if (inHeaderRepeatPrefix && row.isHeaderRepeat !== true) {
      // End of the repeated header group: nothing it opened reaches the body rows.
      inHeaderRepeatPrefix = false;
      flushActives();
      claimedColumns?.clear();
    }

    const touched = new Set<number>();
    let rowAborted = false;
    for (const cell of row.cells) {
      if (budget) {
        if (budget.cellsRemaining <= 0) {
          rowAborted = true;
          break;
        }
        budget.cellsRemaining -= 1;
      }
      if (work) work.cellsVisited += 1;

      // Clamp hostile / out-of-range column indexes to the structure ceiling.
      const col = Math.max(0, Math.min(cell.gridColumn | 0, MAX_TABLE_COLUMNS - 1));
      touched.add(col);

      if (cell.vMergeContinue) {
        lookup();
        const active = activeByColumn.get(col);
        if (active) {
          active.span += 1;
        } else if (claimedColumns && !claimedColumns.has(col)) {
          // Carried in from the previous page fragment: this copy heads the merge here.
          lookup();
          activeByColumn.set(col, { id: cell.id, span: 1 });
        }
        // Anything else is an orphan continue — ignore (historical behavior).
      } else {
        // Plain cell or restart: end any prior open merge at this column, then open.
        closeColumn(col);
        lookup();
        activeByColumn.set(col, { id: cell.id, span: 1 });
      }
      claimedColumns?.add(col);
    }

    if (rowAborted) {
      flushActives();
      break;
    }

    // Omitted columns end merges (same as a `.find()` miss in the old per-restart scan).
    for (const col of [...activeByColumn.keys()]) {
      if (!touched.has(col)) closeColumn(col);
    }
  }

  flushActives();
  return mergeSpanById;
}
