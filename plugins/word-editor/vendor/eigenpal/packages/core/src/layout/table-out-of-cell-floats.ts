// Floats a table cell anchors but Word lays out against the page (`layoutInCell="0"` before
// mode 15), and the rows they push.
//
// Printed from Word 16.113 in mode 14: such an object wraps like a BODY float. It stays where
// it resolves from the table's original, unpushed layout, and every row whose band touches
// or crosses the object's band moves below it, with the rows after it. It does not matter
// whether the row overlaps the object horizontally. `wrapNone`, in-front and behind objects
// push nothing. The object does not move with the rows it pushed.
//
// Only the cases this module can place exactly take part: a top-level cell paragraph whose
// every anchor is such a float, in a table with no vertical merges and a top-aligned cell.
// Everything else keeps the cell flow's own handling (see `anchoredOutOfCell`).

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { anchorLaidOutInCell, cellAnchorScope } from './cell-anchor-layout.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { exclusionZoneFromAnchoredDrawing, wrapProducesExclusion } from './drawing-exclusion.ts';
import {
  anchoredDrawingAtomsInParagraph,
  type AnchoredDrawingRecord,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { shiftAnchoredDrawing } from './drawing-overlap.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableFragmentRecord } from './semantic-records.ts';
import {
  createTableBorderOwnershipBudget,
  createTableVMergeResolveBudget,
  layoutTableFragment,
  type TableFlowDeps,
} from './semantic-table-layout.ts';

const EPSILON = 0.001;

/** A vertical band an out-of-cell float keeps clear, in page-content points. */
interface OutOfCellBand {
  readonly top: number;
  readonly bottom: number;
  readonly paragraphId: string;
  /** Where the unpushed probe placed the float's anchor row. */
  readonly anchorRowTop: number;
  readonly anchorRowBottom: number;
  /** How far above the anchor row the first row the band touches starts, unpushed. */
  readonly leadIn: number;
}

export interface OutOfCellFloatPlan {
  /** The table's deps with the pin applied at publication; use them for every row. */
  readonly deps: TableFlowDeps;
  /**
   * Where rows of total height `heightAt(top)` go to clear every band, recording that push
   * for the floats of `rows`. Call it before placing those rows.
   */
  readonly clear: (
    top: number,
    heightAt: (top: number) => number,
    rows: readonly SemanticTableRow[],
    pageBottom: number
  ) => number;
  /**
   * The first fragment is published: stop pushing and pinning, and hand every float back to
   * the cell flow, which is all a later sheet or a repeated header row has.
   */
  readonly end: () => void;
}

/**
 * Plan the rows an in-flow table's out-of-cell floats push, or null when it has none.
 *
 * The floats are placed by a probe of the whole table at its original top, and published
 * there: the push each float's row received is taken back as its records are published, so
 * page-bottom and overlap checks see the final position, never the pushed one.
 */
export function planOutOfCellFloats(
  structure: SemanticTableStructure,
  tableId: string,
  left: number,
  top: number,
  deps: TableFlowDeps
): OutOfCellFloatPlan | null {
  const layout = deps.inlineDrawingLayout;
  // From mode 15 no anchor is out of its cell, so there is nothing to walk.
  if (!layout || hasCompatibilityRule(deps.compatibilityMode, 'anchorsLayOutInCell')) return null;
  // Live: cells read it as they break, and `end` empties it.
  const paragraphs = new Set(outOfCellFloatParagraphs(structure, layout, deps));
  if (paragraphs.size === 0) return null;
  // The probe skips the cell band exactly as the real rows do, so both break the same way.
  let bands = probeBands(structure, tableId, left, top, layout, {
    ...deps,
    outOfCellFloatParagraphs: paragraphs,
  });
  // A float the probe gave no band pushes nothing; its cell keeps the cell-flow handling.
  for (const id of [...paragraphs])
    if (!bands.some((band) => band.paragraphId === id)) paragraphs.delete(id);
  if (paragraphs.size === 0) return null;
  let push = 0;
  const pushByParagraph = new Map<string, number>();
  // Anchor rows already cleared for placement: their bands stay, whatever pushes come later.
  const placedAnchors = new Set<string>();
  /** Whether a band's anchor row still ends on this sheet once pushed, by its own band too. */
  const anchorRowFits = (band: OutOfCellBand, pageBottom: number): boolean => {
    const height = band.anchorRowBottom - band.anchorRowTop;
    const top = band.anchorRowTop + push;
    // Every row from the first one the band touches down to the anchor row moves below it.
    const finalTop =
      band.top <= top + height + EPSILON ? Math.max(top, band.bottom + band.leadIn) : top;
    return finalTop + height <= pageBottom + EPSILON;
  };
  // Only a flow-framed float moved with its pushed row; a page- or margin-framed one never
  // did, which is the same rule `shiftAnchoredDrawingRecords` applies.
  const pin = (drawings: readonly AnchoredDrawingRecord[]): readonly AnchoredDrawingRecord[] =>
    drawings.map((drawing) => {
      const dy = pushByParagraph.get(drawing.anchorParagraphId);
      if (dy === undefined || !['paragraph', 'line'].includes(drawing.verticalFrame))
        return drawing;
      return shiftAnchoredDrawing(drawing, 0, -dy);
    });
  const sink = (target: ((drawings: readonly AnchoredDrawingRecord[]) => void) | undefined) =>
    target && ((drawings: readonly AnchoredDrawingRecord[]) => target(pin(drawings)));
  const republish = deps.onAnchorRepublish;
  return {
    deps: {
      ...deps,
      publishAnchoredDrawings: sink(deps.publishAnchoredDrawings),
      collectAnchoredDrawings: sink(deps.collectAnchoredDrawings),
      ...(republish
        ? { onAnchorRepublish: (id: string, drawings) => republish(id, pin(drawings)) }
        : {}),
      outOfCellFloatParagraphs: paragraphs,
    },
    clear: (from, heightAt, rows, pageBottom) => {
      // A float whose unplaced row the page break will carry, pushed, to a later sheet, or
      // whose band starts past this sheet, pushes nothing here: its cell handles it as the
      // cell flow always has. Every band of such a paragraph goes, not only the failing one.
      for (const band of bands) {
        if (placedAnchors.has(band.paragraphId)) continue;
        if (band.top >= pageBottom || !anchorRowFits(band, pageBottom))
          paragraphs.delete(band.paragraphId);
      }
      bands = bands.filter(
        (band) =>
          paragraphs.has(band.paragraphId) && band.bottom > from + EPSILON && band.top < pageBottom
      );
      let current = from;
      for (let moves = 0; bands.length > 0 && moves <= bands.length; moves += 1) {
        const bottom = current + heightAt(current);
        const hit = bands.find(
          (band) => band.top <= bottom + EPSILON && band.bottom > current + EPSILON
        );
        if (!hit) break;
        current = hit.bottom;
      }
      push += current - from;
      for (const row of rows)
        for (const cell of row.cells)
          for (const block of cell.blocks) {
            if (!paragraphs.has(block.id)) continue;
            placedAnchors.add(block.id);
            if (push > EPSILON) pushByParagraph.set(block.id, push);
          }
      return current;
    },
    end: () => {
      bands = [];
      push = 0;
      pushByParagraph.clear();
      placedAnchors.clear();
      paragraphs.clear();
    },
  };
}

/**
 * Top-level body-row cell paragraphs whose every anchor is an out-of-cell float that wraps
 * text. A table with a vertical merge, or a cell that is not top-aligned, is left to the cell
 * flow: finalize moves such content after the probe placed it, so the probe could not pin it.
 */
function outOfCellFloatParagraphs(
  structure: SemanticTableStructure,
  layout: InlineDrawingLayoutContext,
  deps: TableFlowDeps
): ReadonlySet<string> {
  const found = new Set<string>();
  if (structure.rows.some((row) => row.cells.some((cell) => cell.vMergeContinue))) return found;
  const scope = cellAnchorScope(true, deps);
  for (const row of structure.rows) {
    // A header row repeats on later sheets, where nothing is pushed: it keeps the cell flow.
    if (row.isHeader) continue;
    for (const cell of row.cells) {
      if (cell.vAlign !== 'top') continue;
      for (const block of cell.blocks) {
        if (block.kind !== 'paragraph') continue;
        if (paragraphFloatsOutOfCell(block, layout, scope)) found.add(block.id);
      }
    }
  }
  return found;
}

function paragraphFloatsOutOfCell(
  paragraph: OoxmlElement,
  layout: InlineDrawingLayoutContext,
  scope: ReturnType<typeof cellAnchorScope>
): boolean {
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, layout);
  if (atoms.length === 0) return false;
  return atoms.every(({ projection }) => {
    // `behindDoc` only sets the paint layer; the wrap decides whether the rows move.
    if (projection.hidden) return false;
    if (!wrapProducesExclusion(projection.wrap)) return false;
    return !anchorLaidOutInCell(projection, scope);
  });
}

