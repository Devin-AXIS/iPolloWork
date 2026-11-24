// A text-anchored positioned table that row pagination places in the body flow.
//
// Where a table comes from. A `w:tblpPr` table with `w:vertAnchor="text"` (and no
// `w:tblpYSpec`) normally waits for its anchor paragraph and is placed there whole
// (`admitsAtAnchor` in `table-float-exclusion.ts`). Row pagination places it instead when:
// - its rows do not fit the room below the body cursor but its opening does (below), in a
//   single-column section, without `w:topFromText` or a negative `w:tblpY`, and without
//   `w:doNotBreakWrappedTables`. `w:bottomFromText` alone never keeps it whole;
// - it is taller than a page, earlier wrapping pictures or frames reach its cells, or a header
//   or footer holds wrapping objects. These routes skip the keep-whole conditions above.
//
// How it breaks:
// - The opening is the header rows and the first line of every cell of the first body row, or
//   that row's minimum height when larger, or the whole row when its height is exact.
// - The first fragment keeps the `w:tblpY` offset below the body cursor. When the opening fits
//   only a fresh page below content already in the column, or a negative offset would break the
//   table below that content, the table moves there first and keeps its offset, as a whole table
//   moves with its anchor (`openTextTable`). A negative offset at a page top reaches into the
//   top margin, as an unbroken positioned table does.
// - Rows paginate as in an unpositioned table: a row splits between lines at the page bottom
//   and moves to the next page only when the room left cannot hold its minimum height or the
//   first line of every cell. The first body row is the opening's and never moves alone.
//   `w:cantSplit` is ignored, as for page-positioned tables. Later fragments open at the top of
//   the next page or column, below repeated header rows.
//
// The text after it:
// - The anchor paragraph and what follows continue on the page of the last fragment. Beside a
//   table that leaves no passage wider than a quarter inch in its column, no text fits, so they
//   resume below the last row and its `w:bottomFromText` (`resumeAfterBreak`). Beside a
//   narrower table they resume at the top of that fragment, which then wraps text like any
//   floating table: the paginator publishes it with `wrapsFollowingText`, and
//   `addFloatingTableExclusions` turns it into a zone. Text that starts there sits at the top of
//   the page, so its space before collapses. A page- or margin-positioned table that breaks
//   (`table-pinned-break.ts`) resumes the text by the same rule.
// - With `textBesideBrokenFloatingTable`, the text starts beside the first fragment instead, and
//   every fragment wraps text on its page (`table-text-carry.ts`).
// - An earlier floating table that waits for the same anchor paragraph is placed where the body
//   reached this table (`noteAnchor` in `semantic-layout.ts`), even when the table then moves on.
//
// A table that does not break resumes the text below its last row, as before. Limit: a first
// body row whose minimum fits neither the room left nor a fresh page splits where it stands.

import type { SemanticTableStructure } from './semantic-table.ts';
import type { TableFlowCursor } from './table-flow-cursor.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { openingHeight, probeTable } from './table-pinned-break.ts';
import { rowMinimumOpeningPt } from './table-row-minimum-fit.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';
import { TABLE_WRAP_MIN_PASSAGE_PT } from './drawing-exclusion.ts';

const EPSILON = 0.001;
const NO_DISTANCES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** Whether the paginator places `structure` as a text-anchored table in the body flow. */
export function isInFlowTextTable(structure: SemanticTableStructure, outOfFlow: boolean): boolean {
  return !outOfFlow && structure.float?.vertAnchor === 'text' && !structure.float.ySpec;
}

/**
 * Bottom of a table's opening when it starts at `top`: the header prefix, which moves as one
 * group, and the first line of every cell of the first body row, or that row's authored minimum
 * height when it is larger. An exact-height row opens whole. `undefined` when the table has no
 * body row. `width` is the width the structure was read against.
 */
