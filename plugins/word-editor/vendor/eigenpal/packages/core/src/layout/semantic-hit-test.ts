import {
  PATH_HIT_REACH,
  textboxPaintsPastFrame,
  textboxPressReaches,
  turnedShapeBounds,
  unionBox,
  vectorShapeHit,
} from './vector-shape-hit.ts';
import { vectorShapeInkClip } from './vector-shape-ink.ts';
export {
  findDrawingOverlayFrameInLayout,
  type DrawingOverlayFrame,
} from './drawing-overlay-frame.ts';
import { beyondLine, gapOffset } from './line-edge-hit.ts';
import { turnedInlineDrawingAt } from './turned-inline-drawing-hit.ts';
import { endsWithSpaceSlot, withoutTrailingZeroWidthSpaces } from './trailing-spaces.ts';
import { drawingAtOffset, pictureEdgeX, pictureIsRtl } from './inline-picture-caret.ts';
import { bidiPrefixWidth } from './shaped-caret-advances.ts';
import { nearestBidiSpan, paragraphIsRtl } from './rtl-paragraph.ts';
import { lineContentEdges } from './pending-line.ts';
import { snapToSoundMarkCluster } from './sound-mark-hit.ts';
// Pointer hit testing in MODEL space, over semantic layout records.
//
// A pointer lands somewhere on a sheet; this answers which text position the person meant.
// The answer comes from the records alone — line boxes, span boxes, cell boxes — with no DOM
// range, no element rectangle and no remeasurement of painted output. That is what makes the
// behaviour identical between adapters and provable headlessly.
//
// The rules it encodes are the ones a word processor is expected to follow, and every one of
// them is about a point that is NOT on a glyph:
//
//   - left of a line's first glyph (an indent, a margin, a cell's left padding) is the START
//     of that line, not "nothing";
//   - right of its last glyph is the END of that line;
//   - above the first line or below the last line of a block clamps into that block;
//   - a click in a margin belongs to the block it is LEVEL with, not the one it is nearest in
//     a straight line — vertical distance is weighted so that "beside a short line" beats
//     "below a long one";
//   - the gutter between two sheets belongs to the sheet above it, whose last line is the
//     nearest text.
//
// Refusing to answer is never right: a click has to put the caret somewhere, and returning
// null makes it do nothing at all.

