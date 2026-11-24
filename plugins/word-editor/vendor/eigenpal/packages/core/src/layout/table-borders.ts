// Three-state table/cell borders, Word-like collapsed-edge conflict resolution, and
// layout-owned compound stroke geometry.
//
// OOXML distinguishes omitted edges (fall through to `tblBorders`), explicit `nil`/`none`
// (suppress), and styled edges. With zero cell spacing the shared grid line picks one
// winner — per grid interval, so a spanning cell may publish different winners against
// different neighbors. Layout expands double/triple into explicit stroke segments with
// corner-adjusted endpoints in points; paint only scales and draws those records.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { TableBorderStyle } from '@docx-editor.dev/core/store';
import {
  COMPOUND_BORDER_MIN_GAP_PT,
  COMPOUND_BORDER_MIN_STROKE_PT,
  borderStrokeWidthPt,
  computeDoubleBorderMetricsPt,
  type CompoundBorderMetrics,
} from './border-metrics.ts';
import { MAX_BORDER_WIDTH_PT } from './paragraph-style.ts';
import { resolveStrictHexFill } from './ooxml-shading.ts';
import { cellDiagonalRecords, type TableCellDiagonalRecord } from './table-cell-diagonals.ts';
export type { TableCellDiagonalRecord } from './table-cell-diagonals.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import { tableRowBorderExtents } from './table-row-border-extents.ts';
import {
  splitPublishedTableBands,
  tableBorderLine,
  type TableBorderLine,
} from './table-border-lines.ts';
import {
  buildColumnOwnershipIndexes,
  ownerAt,
  type TableBorderGridResolveWork,
  type TableBorderOwnershipBudget,
} from './table-border-ownership.ts';

export type { TableBorderStyle } from '@docx-editor.dev/core/store';
export type { TableBorderLine } from './table-border-lines.ts';
export type { TableBorderGridResolveWork, TableBorderOwnershipBudget };
export { effectiveBorderSide } from './table-border-cascade.ts';
export {
  createTableBorderOwnershipBudget,
  MAX_BORDER_OWNERSHIP_INTERVALS,
} from './table-border-ownership.ts';
export {
  COMPOUND_BORDER_MIN_GAP_PT,
  COMPOUND_BORDER_MIN_STROKE_PT,
  computeDoubleBorderMetricsPt,
  type CompoundBorderMetrics,
} from './border-metrics.ts';

/** Which physical edge of a box a border sits on. */
export type TableBorderSideName = 'top' | 'right' | 'bottom' | 'left';

/**
 * One border edge in one of three states.
 *
 * Omitted edges inherit. Explicit no-border edges suppress their own inherited rule.
 * An opposing edge can still win, including a rule inherited by the neighboring cell.
 */
export type TableBorderSide =
  | { readonly state: 'omitted' }
  | { readonly state: 'none' }
  | {
      readonly state: 'edge';
      readonly style: TableBorderStyle;
      /** Validated RRGGBB, or null for auto/missing (paint defaults to black). */
      readonly color: string | null;
      /** Painted band in points: `w:sz` (eighths of a point), or the band of `line`. */
      readonly widthPt: number;
      /** The authored line style when it paints more than one solid band (§17.18.2). */
      readonly line?: TableBorderLine;
      /** The authored `w:sz` in points, when `line` paints a band of another width. */
      readonly sizePt?: number;
    };

/** A table's six authored border edges: four outer, plus the two interior intervals. */
export interface TableBorderBox {
  readonly top: TableBorderSide;
  readonly left: TableBorderSide;
  readonly bottom: TableBorderSide;
  readonly right: TableBorderSide;
  readonly insideH: TableBorderSide;
  readonly insideV: TableBorderSide;
}

/** The four resolved edges of one cell, after conflict resolution against its neighbours. */
export interface CellBorderBox {
  readonly tl2br?: TableBorderSide;
  readonly tr2bl?: TableBorderSide;
  readonly top: TableBorderSide;
  readonly left: TableBorderSide;
  readonly bottom: TableBorderSide;
  readonly right: TableBorderSide;
}

/** Final edge winner; absent means the side/interval is not drawn. */
export interface ResolvedTableBorderEdge {
  readonly style: TableBorderStyle;
  readonly color: string | null;
  /** Painted band in points. */
  readonly widthPt: number;
  /** The authored line style when it paints more than one solid band (§17.18.2). */
  readonly line?: TableBorderLine;
  /** The authored `w:sz` in points, when `line` paints a band of another width. */
  readonly sizePt?: number;
}

/**
 * Conflict winner over one grid interval of a cell side.
 *
 * `gridStart`/`gridEnd` are absolute grid column indices for horizontal sides and absolute
 * row indices for vertical sides (half-open). `startPt`/`endPt` are cell-local along-axis
 * positions in layout points.
 */
export interface ResolvedTableBorderEdgeSegment {
  readonly side: TableBorderSideName;
  readonly gridStart: number;
  readonly gridEnd: number;
  readonly startPt: number;
  readonly endPt: number;
  readonly edge: ResolvedTableBorderEdge;
}

