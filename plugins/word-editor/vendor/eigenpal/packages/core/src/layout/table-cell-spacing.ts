import type { TableSpacingFrame } from './semantic-records.ts';
import { spacingFrameParts } from './table-spacing-band.ts';

/**
 * Where the cells of a table with `w:tblCellSpacing` sit along its row, in points from the
 * table's left edge.
 *
 * The spacing (17.4.45) is the space on each side of every cell, so two neighbouring cells,
 * and a cell and the table edge, sit twice that apart. Those gaps come out of the table's own
 * width: every column gives up its share in proportion to its width. A spaced table's frame
 * moves its outer cells further in by {@link SpacedTableFrame} (`table-spacing-frame.ts`).
 */
export interface CellSpacingGeometry {
  /** The gap between neighbouring cells, and between a cell and the table edge. */
  readonly gapPt: number;
  /** The left edge of the cell starting at grid column `column`. */
  cellLeft(column: number): number;
  /** The width of a cell spanning `span` columns from `column`, gaps it covers included. */
  cellWidth(column: number, span: number): number;
  /** The frame part the first column holds (`SpacingFrameParts`), 0 without a frame. */
  readonly leadPt: number;
  /** The frame part the last column holds, 0 without a frame. */
  readonly trailPt: number;
}

/** How far a spaced table's frame moves its outer cells in (`table-spacing-frame.ts`). */
export type SpacedTableFrame = Omit<TableSpacingFrame, 'borders' | 'rowBorders'>;

/** The gap between neighbouring cells, and a cell and the table edge: twice the spacing. */
export function cellSpacingGapPt(spacingPt: number): number {
  return Number.isFinite(spacingPt) && spacingPt > 0 ? 2 * spacingPt : 0;
}

export function cellSpacingGeometry(
  columns: readonly number[],
  spacingPt: number,
  frame?: SpacedTableFrame | TableSpacingFrame
): CellSpacingGeometry | null {
  if (!Number.isFinite(spacingPt) || spacingPt <= 0 || columns.length === 0) return null;
  const parts = frame && 'borders' in frame ? spacingFrameParts(frame) : undefined;
  const gapPt = cellSpacingGapPt(spacingPt);
  const prefix = [0];
  for (const width of columns) prefix.push(prefix.at(-1)! + width);
  const scale = cellSpacingScale(columns, spacingPt, frame);
  const left = frame?.leftPt ?? 0;
  const at = (column: number): number => prefix[Math.max(0, Math.min(column, columns.length))]!;
  return {
    gapPt,
    leadPt: parts?.leadPt ?? 0,
    trailPt: parts?.trailPt ?? 0,
    cellLeft: (column) => left + gapPt * (column + 1) + at(column) * scale,
    cellWidth: (column, span) =>
      (at(column + span) - at(column)) * scale + gapPt * Math.max(0, span - 1),
  };
}

/**
 * The box of a spaced cell in its row, from the table's left edge. A cell with no neighbour on
 * a side because its row skips the grid columns there (`w:gridBefore`, `w:gridAfter`, or a
 * row that ends early) sits the spacing further in on that side: the skipped columns keep
 * their own spacing. Measured in modes 11, 14 and 15 with spacing of 1, 5 and 10pt, rules of
 * 0, 0.5 and 3pt, cell margins of 5.4 and 15pt, and autofit, fixed and automatic widths.
 * It also moves in by the frame part the outer column on that side holds: with a 6pt left
 * rule and 0.5pt inside rules, the first cell after `w:gridBefore` sits 10.5pt further in.
 */
export function spacedCellBox(
  geometry: CellSpacingGeometry,
  cells: readonly { readonly gridColumn: number; readonly gridSpan: number }[],
  column: number,
  span: number,
  columnCount: number
): { readonly x: number; readonly width: number } {
  // By grid position: a visually reversed row keeps its cells in document order.
  let skipsBefore = column > 0;
  let skipsAfter = column + span < columnCount;
  for (const cell of cells) {
    if (cell.gridColumn + cell.gridSpan === column) skipsBefore = false;
    if (cell.gridColumn === column + span) skipsAfter = false;
  }
  const inset = geometry.gapPt / 2;
  const before = skipsBefore ? inset + geometry.leadPt : 0;
  const after = skipsAfter ? inset + geometry.trailPt : 0;
  return {
    x: geometry.cellLeft(column) + before,
    width: geometry.cellWidth(column, span) - before - after,
  };
}

/** The space a spaced table's gaps and frame take from its width. */
function gapsAcross(columnCount: number, spacingPt: number, frame?: SpacedTableFrame): number {
  return (
    (columnCount + 1) * cellSpacingGapPt(spacingPt) + (frame ? frame.leftPt + frame.rightPt : 0)
  );
}

/**
 * The factor a column's width is scaled by to give its cell's width, after the spacing gaps
 * and the frame come out of the table: 1 with no spacing.
 */
export function cellSpacingScale(
  columns: readonly number[],
  spacingPt: number,
  frame?: SpacedTableFrame
): number {
  if (!Number.isFinite(spacingPt) || spacingPt <= 0 || columns.length === 0) return 1;
  let total = 0;
  for (const width of columns) total += width;
  if (total <= 0) return 1;
  return Math.max(0, total - gapsAcross(columns.length, spacingPt, frame)) / total;
}

