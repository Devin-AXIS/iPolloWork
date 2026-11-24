// The wrap exclusion a placed floating table publishes for the text beside it.
//
// One builder serves the body, header and footer floats (`table-float-exclusion.ts`) and the
// floats a table cell holds (`cell-float-tables.ts`), so a table wraps text the same way
// wherever it floats.
import { TABLE_WRAP_MIN_PASSAGE_PT, type ExclusionZone } from './drawing-exclusion.ts';
import type { TableFragmentRecord } from './semantic-records.ts';
import type { TableFloatPosition } from './semantic-table.ts';

const NO_DISTANCES = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * How far a floating table's own outer rules reach past its grid, per side.
 *
 * Text clears a floating table at the grid edge PLUS the table's authored outer border width
 * PLUS `w:leftFromText`/`w:rightFromText`. The fragment box IS the grid (`columnEdges` run
 * from 0 to `box.width`), so the rule adds a term rather than replacing one, and a table with
 * no authored outer rule adds nothing.
 *
 * Captured against a six-case control over an 8x range of border width: the term is the
 * FULL authored width, not the half a collapsed grid line paints on this side.
 */
function outerRuleWidths(fragment: TableFragmentRecord): {
  readonly left: number;
  readonly right: number;
} {
  const columnCount = Math.max(0, fragment.columnEdges.length - 1);
  let left = 0;
  let right = 0;
  for (const row of fragment.rows) {
    for (const cell of row.cells) {
      const borders = cell.borders;
      if (!borders) continue;
      const first = cell.gridColumn <= 0;
      const last = cell.gridColumn + cell.gridSpan >= columnCount;
      if (first) left = Math.max(left, borders.left?.widthPt ?? 0);
      if (last) right = Math.max(right, borders.right?.widthPt ?? 0);
      for (const segment of borders.edgeSegments ?? []) {
        if (first && segment.side === 'left') left = Math.max(left, segment.edge.widthPt);
        if (last && segment.side === 'right') right = Math.max(right, segment.edge.widthPt);
      }
    }
  }
  return { left, right };
}

/**
 * Whether a table band from `bandLeft` to `bandRight` (its grid plus its side text distances)
 * leaves no passage for text in the column: none wider than a quarter inch on either side.
 */
export function leavesNoPassage(
  bandLeft: number,
  bandRight: number,
  columnLeft: number,
  columnWidth: number
): boolean {
  const passage = Math.max(bandLeft - columnLeft, columnLeft + columnWidth - bandRight);
  return passage <= TABLE_WRAP_MIN_PASSAGE_PT;
}

/** The text column a floating table wraps, and how its zone reaches earlier lines. */
export interface TableWrapColumn {
  readonly left: number;
  readonly width: number;
  readonly columnIndex: number;
  /** A page- or margin-positioned table also wraps the earlier lines it covers. */
  readonly pageFramed: boolean;
  /**
   * Whether a band that leaves no passage moves the earlier lines it covers (see
   * {@link ExclusionZone.reachesEarlierLines}); the caller decides when that applies.
   */
  readonly reachesWhenSpanning: boolean;
  /**
   * Whether a band that leaves a passage wraps the earlier lines it crosses (see
   * {@link ExclusionZone.wrapsEarlierLines}); the caller decides when that applies.
   */
  readonly wrapsWhenRising?: boolean;
}

/** The wrap exclusion of one placed floating table fragment. */
export function floatingTableZone(
  block: TableFragmentRecord,
  metadata: {
    readonly anchorId: string;
    readonly float: TableFloatPosition;
    readonly sourceOrder: number;
  },
  column: TableWrapColumn
): ExclusionZone {
  const grid = block.box;
  const distances = metadata.float.distances ?? NO_DISTANCES;
  // A zero authored distance is the one case the control leaves unexplained, so the border
  // term stays off there rather than guessing at a minimum separation.
  const rules = outerRuleWidths(block);
  const ruleLeft = distances.left > 0 ? rules.left : 0;
  const ruleRight = distances.right > 0 ? rules.right : 0;
  const box = {
    x: grid.x - ruleLeft,
    y: grid.y,
    width: grid.width + ruleLeft + ruleRight,
    height: grid.height,
  };
  const { left, width, pageFramed } = column;
  const spans = leavesNoPassage(
    grid.x - distances.left,
    grid.x + grid.width + distances.right,
    left,
    width
  );
  const reaches = !pageFramed && spans && column.reachesWhenSpanning;
  return {
    sourceKind: 'table',
    drawingNodeId: `table:${block.tableId}`,
    anchorParagraphId: metadata.anchorId,
    anchorModelStart: 0,
    sourceOrder: metadata.sourceOrder,
    paintLayer: 'inFront',
    relativeHeight: 0,
    allowOverlap: true,
    columnIndex: column.columnIndex,
    // A page- or margin-positioned table does not move with the text before it, so it also
    // wraps or moves the earlier lines it covers on its page.
    ...(pageFramed ? { pageFramedBand: true } : reaches ? { reachesEarlierLines: true } : {}),
    ...(!pageFramed && !spans && column.wrapsWhenRising ? { wrapsEarlierLines: true } : {}),
    ...(block.fragmentIndex > 0 ? { continuedTablePart: true } : {}),
    y: box.y,
    verticalBand: {
      x: box.x - distances.left,
      y: box.y - distances.top,
      width: box.width + distances.left + distances.right,
      height: box.height + distances.top + distances.bottom,
    },
    input: {
      // A band that leaves no passage and moves earlier lines moves empty ones too.
      mode:
        (box.x - distances.left <= left && box.x + box.width + distances.right >= left + width) ||
        (spans && (pageFramed || reaches))
          ? 'topAndBottom'
          : 'square',
      contentBounds: box,
      polygon: null,
      clipPolygon: null,
      wrapDistances: distances,
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      textSide: 'bothSides',
      contentLeft: left,
      contentRight: left + width,
    },
  };
}
