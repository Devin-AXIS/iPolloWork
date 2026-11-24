// Floating tables inside a table cell: `w:tblpPr` (ECMA-376 Part 1, 17.4.57) on a nested table.
//
// A nested table with `w:tblpPr` leaves the cell's flow. The cell is its whole world:
//
// - Horizontal (`w:horzAnchor`, 17.4.58): `text` and `margin` measure `w:tblpX` or align by
//   `w:tblpXSpec` (17.4.63) within the cell's content box; `page` measures within the cell box.
//   The table never leaves the cell box: it is clamped to stay inside it.
// - Vertical (`w:vertAnchor`, 17.4.66): `text` measures `w:tblpY` from the top of the paragraph
//   that follows the table, before its spacing; `margin` and `page` measure from the cell top.
//   A `w:tblpYSpec` (17.4.65) of `top` (or `inside`) puts the table at that top.
// - Two adjacent tables with identical `w:tblpPr` stack: the later one starts at the bottom of
//   the earlier one. Other floats of one cell never overlap, whatever `w:tblOverlap` (17.4.56)
//   says: the later one moves right beside the earlier one, or left from mode 15, when its band
//   then fits the cell box; otherwise down below it (`table-float-overlap.ts`). From mode 15 a
//   table moved down also moves right by its own `w:leftFromText`.
// - The cell's later paragraphs wrap around the table, its side distances and outer rules
//   included, as body text wraps around a floating table (`table-wrap-zone.ts`).
// - The cell grows to hold the table. Vertical alignment moves the cell's text, never its
//   floats, and counts the floats in the content height.
//
// Pagination: a float that does not fit the band left on the page lays out in flow at its
// horizontal position and splits there, so nothing is lost and the flow cannot loop. The part
// the next page continues floats again at the top of the cell, and the following text wraps
// beside it.
//
// Not modelled, and so kept in flow as before: a `w:tblpYSpec` other than `top` or `inside`
// (and `inline`, which never floats), and a table nested deeper than `MAX_CELL_FLOAT_DEPTH`.
// Earlier lines of the cell do not wrap around a float raised above its anchor, or around one
// positioned against the cell top.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { ExclusionZone } from './drawing-exclusion.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { emitNestedTable } from './nested-table-layout.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { TableFloatPosition } from './semantic-table.ts';
import { shiftBlocks } from './table-fragment-finalize.ts';
import { readTableFloatPosition } from './table-float-properties.ts';
import { noOverlapShift, type NoOverlapObstacle } from './table-float-overlap.ts';
import { sameTablePosition } from './table-float-stack.ts';
import { tableFloatOriginX } from './table-origin.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { floatingTableZone } from './table-wrap-zone.ts';

/** The box of the cell whose flow holds floats: its outer edges and top, in page points. */
export interface CellFloatBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

const NO_DISTANCES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * The deepest nesting at which a cell table floats. Placing a float lays its table out twice
 * (measure, then place), so floats nested in floats multiply the work; deeper ones stay in
 * flow, which bounds that cost for any file.
 */
const MAX_CELL_FLOAT_DEPTH = 4;

type NestedTableResult = ReturnType<typeof emitNestedTable>;

/** What a cell flow asks of the floats it holds. */
export interface CellFloats {
  /** Lays out one table of the cell, as `emitNestedTable` does; a float keeps the cursor. */
  readonly emit: typeof emitNestedTable;
  /** The deps a paragraph of the cell breaks with: the page zones plus the cell's floats. */
  paragraphDeps(deps: TableFlowDeps): TableFlowDeps;
  /** The bottom the cell content reaches at `y`, its floats included. */
  bottom(y: number): number;
}

function tablePropertiesOf(table: OoxmlElement): OoxmlElement | undefined {
  for (const child of table.children)
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === 'tblPr'
    )
      return child;
  return undefined;
}

/** The position of a cell table that floats, or undefined for one that stays in flow. */
export function cellTableFloat(table: OoxmlElement): TableFloatPosition | undefined {
  const float = readTableFloatPosition(tablePropertiesOf(table));
  if (!float) return undefined;
  // Only an alignment to the top of the frame is modelled; the others keep the table in flow.
  if (float.ySpec !== undefined && float.ySpec !== 'top' && float.ySpec !== 'inside')
    return undefined;
  return float;
}

