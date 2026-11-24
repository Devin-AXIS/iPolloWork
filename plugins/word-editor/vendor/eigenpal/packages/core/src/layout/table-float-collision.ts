// Table fragments that meet a wrapping float.
//
// A table does not wrap its cell text beside a float that crosses it. When a fragment of a
// top-level table opens on a page (the table start, or its continuation after a break), and
// its rows would reach a crossing float's wrap band, it moves into a passage beside the bands
// it would reach when one holds its width: it keeps its `w:jc` alignment (ECMA-376 Part 1,
// 17.4.28) and indent inside that passage. Otherwise the whole fragment starts below the band.
// A table that ends above the band stays where it is. Rows never move inside a fragment that
// is already open, so a fragment never gets a gap between its rows.
//
// Obstacles are pictures in the page header or footer, and body pictures anchored before the
// table in document order, including those an earlier section left on a shared sheet. In a
// multi-column section a body picture reaches only its own column. A picture clear of the
// table's horizontal extent, wrap distances included, does not move it. Paragraphs keep
// wrapping beside every float as before.
//
// The band is the float's wrap outline: a tight or through outline ends at its polygon, not
// at the picture's extent, plus the wrap distances. Floats anchored inside the table keep
// their own rules (`table-out-of-cell-floats.ts`, cell flow), and floats anchored after the
// table cannot reach back to it. Floating tables are obstacles too; frames are not.
//
// A kept row that exceeds the fresh band below a float can split inside that band.

import type { ExclusionZone } from './drawing-exclusion.ts';
import { squareExclusionBounds } from './drawing-wrap.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import { contentAlignedReachPt, tableOriginX } from './table-origin.ts';

const EPSILON = 0.001;
const MAX_CLEARANCE_STEPS = 16;

/** A float's wrap outline, in page-content points. */
interface CollisionBand {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Whether a fragment opened at `top` extends below `limit`, and whether its first row can
 * start at a given top. Both describe the rows the fragment opens with.
 */
export interface PendingTableFragment {
  readonly reaches: (top: number, limit: number) => boolean;
  readonly fitsAt: (top: number) => boolean;
}

/** What the clearance reads from, and moves, in the paginator that owns the table. */
export interface TableFloatClearanceHost {
  readonly flow: {
    cursorY: number;
    readonly flowColumn?: () => number | undefined;
    /** The text column the table is placed in. */
    readonly columnLeft?: () => number;
    readonly columnWidth?: () => number;
  };
  /** Left edge of the table in page-content points, which moves between fragments. */
  readonly left: () => number;
  /** Moves the table, which has no rows yet, to the left edge `left` beside a band. */
  readonly place?: (left: number) => void;
  /** Bottom of the band the page being filled offers the table. */
  readonly bottom: () => number;
  /**
   * Whether only repeated header rows precede the cursor in the column being filled. A later
   * column's top is as fresh as a page top, even with content in an earlier column.
   */
  readonly opensRegion: () => boolean;
  /**
   * The cursor moved to `top`, where the fragment, which has no rows yet, opens. `opensRegion`
   * tells that nothing but the band is above it in its column.
   */
  readonly moved: (top: number, opensRegion: boolean) => void;
  /** One row's natural height at `top`. */
  readonly heightOf: (row: SemanticTableRow, top: number) => number;
}

export interface TableFloatClearance {
  /** The body row being placed, which a page break carries to its next fragment. */
  pending: PendingTableFragment | undefined;
  /**
   * Opens the fragment below every band it would reach; true when the cursor moved. Call it
   * only while the fragment holds no rows.
   */
  clear(fragment: PendingTableFragment): boolean;
  /** Opens a continuation fragment for the pending row below `repeat` points of header rows. */
  clearPending(repeat: number): void;
  /** The fragment that opens with table row `from`; see {@link tableFragmentReach}. */
  fragment(
    from: number,
    fitsAt: (top: number) => boolean,
    lead?: (top: number) => number,
    continued?: () => boolean
  ): PendingTableFragment;
}

/**
 * Whether rows `from` onward, placed at `top` after `lead(top)` points of header rows, extend
 * below `limit`. A continued first row counts as 1 point: only its remainder is left.
 */
export function tableFragmentReach(
  rows: readonly SemanticTableRow[],
  from: number,
  heightOf: (row: SemanticTableRow, top: number) => number,
  lead: (top: number) => number = () => 0,
  continued: () => boolean = () => false
): (top: number, limit: number) => boolean {
  return (top, limit) => {
    if (limit <= top + EPSILON) return true;
    let y = top + lead(top);
    let index = from;
    if (continued()) {
      y += 1;
      index += 1;
    }
    if (y > limit + EPSILON) return true;
    for (; index < rows.length; index += 1) {
      y += heightOf(rows[index]!, y);
      if (y > limit + EPSILON) return true;
    }
    return false;
  };
}

function collisionBand(zone: ExclusionZone): CollisionBand {
  const input = zone.input;
  if (input.mode === 'topAndBottom') {
    const band = zone.verticalBand;
    return { top: band.y, bottom: band.y + band.height, left: -Infinity, right: Infinity };
  }
  if (input.mode === 'square' || !input.polygon || input.polygon.length < 3) {
    const box = squareExclusionBounds(input.contentBounds, input.effectInsets, input.wrapDistances);
    return { top: box.y, bottom: box.y + box.height, left: box.x, right: box.x + box.width };
  }
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const point of input.polygon) {
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
  }
  const insets = input.effectInsets;
  const distances = input.wrapDistances;
  return {
    top: top - insets.top - distances.top,
    bottom: bottom + insets.bottom + distances.bottom,
    left: left - insets.left - distances.left,
    right: right + insets.right + distances.right,
  };
}

