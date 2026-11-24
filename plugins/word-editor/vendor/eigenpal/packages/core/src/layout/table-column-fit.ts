// How a table's columns give way when their cells must fit a smaller total than they ask:
// for a stated table width, or for the spacing gaps a spaced table takes from its width.
import type { SemanticTableRow } from './semantic-table.ts';
import type { TableBorderBox } from './table-borders.ts';
import { spacingGapsPt } from './table-cell-spacing.ts';
import { withSpacingFrame } from './table-spacing-frame.ts';
import {
  spacingFrameParts,
  type SpacingFrameInsets,
  type SpacingFrameParts,
} from './table-spacing-band.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

const EPSILON_PT = 0.001;

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Widths that total `targetPt`. A wider total grows every column in proportion to its width.
 * A narrower one takes from each column in proportion to its width above its minimum, so a
 * column at its minimum keeps it. Past every minimum, the minimums scale down together.
 *
 * Measured with fixed layout in modes 11, 14 and 15, spaced and not: the minimum is a column's
 * left and right cell margins. 1000/3000 twips with 108-twip margins under a 3000-twip width
 * lay out as 39.0/111.0pt, not 37.5/112.5; with 300-twip margins as 42.9/107.1pt; and the
 * gaps of a spaced table come out the same way. Under 6000 twips the same columns grow to
 * 75/225pt. An autofit table measures each column's minimum from its content instead.
 */
export function fitColumnsAboveMinimums(
  widths: readonly number[],
  targetPt: number,
  minimums: readonly number[]
): readonly number[] {
  const total = sum(widths);
  if (!(total > 0) || !(targetPt > 0) || Math.abs(total - targetPt) <= EPSILON_PT) return widths;
  if (targetPt > total) return widths.map((width) => (width * targetPt) / total);
  const floors = widths.map((width, column) => Math.min(width, Math.max(0, minimums[column] ?? 0)));
  const slack = total - sum(floors);
  const need = total - targetPt;
  if (need < slack - EPSILON_PT)
    return widths.map((width, column) => width - (need * (width - floors[column]!)) / slack);
  const floorTotal = sum(floors);
  return floorTotal > 0
    ? floors.map((floor) => (floor * targetPt) / floorTotal)
    : widths.map((width) => (width * targetPt) / total);
}

/** Each column's fixed-layout minimum: the widest left and right margins of a cell in it. */
export function cellMarginMinimumsPt(
  rows: readonly SemanticTableRow[],
  columnCount: number
): readonly number[] {
  const minimums = new Array<number>(columnCount).fill(0);
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.gridSpan !== 1 || cell.gridColumn >= columnCount) continue;
      const margins = cell.margins.left + cell.margins.right;
      if (margins > minimums[cell.gridColumn]!) minimums[cell.gridColumn] = margins;
    }
  }
  return minimums;
}

/** What a spaced table's gaps take from its width, and the frame parts its columns hold. */
export interface SpacingTake {
  /** Every gap and both frame insets. */
  readonly gapsPt: number;
  /** The part of `gapsPt` the outer columns hold, when the table has a frame. */
  readonly frame?: SpacingFrameParts;
  /** Where the rows' outer cells sit, when the table has a frame. */
  readonly edges?: RowEdgeColumns;
}

/**
 * The width a spaced table's gaps and frame take, before its columns are resolved. `rows` and
 * `borders` are in display order; a visually right-to-left table (`reversed`) resolves its
 * columns in document order, so its first column holds the right part.
 */
export function spacingGapsBeforeColumns(
  rows: readonly SemanticTableRow[],
  borders: TableBorderBox,
  cellSpacingPt: number,
  columnCount: number,
  reversed = false
): SpacingTake {
  if (!(cellSpacingPt > 0) || columnCount < 1) return { gapsPt: 0 };
  const framed = withSpacingFrame(rows.slice(0, 1), borders, cellSpacingPt);
  const gapsPt = spacingGapsPt({
    columnWidthsPt: new Array<number>(columnCount).fill(0),
    cellSpacingPt,
    rows: framed,
  });
  const frame = spacingFrameParts(framed[0]?.spacingFrame);
  if (!frame) return { gapsPt };
  const edges = rowEdgeColumns(rows, columnCount);
  if (!reversed) return { gapsPt, frame, edges };
  return {
    gapsPt,
    frame: { ...frame, leadPt: frame.trailPt, trailPt: frame.leadPt },
    edges: { starts: [...edges.ends].reverse(), ends: [...edges.starts].reverse() },
  };
}

