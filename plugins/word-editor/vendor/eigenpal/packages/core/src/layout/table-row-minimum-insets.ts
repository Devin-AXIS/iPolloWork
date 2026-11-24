// Row-local content clearance for authored row minima.
//
// A `w:trHeight` minimum belongs to each authored ROW, while a vertically merged head's
// content borders belong to its whole SPAN. Row-height resolution therefore needs an
// unmerged view of the clearance, which this module resolves alongside — never in place
// of — the ordinary content/paint grid, which must keep suppressing borders inside merges.

import type { SemanticTableCell, SemanticTableRow } from './semantic-table.ts';

/**
 * Row-minimum clearance for one repeated-header or body occurrence, keyed by cell id.
 *
 * Separate from a vMerge content span: a minimum belongs to the authored ROW, while a
 * merged head's content borders belong to its whole span.
 */
export type RowMinimumInsetMap = ReadonlyMap<
  string,
  { readonly top: number; readonly bottom: number }
>;
import type { TableBorderBox } from './table-borders.ts';
import { cellContentInsets } from './table-cell-geometry.ts';
import { withTableContentBorders } from './table-content-borders.ts';

/**
 * Stamps `minimumContentInsets` on the cells of every `atLeast` row, resolved as if no cell
 * in the table continued a vertical merge. Rows without a minimum, and tables that pair no
 * minimum with a merge, are returned by identity.
 */
export function withRowMinimumContentInsets(
  contentRows: readonly SemanticTableRow[],
  visualRows: readonly SemanticTableRow[],
  tableBorders: TableBorderBox,
  columns: number,
  collapsed: boolean
): readonly SemanticTableRow[] {
  if (
    !visualRows.some((row) => row.height.rule === 'atLeast') ||
    !visualRows.some((row) => row.cells.some((cell) => cell.vMergeContinue))
  )
    return contentRows;
  const minimumRows = withTableContentBorders(
    visualRows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({ ...cell, vMergeContinue: false })),
    })),
    tableBorders,
    columns,
    collapsed
  );
  return contentRows.map((row, rowIndex) =>
    row.height.rule !== 'atLeast'
      ? row
      : {
          ...row,
          cells: row.cells.map((cell, cellIndex) => {
            const local = minimumRows[rowIndex]!.cells[cellIndex]!;
            const insets = cellContentInsets(local, collapsed);
            return { ...cell, minimumContentInsets: { top: insets.top, bottom: insets.bottom } };
          }),
        }
  );
}

/**
 * Row height an authored `atLeast` minimum asks for, in points.
 *
 * The minimum is a CONTENT height, so it is padded by the row's largest top and bottom
 * clearance. A merged head's clearance belongs to its whole span, which is why the
 * row-local {@link withRowMinimumContentInsets} value wins over the flowed one when the
 * table pairs a minimum with a vertical merge.
 */
export function authoredRowMinimumFloorPt(
  atLeastHeightPt: number,
  flowed: readonly {
    readonly cell: SemanticTableCell;
    readonly insets: { readonly top: number; readonly bottom: number };
  }[],
  overrides?: ReadonlyMap<string, { readonly top: number; readonly bottom: number }>,
  /** The cell-spacing gap above the row's cells; `entry.insets` already include it. */
  rowGapPt = 0
): number {
  let top = 0;
  let bottom = 0;
  for (const entry of flowed) {
    const authored = overrides?.get(entry.cell.id) ?? entry.cell.minimumContentInsets;
    const insets = authored ? { ...authored, top: authored.top + rowGapPt } : entry.insets;
    top = Math.max(top, insets.top);
    bottom = Math.max(bottom, insets.bottom);
  }
  return atLeastHeightPt + top + bottom;
}