/** The total of a spaced table's gaps: twice the spacing at every column edge, and its frame. */
export function spacingGapsPt(structure: SpacedTable): number {
  const frame = structure.rows?.[0]?.spacingFrame;
  return gapsAcross(structure.columnWidthsPt.length, structure.cellSpacingPt, frame);
}

/** Each column's cell width: the column itself, or its share once the gaps come out. */
export function spacedCellWidths(structure: SpacedTable): readonly number[] {
  const frame = structure.rows?.[0]?.spacingFrame;
  const scale = cellSpacingScale(structure.columnWidthsPt, structure.cellSpacingPt, frame);
  return scale === 1 ? structure.columnWidthsPt : structure.columnWidthsPt.map((w) => w * scale);
}

/**
 * Where a row of a spaced table opens: at the table's start or below another row (`start`),
 * as the first whole row or header repeat of a fragment the table continues in (`break`), or
 * as the rest of a row split across pages (`remainder`).
 */
export type SpacedRowOpening = 'start' | 'break' | 'remainder';

/**
 * The gap above a row's cells: twice the spacing and, above the table's first row, the frame.
 * A whole row or header repeat that opens a page break sits the spacing plus the frame's rule
 * from it instead. The rest of a split row keeps its own gap, or that, whichever is wider.
 * An exact-height row opens the gap inside its height.
 */
export function rowOpeningGapPt(
  row: { readonly spacingFrame?: SpacedTableFrame },
  spacingPt: number,
  opening: SpacedRowOpening = 'start'
): number {
  const gap = cellSpacingGapPt(spacingPt);
  if (gap === 0) return 0;
  const frame = row.spacingFrame;
  const own = gap + (frame?.first ? frame.topPt : 0);
  if (opening === 'start' || !frame) return Math.max(0, own);
  const atBreak = gap + frame.breakTopPt;
  return Math.max(0, opening === 'break' ? atBreak : Math.max(own, atBreak));
}

/**
 * How much taller than authored an exact-height row of a spaced table lays out: a row below
 * the first measures its height from the middle of the gap above its cells, which starts
 * that much below the row's top here.
 */
export function exactSpacingExtensionPt(
  row: { readonly spacingFrame?: SpacedTableFrame },
  spacingPt: number
): number {
  return cellSpacingGapPt(spacingPt) > 0 && !row.spacingFrame?.first ? spacingPt : 0;
}

/** Column widths whose cells, once `gaps` come out of their total, have the widths given. */
export function columnsAroundCells(cells: readonly number[], gaps: number): readonly number[] {
  let total = 0;
  for (const cell of cells) total += cell;
  if (total <= 0) return cells.map(() => gaps / Math.max(cells.length, 1));
  const grow = (total + gaps) / total;
  return cells.map((cell) => cell * grow);
}

/** What the spacing helpers read from a table. */
interface SpacedTable {
  readonly columnWidthsPt: readonly number[];
  readonly cellSpacingPt: number;
  readonly rows?: readonly { readonly spacingFrame?: SpacedTableFrame }[];
}

export function sumCols(cols: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to && index < cols.length; index += 1) sum += cols[index]!;
  return sum;
}

/**
 * The gap a fragment of a spaced table closes below its last row, `lastRow`, split or whole:
 * twice the spacing and the frame, which is wider below the table's last row than at a page
 * break; no more than `roomPt`.
 */
export function fragmentClosingGapPt(
  cellSpacingPt: number,
  lastRow: { readonly spacingFrame?: SpacedTableFrame } | undefined,
  roomPt: number
): number {
  if (!lastRow) return 0;
  const gap = cellSpacingGapPt(cellSpacingPt);
  if (gap === 0) return 0;
  const frame = lastRow.spacingFrame;
  const extra = frame ? (frame.last ? frame.bottomPt : frame.breakBottomPt) : 0;
  return Math.max(0, Math.min(gap + extra, roomPt));
}

/**
 * The room a row of a spaced table keeps free below it on a page, for the gap and frame its
 * fragment closes with there (`fragmentClosingGapPt`). Spacing so wide that the row's
 * opening and closing take half the page band or more is not reserved: no row could fit.
 */
export function closingReservePt(
  cellSpacingPt: number,
  row: { readonly spacingFrame?: SpacedTableFrame } | undefined,
  pageBandPt: number
): number {
  const closing = fragmentClosingGapPt(cellSpacingPt, row, Infinity);
  if (closing === 0 || !row) return 0;
  return closing + rowOpeningGapPt(row, cellSpacingPt) < pageBandPt / 2 ? closing : 0;
}

/** The gap a whole table leaves below its last row, with no bound below it. */
export function closingCellSpacingPt(structure: {
  readonly cellSpacingPt: number;
  readonly rows: readonly { readonly spacingFrame?: SpacedTableFrame }[];
}): number {
  return fragmentClosingGapPt(structure.cellSpacingPt, structure.rows.at(-1), Infinity);
}

/**
 * Move `flow` past the gap a spaced table closes below its last row, no lower than
 * `frameBottom`, the bottom of the frame the table fills. A cursor already past that bottom
 * comes back to it.
 */
export function placeClosingCellSpacing(
  flow: { cursorY: number },
  structure: Parameters<typeof closingCellSpacingPt>[0],
  frameBottom: number
): void {
  flow.cursorY = Math.min(flow.cursorY + closingCellSpacingPt(structure), frameBottom);
}