/** The columns where some row's first cell starts and where some row's last cell ends. */
export interface RowEdgeColumns {
  readonly starts: readonly boolean[];
  readonly ends: readonly boolean[];
}

/** Where each row's outer cells sit (`RowEdgeColumns`), by grid position. */
export function rowEdgeColumns(
  rows: readonly {
    readonly cells: readonly { readonly gridColumn: number; readonly gridSpan: number }[];
  }[],
  columnCount: number
): RowEdgeColumns {
  const starts = new Array<boolean>(columnCount).fill(false);
  const ends = new Array<boolean>(columnCount).fill(false);
  for (const row of rows) {
    let first = Infinity;
    let end = -Infinity;
    for (const cell of row.cells) {
      first = Math.min(first, cell.gridColumn);
      end = Math.max(end, cell.gridColumn + cell.gridSpan);
    }
    if (first < columnCount) starts[Math.max(0, first)] = true;
    if (end > 0) ends[Math.min(columnCount, end) - 1] = true;
  }
  return { starts, ends };
}

/**
 * Cell widths that total `cellTargetPt` when a spaced table's outer columns hold their frame
 * parts: each column fits with its part (`fitColumnsAboveMinimums`), its minimum raised by
 * that part, and then gives the part back. Without parts, the columns fit as they are.
 *
 * Measured in modes 0 and 15 with spacing of 2, 5 and 15pt, outer rules of 0 to 6pt on either
 * side and inside rules of 0 to 6pt, autofit and fixed. With a 6pt left rule and 0.5pt right
 * and inside rules: fixed 1000/2000/3000-twip cells under 6000 twips lay out as
 * 38.5/86.4/129.6pt, not 44.6/83.0/121.2; 2000/2000 stretched to 5000 as 104.5/110; and
 * without a table width the first cell narrows to 94.5pt. Equal 6pt rules on 1000/2000/3000
 * lay out near 41.8/85.9/121.2.
 *
 * A column where a row that skips the grid columns before it (`w:gridBefore`) starts needs the
 * left part as well, and one where a row that skips the columns after it ends needs the right
 * part (`edges`): with a 6pt left rule, a 2000-twip middle column that opens a `w:gridBefore`
 * row keeps 0.7pt more than in the same table without that row.
 */
export function fitColumnsHoldingFrame(
  widths: readonly number[],
  cellTargetPt: number,
  minimums: readonly number[],
  frame: SpacingFrameParts | undefined,
  edges?: RowEdgeColumns,
  /** The table has no width to keep: a raised floor widens it instead of its neighbours. */
  growsPastTarget = false
): readonly number[] {
  const last = widths.length - 1;
  if (!frame || last < 0) return fitColumnsAboveMinimums(widths, cellTargetPt, minimums);
  const held = widths.map(
    (_, column) => (column === 0 ? frame.leadPt : 0) + (column === last ? frame.trailPt : 0)
  );
  const needs = widths.map(
    (_, column) =>
      (column === 0 || edges?.starts[column] ? frame.leadPt : 0) +
      (column === last || edges?.ends[column] ? frame.trailPt : 0)
  );
  const fitted = fitColumnsAboveMinimums(
    widths,
    cellTargetPt + sum(held),
    widths.map((_, column) => Math.max(0, Math.max(0, minimums[column] ?? 0) + needs[column]!))
  );
  return keepCellFloors(
    fitted.map((width, column) => width - held[column]!),
    held.map((part) => (part === 0 ? 0 : MIN_CELL_PT)),
    growsPastTarget ? Infinity : cellTargetPt
  );
}

/** The narrowest cell a column holding a frame part keeps, as any derived column does. */
const MIN_CELL_PT = 1;

/**
 * `cells` with none below its floor: a column narrower than the frame part it holds keeps
 * its floor, and the others give the difference up in proportion to their width above theirs,
 * as far as the total passes `targetPt`. Unmeasured; it keeps a spacer column beside a thick
 * rule from collapsing.
 */