/**
 * Deps that name the cell box for a cell flow holding a floating table. A cell without one,
 * or one whose text runs vertically (`room` undefined), keeps its deps as they are.
 */
export function withCellFloatBox(
  deps: TableFlowDeps,
  blocks: readonly OoxmlElement[],
  room: { readonly left: number; readonly right: number } | undefined,
  top: number
): TableFlowDeps {
  if (!room || !blocks.some((block) => block.kind === 'table' && cellTableFloat(block)))
    return deps.cellFloatBox ? { ...deps, cellFloatBox: undefined } : deps;
  return { ...deps, cellFloatBox: { left: room.left, right: room.right, top } };
}

/**
 * The floats of one cell flow on one page, or undefined when the flow holds none or is not a
 * table cell (`deps.cellFloatBox` names the cell).
 */
export function createCellFloats(
  blocks: readonly OoxmlElement[],
  left: number,
  right: number,
  deps: TableFlowDeps
): CellFloats | undefined {
  const box = deps.cellFloatBox;
  if (!box) return undefined;
  const zones: ExclusionZone[] = [];
  const obstacles: NoOverlapObstacle[] = [];
  const placed = new Map<OoxmlElement, TableFragmentRecord>();
  let floatBottom = Number.NEGATIVE_INFINITY;
  // The paragraph deps last built, reused until another float is placed.
  let zonedDeps = { base: deps, count: 0, deps };

  const frames = {
    text: { left, width: Math.max(0, right - left) },
    margin: { left, width: Math.max(0, right - left) },
    page: { left: box.left, width: Math.max(0, box.right - box.left) },
  };
  const movesLeft = hasCompatibilityRule(deps.compatibilityMode, 'floatingTableOverlapMovesLeft');
  const indentsMovedDown = hasCompatibilityRule(
    deps.compatibilityMode,
    'cellFloatMovedDownIndents'
  );

  /** The grid left of a float `width` wide: authored, then kept inside the cell box. */
  const originX = (float: TableFloatPosition, width: number): number => {
    const x = tableFloatOriginX(float, width, frames);
    return Math.max(box.left, Math.min(x, box.right - width));
  };

  const anchorOf = (table: OoxmlElement): string => {
    for (let index = blocks.indexOf(table) + 1; index < blocks.length; index++)
      if (blocks[index]!.kind === 'paragraph') return blocks[index]!.id;
    return table.id;
  };

  /** Publish a placed float: its wrap zone, its band for later floats, and its bottom. */
  const record = (
    table: OoxmlElement,
    float: TableFloatPosition,
    fragment: TableFragmentRecord
  ): TableFragmentRecord => {
    const anchorId = anchorOf(table);
    const sourceOrder = blocks.indexOf(table);
    const floating: TableFragmentRecord = {
      ...fragment,
      floatingWrap: { anchorId, columnIndex: 0, float, sourceOrder },
    };
    const distances = float.distances ?? NO_DISTANCES;
    zones.push(
      floatingTableZone(
        floating,
        // The zone names the table as its anchor, so every later paragraph of the cell takes it
        // as a band it inherits: a cell paragraph carves only its own drawings at break time.
        { anchorId: table.id, float, sourceOrder: -1 },
        {
          left,
          width: Math.max(0, right - left),
          columnIndex: 0,
          pageFramed: false,
          reachesWhenSpanning: false,
        }
      )
    );
    const { x, y, width, height } = fragment.box;
    obstacles.push({
      left: x - distances.left,
      top: y - distances.top,
      right: x + width + distances.right,
      bottom: y + height + distances.bottom,
      refusesOverlap: true,
    });
    placed.set(table, floating);
    floatBottom = Math.max(floatBottom, y + height);
    return floating;
  };

  const emit: typeof emitNestedTable = (
    table,
    tableLeft,
    tableRight,
    top,
    depth,
    flowDeps,
    maxBottom = Number.POSITIVE_INFINITY,
    continuation,
    freshBand = false
  ): NestedTableResult => {
    const float = depth <= MAX_CELL_FLOAT_DEPTH ? cellTableFloat(table) : undefined;
    if (!float) {
      // A table that stays in flow starts below the floats placed before it.
      const start = Math.max(top, floatBottom);
      return emitNestedTable(
        table,
        tableLeft,
        tableRight,
        start,
        depth,
        flowDeps,
        maxBottom,
        continuation,
        freshBand && start === top
      );
    }
    let probeLineId = 0;
    const probeDeps: TableFlowDeps = {
      ...stripAnchorSinksForProbe(flowDeps),
      cache: undefined,
      borderOwnershipBudget: undefined,
      vMergeResolveBudget: undefined,
      onCellBreakKey: undefined,
      nextLineId: () => `probe-cell-float-${probeLineId++}`,
    };
    // A continued table honours its row cursors only in a bounded band, so the part a page
    // continues is laid out against the page bottom; a fresh float against no bottom at all.
    const band = continuation ? maxBottom : Number.POSITIVE_INFINITY;
    const layAt = (y: number, x: number | undefined, deps: TableFlowDeps, bottom = band) =>
      emitNestedTable(
        table,
        tableLeft,
        tableRight,
        y,
        depth,
        deps,
        bottom,
        continuation,
        freshBand,
        x
      );
    const probe = layAt(top, undefined, probeDeps);
    const probeFragment = probe?.fragment;
    // The band cannot hold what is left of a continued float: it splits in flow again.
    if (!probeFragment || probe.remainder)
      return layAt(
        top,
        probeFragment ? originX(float, probeFragment.box.width) : undefined,
        flowDeps,
        maxBottom
      );
    const { width, height } = probeFragment.box;
    let x = originX(float, width);
    let y: number;
    const previous = blocks[blocks.indexOf(table) - 1];
    const partner = previous?.kind === 'table' ? placed.get(previous) : undefined;
    if (continuation) {
      // The part a page continues floats at the top of the cell band.
      y = top;
    } else if (partner && sameTablePosition(table, previous!)) {
      y = partner.box.y + partner.box.height;
    } else {
      y =
        float.vertAnchor === 'text'
          ? top + (float.ySpec ? 0 : float.yPt)
          : box.top + (float.ySpec ? 0 : float.yPt);
      y = Math.max(box.top, y);
      const distances = float.distances ?? NO_DISTANCES;
      // A float moves beside an earlier one only when its band, distances included, still
      // fits the cell box; otherwise it moves below it.
      const shift = noOverlapShift(
        { left: x, top: y, width, height, distances, refusesOverlap: true },
        obstacles,
        { left: box.left + distances.left, right: box.right - distances.right },
        movesLeft
      );
      x += shift.dx;
      y += shift.dy;
      if (shift.dx === 0 && shift.dy > 0 && indentsMovedDown)
        x = Math.min(x + distances.left, Math.max(box.left, box.right - width));
    }
    // The band cannot hold the float: it lays out in flow at its horizontal position and
    // splits there.
    if (y + height > maxBottom + 0.001) return layAt(top, x, flowDeps, maxBottom);
    const laid = layAt(y, x, flowDeps);
    if (!laid?.fragment || laid.remainder) return laid;
    return { fragment: record(table, float, laid.fragment), bottom: top };
  };

  return {
    emit,
    paragraphDeps(base: TableFlowDeps): TableFlowDeps {
      if (zones.length === 0) return base;
      if (zonedDeps.base !== base || zonedDeps.count !== zones.length) {
        const own = zones.slice();
        const pageZones = base.pageExclusionZones;
        zonedDeps = {
          base,
          count: zones.length,
          deps: {
            ...base,
            pageExclusionZones: () => {
              const page = pageZones?.() ?? [];
              return page.length === 0 ? own : [...page, ...own];
            },
          },
        };
      }
      return zonedDeps.deps;
    },
    bottom: (y: number): number => Math.max(y, floatBottom),
  };
}

/**
 * Shift a finished cell's content by its vertical alignment. The cell's floats keep their
 * place: they were positioned against the cell, not against the text that moves.
 */
export function alignCellContent(
  blocks: readonly BlockFragmentRecord[],
  dy: number
): BlockFragmentRecord[] {
  if (!blocks.some((block) => block.kind === 'table' && block.floatingWrap))
    return shiftBlocks(blocks, dy);
  return blocks.map((block) =>
    block.kind === 'table' && block.floatingWrap ? block : shiftBlocks([block], dy)[0]!
  );
}