/**
 * One published stroke rectangle in cell-local layout points.
 *
 * Paint multiplies x/y/width/height by scale and draws — no metrics, gaps, or corner math.
 */
export interface TableBorderStrokeRecord {
  readonly side: TableBorderSideName;
  readonly role: 'outer' | 'inner' | 'middle' | 'edge';
  readonly color: string | null;
  /** CSS keyword for this stroke (compound strokes are always solid). */
  readonly cssStyle: 'solid' | 'dashed' | 'dotted';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Dash and gap lengths along the stroke in points, ink first, for a dashed line style. */
  readonly dashPt?: readonly number[];
  /** The stroke is the hatch of `dashDotStroked` (`DASH_DOT_STROKED_HATCH`). */
  readonly hatch?: true;
}

/**
 * Layout-owned cell borders after conflict resolution and compound expansion.
 *
 * Convenience `top`/`left`/`bottom`/`right` are set when that side has a single uniform
 * full-span winner (existing consumers / CSS simple edges). Multi-interval winners live
 * only on `edgeSegments`. Compound geometry is always on `strokes`.
 */
export interface ResolvedCellBorders {
  readonly diagonals?: readonly TableCellDiagonalRecord[];
  readonly top?: ResolvedTableBorderEdge;
  readonly left?: ResolvedTableBorderEdge;
  readonly bottom?: ResolvedTableBorderEdge;
  readonly right?: ResolvedTableBorderEdge;
  readonly edgeSegments?: readonly ResolvedTableBorderEdgeSegment[];
  readonly strokes?: readonly TableBorderStrokeRecord[];
}

/** Soft cap on published stroke rectangles per cell (security / pathological spans). */
export const MAX_TABLE_BORDER_STROKES = 256;

const OMITTED: TableBorderSide = { state: 'omitted' };
const NONE: TableBorderSide = { state: 'none' };

const EMPTY_TABLE_BORDERS: TableBorderBox = {
  top: OMITTED,
  left: OMITTED,
  bottom: OMITTED,
  right: OMITTED,
  insideH: OMITTED,
  insideV: OMITTED,
};

const EMPTY_CELL_BORDERS: CellBorderBox = {
  top: OMITTED,
  left: OMITTED,
  bottom: OMITTED,
  right: OMITTED,
};

/** Word border number; also the precedence rank when weighted rules tie. */
const BORDER_NUMBER: Readonly<Record<TableBorderStyle, number>> = {
  single: 1,
  thick: 2,
  double: 3,
  dotted: 4,
  dashed: 5,
  triple: 10,
};

const STYLE_FROM_VAL = new Map<string, TableBorderStyle>([
  ['single', 'single'],
  ['thick', 'thick'],
  ['double', 'double'],
  ['dotted', 'dotted'],
  ['dashed', 'dashed'],
  ['dashSmallGap', 'dashed'],
  ['dotDash', 'dashed'],
  ['dotDotDash', 'dashed'],
  ['triple', 'triple'],
  // Common Word aliases → nearest CSS-representable style.
  ['wave', 'single'],
  ['hairline', 'single'],
  ['inset', 'single'],
  ['outset', 'single'],
]);