/**
 * Lay the table out once at its original top, without pagination and without its own
 * floats' zones from an earlier pass, and read the bands its floats keep clear.
 */
function probeBands(
  structure: SemanticTableStructure,
  tableId: string,
  left: number,
  top: number,
  layout: InlineDrawingLayoutContext,
  deps: TableFlowDeps & { readonly outOfCellFloatParagraphs: ReadonlySet<string> }
): readonly OutOfCellBand[] {
  const paragraphs = deps.outOfCellFloatParagraphs;
  const captured: AnchoredDrawingRecord[] = [];
  const capture = (drawings: readonly AnchoredDrawingRecord[]): void => {
    for (const drawing of drawings) captured.push(drawing);
  };
  const zones = deps.pageExclusionZones;
  let line = 0;
  const probe = layoutTableFragment(structure, left, top, 0, tableId, 0, {
    // Every live sink stripped, then only the capture put back: the probe must publish nothing.
    ...stripAnchorSinksForProbe(deps),
    measuringOnly: deps.measuringOnly,
    anchorDeferOnly: false,
    publishAnchoredDrawings: capture,
    collectAnchoredDrawings: capture,
    onCellBreakKey: undefined,
    ...(zones
      ? {
          pageExclusionZones: () =>
            zones().filter((zone) => !paragraphs.has(zone.anchorParagraphId ?? '')),
        }
      : {}),
    borderOwnershipBudget: createTableBorderOwnershipBudget(),
    vMergeResolveBudget: createTableVMergeResolveBudget(),
    nextLineId: () => `out-of-cell-float-probe-${line++}`,
  });
  const rows = rowByParagraph(probe.fragment);
  const bands: OutOfCellBand[] = [];
  for (const drawing of captured) {
    if (!paragraphs.has(drawing.anchorParagraphId)) continue;
    const projection = layout.projectionForAtom?.(drawing.drawingNodeId);
    // The same band the float gives the body flow, wrap distances and polygons included.
    const zone = projection
      ? exclusionZoneFromAnchoredDrawing({
          drawing,
          projection,
          sourceOrder: 0,
          contentLeft: -1_000_000,
          contentRight: 1_000_000,
        })
      : null;
    if (!zone) continue;
    let bandTop = zone.verticalBand.y;
    const bottom = zone.verticalBand.y + zone.verticalBand.height;
    // Word resolves a float at the top of its row ON the row edge, where the engine resolves
    // it at the cell's content top, inside the rule between the rows. Measured from the edge,
    // the row above ends exactly where the float begins, and moves with it, as in Word.
    const row = rows.get(drawing.anchorParagraphId);
    if (!row) continue;
    if (row.contentTop !== undefined && drawing.paintBounds.y <= row.contentTop + EPSILON)
      bandTop = Math.min(bandTop, row.top);
    if (bottom > bandTop + EPSILON)
      bands.push(
        Object.freeze({
          top: bandTop,
          bottom,
          paragraphId: drawing.anchorParagraphId,
          anchorRowTop: row.top,
          anchorRowBottom: row.bottom,
          leadIn: Math.max(0, row.top - firstTouchedRowTop(probe.fragment, bandTop)),
        })
      );
  }
  return bands;
}

/** The top of the first probed row that ends at or below `y`: the first one a band there touches. */
function firstTouchedRowTop(fragment: TableFragmentRecord, y: number): number {
  const row = fragment.rows.find(
    (candidate) => candidate.box.y + candidate.box.height >= y - EPSILON
  );
  return row ? row.box.y : y;
}

interface ProbedRow {
  readonly top: number;
  readonly bottom: number;
  /** The paragraph's top when it opens its cell; otherwise none. */
  readonly contentTop?: number;
}

/** Each top-level cell paragraph's row, and the top of the content it opens its cell with. */
function rowByParagraph(fragment: TableFragmentRecord): ReadonlyMap<string, ProbedRow> {
  const found = new Map<string, ProbedRow>();
  for (const row of fragment.rows) {
    const bottom = row.box.y + row.box.height;
    for (const cell of row.cells) {
      for (const [index, block] of cell.blocks.entries()) {
        if (block.kind !== 'paragraph') continue;
        found.set(block.paragraphId, {
          top: row.box.y,
          bottom,
          ...(index === 0 ? { contentTop: block.box.y } : {}),
        });
      }
    }
  }
  return found;
}
