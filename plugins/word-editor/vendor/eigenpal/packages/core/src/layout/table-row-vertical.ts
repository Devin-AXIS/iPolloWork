// Vertical expressions shared by cell row placement and the shifted-row replay.
//
// `placeCellParagraph` and `layoutRowFragmentBounded` compute these with left-associated
// floating-point sums. The shifted-row replay (`table-row-geometry-reuse.ts`) calls the same
// functions, so both paths evaluate the same operations in the same order. Expressions of one
// operation, and `Math.min`/`Math.max`, have no order to get wrong and stay inline.

import type { CellVerticalAlign } from './semantic-table.ts';

/** Where a cell paragraph's first line starts: its top, its applied space before, its top rule. */
export function cellParagraphFirstTop(
  top: number,
  appliedBefore: number,
  topExtent: number
): number {
  return top + appliedBefore + topExtent;
}

/** The room a horizontal cell leaves around its content in a row of `rowHeight`. */
export function cellAlignmentRoom(
  rowHeight: number,
  insetsTop: number,
  insetsBottom: number,
  contentHeight: number
): number {
  return rowHeight - insetsTop - insetsBottom - contentHeight;
}

/** How far a centred or bottom-aligned cell moves its content down, given positive `room`. */
export function cellAlignmentShift(vAlign: CellVerticalAlign, room: number): number {
  return vAlign === 'center' ? room / 2 : room;
}