import { PAGE_BREAK_CHAR } from '../store/package/hard-break.ts';
import { graphemeBoundaryEpoch, segmentGraphemes } from './grapheme.ts';
import { isCjk } from './cjk-paragraph-breaks.ts';
import { lastCodePointOf } from './cjk-line-break.ts';
import { lineForSegment, lineSegments, type LineSegment } from './line-segments.ts';
import { baselineShiftPtOf, measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { CaretGeometry, SemanticPosition } from './semantic-interaction.ts';
import type {
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  LayoutBox,
  LineRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
  TextMeasurer,
} from './semantic-records.ts';
import type { InlineDrawingRecord, AnchoredDrawingRecord } from './drawing-layout.ts';
import { pointInDrawingClip } from './drawing-wrap.ts';
import { clipParagraphBox } from './paragraph-frame-clip.ts';
import { blockDistance, isCollapsedSectionMark, weightedDistance } from './hit-test-blocks.ts';
import { paragraphContentBounds } from './paragraph-content-bounds.ts';
import { bottomToTopCaretInLayout, pointInBottomToTopCell } from './table-cell-text-direction.ts';
import { hitIndex, type MergedCellOrigin } from './semantic-hit-index.ts';

/** A point in the coordinate space named by the function taking it. */
export interface HitPoint {
  readonly x: number;
  readonly y: number;
}

/** The innermost table cell a point resolved through. */
export interface TableCellAddress {
  /** Canonical node id of the `w:tbl`. */
  readonly tableId: string;
  /** Canonical node id of the `w:tr`. */
  readonly rowId: string;
  /** Canonical node id of the `w:tc`. */
  readonly cellId: string;
  /** Ordinal in the WHOLE table, stable across fragments and header repeats. */
  readonly rowIndex: number;
  readonly gridColumn: number;
  readonly gridSpan: number;
}

/** Stable inline drawing identity when a hit resolves to a drawing atom. */
export interface SemanticHitDrawing {
  readonly drawingNodeId: string;
  readonly paragraphId: string;
  readonly start: number;
}

/** What a point landed on: a semantic position, its caret geometry, and where it sits. */
export interface SemanticHit {
  readonly position: SemanticPosition;
  readonly caret: CaretGeometry;
  readonly pageIndex: number;
  readonly lineId: string;
  /** Null outside a table; the innermost cell when tables nest. */
  readonly cell: TableCellAddress | null;
  /**
   * True when the point was inside the resolved line's box AND inside one of its spans.
   *
   * A caller distinguishing a click ON text from a click BESIDE it — to decide whether to
   * claim the gesture at all — needs this, and cannot recover it from the position.
   */
  readonly onGlyphs: boolean;
  /**
   * Innermost content-control boundary covering the hit point, or null outside every control.
   *
   * Resolved from layout-published boundary geometry (not DOM). Nested controls prefer the
   * deepest {@link ContentControlBoundaryRecord.nestingDepth}.
   */
  readonly contentControlId: string | null;
  /** Non-null when the hit resolved to an inline drawing atom. */
  readonly drawing: SemanticHitDrawing | null;
}

/**
 * How precisely a hit resolves within a run.
 *
 * Without a measurer the offset is INTERPOLATED across the span's advance, which is exact only
 * for monospaced text — supply one for proportional fonts, or a click lands a character or two
 * away from the glyph under the pointer.
 */
export interface HitTestOptions {
  /**
   * Exact resolution of the character within a run.
   *
   * Absent, the offset is interpolated across the span's own advance, which is exact only for
   * a uniform advance. Pass the measurer layout was produced with, or the answer can disagree
   * with what was painted.
   */
  readonly measurer?: TextMeasurer;
  /** Vertical weight for the nearest-block rule. */
  readonly verticalWeight?: number;
}

/**
 * How much more a point of vertical distance counts than a point of horizontal distance.
 *
 * Without it, clicking far out in the right margin beside a two-word line picks whichever
 * block happens to be directly below, because that block is horizontally nearer. Weighting
 * the vertical axis makes "the line I am level with" win, which is what the pointer meant.
 */
export const DEFAULT_VERTICAL_WEIGHT = 8;

interface HitContext {
  readonly layout: SemanticLayout;
  readonly pageIndex: number;
  readonly verticalWeight: number;
  readonly measurer: TextMeasurer | undefined;
}

function bottomToTopHit(layout: SemanticLayout, hit: SemanticHit | null): SemanticHit | null {
  return hit ? { ...hit, caret: bottomToTopCaretInLayout(layout, hit.caret) } : null;
}

// ---------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------

/**
 * The page a sheet-space y belongs to.
 *
 * The gutter between page *i* and page *i+1* resolves to page *i*, because the nearest text
 * to a point in that gap is the last line of the page above it. That falls out of searching
 * for the last page whose top is at or above the point, with no special case: the gutter is
 * inside `[top(i), top(i+1))` by construction. A point above the first page clamps to it, and
 * a point past the last page clamps to that.
 */
export function pageAtY(layout: SemanticLayout, sheetY: number): number {
  const tops = hitIndex(layout).pageTops;
  if (tops.length === 0) return -1;
  let low = 0;
  let high = tops.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tops[mid]! <= sheetY) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** True when a sheet-space point falls inside a page's header or footer box. */
export function isFurniturePoint(layout: SemanticLayout, point: HitPoint): boolean {
  const page = layout.pages[pageAtY(layout, point.y)];
  if (!page) return false;
  for (const story of [page.header, page.footer]) {
    if (story && contains(story.box, point)) return true;
  }
  return false;
}

export function hitAnchoredDrawingAtPoint(
  drawings: readonly AnchoredDrawingRecord[] | undefined,
  point: HitPoint,
  pageIndex: number,
  requireFront = false
): SemanticHit | null {
  if (!drawings || drawings.length === 0) return null;
  const sorted = [...drawings].sort((left, right) => {
    if (left.behindDocument !== right.behindDocument) return left.behindDocument ? -1 : 1;
    return right.relativeHeight - left.relativeHeight;
  });
  for (const drawing of sorted) {
    if (requireFront && drawing.behindDocument) continue;
    if (!hitBoundsContainDrawing(drawing, point)) continue;
    const position: SemanticPosition = {
      paragraphId: drawing.anchorParagraphId,
      offset: drawing.start,
    };
    return {
      position,
      caret: {
        position,
        x: drawing.x,
        y: drawing.y,
        height: drawing.height,
        lineId: '',
        pageIndex,
      },
      pageIndex,
      lineId: '',
      cell: null,
      contentControlId: null,
      onGlyphs: true,
      drawing: Object.freeze({
        drawingNodeId: drawing.drawingNodeId,
        paragraphId: drawing.anchorParagraphId,
        start: drawing.start,
      }),
    };
  }
  return null;
}

/** Hit test a point given in PAGE-CONTENT coordinates, the space the fragment boxes use. */
export function hitTestPage(
  layout: SemanticLayout,
  pageIndex: number,
  point: HitPoint,
  options: HitTestOptions = {}
): SemanticHit | null {
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const context: HitContext = {
    layout,
    pageIndex: page.index,
    verticalWeight: options.verticalWeight ?? DEFAULT_VERTICAL_WEIGHT,
    measurer: options.measurer,
  };
  const contentControlId = contentControlIdAtPoint(layout, page.index, point);
  const frontDrawings = (page.anchoredDrawings ?? []).filter((drawing) => !drawing.behindDocument);
  const behindDrawings = (page.anchoredDrawings ?? []).filter((drawing) => drawing.behindDocument);
  const frontHit = hitAnchoredDrawingAtPoint(frontDrawings, point, context.pageIndex);
  if (frontHit) return { ...frontHit, contentControlId };
  const turnedHit = turnedInlineHit(page.fragments, point, context, layout);
  if (turnedHit) return turnedHit;
  const textHit = bottomToTopHit(layout, resolveBlocks(page.fragments, point, context, null));
  // Anywhere in a line's box is on the text, so a drawing behind it takes the press only
  // outside every line: in the margins, or in the space between paragraphs.
  if (textHit && (textHit.onGlyphs || pointInTextLine(page.fragments, point)))
    return { ...textHit, contentControlId };
  const behindHit = hitAnchoredDrawingAtPoint(behindDrawings, point, context.pageIndex);
  if (behindHit) return { ...behindHit, contentControlId };
  if (textHit) return { ...textHit, contentControlId };

  // A blank parity sheet shares no geometry with its neighbours: the upper half lands at the
  // end of the text before it, the lower half at the start of the text after it.
  if (page.parityBlank) {
    const step = point.y + page.contentBox.y - page.box.y < page.box.height / 2 ? -1 : 1;
    for (let index = pageIndex + step; layout.pages[index]; index += step) {
      const other = layout.pages[index]!;
      const { width, height } = step < 0 ? other.contentBox : { width: 0, height: 0 };
      const at = { ...context, pageIndex: other.index };
      const edge = resolveBlocks(other.fragments, { x: width, y: height }, at, null);
      const found = bottomToTopHit(layout, edge);
      if (found) return { ...found, contentControlId: null };
    }
  }

  // This page paints no reachable text — a run of vertical-merge continuations whose origin
  // is pages back, or a table fragment carrying nothing at all. A press still has to land
  // somewhere, so walk outward to the nearest page that does hold text. Only ever reached on
  // a page that would otherwise be a dead click.
  for (let distance = 1; distance < layout.pages.length; distance += 1) {
    for (const index of [pageIndex - distance, pageIndex + distance]) {
      const neighbour = layout.pages[index];
      if (!neighbour) continue;
      const found = bottomToTopHit(
        layout,
        resolveBlocks(neighbour.fragments, point, { ...context, pageIndex: neighbour.index }, null)
      );
      if (found) {
        return {
          ...found,
          contentControlId: contentControlIdAtPoint(layout, neighbour.index, point),
        };
      }
    }
  }
  return null;
}

/**
 * A press on the painted part of a turned inline shape: the shape turns about its extent's
 * centre and paints over the lines around it, so the press is on the shape whatever line is
 * under the pointer. Its caret is the shape's own position, before it on its line.
 */
function turnedInlineHit(
  fragments: readonly BlockFragmentRecord[],
  point: HitPoint,
  context: HitContext,
  controlsOf?: SemanticLayout
): SemanticHit | null {
  const found = turnedInlineDrawingAt(fragments, point, (drawing) =>
    hitBoundsContainDrawing(drawing, point)
  );
  if (!found) return null;
  const { drawing, line } = found;
  const position: SemanticPosition = { paragraphId: drawing.paragraphId, offset: drawing.start };
  return {
    position,
    caret: {
      position,
      x: pictureEdgeX(drawing, false),
      y: line.box.y,
      height: line.box.height,
      lineId: line.id,
      pageIndex: context.pageIndex,
    },
    pageIndex: context.pageIndex,
    lineId: line.id,
    cell: found.cell
      ? addressOf(context.layout, found.cell.table, found.cell.row, found.cell.cell)
      : null,
    onGlyphs: true,
    // The control that holds the shape, read at the middle of its advance on its own line,
    // not one under a neighbouring line it paints over.
    contentControlId: controlsOf
      ? contentControlIdAtPoint(controlsOf, context.pageIndex, {
          x: (drawing.advanceStart + drawing.advanceEnd) / 2,
          y: line.box.y + line.box.height / 2,
        })
      : null,
    drawing: drawingHitIdentity(drawing),
  };
}

/**
 * The turned inline shape of story-relative fragments that paints at `point`, or null. An open
 * header or footer's turned shape can paint past the story band, where no text hit reaches.
 */
export function hitTestTurnedInlineDrawing(
  layout: SemanticLayout,
  pageIndex: number,
  fragments: readonly BlockFragmentRecord[],
  point: HitPoint
): SemanticHit | null {
  const context = {
    layout,
    pageIndex,
    verticalWeight: DEFAULT_VERTICAL_WEIGHT,
    measurer: undefined,
  };
  return turnedInlineHit(fragments, point, context);
}

/**
 * Whether a point lies in the box of a text line: on its words, past its end, or in an empty
 * paragraph's line. Table cells count their own lines.
 */
export function pointInTextLine(blocks: readonly BlockFragmentRecord[], point: HitPoint): boolean {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      if (!contains(paragraphContentBounds(block), point)) continue;
      for (const line of block.lines)
        if (point.y >= line.box.y && point.y < line.box.y + line.box.height) return true;
    } else if (contains(block.box, point)) {
      for (const row of block.rows)
        for (const cell of row.cells)
          if (contains(cell.box, point) && pointInTextLine(cell.blocks, point)) return true;
    }
  }
  return false;
}