function keepCellFloors(
  cells: readonly number[],
  floors: readonly number[],
  targetPt: number
): readonly number[] {
  let short = 0;
  for (let column = 0; column < cells.length; column++)
    short += Math.max(0, floors[column]! - cells[column]!);
  if (short <= EPSILON_PT) return cells;
  const raised = cells.map((width, column) => Math.max(width, floors[column]!));
  const spare = raised.reduce(
    (total, width, column) => total + Math.max(0, width - floors[column]!),
    0
  );
  const give = Math.min(short, Math.max(0, sum(raised) - targetPt), spare);
  if (!(spare > 0) || !(give > 0)) return raised;
  return raised.map((width, column) => width - (give * (width - floors[column]!)) / spare);
}

/**
 * The cell widths of an autofit table whose content already fits, when its cells' stated
 * widths had to give way to a narrower total: each column gives way above its content
 * minimum (`fitColumnsAboveMinimums`). Undefined when a column states no absolute width,
 * nothing gave way, or a column cannot keep its minimum. Measured in modes 11, 14 and 15: 50/100/50pt cells in a 200pt spaced
 * table lay out near 45/69/45pt, not in proportion to their widths.
 */
export function autofitCellsAboveMinimums(
  preferredWidths: readonly (number | undefined)[],
  cellWidths: readonly number[],
  minimums: readonly number[],
  frame?: SpacingFrameParts,
  spans: readonly {
    readonly from: number;
    readonly count: number;
    readonly minimum: number;
  }[] = [],
  edges?: RowEdgeColumns
): readonly number[] | undefined {
  if (preferredWidths.length !== cellWidths.length) return undefined;
  const preferred: number[] = [];
  for (const width of preferredWidths) {
    if (width === undefined || !(width > 0)) return undefined;
    preferred.push(width);
  }
  const target = sum(cellWidths);
  const held = frame ? frame.leadPt + frame.trailPt : 0;
  if (sum(preferred) <= target + held + EPSILON_PT) return undefined;
  const cells = fitColumnsHoldingFrame(preferred, target, minimums, frame, edges);
  // Content wider than its column, or minimums past the total, widen in their own way.
  if (!cells.every((width, column) => width + EPSILON_PT >= (minimums[column] ?? 0)))
    return undefined;
  for (const span of spans) {
    let spanned = 0;
    for (let column = span.from; column < span.from + span.count; column++)
      spanned += cells[column] ?? 0;
    if (spanned + EPSILON_PT < span.minimum) return undefined;
  }
  return cells;
}

/** Columns in display order: reversed for a visually right-to-left table. */
export function visualOrder(widths: readonly number[], reversed: boolean): readonly number[] {
  return reversed ? [...widths].reverse() : widths;
}

/**
 * The refit of an autofit table's stated cell widths above its content minimums
 * (`autofitCellsAboveMinimums`), from the widths its cells and spans state. Measured at the
 * top level and in headers, spaced or not, and nested in mode 15: 3000/3000 twips under a
 * 4000-twip width with one long word lay out as 126.5/73.5pt, not 100/100. Undefined for a
 * nested legacy table, which keeps its cell's room (measured in mode 0).
 */
export function autofitRefit(
  structure: {
    readonly statedColumnWidthsPt?: readonly number[];
    readonly rows?: readonly {
      readonly spacingFrame?: SpacingFrameInsets;
      readonly cells: readonly { readonly gridColumn: number; readonly gridSpan: number }[];
    }[];
  },
  content: {
    readonly preferredWidths: readonly (number | undefined)[];
    readonly spans: readonly {
      readonly from: number;
      readonly count: number;
      readonly minimum: number;
    }[];
  },
  cellWidths: readonly number[],
  minimums: readonly number[],
  nested: { readonly depth: number; readonly compatibilityMode?: number }
): readonly number[] | undefined {
  if (
    nested.depth > 0 &&
    !hasCompatibilityRule(nested.compatibilityMode, 'autofitRefitsNestedCells')
  )
    return undefined;
  const stated = structure.statedColumnWidthsPt;
  // A column no cell states keeps blocking the refit; stated columns take any span's excess.
  const preferred =
    stated && stated.length === content.preferredWidths.length
      ? content.preferredWidths.map((width, column) =>
          width === undefined ? undefined : stated[column]
        )
      : content.preferredWidths;
  const frame = spacingFrameParts(structure.rows?.[0]?.spacingFrame);
  return autofitCellsAboveMinimums(
    preferred,
    cellWidths,
    minimums,
    frame,
    content.spans,
    frame && structure.rows ? rowEdgeColumns(structure.rows, cellWidths.length) : undefined
  );
}