export function openingRowsBottom(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  width: number,
  top: number,
  deps: TableFlowDeps
): number | undefined {
  const first = structure.rows.findIndex((row) => !row.isHeader);
  if (first < 0) return undefined;
  const probe = probeTable(table, structure, width, deps);
  const row = structure.rows[first]!;
  const rowDeps = first === 0 ? firstRowContentDeps(structure, row, deps) : deps;
  const placed = probe.rows[first];
  // An exact-height row never splits, so it opens whole.
  if (row.height.rule === 'exact' && placed) return top + placed.box.y + placed.box.height;
  const minimum = rowMinimumOpeningPt(row, rowDeps, structure.cellSpacingPt, Infinity) ?? 0;
  return top + Math.max(openingHeight(probe), (placed?.box.y ?? 0) + minimum);
}

/**
 * Opens an in-flow text-anchored table `w:tblpY` below the body cursor. Below content already in
 * the column, when its opening does not fit there, or a negative offset leaves the whole table
 * short of the room, but the opening fits a fresh column, the table first moves to the next
 * column or page and keeps its offset there, up into the top margin. Returns the table's left edge
 * in the column it opens in.
 */
export function openTextTable(
  table: OoxmlElement,
  structure: SemanticTableStructure,
  flow: TableFlowCursor,
  left: number,
  originX: () => number
): number {
  const offset = structure.float?.yPt ?? 0;
  const fits = (top: number) =>
    (openingRowsBottom(table, structure, flow.columnWidth(), top + offset, flow.deps) ?? 0) <=
    flow.contentHeight() + EPSILON;
  // A negative offset that does not let the whole table fit the room left would cover the text
  // above the break, so such a table opens the next region too. Only then is it measured whole.
  const breaksBelowText =
    offset < 0 &&
    flow.cursorY + offset + probeTable(table, structure, flow.columnWidth(), flow.deps).box.height >
      flow.contentHeight() + EPSILON;
  if (
    flow.regionHoldsContent(flow.cursorY) &&
    (breaksBelowText || !fits(flow.cursorY)) &&
    fits(flow.columnTop?.() ?? 0)
  ) {
    flow.advanceColumn();
    left = originX();
  }
  // A negative offset at the top of a page reaches into the top margin, never past the sheet.
  // `|| 0` keeps a page without a top margin at +0, not -0.
  const sheetTop = flow.verticalAnchorFrames().page.top || 0;
  flow.cursorY = Math.max(sheetTop, Math.min(flow.cursorY + offset, flow.contentHeight()));
  return left;
}

/**
 * Whether a table at `left` leaves a passage for text beside it in the column being filled:
 * more than a quarter inch between its text distance and the column edge, on either side. The
 * check uses the grid edges; the wrap zone also adds outer border widths, so a passage within
 * a border width of a quarter inch counts as room although no text fits there.
 */
export function leavesPassage(
  structure: SemanticTableStructure,
  flow: Pick<TableFlowCursor, 'columnLeft' | 'columnWidth'>,
  left: number
): boolean {
  const distances = structure.float?.distances ?? NO_DISTANCES;
  const width = structure.columnWidthsPt.reduce((sum, columnWidth) => sum + columnWidth, 0);
  const column = flow.columnLeft();
  const before = left - distances.left - column;
  const after = column + flow.columnWidth() - (left + width + distances.right);
  return Math.max(before, after) > TABLE_WRAP_MIN_PASSAGE_PT + EPSILON;
}

/**
 * Where the body resumes after a positioned table that broke across pages, with the flow cursor
 * at the end of its last fragment. Text that wraps beside that fragment starts at its `top`.
 * Otherwise it starts below the last row and `w:bottomFromText`. The same holds for text- and
 * page-anchored tables.
 */
export function resumeAfterBreak(
  structure: SemanticTableStructure,
  flow: Pick<TableFlowCursor, 'cursorY' | 'contentHeight'>,
  wrapsBeside: boolean,
  top: number
): number {
  if (wrapsBeside) return top;
  const bottom = structure.float?.distances?.bottom ?? 0;
  return Math.min(flow.cursorY + bottom, flow.contentHeight());
}