/**
 * Hit test story-relative fragments (header/footer boxes use this coordinate space).
 *
 * Unlike `hitTestPage`, there is no cross-page neighbour walk — furniture stories are
 * self-contained on one sheet.
 */
export function hitTestFragments(
  layout: SemanticLayout,
  pageIndex: number,
  fragments: readonly BlockFragmentRecord[],
  point: HitPoint,
  options: HitTestOptions = {}
): SemanticHit | null {
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const context: HitContext = {
    layout,
    pageIndex: page.index,
    verticalWeight: options.verticalWeight ?? DEFAULT_VERTICAL_WEIGHT,
    measurer: options.measurer,
  };
  return (
    turnedInlineHit(fragments, point, context) ??
    bottomToTopHit(layout, resolveBlocks(fragments, point, context, null))
  );
}

/**
 * Hit test a point given in SHEET coordinates — the space `page.box` lives in, and the space
 * a surface's own pixel offsets convert into.
 */
export function hitTestSheet(
  layout: SemanticLayout,
  point: HitPoint,
  options: HitTestOptions = {}
): SemanticHit | null {
  const page = layout.pages[pageAtY(layout, point.y)];
  if (!page) return null;

  for (const story of [page.header, page.footer]) {
    if (!story?.anchoredDrawings || story.anchoredDrawings.length === 0) continue;
    const storyPoint = Object.freeze({ x: point.x - story.box.x, y: point.y - story.box.y });
    const furnitureHit = hitAnchoredDrawingAtPoint(story.anchoredDrawings, storyPoint, page.index);
    if (furnitureHit) return furnitureHit;
  }

  return hitTestPage(
    layout,
    page.index,
    { x: point.x - page.contentBox.x, y: point.y - page.contentBox.y },
    options
  );
}

// ---------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------

function contains(box: LayoutBox, point: HitPoint): boolean {
  return (
    point.x >= box.x &&
    point.x < box.x + box.width &&
    point.y >= box.y &&
    point.y < box.y + box.height
  );
}

/**
 * Innermost content control whose published boundary geometry contains `point` on `pageIndex`.
 *
 * Nested controls that share the same content box resolve to the deepest nesting depth.
 */
export function contentControlAtPoint(
  layout: SemanticLayout,
  pageIndex: number,
  point: HitPoint
): ContentControlBoundaryRecord | null {
  const controls = layout.contentControls ?? [];
  let best: ContentControlBoundaryRecord | null = null;
  for (const control of controls) {
    for (const fragment of control.fragments) {
      if (fragment.pageIndex !== pageIndex) continue;
      if (!contains(fragment.box, point)) continue;
      if (!best || control.nestingDepth > best.nestingDepth) best = control;
    }
  }
  return best;
}

function contentControlIdAtPoint(
  layout: SemanticLayout,
  pageIndex: number,
  point: HitPoint
): string | null {
  return contentControlAtPoint(layout, pageIndex, point)?.id ?? null;
}

/**
 * The block a point means, then the position within it.
 *
 * A paragraph's box starts at its left INDENT, so the indent strip — the most common place to
 * click when aiming at the start of a line — is outside every box on the page. Nearest-box
 * with a weighted vertical axis is what recovers the intended paragraph there.
 */
function resolveBlocks(
  blocks: readonly BlockFragmentRecord[],
  point: HitPoint,
  context: HitContext,
  cell: TableCellAddress | null
): SemanticHit | null {
  if (blocks.length === 0) return null;

  // A collapsed section mark keeps a fragment for the caret, but it shows nothing and takes no
  // flow height, so it overlaps the next section's first line. A press reaches it only when no
  // other block on the page can answer.
  const marks = blocks.filter(isCollapsedSectionMark);
  if (marks.length > 0 && marks.length < blocks.length) {
    const others = blocks.filter((block) => !isCollapsedSectionMark(block));
    return (
      resolveBlocks(others, point, context, cell) ?? resolveBlocks(marks, point, context, cell)
    );
  }

  // Positioned paragraphs may overlap. Resolve their shared band in reverse paint order,
  // including ordinary anchor text painted after them. Keep ordinary flow's edge rules.
  if (
    blocks.some(
      (block) => block.kind === 'paragraph' && block.outOfFlow && contains(block.box, point)
    )
  ) {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index]!;
      if (!contains(block.box, point)) continue;
      const hit = resolveOneBlock(block, point, context, cell);
      if (hit) return hit;
    }
  }

  // Containment first, and HALF-OPEN, so a point exactly on the edge two stacked blocks share
  // belongs to the lower one — the same rule the line bands use, decided by construction
  // rather than by a tolerance. Distance alone cannot express it: the shared edge is zero
  // away from both boxes, and first-wins would silently hand it to the block above.
  let contained: BlockFragmentRecord | null = null;
  for (const block of blocks) {
    if (!contains(block.box, point)) continue;
    contained = block;
    const hit = resolveOneBlock(block, point, context, cell);
    if (hit) return hit;
    break;
  }

  // Nearest-first, and it keeps going. A block CAN fail to answer — a table fragment that
  // paints nothing but vertical-merge continuations holds no text at all — and stopping at
  // the first refusal is what turned those pages into dead clicks, which is never the right
  // answer for a press.
  const ranked = blocks
    .filter((block) => block !== contained)
    .map((block) => ({ block, score: blockDistance(block, point, context.verticalWeight) }))
    .sort((left, right) => left.score - right.score);
  for (const { block } of ranked) {
    const hit = resolveOneBlock(block, point, context, cell);
    if (hit) return hit;
  }
  return null;
}

