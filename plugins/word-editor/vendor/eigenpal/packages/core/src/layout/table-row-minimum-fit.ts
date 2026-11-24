// Where a splittable row with an authored minimum height may start.
//
// A row with a `w:trHeight` `atLeast` minimum (§17.4.81) starts below content already in the
// column only when that minimum, padded by the row's margins as the row box pads it, fits the
// room left there. Otherwise the row moves to the next column or page, even when its first
// lines would fit, and even when its content is taller than a page. When the minimum fits, the
// row starts and splits as any other row. A continuation fragment has no minimum. A
// `w:keepNext` paragraph before the table prices the same height, so it moves with the row.
//
// A wrap band is not content. When a fragment opens below a band in a column that holds
// nothing else (`table-float-collision.ts`), only the band and repeated header rows sit above
// the row, and the row starts there. The room a fresh column offers does not deduct a band
// that repeats there, so a row with content above it moves even when the next page leaves it
// the same room below that band.
//
// Positioned-table limit:
// - Positioned (`w:tblpPr`) tables, except one breaking across pages in the body flow
//   (`table-pinned-break.ts`, `table-text-float-break.ts`).

import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import { cutRowContentDeps } from './table-fragment-content-insets.ts';
import type { PinnedTableBreak } from './table-pinned-break.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { authoredRowMinimumFloorPt } from './table-row-minimum-insets.ts';
import { rowOpeningGapPt } from './table-cell-spacing.ts';

/**
 * Height the first fragment of `row` needs where it starts: the padded `atLeast` minimum, or
 * undefined when the row has none. A larger minimum consumes the fresh column band.
 */
export function rowMinimumOpeningPt(
  row: SemanticTableRow,
  deps: TableFlowDeps,
  cellSpacingPt: number,
  freshRoomPt: number
): number | undefined {
  if (row.height.rule !== 'atLeast' || !(row.height.valuePt > 0)) return undefined;
  // The cell-spacing gap above the row's cells counts toward its height, as row layout places it.
  const gapPt = rowOpeningGapPt(row, cellSpacingPt);
  const cells = row.cells.map((cell) => {
    const own =
      deps.cellContentInsets?.get(cell.id) ?? cellContentInsets(cell, cellSpacingPt === 0);
    return { cell, insets: { ...own, top: own.top + gapPt } };
  });
  const minimum = authoredRowMinimumFloorPt(
    row.height.valuePt,
    cells,
    deps.cellMinimumContentInsets,
    gapPt
  );
  return Math.min(minimum, freshRoomPt);
}

/** Whether a row's first fragment can retain its minimum in the offered opening. */
export function rowMinimumFits(
  row: SemanticTableRow,
  deps: TableFlowDeps,
  cellSpacingPt: number,
  freshRoomPt: number,
  availablePt: number
): boolean {
  const minimum = rowMinimumOpeningPt(row, deps, cellSpacingPt, freshRoomPt);
  return minimum === undefined || minimum <= availablePt + 0.001;
}

/**
 * How the part of a row that does not fit the page whole is placed: its deps and the bottom it
 * may reach. A first part ends its fragment at a cut, so its cells keep room for the inside rule
 * that closes it (`cutRowContentDeps`). A continuation keeps its own insets, and its band stops
 * that rule's width short of `bottom`: it either splits again or ends the page with its closing
 * rule. A page-positioned break (`table-pinned-break.ts`) fills its band without either.
 */
export function cutPart(
  structure: SemanticTableStructure,
  row: SemanticTableRow,
  deps: TableFlowDeps,
  bottom: number,
  continuation: boolean,
  /** The page-positioned break this row belongs to, if any. */
  pinned: PinnedTableBreak | undefined
): { readonly deps: TableFlowDeps; readonly bottom: number } {
  if (pinned) return { deps, bottom };
  const cut = cutRowContentDeps(structure, row, deps);
  if (!continuation) return { deps: cut, bottom };
  let rule = 0;
  for (const cell of row.cells) {
    const own = (deps.cellContentInsets?.get(cell.id) ?? cellContentInsets(cell, true)).bottom;
    rule = Math.max(rule, (cut.cellContentInsets?.get(cell.id)?.bottom ?? own) - own);
  }
  return { deps, bottom: bottom - rule };
}

/** Where a row would start in the column being filled, in page content coordinates. */
export interface RowMinimumPlace {
  readonly top: number;
  readonly columnTop: number;
  /** Bottom of the band on this page. */
  readonly bottom: number;
  /** Bottom of the full band a fresh page offers, note reserve ignored. */
  readonly band: number;
  /** Height of the header rows a fresh page repeats above the row. */
  readonly repeat: number;
  /** Only a wrap band and repeated header rows sit above the row in its column. */
  readonly belowBandOnly?: boolean;
}

/**
 * Whether the first fragment of `row` moves to the next column or page: content already sits
 * above `at.top` in the column, the minimum does not fit below it, and a fresh column holds it.
 * A row whose `wholeHeight`, its closing rule included, fits the room never moves here. Otherwise
 * the row ends its fragment, whole or split, so with `cut` its minimum is padded by the inside
 * rule that closes it (`cutRowContentDeps`); a page-positioned break fills its band without one.
 */
export function rowMinimumMoves(
  row: SemanticTableRow,
  deps: TableFlowDeps,
  structure: SemanticTableStructure,
  wholeHeight: number,
  cut: boolean,
  at: RowMinimumPlace
): boolean {
  if (at.belowBandOnly || at.top <= at.columnTop + 0.001) return false;
  if (wholeHeight <= at.bottom - at.top + 0.001) return false;
  const fresh = at.band - at.columnTop - at.repeat;
  const closing = cut ? cutRowContentDeps(structure, row, deps) : deps;
  return !rowMinimumFits(row, closing, structure.cellSpacingPt, fresh, at.bottom - at.top);
}
