import type { CellBorderBox, TableBorderBox, TableBorderSide } from './table-borders.ts';

interface BorderCell {
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly borders: CellBorderBox;
  readonly rowTableBorders?: TableBorderBox;
}

export interface TableBorderWidthProof {
  readonly columnCount: number;
}

// At most 1024 positive additions below 2^20 keep accumulated rounding below the
// border publisher's 1e-6 full-side tolerance. Interior endpoints remain at least 1pt apart.
const MAX_COLUMNS = 1024;
const MAX_EXTENT_PT = 2 ** 20;

function stableColumns(columns: readonly number[]): boolean {
  if (columns.length === 0 || columns.length > MAX_COLUMNS) return false;
  let total = 0;
  for (const width of columns) {
    if (!Number.isFinite(width) || width < 1) return false;
    total += width;
  }
  return total <= MAX_EXTENT_PT;
}

function simple(side: TableBorderSide): boolean {
  return (
    side.state !== 'edge' ||
    (side.style !== 'double' &&
      side.style !== 'triple' &&
      Number.isFinite(side.widthPt) &&
      side.widthPt > 0)
  );
}

function simpleBox(box: TableBorderBox): boolean {
  return (
    simple(box.top) &&
    simple(box.left) &&
    simple(box.bottom) &&
    simple(box.right) &&
    simple(box.insideH) &&
    simple(box.insideV)
  );
}

/**
 * Prove only the border publisher's vertical invariance under a later width change.
 * The caller separately proves unchanged sources, row heights, merges, and inset flags.
 * Compound corners and diagonals stay on the full path. This token retains no source rows.
 */
export function createTableBorderWidthProof(
  rows: readonly { readonly cells: readonly BorderCell[] }[],
  table: TableBorderBox,
  columns: readonly number[]
): TableBorderWidthProof | null {
  if (!rows.length || !stableColumns(columns) || !simpleBox(table)) return null;
  for (const row of rows) {
    if (!row.cells.length) return null;
    for (const cell of row.cells) {
      const box = cell.borders;
      if (
        !Number.isInteger(cell.gridColumn) ||
        !Number.isInteger(cell.gridSpan) ||
        cell.gridColumn < 0 ||
        cell.gridSpan < 1 ||
        cell.gridColumn + cell.gridSpan > columns.length ||
        !simple(box.top) ||
        !simple(box.left) ||
        !simple(box.bottom) ||
        !simple(box.right) ||
        box.tl2br?.state === 'edge' ||
        box.tr2bl?.state === 'edge' ||
        (cell.rowTableBorders && !simpleBox(cell.rowTableBorders))
      )
        return null;
    }
  }
  return { columnCount: columns.length };
}

/** The unchanged sources and vertical inputs remain the caller's proof obligations. */
export function tableBorderWidthProofHolds(
  proof: TableBorderWidthProof,
  columns: readonly number[]
): boolean {
  return columns.length === proof.columnCount && stableColumns(columns);
}
