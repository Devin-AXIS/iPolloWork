// Row probes over `layoutRowFragment`: the position-free height measure and the one-pass
// placement for flows with no next fragment. Split out of `semantic-table-layout.ts`, which
// re-exports both, so that module stays inside its line budget; behavior is unchanged.

import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import {
  layoutRowFragment,
  type LayoutRowBoundedResult,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import { measuringFlowDeps } from './table-probe-deps.ts';
import type { RowVMergeLayoutOptions } from './table-vmerge-heights.ts';

/**
 * The row's height on its own, with no page position — what the caller compares against a
 * fresh content box to decide whether the row fits where it stands or has to move.
 *
 * The probe places the row at y=0 because that height must not depend on where the row
 * currently sits. Wrap exclusions are the opposite: they are page-content bands, so at y=0
 * a float near the top of the page covers a row that really sits far below it, and every
 * cell paragraph breaks around a picture it never touches. The probe therefore measures
 * free of them — the placing pass runs at the row's true top and applies whichever bands
 * actually cross it.
 */
export function measureRowHeight(
  row: SemanticTableRow,
  cols: readonly number[],
  left: number,
  depth: number,
  deps: TableFlowDeps,
  cellSpacingPt = 0,
  vMerge?: RowVMergeLayoutOptions,
  atYPt?: number
): number {
  // `atYPt` measures the row WHERE IT IS GOING, wrap bands included — the one thing the
  // position-free probe above cannot do. A merge deciding how tall its span must be passes
  // it; everyone else keeps the position-free probe and the bands it must not see.
  const probeDeps = measuringFlowDeps(deps, atYPt !== undefined);
  // `vMerge` reaches the probe so a detached head is detached HERE too. Emptying its blocks
  // instead still charged the row the empty-cell line below, and that phantom line became a
  // floor the placement never asked for.
  const placed = layoutRowFragment(
    row,
    cols,
    left,
    atYPt ?? 0,
    false,
    depth,
    probeDeps,
    cellSpacingPt,
    vMerge
  );
  return placed.record.box.height;
}

/**
 * One row of a table placed in ONE PASS, where there is no next fragment to carry a
 * remainder to — a nested table, a header/footer story.
 *
 * A merged head is bounded by its span, so it CAN come back owing more than it placed, and
 * these callers have nowhere to put what it owes. Dropping it would break the one rule this
 * module does not bend: nothing discards content to stay inside a box. So the row is placed
 * again with the merge unplanned, which puts the head back to sizing its own row and holding
 * all of it — the shape this file had before any of it planned heights.
 *
 * `rollback` undoes what the discarded attempt published AND withdraws the merge from the
 * plan. The first is why the paginator refuses to re-place at all: an attempt on live deps
 * has already emitted its anchored drawings, and re-placing without taking them back leaves
 * a float positioned by a layout that never happened. The second matters just as much —
 * un-planning the ROW alone leaves the span accepted, so the surplus it put below is still
 * handed out while the head sizes its own row again, reserving the merged height twice.
 * It returns the row's options after the withdrawal: none, or the floor an enclosing merge
 * still needs when the row is a nested head.
 *
 * A caller with no sink it can undo must not pass a `vMerge` at all.
 */
export function layoutOnePassRow(
  row: SemanticTableRow,
  structure: SemanticTableStructure,
  left: number,
  y: number,
  depth: number,
  deps: TableFlowDeps,
  isHeaderRepeat: boolean,
  vMerge: RowVMergeLayoutOptions | undefined,
  rollback: () => RowVMergeLayoutOptions | undefined
): LayoutRowBoundedResult {
  const place = (options: RowVMergeLayoutOptions | undefined): LayoutRowBoundedResult =>
    layoutRowFragment(
      row,
      structure.columnWidthsPt,
      left,
      y,
      isHeaderRepeat,
      depth,
      deps,
      structure.cellSpacingPt,
      options
    );
  const placed = place(vMerge);
  if (placed.remainder === null || vMerge === undefined) return placed;
  return place(rollback());
}