function resolveOneBlock(
  block: BlockFragmentRecord,
  point: HitPoint,
  context: HitContext,
  cell: TableCellAddress | null
): SemanticHit | null {
  if (block.kind !== 'paragraph') return resolveTable(block, point, context, cell);
  // A hanging first line paints outside the box, and a press on that text is on the text.
  // A clipped box hides everything outside it, and its content bounds are the box.
  const inside = contains(paragraphContentBounds(block), point);
  return resolveParagraph(block, point, context, cell, inside);
}

function resolveParagraph(
  fragment: ParagraphFragmentRecord,
  point: HitPoint,
  context: HitContext,
  cell: TableCellAddress | null,
  insideBox: boolean
): SemanticHit | null {
  if (fragment.clipToBox && !insideBox) return null;
  const line = lineAtY(fragment.lines, point.y);
  if (!line || lineSegments(line).length === 0) return null;
  const resolved = offsetOnLine(line, point.x, point.y, context, paragraphIsRtl(fragment.props));
  // WHICH paragraph the pointer is over, not which one the line is named after. A resolved
  // display mode merges the paragraphs a tracked decision merges, so one line can carry two,
  // and the offset the walk just resolved counts in the one under the pointer.
  const segment = segmentAtX(line, point.x);
  // The offset comes from a walk over the WHOLE line and the paragraph from the segment under
  // the pointer, so on a merged line the two are counted in different paragraphs. Clamping
  // ties them back together: a click past the end of the line lands at the end of the
  // paragraph the pointer is over, not at an offset that paragraph does not have.
  const offset = Math.min(Math.max(resolved.offset, segment.start), segment.end);
  const position: SemanticPosition = { paragraphId: segment.paragraphId, offset };
  const box = caretBoxOnLine(line, offset, context.measurer, segment);
  // Beside a picture the side a point resolves to and the caret drawn for that offset can be
  // apart (a float's jump, or a bidi boundary); the caret drawn for the offset is the answer.
  const caretBox = clipParagraphBox(
    { ...box, x: line.drawings?.length ? box.x : resolved.x, width: 0 },
    fragment.clipToBox ? fragment.box : undefined
  );
  if (!caretBox) return null;
  const inBand = point.y >= line.box.y && point.y < line.box.y + line.box.height;
  return {
    position,
    caret: {
      position,
      x: caretBox.x,
      y: caretBox.y,
      height: caretBox.height,
      lineId: line.id,
      pageIndex: context.pageIndex,
    },
    pageIndex: context.pageIndex,
    lineId: line.id,
    cell,
    // The LINE's band, not the block's: a paragraph with trailing space is taller than its
    // text, and a point in that space is not on a glyph however far inside the block it is.
    onGlyphs: insideBox && resolved.withinSpan && inBand,
    // Filled by {@link hitTestPage} once the point is known; keep null on the inner path.
    contentControlId: null,
    drawing: resolved.drawing && resolved.withinSpan ? drawingHitIdentity(resolved.drawing) : null,
  };
}

/**
 * The line a y belongs to, clamped into the fragment.
 *
 * Banding here is purely vertical and never weighted: lines within one paragraph are stacked,
 * so letting horizontal distance participate would let a long line two rows down outvote the
 * short one the pointer is actually level with. Bands are half-open, so a point exactly on a
 * shared edge belongs to the lower line with no epsilon anywhere.
 */
