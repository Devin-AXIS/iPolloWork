// Transactional row-progress preflight for repeated table headers.

import {
  layoutRowFragmentBounded,
  type CellPlaceCursor,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { readOnlyBreakCache } from './paragraph-cache-peek.ts';

/**
 * Whether a bounded row placement can consume authored content without publishing anything.
 *
 * Repeated table headers ask this before committing their copy to a continuation page. A header
 * that leaves no room for the pending row must be omitted on that page; discovering that only
 * after placement would leave live line ids, drawing sinks and shared budgets mutated by geometry
 * that is then discarded. The probe deliberately keeps all geometry inputs (including page wrap
 * zones and the exact continuation cursor) while replacing every publication/retention seam.
 *
 * It intentionally probes the row without an admitted vMerge plan. Admission is tied to the
 * row's committed page position and has no snapshot/rollback seam; reusing the previous page's
 * options produced false negatives for carried merges, while accepting against a speculative
 * header position would leave stale floors behind when the repeat is suppressed. The unplanned
 * row is the conservative progress baseline: vMerge can detach or floor geometry, but cannot take
 * away the first authored progress that this baseline can place.
 * @internal
 */
export function probeRowFragmentProgress(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  rowTop: number,
  maxBottom: number,
  isContinuation: boolean,
  depth: number,
  deps: TableFlowDeps,
  cursors: readonly CellPlaceCursor[],
  cellSpacingPt = 0,
  options?: { readonly requireEveryCell?: boolean }
): boolean {
  let lineCounter = 0;
  // Before mode 15 a cell object that would cross the page keeps its row from starting here.
  let anchorCrosses = false;
  const probeDeps: TableFlowDeps = {
    ...stripAnchorSinksForProbe(deps),
    // Reads only: a probe never retains a break, but it may reuse one placement measured.
    cache: readOnlyBreakCache(deps.cache),
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-progress-${lineCounter++}`,
    ...(options?.requireEveryCell ? { onCellAnchorCrossing: () => (anchorCrosses = true) } : {}),
  };
  const placed = layoutRowFragmentBounded(
    row,
    cols,
    left,
    rowTop,
    maxBottom,
    false,
    isContinuation,
    depth,
    probeDeps,
    cursors,
    cellSpacingPt
  );
  return (
    placed.fitted &&
    !anchorCrosses &&
    (!options?.requireEveryCell ||
      placed.record.cells.every(
        (cell, index) =>
          cell.vMergeContinue || row.cells[index]!.blocks.length === 0 || cell.blocks.length > 0
      ))
  );
}

/**
 * Whether the next fragment of a body row makes progress at `top` on a page that ends at
 * `bottom`, without the row's page-start allowance. A new row must start every cell there,
 * also when it is taller than a page. A continued row needs only one.
 * @internal
 */
export function probeBodyRowStart(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  left: number,
  top: number,
  bottom: number,
  isContinuation: boolean,
  deps: TableFlowDeps,
  cursors: readonly CellPlaceCursor[]
): boolean {
  return probeRowFragmentProgress(
    row,
    structure.columnWidthsPt,
    left,
    top,
    bottom,
    isContinuation,
    0,
    { ...deps, rowAtPageStart: false },
    cursors,
    structure.cellSpacingPt,
    { requireEveryCell: !isContinuation }
  );
}