/** Document order of the table's first own paragraph, or undefined when none is indexed. */
function tableStartOrder(
  structure: SemanticTableStructure,
  orderOf: (paragraphId: string) => number | undefined
): number | undefined {
  let start: number | undefined;
  for (const row of structure.rows) {
    for (const cell of row.cells) {
      for (const block of cell.blocks) {
        if (block.localName !== 'p') continue;
        const order = orderOf(block.id);
        if (order !== undefined && (start === undefined || order < start)) start = order;
      }
    }
    if (start !== undefined) return start;
  }
  return start;
}

/**
 * Clearance for an in-flow table's fragments, or null when the flow publishes no wrap zones.
 * Zones are read per call: each page the table reaches has its own.
 *
 * Bounds: a band that reaches the page bottom is not an obstacle. On a page or column the
 * table opens, a fragment whose first row cannot start below the band keeps its place: no band
 * pushes a fragment from page to page, and a row that a break already carried to a fresh page
 * or column, which cannot advance again, never moves below a band where it cannot start.
 */
export function tableFloatClearance(
  structure: SemanticTableStructure,
  tableId: string,
  deps: TableFlowDeps,
  host: TableFloatClearanceHost
): TableFloatClearance | null {
  const zonesOf = deps.pageExclusionZones;
  if (!zonesOf) return null;
  const orderOf = deps.paragraphOrderIndex;
  const start = orderOf ? tableStartOrder(structure, orderOf) : undefined;
  const ownPrefix = `${tableId}.`;
  const width = structure.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  // A legacy table that puts its cell content on the text edges reaches past them.
  const inset = contentAlignedReachPt(structure);
  const reaches = (zone: ExclusionZone, column: number | undefined): boolean => {
    if (zone.sourceKind === 'furniture') return true;
    // A text frame stands in the way of the table it anchors at.
    if (zone.sourceKind === 'frame')
      return (
        zone.anchorParagraphId === tableId && (column === undefined || zone.columnIndex === column)
      );
    if (zone.sourceKind !== undefined && zone.sourceKind !== 'table') return false;
    // A float an earlier section left on this sheet is anchored before every table here.
    if (zone.earlierSection) return true;
    if (start === undefined || !orderOf) return false;
    if (column !== undefined && zone.columnIndex !== column) return false;
    if (zone.anchorParagraphId.startsWith(ownPrefix)) return false;
    // A floating table this table anchors stands at the table's top.
    if (zone.anchorParagraphId === tableId) return true;
    const order = orderOf(zone.anchorParagraphId);
    return order !== undefined && order < start;
  };
  let bandsFor: readonly ExclusionZone[] | undefined;
  let bandsColumn: number | undefined;
  let bands: readonly CollisionBand[] = [];
  const clearedTop = (
    top: number,
    fragment: PendingTableFragment
  ): { readonly top: number; readonly left?: number } => {
    const zones = zonesOf();
    const column = host.flow.flowColumn?.();
    if (zones !== bandsFor || column !== bandsColumn) {
      bandsFor = zones;
      bandsColumn = column;
      bands = zones
        .filter((zone) => reaches(zone, column))
        .map(collisionBand)
        .sort((a, b) => a.top - b.top);
    }
    const left = host.left();
    const bottom = host.bottom();
    const crossing = bands.filter(
      (band) =>
        band.bottom < bottom - EPSILON &&
        band.left < left + width - EPSILON &&
        band.right > left + EPSILON
    );
    let y = top;
    for (let step = 0; step < MAX_CLEARANCE_STEPS; step += 1) {
      // Sorted by top: when the fragment does not reach the first band still below it, it
      // reaches none of the later ones.
      const band = crossing.find((candidate) => candidate.bottom > y + EPSILON);
      if (!band || !fragment.reaches(y, band.top)) return { top: y };
      const beside = passageLeft(y, fragment, bottom);
      if (beside !== undefined) return { top: y, left: beside };
      y = band.bottom;
    }
    return { top: y };
  };
  /** Where the table stands in the first passage at `top` that holds it beside every band. */
  const passageLeft = (
    top: number,
    fragment: PendingTableFragment,
    bottom: number
  ): number | undefined => {
    const { columnLeft, columnWidth } = host.flow;
    if (!columnLeft || !columnWidth || !host.place) return undefined;
    const column = { left: columnLeft(), width: columnWidth() };
    const reached = bands.filter(
      (band) =>
        band.bottom > top + EPSILON &&
        band.bottom < bottom - EPSILON &&
        (band.top <= top + EPSILON || fragment.reaches(top, band.top))
    );
    const blocked = reached
      .map((band) => [band.left, band.right] as const)
      .sort((a, b) => a[0] - b[0]);
    let start = column.left;
    const end = column.left + column.width;
    for (const [left, right] of [...blocked, [end, end] as const]) {
      const gap = Math.min(left, end) - start;
      if (gap > 0) {
        // The table keeps its alignment and indent inside the passage, as in a narrower column.
        const x = start + tableOriginX(structure, gap);
        if (x >= start - EPSILON - inset && x + width <= start + gap + EPSILON + inset) return x;
      }
      start = Math.max(start, right);
      if (start >= end - EPSILON) return undefined;
    }
    return undefined;
  };
  const clearance: TableFloatClearance = {
    pending: undefined,
    clear(fragment) {
      const top = host.flow.cursorY;
      const placed = clearedTop(top, fragment);
      if (placed.left !== undefined) host.place!(placed.left);
      const cleared = placed.top;
      if (cleared <= top + EPSILON || cleared >= host.bottom() - EPSILON) return false;
      const opensRegion = host.opensRegion();
      if (opensRegion && !fragment.fitsAt(cleared)) return false;
      host.flow.cursorY = cleared;
      host.moved(cleared, opensRegion);
      return true;
    },
    clearPending(repeat) {
      const pending = clearance.pending;
      if (!pending) return;
      clearance.clear({
        reaches: (top, limit) => limit <= top + EPSILON || pending.reaches(top + repeat, limit),
        fitsAt: (top) => pending.fitsAt(top + repeat),
      });
    },
    fragment: (from, fitsAt, lead, continued) => ({
      reaches: tableFragmentReach(structure.rows, from, host.heightOf, lead, continued),
      fitsAt,
    }),
  };
  return clearance;
}