function lineAtY(lines: readonly LineRecord[], y: number): LineRecord | null {
  if (lines.length === 0) return null;
  for (const line of lines) {
    if (y >= line.box.y && y < line.box.y + line.box.height) return line;
  }
  // Between lines, above the first, or below the last: the nearest band, earliest on a tie.
  // This is the clamp that makes a click in the whitespace under a paragraph land at its end
  // rather than doing nothing.
  let best = lines[0]!;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const gap = y < line.box.y ? line.box.y - y : y - (line.box.y + line.box.height);
    if (gap < bestGap) {
      bestGap = gap;
      best = line;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------
// Within a line
// ---------------------------------------------------------------------------------------

interface LineOffset {
  readonly offset: number;
  readonly x: number;
  /** False when the point was outside every span — a margin, an indent, a justification gap. */
  readonly withinSpan: boolean;
  readonly drawing?: InlineDrawingRecord | null;
}

function drawingHitIdentity(drawing: InlineDrawingRecord): SemanticHitDrawing {
  return Object.freeze({
    drawingNodeId: drawing.drawingNodeId,
    // The drawing's own paragraph. On a merged line the record names a member, and the line
    // names whichever member starts it.
    paragraphId: drawing.paragraphId,
    start: drawing.start,
  });
}

/**
 * The segment of a line an x falls in.
 *
 * Answers the FIRST segment on a line with one, which is every ordinary line. Otherwise the
 * last segment that begins at or before the point, so a click past the end of the line lands
 * in the paragraph that ends it rather than the one that starts it.
 */
function segmentAtX(line: LineRecord, x: number): LineSegment {
  const segments = lineSegments(line);
  const bidiSpan = nearestBidiSpan(line.spans, x);
  if (bidiSpan) {
    const owner = segments.find((segment) => segment.paragraphId === bidiSpan.range.paragraphId);
    if (owner) return owner;
  }
  let found = segments[0]!;
  for (const segment of segments) {
    const first = segment.spans[0];
    if (first === undefined) continue;
    const last = segment.spans[segment.spans.length - 1]!;
    if (x >= first.box.x) found = segment;
    if (x < last.box.x + last.box.width) break;
  }
  return found;
}

/** The position a point over a picture's advance means: the side of the picture it is on. */
function pictureHit(drawing: InlineDrawingRecord, x: number, y: number): LineOffset {
  const after = x >= drawing.x + drawing.width / 2 !== pictureIsRtl(drawing);
  return {
    offset: after ? drawing.start + 1 : drawing.start,
    x: pictureEdgeX(drawing, after),
    withinSpan: hitBoundsContainDrawing(drawing, { x, y }),
    drawing,
  };
}

function hitBoundsContainDrawing(
  drawing: InlineDrawingRecord | AnchoredDrawingRecord,
  point: HitPoint
): boolean {
  if (drawing.accessibility.hidden) return false;
  const box = drawing.hitBounds;
  // A vector shape takes a press on what it paints: its fill, and its path or outline within
  // reach. A press beside a line, or inside a shape with no fill, goes to the text. A turned
  // shape paints outside its box too, as far as its turned extent reaches, and a shape that
  // paints outside its extent, such as a callout's tail, as far as its ink reaches.
  const reach = PATH_HIT_REACH + maxStrokeHalfWidth(drawing);
  const ink = drawing.vectorShape?.overflowVisible
    ? vectorShapeInkClip(drawing, drawing.paintBounds)
    : null;
  const near = unionBox(unionBox(box, turnedShapeBounds(drawing)), ink);
  if (
    point.x < near.x - reach ||
    point.x > near.x + near.width + reach ||
    point.y < near.y - reach ||
    point.y > near.y + near.height + reach
  )
    return false;
  const vector = vectorShapeHit(drawing, point);
  if (vector !== null) return vector;
  if (
    point.x < box.x ||
    point.x >= box.x + box.width ||
    point.y < box.y ||
    point.y >= box.y + box.height
  )
    return false;
  // A text box that paints past its frame takes a press on its frame, its text, or the shape
  // it paints there, whatever its effect extent reserves; the gesture follows the same rule.
  if (textboxPaintsPastFrame(drawing)) return textboxPressReaches(drawing, point);
  return pointInDrawingClip(point.x, point.y, drawing.geometry);
}

/** Half the widest outline a drawing's vector shape paints, in points; 0 for no shape. */
function maxStrokeHalfWidth(drawing: InlineDrawingRecord | AnchoredDrawingRecord): number {
  let widest = 0;
  for (const component of drawing.vectorShape?.components ?? [])
    widest = Math.max(widest, component.strokeWidthEmu);
  return widest / 12_700 / 2;
}

/**
 * Where on a line an x means.
 *
 * SPAN boxes are the authority, never `line.box.x`: alignment is baked into the span boxes, so
 * a centred or right-aligned line starts well right of its line box and using the line box
 * would report every such click as "left of the line". With no spans to read, the aligned
 * origin comes from {@link LineRecord.contentX}, which obeys the same rule.
 */
function offsetOnLine(
  line: LineRecord,
  x: number,
  y: number,
  context: HitContext,
  paragraphRtl = false
): LineOffset {
  const spans = line.spans;
  for (const drawing of line.drawings ?? []) {
    if (hitBoundsContainDrawing(drawing, { x, y })) {
      return {
        offset: drawing.start,
        x: pictureEdgeX(drawing, false),
        withinSpan: true,
        drawing,
      };
    }
  }
  if (spans.length === 0 && (line.drawings?.length ?? 0) > 0) {
    // Pictures only. Beyond either end the line's own start or end answers, which also covers
    // content that paints no box before or after the pictures, such as a hidden run.
    let leftmost = line.drawings![0]!;
    let rightmost = leftmost;
    for (const item of line.drawings!) {
      if (item.advanceStart < leftmost.advanceStart) leftmost = item;
      if (item.advanceEnd > rightmost.advanceEnd) rightmost = item;
      if (x >= item.advanceStart && x < item.advanceEnd) return pictureHit(item, x, y);
    }
    const beyond = beyondLine(
      line,
      leftmost.advanceStart,
      rightmost.advanceEnd,
      x,
      context,
      paragraphRtl,
      { left: leftmost, right: rightmost }
    );
    return beyond ?? gapOffset(line, spans, x, context);
  }
  if (spans.length === 0) {
    // An empty paragraph still has a position to click into, and it is the line's ALIGNED
    // origin: clicking a centred empty paragraph must not park the caret at the left margin.
    return { offset: line.range.start, x: line.contentX, withinSpan: false };
  }

  const bidiSpan = nearestBidiSpan(spans, x);
  // A picture on a shaped line has its own side to give before the nearest text answers, and
  // so does a point beyond either end of the line; see `beyondLine`.
  if (bidiSpan) {
    for (const drawing of line.drawings ?? []) {
      if (x >= drawing.advanceStart && x < drawing.advanceEnd) return pictureHit(drawing, x, y);
    }
    const edges = lineContentEdges(spans, line.drawings ?? [])!;
    const pictureAt = (edge: number) =>
      line.drawings?.find(
        (drawing) =>
          Math.abs(drawing.advanceStart - edge) < 0.001 ||
          Math.abs(drawing.advanceEnd - edge) < 0.001
      );
    const beyond = beyondLine(line, edges.left, edges.right, x, context, paragraphRtl, {
      left: pictureAt(edges.left),
      right: pictureAt(edges.right),
    });
    if (beyond) return beyond;
  }
  if (bidiSpan) {
    const candidate = offsetWithinSpan(
      bidiSpan,
      Math.max(bidiSpan.box.x, Math.min(x, bidiSpan.box.x + bidiSpan.box.width)),
      context
    );
    const segment = lineSegments(line).find(
      (entry) => entry.paragraphId === bidiSpan.range.paragraphId
    );
    // Merged display lines carry independent offset spaces. Trim only this member's tail.
    const ownedLine = lineForSegment(line, segment);
    const offset = Math.min(candidate.offset, lineEndOffset(context.layout, ownedLine));
    return offset === candidate.offset
      ? candidate
      : { ...candidate, offset, x: caretBoxOnLine(line, offset, context.measurer, segment).x };
  }
  // The line starts at its first content, which can be an inline picture before the text. A
  // point over that picture's advance is decided by the drawing checks below.
  if (x <= line.contentX) return { offset: line.range.start, x: line.contentX, withinSpan: false };

  // The line ends at its last content, which can be an inline picture after the text.
  const rightEdge = lineContentEdges(spans, line.drawings ?? [])!.right;
  if (x >= rightEdge) return endOfLine(line, rightEdge, context);

  // Text owns its published box. Check every text box before looking at drawing gaps:
  // otherwise a later inline image can claim text that lies between earlier images.
  for (const [index, span] of spans.entries()) {
    // A shrunk space ends where the next span starts.
    const next = spans[index + 1];
    let end = span.box.x + span.box.width;
    if (next && next.box.x < end && next.box.x > span.box.x && endsWithSpaceSlot(span.text))
      end = next.box.x;
    if (x >= span.box.x && x < end) {
      return snapToSoundMarkCluster(
        offsetWithinSpan(span, x, context),
        x,
        line.range.start,
        (offset) => characterAt(line, offset),
        (offset) => caretBoxOnLine(line, offset, context.measurer).x
      );
    }
  }

  for (const drawing of line.drawings ?? []) {
    if (x >= drawing.advanceStart && x < drawing.advanceEnd) return pictureHit(drawing, x, y);
  }
  return gapOffset(line, spans, x, context);
}

function endOfLine(line: LineRecord, rightEdge: number, context: HitContext): LineOffset {
  const offset = lineEndOffset(context.layout, line);
  if (offset === line.range.end) return { offset, x: rightEdge, withinSpan: false };
  // The end moved back over a break, so the caret's x moves back with it — into whichever
  // span now CONTAINS that offset, never the far right edge of the last span.
  for (let index = line.spans.length - 1; index >= 0; index -= 1) {
    const span = line.spans[index]!;
    if (offset < span.range.start) continue;
    const within = offset - span.range.start;
    const width = context.measurer
      ? prefixWidth(span, within, context.measurer)
      : span.box.width *
        (span.range.end > span.range.start ? within / (span.range.end - span.range.start) : 0);
    return { offset, x: span.box.x + width, withinSpan: false };
  }
  return { offset, x: rightEdge, withinSpan: false };
}

/**
 * Logical line end, excluding a hard break, whose following position belongs to the next line.
 * Trailing spaces of a soft wrap stay on the line: the end is after them, where End puts the
 * caret, and the caret shows on this line through its line affinity. Page breaks are excluded
 * even on the paragraph's last line.
 */
export function lineEndOffset(layout: SemanticLayout, line: LineRecord): number {
  const end = line.range.end;
  if (end > line.range.start && characterAt(line, end - 1) === PAGE_BREAK_CHAR) return end - 1;
  if (hitIndex(layout).lastLineIdOfParagraph.get(line.range.paragraphId) === line.id) {
    return end;
  }
  if (end > line.range.start && characterAt(line, end - 1) === '\n') return end - 1;
  return end;
}

/** The character at a model offset, or null when the span's text is not a 1:1 projection. */
function characterAt(line: LineRecord, offset: number): string | null {
  for (const span of line.spans) {
    if (offset < span.range.start || offset >= span.range.end) continue;
    // A span whose painted text is a substitution (a tab, a field result) does not map offset
    // to index, and guessing would trim a character that is not a space at all.
    if (span.text.length !== span.range.end - span.range.start) return null;
    return span.text[offset - span.range.start] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Within a span
// ---------------------------------------------------------------------------------------

const boundaryCache = new WeakMap<
  StyleSpanRecord,
  { epoch: number; boundaries: readonly number[] }
>();
/**
 * Keyed on the MEASURER first.
 *
 * Widths depend on who measured, so a cache keyed on the span alone serves the first
 * measurer's numbers to every later one — and two ports over one layout is exactly what a
 * second surface, or a headless probe, does.
 */
const prefixCache = new WeakMap<TextMeasurer, WeakMap<StyleSpanRecord, Map<number, number>>>();

/** Grapheme boundaries of a span's text, as UTF-16 offsets within it. */
function boundariesOf(span: StyleSpanRecord): readonly number[] {
  // Segmentation is replaceable, and `grapheme.ts` states the rule: a cache whose value
  // depends on it must carry the epoch in its key rather than trust anyone to clear it.
  const epoch = graphemeBoundaryEpoch();
  const cached = boundaryCache.get(span);
  if (cached && cached.epoch === epoch) return cached.boundaries;
  const boundaries: number[] = [0];
  for (const segment of segmentGraphemes(span.text)) boundaries.push(segment.utf16To);
  if (boundaries[boundaries.length - 1] !== span.text.length) boundaries.push(span.text.length);
  boundaryCache.set(span, { epoch, boundaries });
  return boundaries;
}

/**
 * Advance width of a span's first `utf16` code units.
 *
 * Memoized per span record as well as inside the measurer, because a drag re-crosses the same
 * span dozens of times and the binary search asks for the same handful of boundaries each
 * time. The record is immutable and retained by the layout, so the entry lives exactly as long
 * as the geometry it describes.
 */
function prefixWidth(span: StyleSpanRecord, utf16: number, measurer: TextMeasurer): number {
  const edges = span.caretEdges;
  if (edges && utf16 >= 0 && utf16 < edges.length) return edges[utf16]!;
  if (span.style.shaping) return bidiPrefixWidth(span, utf16, measurer);

  let perSpan = prefixCache.get(measurer);
  if (!perSpan) {
    perSpan = new WeakMap<StyleSpanRecord, Map<number, number>>();
    prefixCache.set(measurer, perSpan);
  }
  let widths = perSpan.get(span);
  if (!widths) {
    widths = new Map<number, number>();
    perSpan.set(span, widths);
  }
  const cached = widths.get(utf16);
  if (cached !== undefined) return cached;
  // As DRAWN, matching `caretEdges` and the advance `breakParagraph` reserved: a `w:caps`
  // run paints uppercase, and measuring the source text would disagree with both.
  const measured =
    utf16 <= 0
      ? 0
      : measureDisplayText(
          span.text.slice(0, utf16),
          styleForFontSlot(span.style, span.fontSlot),
          measurer
        );
  const width = span.lineEndWhitespace ? Math.min(measured, span.box.width) : measured;
  widths.set(utf16, width);
  return width;
}

/**
 * True when the span's painted advance is owned by layout, not by measuring `span.text`.
 *
 * Tabs keep a 1:1 `\t` model range but a stop-sized box; measuring U+0009 returns a narrow
 * native advance and would place the caret after a right/center/decimal/left tab next to the
 * preceding run instead of at the aligned destination. Projected fields and other non-1:1
 * substitutions are the same class.
 */
function usesPublishedAdvance(span: StyleSpanRecord): boolean {
  if (span.text === '\t' || span.projected) return true;
  return span.text.length !== span.range.end - span.range.start;
}

/**
 * The x of a model offset inside a span — the inverse of {@link offsetWithinSpan}.
 *
 * Shares the measurement, and the cache, with the hit test. Interpolating across the span's
 * advance instead is exact only for a uniform one: in a proportional face the caret for
 * offset 4 of an 8-character span is drawn at half its width, which lands in the middle of a
 * glyph rather than between two.
 */
export function spanOffsetX(
  span: StyleSpanRecord,
  offset: number,
  measurer: TextMeasurer | undefined
): number {
  const length = span.range.end - span.range.start;
  if (length <= 0) return span.box.x;
  const within = Math.max(0, Math.min(offset - span.range.start, length));
  const physical = (advance: number) =>
    span.box.x + (span.style.shaping?.direction === 'rtl' ? span.box.width - advance : advance);
  // Published cluster edges win WHEN PRESENT (a producer may attach them); layout itself
  // measures prefixes on demand instead of publishing eager per-character arrays.
  const edges = span.caretEdges;
  if (edges && within < edges.length) return span.box.x + edges[within]!;
  // Layout-owned advances (tabs, projected fields): always use the published box. Measuring
  // `\t` or multi-digit PAGE ink would disagree with breakParagraph's stop geometry.
  if (!measurer || usesPublishedAdvance(span)) {
    return physical(span.box.width * (within / length));
  }
  return physical(prefixWidth(span, within, measurer));
}

/**
 * Where a caret sits on a line: its x, and the box it should be drawn at.
 *
 * The height comes from the RUN at the insertion point, not from the line. A line is as tall
 * as its largest run, so a caret in 11pt text on a line that also carries 36pt text was drawn
 * three times the height of the text it sits in. Word sizes the insertion point to the run it
 * would type into, which is also how the painter already draws the selection band: every run
 * is its own inline box, and the band steps with the text.
 *
 * Affinity at a shared model boundary:
 *   - after a layout-sized atom (tab / projected field), prefer the DOWNSTREAM span so the
 *     caret sits at the aligned destination (e.g. before CONFIDENTIAL after a right tab),
 *     matching hit-testing and caretStops;
 *   - otherwise the run BEFORE the offset wins — the run a keystroke would continue —
 *     except at the start of the line, where there is nothing before it.
 */
export function caretBoxOnLine(
  line: LineRecord,
  offset: number,
  measurer: TextMeasurer | undefined,
  segment?: {
    readonly spans: readonly StyleSpanRecord[];
    readonly drawings: readonly InlineDrawingRecord[];
  } | null
): { x: number; y: number; height: number } {
  // A merged line carries two paragraphs, and an offset means something in only one of them.
  // Without a segment the line IS the segment, which is every ordinary line.
  const drawing = drawingAtOffset(line, offset, segment);
  if (drawing) {
    return {
      x: pictureEdgeX(drawing, offset > drawing.start),
      // Drawing records are page-relative once semantic layout places them; line.box.y is
      // already folded into drawing.y.
      y: drawing.y,
      height: drawing.height,
    };
  }
  const spans = segment ? segment.spans : line.spans;
  if (spans.length === 0) {
    // An empty paragraph paints no run to size the caret against, so the LINE is all there
    // is — but the line box on a spaced paragraph is mostly spacing, and taking it whole
    // draws a double-spaced empty line a caret twice the height of the text it would type.
    //
    // Both numbers are READ, never recovered from the box: `leading` is the `exact`-rule
    // space above the band and `trailingSpacing` is the `auto` depth below it.
    // Subtracting `leading` alone was right only while every rule put its extra above — the
    // rules that put it below leave `leading` at zero, so the whole spaced box read as text.
    const leading = line.leading ?? 0;
    const band = Math.max(0, line.box.height - leading - (line.trailingSpacing ?? 0));
    // A line with NO BOX AT ALL — height zero, not merely a box its spacing consumes — is
    // the empty `w:p` a cell must end with after a nested table. It takes no flow height, so
    // there is no band to size a caret from, and falling through to zero paints a 0px caret
    // while the pages layer keeps the native one transparent: the user types blind into a
    // paragraph they cannot see. The ascent the line was measured at is what a caret in it
    // should be, and it survives the collapse for exactly this.
    //
    // End at the collapse point so the caret remains inside the owning row.
    // Growing downward would paint over the following table or paragraph.
    //
    // The terminator keeps its own authored horizontal alignment, even over a preceding
    // table: this is where subsequent typed text will appear.
    //
    // Restricted to a zero box on purpose. A spanless line whose `leading` and
    // `trailingSpacing` happen to consume it is an ordinary spaced empty paragraph that
    // still occupies its row, and it keeps the answer it has always had.
    if (band <= 0 && line.box.height <= 0) {
      const fallback = Math.max(0, line.baseline);
      return { x: line.contentX, y: line.box.y - fallback, height: fallback };
    }
    return { x: line.contentX, y: line.box.y + leading, height: band };
  }
  let chosen = spans[0]!;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (offset > span.range.start && offset < span.range.end) {
      chosen = span;
      break;
    }
    if (offset === span.range.end) {
      const next = spans[index + 1];
      // Shaped caret stops use downstream affinity at a shared logical boundary.
      if (next?.range.start === offset && span.style.shaping && next.style.shaping) {
        chosen = next;
        break;
      }
      // Trailing edge of a tab/field: downstream affinity — same model offset as the next
      // span's start, but the visual insertion point belongs with the following text. So too
      // after a page break with text beside it, which only a table cell (that ignores it) has.
      const ignoredBreak = span.text === PAGE_BREAK_CHAR && span.box.width === 0;
      if (next && next.range.start === offset && (usesPublishedAdvance(span) || ignoredBreak)) {
        chosen = next;
        break;
      }
      // After an expandable space, prefer the next span only when layout left a justify
      // gap. That gap is what paint draws as `word-spacing`; sitting on the upstream end
      // lands inside the stretched space. With no gap (unjustified, or a mere run split
      // after a space), keep upstream affinity so typing continues the preceding run.
      // Between other characters only alignment opens a gap (East Asian justification, or
      // a distributed line spread per character), and the caret sits after it, before the
      // next character, as it does after character spacing.
      if (next && next.range.start === offset) {
        const cjk = isCjk(lastCodePointOf(span.text) ?? 0) || isCjk(next.text.codePointAt(0) ?? 0);
        const gap = next.box.x - (span.box.x + span.box.width) - (next.wrapAdvanceBefore ?? 0);
        const spaceSlot = endsWithSpaceSlot(span.text);
        // A shrunk space overlaps the next span, which starts where the painted space ends.
        if ((spaceSlot && (gap > 0.25 || gap < -0.001)) || ((cjk || !spaceSlot) && gap > 0.001)) {
          chosen = next;
          break;
        }
      }
      chosen = span;
    } else if (offset > span.range.end) {
      chosen = span;
    } else if (
      offset === span.range.start &&
      !spans.some(
        (other) =>
          other.range.paragraphId === span.range.paragraphId &&
          other.range.end === offset &&
          other.range.start < offset
      )
    ) {
      // Nothing ends here (a picture or hidden text came before), so the text that starts
      // here owns the caret rather than the span before the gap.
      chosen = span;
      break;
    }
  }
  const x = justifiedSpaceEndX(spans, chosen, offset) ?? spanOffsetX(chosen, offset, measurer);
  // Span boxes are NOT baseline-aligned — every one of them starts at the line's top, and the
  // painter baseline-aligns the glyphs in CSS. Taking the box directly drew a small run's
  // caret at the top of a tall line, floating above the text it belonged to. Aligning it the
  // way the text is aligned needs the run's own ascent, which is what the measurer answers.
  const metrics = measurer?.lineMetrics(styleForFontSlot(chosen.style, chosen.fontSlot));
  if (!metrics || metrics.height <= 0) {
    return { x, y: line.box.y, height: line.box.height };
  }
  return {
    x,
    // Super and subscript lift the glyphs off the baseline without moving the box, so the
    // caret has to follow them or it is drawn over the text beside it instead of at them.
    y: line.box.y + line.baseline - metrics.baseline - baselineShiftPtOf(chosen.style),
    height: metrics.height,
  };
}

/**
 * The caret between a stretched space and the zero-width spaces after it, on a justified
 * line: at the far end of the painted space (the next span's start), as at the span's end.
 * Only zero-width spaces follow the offset, so both offsets are one visible position.
 */
function justifiedSpaceEndX(
  spans: readonly StyleSpanRecord[],
  span: StyleSpanRecord,
  offset: number
): number | undefined {
  if (offset <= span.range.start || offset >= span.range.end) return undefined;
  if (span.range.end - span.range.start !== span.text.length || span.style.shaping)
    return undefined;
  const tail = span.text.slice(offset - span.range.start);
  if (withoutTrailingZeroWidthSpaces(tail) !== '') return undefined;
  if (!withoutTrailingZeroWidthSpaces(span.text).endsWith(' ')) return undefined;
  const next = spans[spans.indexOf(span) + 1];
  if (!next || next.range.start !== span.range.end) return undefined;
  const gap = next.box.x - (span.box.x + span.box.width) - (next.wrapAdvanceBefore ?? 0);
  return gap > 0.25 || gap < -0.001 ? next.box.x : undefined;
}

function offsetWithinSpan(span: StyleSpanRecord, x: number, context: HitContext): LineOffset {
  const rtl = span.style.shaping?.direction === 'rtl';
  const target = rtl ? span.box.x + span.box.width - x : x - span.box.x;
  const physical = (advance: number) => span.box.x + (rtl ? span.box.width - advance : advance);
  const length = span.range.end - span.range.start;

  // Layout-owned advances are atomic before/after positions.
  if (length <= 0 || usesPublishedAdvance(span)) {
    const after = target > span.box.width / 2;
    return {
      offset: after ? span.range.end : span.range.start,
      x: physical(after ? span.box.width : 0),
      withinSpan: true,
    };
  }

  if (!context.measurer) {
    // Without a measurer, interpolate the published advance.
    const fraction = Math.max(0, Math.min(1, target / Math.max(span.box.width, Number.EPSILON)));
    const raw = Math.round(fraction * length);
    const boundaries = boundariesOf(span);
    let snapped = boundaries[0]!;
    let snappedGap = Number.POSITIVE_INFINITY;
    for (const boundary of boundaries) {
      const gap = Math.abs(boundary - raw);
      if (gap < snappedGap) {
        snappedGap = gap;
        snapped = boundary;
      }
    }
    return {
      offset: span.range.start + snapped,
      x: physical(span.box.width * (snapped / length)),
      withinSpan: true,
    };
  }

  const boundaries = boundariesOf(span);
  // Snap to the nearer grapheme boundary, preferring the earlier one on ties.
  let low = 1;
  let high = boundaries.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (prefixWidth(span, boundaries[mid]!, context.measurer) < target) low = mid + 1;
    else high = mid;
  }
  const right = boundaries[low]!;
  const left = boundaries[low - 1]!;
  const rightWidth = prefixWidth(span, right, context.measurer);
  const leftWidth = prefixWidth(span, left, context.measurer);
  const takeLeft = target - leftWidth <= rightWidth - target;
  return {
    offset: span.range.start + (takeLeft ? left : right),
    x: physical(takeLeft ? leftWidth : rightWidth),
    withinSpan: true,
  };
}

// ---------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------

/**
 * The item whose half-open band contains `coordinate`, else the nearest, earliest on a tie.
 *
 * Used for both rows and columns, which need the same clamp for the same reason: a point in
 * the gap between two rows, or past the last column, still names one of them.
 */
function bandSelect<T>(
  items: readonly T[],
  coordinate: number,
  start: (item: T) => number,
  size: (item: T) => number
): T | null {
  if (items.length === 0) return null;
  for (const item of items) {
    const from = start(item);
    if (coordinate >= from && coordinate < from + size(item)) return item;
  }
  let best: T = items[0] as T;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const from = start(item);
    const gap = coordinate < from ? from - coordinate : coordinate - (from + size(item));
    if (gap < bestGap) {
      bestGap = gap;
      best = item;
    }
  }
  return best;
}

function addressOf(
  layout: SemanticLayout,
  table: TableFragmentRecord,
  row: TableRowFragmentRecord,
  cell: TableCellFragmentRecord
): TableCellAddress {
  return {
    tableId: table.tableId,
    rowId: row.id,
    cellId: cell.id,
    rowIndex: hitIndex(layout).rowIndexById.get(row.id) ?? 0,
    gridColumn: cell.gridColumn,
    gridSpan: cell.gridSpan,
  };
}

function resolveTable(
  table: TableFragmentRecord,
  point: HitPoint,
  context: HitContext,
  outerCell: TableCellAddress | null
): SemanticHit | null {
  void outerCell;
  // A repeated header row is a COPY. Its paragraphs already have caret stops on the page the
  // original sits on, and resolving into one returns a position whose caret and selection
  // paint there instead of where the click was — so interaction ignores repeats, exactly as
  // the records say it should. A fragment that is nothing BUT repeats still has to answer.
  const authored = table.rows.filter((row) => !row.isHeaderRepeat);
  const rows = authored.length > 0 ? authored : table.rows;

  const candidates: MergedCellOrigin[] = [];
  const row = bandSelect(
    rows,
    point.y,
    (item) => item.box.y,
    (item) => item.box.height
  );
  if (row) {
    const hitCell = bandSelect(
      row.cells,
      point.x,
      (item) => item.box.x,
      (item) => item.box.width
    );
    // A continuation paints its box but holds no blocks, so resolving into it directly would
    // find no paragraph. Its origin may be on an EARLIER PAGE, which is why the index tracks
    // merges across the whole layout rather than within this fragment.
    if (hitCell) candidates.push(originOf(context, row, hitCell));
  }

  // Then every other cell that actually holds something, nearest first — an empty cell, or a
  // merge whose origin this layout does not carry, must still put the caret somewhere.
  const rest: { entry: MergedCellOrigin; score: number }[] = [];
  for (const candidateRow of rows) {
    for (const cell of candidateRow.cells) {
      if (cell.blocks.length === 0) continue;
      if (candidates.some((entry) => entry.cell === cell)) continue;
      rest.push({
        entry: { row: candidateRow, cell },
        score: weightedDistance(cell.box, point, context.verticalWeight),
      });
    }
  }
  rest.sort((left, right) => left.score - right.score);

  for (const { row: cellRow, cell } of [...candidates, ...rest.map((item) => item.entry)]) {
    const address = addressOf(context.layout, table, cellRow, cell);
    // Recursing with the SAME point is what makes cell padding work with no rule of its own:
    // the padding is outside every block box, so the nearest-block rule picks the block beside
    // it and the line clamp finishes the job — bottom padding lands at the end of the last
    // block.
    const cellPoint =
      cell.textDirection === 'btLr' ? pointInBottomToTopCell(point, cell.box) : point;
    const hit = resolveBlocks(cell.blocks, cellPoint, context, address);
    if (hit) return hit;
  }
  // This fragment paints no text at all. The caller keeps looking.
  return null;
}

/** The cell whose text is drawn in a cell's box: itself, or the merge it continues. */
function originOf(
  context: HitContext,
  row: TableRowFragmentRecord,
  cell: TableCellFragmentRecord
): MergedCellOrigin {
  if (cell.blocks.length > 0) return { row, cell };
  return hitIndex(context.layout).mergeOriginOf.get(cell) ?? { row, cell };
}
