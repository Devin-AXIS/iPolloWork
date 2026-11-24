import { readTwipsMeasure, type OoxmlElement } from '@docx-editor.dev/core/store';
import { MAX_COLUMN_WIDTH_PT, type CellWidthClaim } from './table-widths.ts';

/**
 * How many leading grid columns no cell reaches: every row starts past them with
 * `w:gridBefore`. Such columns take no width, like trailing ones. None when a row the view
 * hides may still reach them, or when the rows reach nothing past them.
 */
export function leadingUnreachedColumns(
  rows: readonly { readonly starts: readonly number[] }[],
  cellEnd: number,
  hasOmittedRows: boolean
): number {
  if (hasOmittedRows) return 0;
  let lead = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const first = row.starts[0];
    if (first !== undefined && first < lead) lead = first;
  }
  return Number.isFinite(lead) && lead < cellEnd ? lead : 0;
}

/**
 * Moves every row's cells and every width claim `lead` columns to the left, in place. A
 * `w:wBefore` claim keeps its stated width over the skipped columns that remain, and one
 * that covers only the dropped columns goes.
 */
export function shiftPastLeadingColumns<T extends { readonly starts: readonly number[] }>(
  rows: T[],
  claims: CellWidthClaim[],
  lead: number
): void {
  if (lead <= 0) return;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    rows[index] = { ...row, starts: row.starts.map((start) => start - lead) };
  }
  let kept = 0;
  for (const claim of claims) {
    const start = claim.start - lead;
    const span = start < 0 ? claim.span + start : claim.span;
    if (span > 0) claims[kept++] = { ...claim, start: Math.max(0, start), span };
  }
  claims.length = kept;
}

/**
 * The grid columns a table lays out: the authored grid from the first column any cell reaches
 * to the last. Columns no cell reaches take no width, even when a row's `w:gridBefore` or
 * `w:gridAfter` spans them, so a one-cell row in a four-column grid is as wide as its cell.
 * Measured in modes 11, 14 and 15, autofit and fixed. A row the view hides may still reach
 * them, so the whole grid stays when any row is hidden.
 */
export function reachedGridColumns<T>(
  gridCols: readonly T[],
  lead: number,
  cellEnd: number,
  hasOmittedRows: boolean
): readonly T[] {
  if (hasOmittedRows || cellEnd <= 0) return gridCols;
  const end = Math.min(cellEnd, gridCols.length);
  if (lead <= 0 && end >= gridCols.length) return gridCols;
  return lead < end ? gridCols.slice(Math.max(0, lead), end) : gridCols;
}

/**
 * The reached grid columns, after moving every row and claim past the leading columns no cell
 * reaches (`lead` of them).
 */
export function reachedGrid<T, R extends { readonly starts: readonly number[] }>(
  gridCols: readonly T[],
  rows: R[],
  claims: CellWidthClaim[],
  cellEnd: number,
  hasOmittedRows: boolean
): { readonly lead: number; readonly gridCols: readonly T[] } {
  const lead = leadingUnreachedColumns(rows, cellEnd, hasOmittedRows);
  shiftPastLeadingColumns(rows, claims, lead);
  return { lead, gridCols: reachedGridColumns(gridCols, lead, cellEnd, hasOmittedRows) };
}

/**
 * How far the leading columns no cell reaches move a leading-aligned table that states no
 * indent, directly or by a table style: their authored width. They take no width of their
 * own, but still place the table. Measured in modes 11 and 15 without a default table style:
 * a 1684-twip skipped column moves the table 84.2pt, autofit and with a stated width alike.
 * A stated indent, or a default table style that states one, replaces it.
 */
export function leadingSkipPt(gridCols: readonly OoxmlElement[], lead: number): number {
  let total = 0;
  for (let index = 0; index < lead && index < gridCols.length; index += 1) {
    const raw = gridCols[index]!.attributes.find((attribute) => attribute.localName === 'w');
    const twips = raw ? readTwipsMeasure(raw.value) : null;
    if (twips !== null && twips > 0) total += Math.min(twips / 20, MAX_COLUMN_WIDTH_PT);
  }
  return total;
}

/** The width claims that fall inside the first `columnCount` grid columns, cut to fit. */
export function claimsWithinGrid(
  claims: readonly CellWidthClaim[],
  columnCount: number
): readonly CellWidthClaim[] {
  if (claims.every((claim) => claim.start + claim.span <= columnCount)) return claims;
  return claims
    .filter((claim) => claim.start < columnCount)
    .map((claim) =>
      claim.start + claim.span <= columnCount
        ? claim
        : { ...claim, span: columnCount - claim.start }
    );
}