function childNamed(node: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of node.children) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function integer(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

function clampWidthPt(eighths: number | null): number {
  if (eighths === null) return 0.5;
  const pt = eighths / 8;
  if (!Number.isFinite(pt) || pt <= 0) return 0.5;
  return pt > MAX_BORDER_WIDTH_PT ? MAX_BORDER_WIDTH_PT : pt;
}

/** Read one OOXML border child into the three-state model. */
export function readBorderSide(node: OoxmlElement | undefined): TableBorderSide {
  if (!node) return OMITTED;
  const val = attributeValue(node, 'val');
  if (!val) return OMITTED;
  if (val === 'nil' || val === 'none') return NONE;
  const style = STYLE_FROM_VAL.get(val) ?? 'single';
  const colorRaw = attributeValue(node, 'color');
  // Hostile non-hex colors become null (paint defaults to black); style/width still count.
  const color =
    colorRaw === undefined || colorRaw === 'auto' ? null : (resolveStrictHexFill(colorRaw) ?? null);
  const widthPt = clampWidthPt(integer(attributeValue(node, 'sz')));
  const line = tableBorderLine(val);
  if (!line) return { state: 'edge', style, color, widthPt };
  const band = borderStrokeWidthPt(line, widthPt);
  return band === widthPt
    ? { state: 'edge', style, color, widthPt, line }
    : { state: 'edge', style, color, widthPt: band, line, sizePt: widthPt };
}

function readBox(
  container: OoxmlElement | undefined,
  sides: readonly TableBorderSideName[]
): CellBorderBox {
  if (!container) return EMPTY_CELL_BORDERS;
  const result: {
    top: TableBorderSide;
    left: TableBorderSide;
    bottom: TableBorderSide;
    right: TableBorderSide;
  } = {
    top: OMITTED,
    left: OMITTED,
    bottom: OMITTED,
    right: OMITTED,
  };
  for (const side of sides) {
    // `w:start`/`w:end` are the direction-relative spellings of the vertical sides, and in
    // the ISO Strict schema they are the ONLY ones `CT_TcBorders` / `CT_TblBorders` declare
    // (wml.xsd `CT_TcBorders`, `CT_TblBorders`). Reading the transitional names alone lost
    // every vertical rule in a Strict-authored document — the cell simply drew no border.
    const relative = side === 'left' ? 'start' : side === 'right' ? 'end' : undefined;
    const element =
      childNamed(container, side) ?? (relative ? childNamed(container, relative) : undefined);
    result[side] = readBorderSide(element);
  }
  return result;
}

/**
 * Read a table's `w:tblBorders`, dropping or clamping hostile values.
 *
 * Widths and colours come from a file: an out-of-range `w:sz` becomes a layout dimension, so it is
 * bounded here rather than downstream.
 */
export function readTableBorders(tblPr: OoxmlElement | undefined): TableBorderBox {
  const container = tblPr && childNamed(tblPr, 'tblBorders');
  if (!container) return EMPTY_TABLE_BORDERS;
  const cell = readBox(container, ['top', 'left', 'bottom', 'right']);
  return {
    ...cell,
    insideH: readBorderSide(childNamed(container, 'insideH')),
    insideV: readBorderSide(childNamed(container, 'insideV')),
  };
}

/**
 * One row's table borders: the sides its `w:tblPrEx` states over the table's own, or
 * undefined when the row states none. An exception replaces the table's properties for that
 * row only, so a borderless footer row in a gridded table paints no rule.
 */
export function rowExceptionBorders(
  row: OoxmlElement,
  table: TableBorderBox
): TableBorderBox | undefined {
  const exception = childNamed(row, 'tblPrEx');
  if (!exception) return undefined;
  const own = readTableBorders(exception);
  if (own === EMPTY_TABLE_BORDERS) return undefined;
  const pick = (base: TableBorderSide, over: TableBorderSide) =>
    over.state === 'omitted' ? base : over;
  return {
    top: pick(table.top, own.top),
    left: pick(table.left, own.left),
    bottom: pick(table.bottom, own.bottom),
    right: pick(table.right, own.right),
    insideH: pick(table.insideH, own.insideH),
    insideV: pick(table.insideV, own.insideV),
  };
}

/** Read one cell's `w:tcBorders`, under the same bounds {@link readTableBorders} applies. */
export function readCellBorders(tcPr: OoxmlElement | undefined): CellBorderBox {
  const container = tcPr && childNamed(tcPr, 'tcBorders');
  const box = readBox(container, ['top', 'left', 'bottom', 'right']);
  if (!container) return box;
  return {
    ...box,
    tl2br: readBorderSide(childNamed(container, 'tl2br')),
    tr2bl: readBorderSide(childNamed(container, 'tr2bl')),
  };
}

/** Word's weighted border selection (MS-OI29500 §2.1.169, tcBorders).
 * https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/7c791c5d-44c3-4fe8-abdd-8f136761bb93
 */
export function borderWeight(side: TableBorderSide): number {
  if (side.state !== 'edge') return 0;
  if (side.style === 'dotted' || side.style === 'dashed') return 1;
  return Math.max(1, Math.round((side.sizePt ?? side.widthPt) * 8)) * BORDER_NUMBER[side.style];
}

function colorBrightness(color: string | null): readonly number[] {
  if (!color) return [0, 0, 0]; // auto resolves to black.
  const r = Number.parseInt(color.slice(0, 2), 16);
  const g = Number.parseInt(color.slice(2, 4), 16);
  const b = Number.parseInt(color.slice(4, 6), 16);
  return [r + b + 2 * g, b + 2 * g, g];
}

/**
 * Pick the winner between two candidates on a shared grid line (zero cell spacing).
 *
 * `none` loses to any edge; two `none`/omitted do not paint. Weighted widths decide;
 * equal weights rank by style, then prefer the darker color, then `preferFirst`
 * (reading-order / first candidate).
 */
export function resolveBorderConflict(
  first: TableBorderSide,
  second: TableBorderSide,
  preferFirst = true
): TableBorderSide {
  if (first.state === 'omitted') return second.state === 'omitted' ? OMITTED : second;
  if (second.state === 'omitted') return first;
  if (first.state === 'none') return second.state === 'none' ? NONE : second;
  if (second.state === 'none') return first;

  const w1 = borderWeight(first);
  const w2 = borderWeight(second);
  if (w1 > w2) return first;
  if (w2 > w1) return second;
  const s1 = BORDER_NUMBER[first.style];
  const s2 = BORDER_NUMBER[second.style];
  if (s1 !== s2) return s1 > s2 ? first : second;
  const b1 = colorBrightness(first.color);
  const b2 = colorBrightness(second.color);
  for (let index = 0; index < b1.length; index++) {
    if (b1[index]! < b2[index]!) return first;
    if (b2[index]! < b1[index]!) return second;
  }
  return preferFirst ? first : second;
}

function asResolved(side: TableBorderSide): ResolvedTableBorderEdge | undefined {
  if (side.state !== 'edge') return undefined;
  const { state: _state, ...edge } = side;
  return edge;
}

function tableFallback(
  table: TableBorderBox,
  side: TableBorderSideName,
  interior: boolean
): TableBorderSide {
  if (!interior) return table[side];
  if (side === 'top' || side === 'bottom') return table.insideH;
  return table.insideV;
}

export interface BorderGridCell {
  readonly gridColumn: number;
  readonly gridSpan: number;
  readonly vMergeContinue: boolean;
  readonly borders: CellBorderBox;
  /** Set on restart cells that visually span into later rows. */
  readonly mergeRowSpan?: number;
  /** The row's `w:tblPrEx` table borders, which replace the table's own for this cell. */
  readonly rowTableBorders?: TableBorderBox;
}

export interface RawInterval {
  gridStart: number;
  gridEnd: number;
  edge: ResolvedTableBorderEdge | undefined;
}

function edgesEqual(
  a: ResolvedTableBorderEdge | undefined,
  b: ResolvedTableBorderEdge | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (!a || !b) return false;
  return (
    a.style === b.style &&
    a.color === b.color &&
    a.widthPt === b.widthPt &&
    a.line === b.line &&
    a.sizePt === b.sizePt
  );
}

/** Append ordered intervals, merging only the unpublished contiguous winner. */
function appendInterval(
  intervals: RawInterval[],
  gridStart: number,
  gridEnd: number,
  side: TableBorderSide
): void {
  const edge = side.state === 'edge' ? side : undefined;
  const previous = intervals[intervals.length - 1];
  if (previous && previous.gridEnd === gridStart && edgesEqual(previous.edge, edge)) {
    previous.gridEnd = gridEnd;
  } else {
    intervals.push({ gridStart, gridEnd, edge: asResolved(side) });
  }
}

function convenienceEdge(
  intervals: readonly RawInterval[],
  fullStart: number,
  fullEnd: number
): ResolvedTableBorderEdge | undefined {
  const painted = intervals.filter((interval) => interval.edge !== undefined);
  if (painted.length !== 1) return undefined;
  const only = painted[0]!;
  if (only.gridStart !== fullStart || only.gridEnd !== fullEnd) return undefined;
  return only.edge;
}

/**
 * The absolute grid a table's borders are drawn on: column widths, and per-row tops and heights.
 *
 * Shared by every edge so adjacent cells resolve to the SAME line, rather than each computing its
 * own and leaving a hairline gap between them.
 */
export interface BorderGridGeometry {
  /** Center simple horizontal strokes on collapsed row boundaries. */
  readonly collapsedHorizontal?: boolean;
  /** Absolute column widths for the whole table (points). */
  readonly columnWidthsPt: readonly number[];
  /**
   * Per laid-out row: absolute top and height in the same coordinate space as cell boxes
   * (only relative differences matter for vertical edge segmentation).
   */
  readonly rowBands: readonly { readonly y: number; readonly height: number }[];
  /** Per laid-out cell: width/height after vMerge expansion (cell-local stroke space). */
  readonly cellBoxes: readonly (readonly {
    readonly width: number;
    readonly height: number;
    /** False when a split occurrence still reserves a shared bottom stroke. */
    readonly outerBottomInsetReserved?: boolean;
    /** Simple vertical strokes share the cell grid line with legacy padding. */
    readonly centeredSideRules?: boolean;
    /** Simple vertical strokes paint centered on the grid line. */
    readonly centeredSidePaint?: boolean;
  }[])[];
}

function sumRange(values: readonly number[], start: number, end: number): number {
  let total = 0;
  const last = Math.min(end, values.length);
  for (let i = Math.max(0, start); i < last; i += 1) total += values[i]!;
  return total;
}

function doubleMetricsOf(
  edge: ResolvedTableBorderEdge | undefined
): CompoundBorderMetrics | undefined {
  if (!edge || edge.style !== 'double') return undefined;
  return computeDoubleBorderMetricsPt(edge.widthPt);
}

export function cssStyleForEdge(style: TableBorderStyle): 'solid' | 'dashed' | 'dotted' {
  if (style === 'dashed') return 'dashed';
  if (style === 'dotted') return 'dotted';
  return 'solid';
}

function horizStart(which: 'outer' | 'inner', left: CompoundBorderMetrics | undefined): number {
  if (!left) return 0;
  if (which === 'outer') return left.insetPt;
  return left.insetPt + left.strokePt + left.gapPt;
}

function horizEnd(
  which: 'outer' | 'inner',
  cellW: number,
  right: CompoundBorderMetrics | undefined
): number {
  if (!right) return cellW;
  if (which === 'outer') return cellW - right.insetPt;
  return cellW - right.insetPt - right.strokePt - right.gapPt;
}

function vertStart(which: 'outer' | 'inner', top: CompoundBorderMetrics | undefined): number {
  if (!top) return 0;
  if (which === 'outer') return top.insetPt + top.strokePt;
  return top.insetPt + top.extentPt;
}

function vertEnd(
  which: 'outer' | 'inner',
  cellH: number,
  bottom: CompoundBorderMetrics | undefined
): number {
  if (!bottom) return cellH;
  if (which === 'outer') return cellH - bottom.insetPt - bottom.strokePt;
  return cellH - bottom.insetPt - bottom.extentPt;
}

function pushStroke(strokes: TableBorderStrokeRecord[], stroke: TableBorderStrokeRecord): void {
  if (strokes.length >= MAX_TABLE_BORDER_STROKES) return;
  if (!(stroke.width > 0) || !(stroke.height > 0)) return;
  strokes.push(stroke);
}

function expandDoubleInterval(
  strokes: TableBorderStrokeRecord[],
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number,
  cellW: number,
  cellH: number,
  leftM: CompoundBorderMetrics | undefined,
  rightM: CompoundBorderMetrics | undefined,
  topM: CompoundBorderMetrics | undefined,
  bottomM: CompoundBorderMetrics | undefined
): void {
  const metrics = computeDoubleBorderMetricsPt(edge.widthPt);
  const { strokePt, gapPt, extentPt, insetPt } = metrics;
  const touchesLeft = Math.abs(startPt) < 1e-6;
  const touchesRight = Math.abs(endPt - cellW) < 1e-6;
  const touchesTop = Math.abs(startPt) < 1e-6;
  const touchesBottom = Math.abs(endPt - cellH) < 1e-6;

  if (side === 'top' || side === 'bottom') {
    const yOuter = side === 'top' ? insetPt : cellH - insetPt - strokePt;
    const yInner = side === 'top' ? insetPt + strokePt + gapPt : cellH - insetPt - extentPt;
    for (const which of ['outer', 'inner'] as const) {
      // Corner-adjusted endpoints may extend past the interval (negative inset).
      let x0 = startPt;
      let x1 = endPt;
      if (touchesLeft) x0 = horizStart(which, leftM);
      if (touchesRight) x1 = horizEnd(which, cellW, rightM);
      pushStroke(strokes, {
        side,
        role: which,
        color: edge.color,
        cssStyle: 'solid',
        x: x0,
        y: which === 'outer' ? yOuter : yInner,
        width: x1 - x0,
        height: strokePt,
      });
    }
    return;
  }

  const xOuter = side === 'left' ? insetPt : cellW - insetPt - strokePt;
  const xInner = side === 'left' ? insetPt + strokePt + gapPt : cellW - insetPt - extentPt;
  for (const which of ['outer', 'inner'] as const) {
    let y0 = startPt;
    let y1 = endPt;
    if (touchesTop) y0 = vertStart(which, topM);
    if (touchesBottom) y1 = vertEnd(which, cellH, bottomM);
    pushStroke(strokes, {
      side,
      role: which,
      color: edge.color,
      cssStyle: 'solid',
      x: which === 'outer' ? xOuter : xInner,
      y: y0,
      width: strokePt,
      height: y1 - y0,
    });
  }
}

function expandTripleInterval(
  strokes: TableBorderStrokeRecord[],
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number,
  cellW: number,
  cellH: number
): void {
  const strokePt = Math.max(COMPOUND_BORDER_MIN_STROKE_PT, edge.widthPt);
  const gapPt = Math.max(COMPOUND_BORDER_MIN_GAP_PT, strokePt);
  const extentPt = strokePt * 3 + gapPt * 2;
  if (side === 'top' || side === 'bottom') {
    const y0 = side === 'top' ? 0 : cellH - extentPt;
    for (let i = 0; i < 3; i += 1) {
      const role = i === 0 ? 'outer' : i === 1 ? 'middle' : 'inner';
      pushStroke(strokes, {
        side,
        role,
        color: edge.color,
        cssStyle: 'solid',
        x: startPt,
        y: y0 + i * (strokePt + gapPt),
        width: endPt - startPt,
        height: strokePt,
      });
    }
    return;
  }
  const x0 = side === 'left' ? 0 : cellW - extentPt;
  for (let i = 0; i < 3; i += 1) {
    const role = i === 0 ? 'outer' : i === 1 ? 'middle' : 'inner';
    pushStroke(strokes, {
      side,
      role,
      color: edge.color,
      cssStyle: 'solid',
      x: x0 + i * (strokePt + gapPt),
      y: startPt,
      width: strokePt,
      height: endPt - startPt,
    });
  }
}

function expandSimpleInterval(
  strokes: TableBorderStrokeRecord[],
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number,
  cellW: number,
  cellH: number,
  centered: boolean
): void {
  const horizontal = side === 'top' || side === 'bottom';
  const w = edge.widthPt;
  // A rule starts AT its grid line and runs in the direction of flow: a shared horizontal
  // band downward into the row below, a vertical rule rightward into the column to its
  // right. Neither is drawn inward, so columns of different widths share one grid line.
  // Captured in `.cache/pdf/claude-band-mixed/` and `.cache/pdf/claude-vertical-rules/`.
  // Admitted legacy vertical rules still straddle their line, and a terminal or outer rule
  // keeps its inward geometry so it stays inside the table.
  const x = horizontal
    ? startPt
    : centered
      ? side === 'right'
        ? cellW - w / 2
        : -w / 2
      : side === 'right'
        ? cellW
        : 0;
  pushStroke(strokes, {
    side,
    role: 'edge',
    color: edge.color,
    cssStyle: cssStyleForEdge(edge.style),
    x,
    y: !horizontal ? startPt : side === 'bottom' ? cellH - (centered ? 0 : w) : 0,
    width: horizontal ? endPt - startPt : w,
    height: horizontal ? w : endPt - startPt,
  });
}

function cornerDoubleMetrics(
  intervals: readonly RawInterval[],
  atStart: boolean
): CompoundBorderMetrics | undefined {
  if (intervals.length === 0) return undefined;
  const interval = atStart ? intervals[0]! : intervals[intervals.length - 1]!;
  return doubleMetricsOf(interval.edge);
}

/** Stroke geometry for one cell from its resolved side intervals. */
export function publishFromIntervals(
  top: readonly RawInterval[],
  left: readonly RawInterval[],
  bottom: readonly RawInterval[],
  right: readonly RawInterval[],
  cellW: number,
  cellH: number,
  columnWidthsPt: readonly number[],
  gridColumn: number,
  rowOffsetsPt: readonly number[],
  rowIndex: number,
  centered = false,
  outerBottom = false,
  centeredSides = false,
  publishAllSides = false
): ResolvedCellBorders {
  const toSegments = (
    side: TableBorderSideName,
    raw: readonly RawInterval[],
    axisIsHorizontal: boolean
  ): ResolvedTableBorderEdgeSegment[] => {
    const segments: ResolvedTableBorderEdgeSegment[] = [];
    for (const interval of raw) {
      if (!interval.edge) continue;
      let startPt: number;
      let endPt: number;
      if (axisIsHorizontal) {
        startPt = sumRange(columnWidthsPt, gridColumn, interval.gridStart);
        endPt = sumRange(columnWidthsPt, gridColumn, interval.gridEnd);
      } else {
        // rowOffsetsPt[i] = offset of row (rowIndex+i) from cell top; length mergeSpan+1
        startPt = rowOffsetsPt[interval.gridStart - rowIndex] ?? 0;
        endPt = rowOffsetsPt[interval.gridEnd - rowIndex] ?? cellH;
      }
      segments.push({
        side,
        gridStart: interval.gridStart,
        gridEnd: interval.gridEnd,
        startPt,
        endPt,
        edge: interval.edge,
      });
    }
    return segments;
  };

  const topSegs = toSegments('top', top, true);
  const leftSegs = toSegments('left', left, false);
  const bottomSegs = toSegments('bottom', bottom, true);
  const rightSegs = toSegments('right', right, false);
  const edgeSegments = [...topSegs, ...rightSegs, ...bottomSegs, ...leftSegs];

  const leftM = cornerDoubleMetrics(left, true);
  const rightM = cornerDoubleMetrics(right, true);
  const topM = cornerDoubleMetrics(top, true);
  const bottomM = cornerDoubleMetrics(bottom, true);

  const isFull = (segments: readonly ResolvedTableBorderEdgeSegment[], extent: number): boolean =>
    segments.length === 1 &&
    Math.abs(segments[0]!.startPt) < 1e-6 &&
    Math.abs(segments[0]!.endPt - extent) < 1e-6;

  const topIsFull = isFull(topSegs, cellW);
  const leftIsFull = isFull(leftSegs, cellH);
  const bottomIsFull = isFull(bottomSegs, cellW);
  const rightIsFull = isFull(rightSegs, cellH);

  const strokes: TableBorderStrokeRecord[] = [];
  const expandSide = (
    side: TableBorderSideName,
    segments: readonly ResolvedTableBorderEdgeSegment[],
    fullSide: boolean
  ): void => {
    for (const segment of segments) {
      const { edge, startPt, endPt } = segment;
      if (edge.style === 'double') {
        expandDoubleInterval(
          strokes,
          side,
          edge,
          startPt,
          endPt,
          cellW,
          cellH,
          side === 'top' || side === 'bottom' ? leftM : undefined,
          side === 'top' || side === 'bottom' ? rightM : undefined,
          side === 'left' || side === 'right' ? topM : undefined,
          side === 'left' || side === 'right' ? bottomM : undefined
        );
      } else if (edge.style === 'triple') {
        expandTripleInterval(strokes, side, edge, startPt, endPt, cellW, cellH);
      } else if (
        publishAllSides ||
        edge.line !== undefined ||
        !fullSide ||
        (centered && (side === 'top' || side === 'bottom')) ||
        side === 'right' ||
        (centeredSides && side === 'left')
      ) {
        // Multi-interval simple edges cannot use CSS border-*; publish stroke geometry.
        // A full simple RIGHT edge publishes it too: CSS draws a right border INSIDE its
        // element, and the reference draws every vertical rule from the grid line
        // rightward. A left, top or separated bottom edge already starts at its own line,
        // which is exactly what CSS border-box draws, so those stay on CSS. A patterned or
        // multi-stroke line style always publishes, split into its own strokes.
        const from = strokes.length;
        expandSimpleInterval(
          strokes,
          side,
          edge,
          startPt,
          endPt,
          cellW,
          cellH,
          side === 'left' || side === 'right'
            ? centeredSides
            : centered && side !== 'top' && !(side === 'bottom' && outerBottom)
        );
        splitPublishedTableBands(strokes, from, edge, MAX_TABLE_BORDER_STROKES);
      }
    }
  };

  expandSide('top', topSegs, topIsFull);
  expandSide('left', leftSegs, leftIsFull);
  expandSide('bottom', bottomSegs, bottomIsFull);
  expandSide('right', rightSegs, rightIsFull);

  const result: {
    top?: ResolvedTableBorderEdge;
    left?: ResolvedTableBorderEdge;
    bottom?: ResolvedTableBorderEdge;
    right?: ResolvedTableBorderEdge;
    edgeSegments?: ResolvedTableBorderEdgeSegment[];
    strokes?: TableBorderStrokeRecord[];
  } = {};

  if (topIsFull && topSegs[0]) result.top = topSegs[0].edge;
  if (leftIsFull && leftSegs[0]) result.left = leftSegs[0].edge;
  if (bottomIsFull && bottomSegs[0]) result.bottom = bottomSegs[0].edge;
  if (rightIsFull && rightSegs[0]) result.right = rightSegs[0].edge;

  if (edgeSegments.length > 0) result.edgeSegments = edgeSegments;
  if (strokes.length > 0) result.strokes = strokes;
  return result;
}

/**
 * Resolve borders for every cell in a laid-out table fragment.
 *
 * Shared vertical edges: conflict(left.right, right.left) → assigned to the left cell,
 * segmented per row when a vMerge restart faces differing neighbors.
 * Shared horizontal edges: conflict(above.bottom, below.top) → assigned to the above cell,
 * segmented per grid column when a gridSpan cell faces differing below neighbors; vMerge
 * interior seams are suppressed per interval.
 *
 * When `geometry` is provided, compound edges expand into explicit stroke records with
 * corner-adjusted endpoints in cell-local points.
 */
export function resolveTableCellBorderGrid(
  rows: readonly (readonly BorderGridCell[])[],
  table: TableBorderBox,
  columnCount: number,
  geometry?: BorderGridGeometry,
  work?: TableBorderGridResolveWork,
  ownershipBudget?: TableBorderOwnershipBudget
): ResolvedCellBorders[][] {
  const rowCount = rows.length;
  const result: ResolvedCellBorders[][] = rows.map((row) => row.map(() => ({})));
  if (work) {
    work.ownershipSlotsWritten = 0;
    work.columnLookups = 0;
  }
  const ownership = buildColumnOwnershipIndexes(rows, columnCount, work, ownershipBudget);
  const rowExtents = tableRowBorderExtents(rows, columnCount);

  const effective = (
    cell: BorderGridCell,
    side: TableBorderSideName,
    interior: boolean
  ): TableBorderSide =>
    effectiveBorderSide(
      cell.borders[side],
      tableFallback(cell.rowTableBorders ?? table, side, interior),
      {
        interior,
      }
    );

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = rows[rowIndex]!;
    for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
      const cell = row[cellIndex]!;
      if (cell.vMergeContinue) {
        result[rowIndex]![cellIndex] = {};
        continue;
      }

      const mergeSpan = cell.mergeRowSpan ?? 1;
      const lastMergeRow = rowIndex + mergeSpan - 1;
      const isTop = rowIndex === 0;
      const isBottom = lastMergeRow === rowCount - 1;
      const lastCol = cell.gridColumn + cell.gridSpan - 1;

      // --- top (outer only; interior owned by row above) — per grid column ---
      const top: RawInterval[] = [];
      if (isTop) {
        for (let col = cell.gridColumn; col <= lastCol; col += 1) {
          appendInterval(top, col, col + 1, effective(cell, 'top', false));
        }
      }

      // Row perimeters can move inward after skipped grid columns.
      const left: RawInterval[] = [];
      for (let r = rowIndex; r <= lastMergeRow; r += 1) {
        if (cell.gridColumn !== rowExtents[r]?.start) continue;
        appendInterval(left, r, r + 1, effective(cell, 'left', false));
      }

      // --- bottom (owned here; conflict with below.top per grid column) ---
      const bottom: RawInterval[] = [];
      for (let col = cell.gridColumn; col <= lastCol; col += 1) {
        let edge: TableBorderSide;
        if (isBottom) {
          edge = effective(cell, 'bottom', false);
        } else {
          const below = ownerAt(ownership, lastMergeRow + 1, col, work);
          // Suppress only intervals whose below cell is a vMerge continue covering this col.
          if (below?.cell.vMergeContinue) {
            edge = OMITTED;
          } else {
            edge = resolveBorderConflict(
              effective(cell, 'bottom', true),
              below ? effective(below.cell, 'top', true) : (cell.rowTableBorders ?? table).insideH
            );
          }
        }
        appendInterval(bottom, col, col + 1, edge);
      }

      // --- right (owned here; conflict with neighbor.left per merge row) ---
      const right: RawInterval[] = [];
      for (let r = rowIndex; r <= lastMergeRow; r += 1) {
        let edge: TableBorderSide;
        if (lastCol >= (rowExtents[r]?.end ?? columnCount) - 1) {
          edge = effective(cell, 'right', false);
        } else {
          const neighbor = ownerAt(ownership, r, lastCol + 1, work);
          edge = resolveBorderConflict(
            effective(cell, 'right', true),
            neighbor
              ? effective(neighbor.cell, 'left', true)
              : (cell.rowTableBorders ?? table).insideV
          );
        }
        appendInterval(right, r, r + 1, edge);
      }

      if (!geometry) {
        // Geometry-free path (unit tests of conflict only): publish convenience edges when
        // the side collapses to one uniform full-span winner.
        const resolved: {
          top?: ResolvedTableBorderEdge;
          left?: ResolvedTableBorderEdge;
          bottom?: ResolvedTableBorderEdge;
          right?: ResolvedTableBorderEdge;
          edgeSegments?: ResolvedTableBorderEdgeSegment[];
        } = {};
        const topEdge = convenienceEdge(top, cell.gridColumn, lastCol + 1);
        const leftEdge = convenienceEdge(left, rowIndex, lastMergeRow + 1);
        const bottomEdge = convenienceEdge(bottom, cell.gridColumn, lastCol + 1);
        const rightEdge = convenienceEdge(right, rowIndex, lastMergeRow + 1);
        if (topEdge) resolved.top = topEdge;
        if (leftEdge) resolved.left = leftEdge;
        if (bottomEdge) resolved.bottom = bottomEdge;
        if (rightEdge) resolved.right = rightEdge;

        const edgeSegments: ResolvedTableBorderEdgeSegment[] = [];
        const pushGeomFree = (
          side: TableBorderSideName,
          intervals: readonly RawInterval[]
        ): void => {
          for (const interval of intervals) {
            if (!interval.edge) continue;
            edgeSegments.push({
              side,
              gridStart: interval.gridStart,
              gridEnd: interval.gridEnd,
              startPt: interval.gridStart,
              endPt: interval.gridEnd,
              edge: interval.edge,
            });
          }
        };
        pushGeomFree('top', top);
        pushGeomFree('left', left);
        pushGeomFree('bottom', bottom);
        pushGeomFree('right', right);
        if (edgeSegments.length > 0) resolved.edgeSegments = edgeSegments;
        result[rowIndex]![cellIndex] = resolved;
        continue;
      }

      const cellBox = geometry.cellBoxes[rowIndex]![cellIndex]!;
      const rowOffsets: number[] = [0];
      let acc = 0;
      for (let r = rowIndex; r <= lastMergeRow; r += 1) {
        const band = geometry.rowBands[r]!;
        acc += band.height;
        rowOffsets.push(acc);
      }
      // Prefer the expanded cell height when floating-point drift appears.
      if (rowOffsets.length > 1) {
        rowOffsets[rowOffsets.length - 1] = cellBox.height;
      }

      // A diagonal's viewport must start at the physical outer cell corner. Publishing
      // every side here keeps CSS border widths at zero; otherwise an absolute SVG's
      // containing block starts inside a CSS top/left border, including pixel rounding.
      const diagonals = cellDiagonalRecords(cell.borders, cellBox.width, cellBox.height);
      const physical = publishFromIntervals(
        top,
        left,
        bottom,
        right,
        cellBox.width,
        cellBox.height,
        geometry.columnWidthsPt,
        cell.gridColumn,
        rowOffsets,
        rowIndex,
        geometry.collapsedHorizontal,
        isBottom && cellBox.outerBottomInsetReserved !== false,
        cellBox.centeredSidePaint ?? cellBox.centeredSideRules,
        diagonals.length > 0
      );
      result[rowIndex]![cellIndex] = diagonals.length ? { ...physical, diagonals } : physical;
    }
  }

  return result;
}

/** Painted extent inward from the cell edge; existing padding may already clear it. */
export function borderExtentPt(
  edge: ResolvedTableBorderEdge | TableBorderSide | undefined
): number {
  if (!edge || ('state' in edge && edge.state !== 'edge')) return 0;
  if (edge.style === 'double') {
    const metrics = computeDoubleBorderMetricsPt(edge.widthPt);
    return metrics.insetPt + metrics.extentPt;
  }
  if (edge.style === 'triple') {
    const strokePt = Math.max(COMPOUND_BORDER_MIN_STROKE_PT, edge.widthPt);
    return strokePt * 3 + Math.max(COMPOUND_BORDER_MIN_GAP_PT, strokePt) * 2;
  }
  return edge.widthPt;
}

export const EMPTY_TABLE_BORDER_BOX = EMPTY_TABLE_BORDERS;
export const EMPTY_CELL_BORDER_BOX = EMPTY_CELL_BORDERS;