/**
 * The stated cell widths to widen from instead, when a stated table width stretched them and
 * the widened columns still pass that width: columns the content does not widen keep what
 * their cells state. Measured in mode 15 past the text column: 11158 twips of cells under an
 * 11263-twip width whose content widens it to 639pt keep their stated widths.
 */
export function unstretchedBase(
  structure: {
    readonly statedColumnWidthsPt?: readonly number[];
    readonly rows?: readonly { readonly spacingFrame?: SpacingFrameInsets }[];
  },
  cellWidths: readonly number[],
  widened: readonly number[],
  targetPt: number
): readonly number[] | undefined {
  const stated = statedCellWidths(structure);
  if (!stated || stated.length !== cellWidths.length) return undefined;
  const statedPt = sum(stated);
  return statedPt < sum(cellWidths) - EPSILON_PT && sum(widened) > targetPt + EPSILON_PT
    ? stated
    : undefined;
}

/**
 * The cell widths a spaced table's stated widths give before any fit: the outer columns'
 * stated widths less the frame parts they hold (`fitColumnsHoldingFrame`).
 */
function statedCellWidths(structure: {
  readonly statedColumnWidthsPt?: readonly number[];
  readonly rows?: readonly { readonly spacingFrame?: SpacingFrameInsets }[];
}): readonly number[] | undefined {
  const stated = structure.statedColumnWidthsPt;
  const frame = spacingFrameParts(structure.rows?.[0]?.spacingFrame);
  if (!stated || !frame || stated.length === 0) return stated;
  const last = stated.length - 1;
  return stated.map(
    (width, column) =>
      width - (column === 0 ? frame.leadPt : 0) - (column === last ? frame.trailPt : 0)
  );
}

/**
 * A stated table width that stretches stated cell widths stretches each column from the larger
 * of its stated width and its content minimum. Measured in modes 14 and 15: a 942-twip column
 * whose word needs 55.3pt takes 55.3pt times the stretch, not its own minimum. Undefined when
 * no column needs more than its stated width or the minimums pass the stretched width.
 */
export function stretchAboveMinimums(
  stated: readonly number[] | undefined,
  cellWidths: readonly number[],
  minimums: readonly number[]
): readonly number[] | undefined {
  if (!stated || stated.length !== cellWidths.length) return undefined;
  const targetPt = sum(cellWidths);
  const statedPt = sum(stated);
  if (statedPt >= targetPt - EPSILON_PT) return undefined;
  const base = stated.map((width, column) => Math.max(width, minimums[column] ?? 0));
  const basePt = sum(base);
  if (basePt <= statedPt + EPSILON_PT || basePt > targetPt + EPSILON_PT) return undefined;
  return base.map((width) => (width * targetPt) / basePt);
}

/** Minimums where a column only spanning cells cover keeps the given width instead. */
export function keepUnmeasured(
  minimums: readonly number[],
  measured: readonly boolean[],
  widths: readonly number[]
): readonly number[] {
  return minimums.map((minimum, column) =>
    measured[column] ? minimum : (widths[column] ?? minimum)
  );
}

/**
 * Only a column that has to widen itself keeps the first-line indent of a word after spaces
 * that open its paragraph; the other columns of a widening table take that word without it.
 * Measured in mode 15 with an 18pt first-line indent: a 1466-twip column holding
 * "  6,746,091" keeps 73.3pt while another column widens, and a 942-twip column holding it
 * widens to the word plus the indent. `plain` fills the minimums without the indent.
 */
export function keepFirstLineWhereWidening(
  ifWidened: number[],
  minimums: readonly number[],
  cellWidths: readonly number[],
  plain: (into: number[]) => void
): void {
  let own: number[] | undefined;
  for (let column = 0; column < ifWidened.length; column++) {
    if ((minimums[column] ?? 0) > (cellWidths[column] ?? 0) + EPSILON_PT) continue;
    if (!own) plain((own = []));
    ifWidened[column] = Math.min(ifWidened[column]!, own[column] ?? ifWidened[column]!);
  }
}
