// An exact-height row taller than the page content.
//
// The row moves to a fresh page and keeps the whole page to itself: the next block starts
// on the next page, with or without `w:cantSplit`. It paints only down to the bottom
// margin, so the row fills the rest of the band, and its border and content are clipped
// there. It does not split and does not run past the margin.

import type { SemanticTableRow } from './semantic-table.ts';
import { TablePaginationError } from './semantic-table-layout.ts';

/** The row and band to place for an exact row no band holds, or null for any other row. */
export function clippedExactRow(
  row: SemanticTableRow,
  contentHeight: number,
  cursorY: number
): { readonly row: SemanticTableRow; readonly band: number } | null {
  const band = contentHeight - cursorY;
  if (row.height.rule !== 'exact' || band <= 0) return null;
  return { row: { ...row, height: { rule: 'exact', valuePt: band } }, band: contentHeight };
}

/** The refusal for a keep-together row that no page can hold. */
export function overheightRowError(row: SemanticTableRow): TablePaginationError {
  return new TablePaginationError(
    'table-row-overheight',
    row.height.rule === 'exact'
      ? `Table row ${row.id} has w:trHeight hRule=exact taller than the available page content`
      : `Table row ${row.id} has w:cantSplit and is taller than the available page content`
  );
}
