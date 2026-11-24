import { spanBesideSymbol } from './symbol-run.ts';
import { preferredLineCaret } from './semantic-caret-affinity.ts';
import {
  lineEdgeTarget,
  verticalLineEndTarget,
  verticalStartOnAffineLine,
  type LineEdgeDeps,
  type MoveCaretOptions,
} from './caret-line-edge-navigation.ts';
import { nearestPageWithStops } from './caret-page-step.ts';
import { mergedCaretGroup } from './merged-caret-navigation.ts';
import {
  bidiDirectionOfStop,
  horizontalCaretStep,
  directionThroughGap,
  visualWordBoundary,
  visualLineEdge,
  type VisualCaretStop,
} from './visual-caret-navigation.ts';
// Navigation derives from layout records in both headless and browser adapters.
// Positions use the canonical paragraph id and UTF-16 offset accepted by tree operations.

import { caretBoxOnLine } from './semantic-hit-test.ts';
import { documentOrder, documentOrderIndex } from './document-order.ts';
export { documentOrder, everyStoryOrder } from './document-order.ts';
export { selectionRects, keyedRangeRects, type KeyedRange } from './selection-rects.ts';
import { xWithinLine } from './line-geometry.ts';
import { clipParagraphBox } from './paragraph-frame-clip.ts';
import { lineSegmentFor, lineSegments, segmentOverlap, type LineSegment } from './line-segments.ts';
import type {
  BlockFragmentRecord,
  ContentControlBoundaryRecord,
  LineRecord,
  LayoutBox,
  SemanticLayout,
  StyleSpanRecord,
  TextMeasurer,
} from './semantic-records.ts';
import { contentControlsOfLayout, paragraphFragmentsOf } from './semantic-records.ts';
import {
  indexCaretStops,
  ParagraphCaretStopCache,
  type IndexedCaretStops,
} from './semantic-caret-stop-index.ts';
import {
  moveHorizontalCaret as moveIndexedHorizontalCaret,
  moveToDocumentEdge,
  moveToLineEdge,
  moveVerticalCaret,
  nearestStop,
  lastStopOfParagraph,
  stopInDirection,
} from './semantic-caret-navigation.ts';
import {
  insideDeletedContent,
  paragraphDeletedRanges,
  paragraphLinesIndex,
  paragraphLinesFor,
} from './paragraph-lines.ts';
import { wordBoundary } from './semantic-word-navigation.ts';
import { wordMotionBoundaries } from './word-navigation-boundaries.ts';
export { deletedTextBoundaries } from './word-navigation-boundaries.ts';
import {
  laterLineOwns,
  nextLineStartsAt,
  laterLineWithDrawingAt,
  laterSegmentHolds,
  earlierSegmentHolds,
  headerRepeatLinesOnPage,
  isNonNavigableInterior,
  breakEndsLineBefore,
  isDrawingOnlySegment,
} from './semantic-caret-line.ts';
import { bottomToTopCaretInLayout } from './table-cell-text-direction.ts';

export { wordBoundary } from './semantic-word-navigation.ts';
export { positionPastDeletion } from './paragraph-lines.ts';

/** A caret position in the model. */
export interface SemanticPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/** A caret position with the geometry that renders it. */
export interface CaretGeometry {
  readonly position: SemanticPosition;
  /** Page-relative, in the same coordinate space as the line boxes. */
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly lineId: string;
  readonly pageIndex: number;
}

/**
 * A selection as two semantic positions — never as DOM nodes.
 *
 * `anchor` is where the selection started and `head` is where it currently ends, so `head` before
 * `anchor` is an ordinary backwards selection rather than an error. Collapsed when the two are
 * equal, which is what a caret is.
 */
export interface SemanticSelection {
  readonly anchor: SemanticPosition;
  readonly head: SemanticPosition;
}

/** One painted selection rectangle, in page-relative layout points. */
export interface SelectionRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function pushLineCaretStops(
  stops: CaretGeometry[],
  layout: SemanticLayout,
  line: LineRecord,
  pageIndex: number,
  measurer?: TextMeasurer,
  only?: string,
  clipBox?: LayoutBox
): void {
  for (const segment of lineSegments(line)) {
    if (only !== undefined && segment.paragraphId !== only) continue;
    pushSegmentCaretStops(stops, layout, line, segment, pageIndex, measurer, clipBox);
  }
}

function pushSegmentCaretStops(
  stops: CaretGeometry[],
  layout: SemanticLayout,
  line: LineRecord,
  segment: LineSegment,
  pageIndex: number,
  measurer?: TextMeasurer,
  clipBox?: LayoutBox
): void {
  const mixed = lineSegments(line).length > 1;
  // Paragraph-wide, not this line's own slices: a deletion that wraps is clipped per line,
  // and its wrap boundaries must not read as region edges (see paragraphDeletedRanges).
  const deleted = paragraphDeletedRanges(layout, segment.paragraphId);
  /** Whether some painted span covers this offset — the glyphs the caret would sit between. */
  const painted = (offset: number): boolean =>
    segment.spans.some((span) => span.range.start <= offset && offset <= span.range.end);
  const continuesEarlier =
    segment.start > 0 || earlierSegmentHolds(layout, line, segment.paragraphId, segment.start);
  for (let offset = segment.start; offset <= segment.end; offset += 1) {
    // A position that a LATER line starts at belongs to that line, whether a hard break or
    // a soft wrap ended this one, and `caretAt` places the caret there. Emitting it here too
    // would put the stop this lane navigates to on a different line from the caret the user
    // can see: Home would land after the next line's first character, Down would skip a
    // line opened by a break, and the empty line a trailing Shift+Enter opens would be
    // unreachable because the dedup below discarded its only stop as a duplicate. The end
    // of a wrapped line stays reachable through line affinity (End, a click past the end).
    if (
      offset === segment.end &&
      offset > segment.start &&
      ((!mixed &&
        ((breakEndsLineBefore(line, offset) && laterLineOwns(layout, line, offset)) ||
          nextLineStartsAt(layout, line, offset))) ||
        laterSegmentHolds(layout, line, segment.paragraphId, offset))
    ) {
      continue;
    }
    // A continuation line's first stop is the same model position as the previous
    // line's last, so it is emitted once — by the line that starts there.
    if (offset === segment.start && continuesEarlier && stops.length > 0) {
      const previous = lastStopOfParagraph(stops, segment.paragraphId);
      if (previous?.position.offset === offset) {
        continue;
      }
    }
    if (isNonNavigableInterior(line, offset, segment)) continue;
    // VISIBLE deleted content is fully navigable — Word lets the caret rest between struck
    // characters, and the tracked lane already accepts inserts there (`tree-op-tracked.ts`).
    // What is skipped is a deleted offset the display mode resolved AWAY: in the proposed
    // result those characters paint no span at all, and an offset-by-offset walk would stop
    // at invisible positions. Derived from the spans rather than from the mode, so the rule
    // holds in any mode that suppresses them.
    if (insideDeletedContent(deleted, offset) && !painted(offset)) continue;
    const visible = clipParagraphBox(
      {
        x: xWithinLine(line, offset, measurer, segment),
        y: line.box.y,
        width: 0,
        height: line.box.height,
      },
      clipBox
    );
    if (!visible) continue;
    stops.push(
      bottomToTopCaretInLayout(layout, {
        position: { paragraphId: segment.paragraphId, offset },
        x: visible.x,
        y: visible.y,
        height: visible.height,
        lineId: line.id,
        pageIndex,
      })
    );
  }
}

function visitParagraphFragments(
  layout: SemanticLayout,
  blocks: readonly BlockFragmentRecord[],
  pageIndex: number,
  stops: CaretGeometry[],
  measurer?: TextMeasurer
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      for (const line of block.lines) {
        pushLineCaretStops(
          stops,
          layout,
          line,
          pageIndex,
          measurer,
          undefined,
          block.clipToBox ? block.box : undefined
        );
      }
      continue;
    }
    for (const row of block.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells)
        visitParagraphFragments(layout, cell.blocks, pageIndex, stops, measurer);
    }
  }
}

/**
 * Every caret stop in the document body, in reading order.
 *
 * One per character boundary on every line, plus the line end. Derived rather than stored,
 * so a stop can never survive the content it described. Ownership of a position SHARED by
 * two lines is decided here exactly as `caretAt` decides it. Furniture stories use
 * {@link caretStopsForBlocks} so open header/footer navigation never walks body stops.
 */
const paragraphCaretStopCache = new ParagraphCaretStopCache<CaretGeometry>();

export function caretStops(layout: SemanticLayout, measurer?: TextMeasurer): CaretGeometry[] {
  const stops: CaretGeometry[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        pushLineCaretStops(
          stops,
          layout,
          line,
          page.index,
          measurer,
          undefined,
          fragment.clipToBox ? fragment.box : undefined
        );
      }
    }
  }
  return stops;
}

const mergedCaretStopCache = new ParagraphCaretStopCache<CaretGeometry>();

/** Use connected merged members so physical motion cannot stop at a hidden paragraph mark. */
function navigationCaretStops(
  layout: SemanticLayout,
  paragraphId: string,
  measurer?: TextMeasurer
): IndexedCaretStops<CaretGeometry> {
  const group = mergedCaretGroup(layout, paragraphId);
  if (!group) return paragraphCaretStops(layout, paragraphId, measurer);
  return mergedCaretStopCache.get(layout, group.members[0]!, measurer, () => {
    const stops: CaretGeometry[] = [];
    for (const { line, pageIndex, clipBox } of group.lines)
      pushLineCaretStops(stops, layout, line, pageIndex, measurer, undefined, clipBox);
    return indexCaretStops(stops);
  });
}

function paragraphCaretStops(
  layout: SemanticLayout,
  paragraphId: string,
  measurer?: TextMeasurer
): IndexedCaretStops<CaretGeometry> {
  return paragraphCaretStopCache.get(layout, paragraphId, measurer, () => {
    const stops: CaretGeometry[] = [];
    for (const { line, pageIndex, clipBox } of paragraphLinesFor(layout, paragraphId) ?? []) {
      pushLineCaretStops(stops, layout, line, pageIndex, measurer, paragraphId, clipBox);
    }
    return indexCaretStops(stops);
  });
}

/**
 * Caret stops for one story's block fragments (header/footer), in reading order.
 *
 * Coordinates stay story-relative — the same space `hitTestFragments` and furniture paint
 * use — so arrow motion follows tab-stop geometry and projected field atoms without mixing
 * body sheet offsets.
 */
export function caretStopsForBlocks(
  layout: SemanticLayout,
  pageIndex: number,
  fragments: readonly BlockFragmentRecord[],
  measurer?: TextMeasurer
): CaretGeometry[] {
  if (!layout.pages[pageIndex]) return [];
  const stops: CaretGeometry[] = [];
  visitParagraphFragments(layout, fragments, pageIndex, stops, measurer);
  return stops;
}

/**
 * How caret geometry is resolved.
 *
 * `preferPage` disambiguates a paragraph that paints on SEVERAL pages — a shared header appears
 * once per page, and without a preference the caret could be placed on any of its copies.
 */
export interface CaretAtOptions {
  readonly measurer?: TextMeasurer;
  /**
   * Prefer geometry from this sheet when the same paragraph paints on multiple pages
   * (shared header/footer copies).
   */
  readonly preferredPageIndex?: number;
  /** Prefer this visual line when one model boundary has several painted occurrences. */
  readonly preferredLineId?: string;
}

function resolveCaretAtOptions(measurerOrOptions?: TextMeasurer | CaretAtOptions): CaretAtOptions {
  if (!measurerOrOptions) return {};
  if (typeof (measurerOrOptions as TextMeasurer).measure === 'function') {
    return { measurer: measurerOrOptions as TextMeasurer };
  }
  return measurerOrOptions as CaretAtOptions;
}

/** Geometry for one model position, or null when it is not laid out. */
export function caretAt(
  layout: SemanticLayout,
  position: SemanticPosition,
  measurerOrOptions?: TextMeasurer | CaretAtOptions
): CaretGeometry | null {
  const options = resolveCaretAtOptions(measurerOrOptions);
  const placed = paragraphLinesFor(layout, position.paragraphId) ?? [];
  const preferred = options.preferredPageIndex;
  const repeats =
    preferred === undefined ? [] : headerRepeatLinesOnPage(layout, preferred, position.paragraphId);
  const seen = new Set(placed.map((entry) => entry.line.id));
  const extra = repeats.filter((entry) => !seen.has(entry.line.id));
  const catalog = extra.length > 0 ? [...placed, ...extra] : placed;
  const lineCaret = preferredLineCaret(layout, position, catalog, options);
  if (lineCaret) return lineCaret;
  const ordered =
    preferred === undefined
      ? catalog
      : [...catalog].sort((a, b) => {
          const aHit = a.pageIndex === preferred ? 0 : 1;
          const bHit = b.pageIndex === preferred ? 0 : 1;
          return aHit - bHit;
        });
  // A position at a line's END is also the START of the next one. Without a line
  // preference the caret belongs at the start of the line that begins there: after a HARD
  // BREAK that is the line the user just opened, and at a SOFT WRAP it is where the next
  // typed character lands. The end of the upper line is shown only for a caller that asks
  // for that line (`preferredLineId`: End, or a click past the line's end).
  let afterBreak: { line: LineRecord; pageIndex: number; clipBox?: LayoutBox } | null = null;
  for (const { line, pageIndex, clipBox } of ordered) {
    // The part of the line this paragraph owns. On a merged line that is half of it, and the
    // other half counts its offsets in a different paragraph entirely.
    const segment = lineSegmentFor(line, position.paragraphId);
    if (!segment) continue;
    if (position.offset < segment.start || position.offset > segment.end) continue;
    if (
      position.offset === segment.end &&
      lineSegments(line).length === 1 &&
      (breakEndsLineBefore(line, position.offset) ||
        (position.offset > segment.start &&
          (isDrawingOnlySegment(line, segment) || nextLineStartsAt(layout, line, position.offset))))
    ) {
      // Remember it, but keep looking for the line that STARTS here. Falling back to it
      // keeps a caret placed rather than lost if no such line was laid out — for the
      // drawing-only line, that fallback is exactly the picture-ends-its-paragraph case,
      // where the right edge of the picture IS the answer.
      afterBreak ??= { line, pageIndex, clipBox };
      continue;
    }
    if (
      (position.offset === segment.end &&
        position.offset > segment.start &&
        (laterLineWithDrawingAt(layout, position.paragraphId, position.offset) ||
          laterSegmentHolds(layout, line, position.paragraphId, position.offset, pageIndex))) ||
      (position.offset === segment.start &&
        earlierSegmentHolds(layout, line, position.paragraphId, position.offset, pageIndex))
    ) {
      continue;
    }
    const box = clipParagraphBox(
      { ...caretBoxOnLine(line, position.offset, options.measurer, segment), width: 0 },
      clipBox
    );
    if (!box) continue;
    return bottomToTopCaretInLayout(layout, {
      position,
      x: box.x,
      y: box.y,
      height: box.height,
      lineId: line.id,
      pageIndex,
    });
  }
  if (afterBreak) {
    const box = clipParagraphBox(
      {
        ...caretBoxOnLine(
          afterBreak.line,
          position.offset,
          options.measurer,
          lineSegmentFor(afterBreak.line, position.paragraphId)
        ),
        width: 0,
      },
      afterBreak.clipBox
    );
    if (!box) return null;
    return bottomToTopCaretInLayout(layout, {
      position,
      x: box.x,
      y: box.y,
      height: box.height,
      lineId: afterBreak.line.id,
      pageIndex: afterBreak.pageIndex,
    });
  }
  return null;
}

export { contentControlAtSemantic, hitTestSemantic } from './semantic-point-queries.ts';

/** Layout-published content-control boundaries in document order. */
export function contentControlsInLayout(
  layout: SemanticLayout
): readonly ContentControlBoundaryRecord[] {
  return contentControlsOfLayout(layout);
}

/**
 * Position lookup for one reading order, memoized on the array.
 *
 * The BODY's order is an identity-stable memoized array, so the map survives as long as it
 * does. That is where the cost was: scanning it with `indexOf` meant two O(n) walks per
 * formatting read, on a path that fires on every selection change — measured at 0.12 ms for a
 * selection near the end of a 240-page document, and growing with it.
 *
 * A furniture or note order is rebuilt per call, so the map never hits there and this is a
 * little more work than the scan it replaced. A header's order is a handful of entries, which
 * is why that trade is worth making for the body's twelve thousand.
 */
const orderIndexes = new WeakMap<readonly string[], Map<string, number>>();

function indexPositions(order: readonly string[]): ReadonlyMap<string, number> {
  let index = orderIndexes.get(order);
  if (!index) {
    index = new Map();
    order.forEach((id, at) => {
      if (!index!.has(id)) index!.set(id, at);
    });
    orderIndexes.set(order, index);
  }
  return index;
}

function positionIn(order: readonly string[], paragraphId: string): number {
  return indexPositions(order).get(paragraphId) ?? -1;
}

/**
 * Order a selection's endpoints, against the order of the story they live in.
 *
 * `order` is REQUIRED, here and on every public entry point that calls this. It used to
 * default to the body's `documentOrder`, which meant every new call site was body-blind unless
 * its author remembered — and a two-paragraph selection in a header ranked both endpoints at
 * -1, gave up, and returned null. The reads built on this then answered for the head paragraph
 * alone. Making the caller state the order turns that from a silent wrong answer into a
 * compile error.
 *
 * A caller holding only a layout and a selection passes {@link everyStoryOrder}, published for
 * exactly that: it covers every story, and a selection cannot span two of them.
 */
export function orderPositions(
  selection: SemanticSelection,
  order: readonly string[]
): { from: SemanticPosition; to: SemanticPosition } | null {
  // Same paragraph needs no document-wide order at all.
  if (selection.anchor.paragraphId === selection.head.paragraphId) {
    return selection.anchor.offset <= selection.head.offset
      ? { from: selection.anchor, to: selection.head }
      : { from: selection.head, to: selection.anchor };
  }
  const anchorIndex = positionIn(order, selection.anchor.paragraphId);
  const headIndex = positionIn(order, selection.head.paragraphId);
  if (anchorIndex === -1 || headIndex === -1) return null;
  if (
    anchorIndex < headIndex ||
    (anchorIndex === headIndex && selection.anchor.offset <= selection.head.offset)
  ) {
    return { from: selection.anchor, to: selection.head };
  }
  return { from: selection.head, to: selection.anchor };
}

/**
 * One caret movement, in Word's own vocabulary.
 *
 * Visual rather than logical where the two differ: `left` means left on screen, which in
 * right-to-left text is forward through the string.
 */
export type NavigationCommand =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'wordLeft'
  | 'wordRight'
  | 'lineStart'
  | 'lineEnd'
  | 'documentStart'
  | 'documentEnd'
  | 'pageUp'
  | 'pageDown';

/**
 * The text of one paragraph, read back from the layout records.
 *
 * Word boundaries need characters, and the records carry them: every span holds the text it
 * was laid out from, keyed by the source range it covers. Reading them back keeps word
 * motion in the interaction lane instead of making it a second consumer of the model.
 */
export function paragraphTextFromLayout(layout: SemanticLayout, paragraphId: string): string {
  const pieces: { start: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    // ONLY this paragraph's part of the line. A resolved display mode lays merged paragraphs
    // out together, and both members count their offsets from zero, so reading the line whole
    // reconstructed one paragraph's text from the other's spans — and this IS the surface's
    // `paragraphTextOf`, so the deletion range, the clamp and the word walk all followed it.
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      // A ZERO-WIDTH span stands for something the model does not spell — a `w:ptab`, an
      // empty field projection. It contributes no characters, and a span whose painted text
      // is longer than its model range would make this reconstruction longer than the
      // paragraph actually is. That matters far beyond a stray character: this IS the
      // surface's `paragraphTextOf`, so the deletion range, the clamp and the word walk are
      // all computed from it, and a phantom tab put every one of them past the model's end.
      if (span.range.end === span.range.start) continue;
      // A paragraph that crosses a page produces fragments over the SAME source ranges, so
      // spans can repeat; keyed by range, they contribute once.
      const key = `${span.range.start}:${span.range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // A PROJECTED atom can paint more glyphs than its model range is wide — a document-property
      // field spells "Sample Title" over one model unit. The raw text would make this longer than
      // the model paragraph, and since this IS the surface's `paragraphTextOf` the overshoot lands
      // in Select All, the deletion range and the word walk. Clamp each span to its model width.
      const width = span.range.end - span.range.start;
      const text =
        span.text.length === width ? span.text : span.text.slice(0, width).padEnd(width, ' ');
      pieces.push({ start: span.range.start, text });
    }
    // Inline drawings occupy one UTF-16 unit each; they live on `line.drawings`, not in span
    // text, but selection clamp, Select All, and surface ops read length from here.
    for (const drawing of segment.drawings) {
      const start = drawing.start;
      const end = start + 1;
      const key = `${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push({ start, text: '\uFFFC' });
    }
  }
  pieces.sort((a, b) => a.start - b.start);
  let text = '';
  for (const piece of pieces) {
    // Gaps mean content layout does not render as text (an unknown inline); pad so offsets
    // stay aligned with the model rather than silently shifting every later word.
    if (piece.start > text.length) text += ' '.repeat(piece.start - text.length);
    text = text.slice(0, piece.start) + piece.text;
  }
  return text;
}

/** Story-scoped stops are required when navigating inside an open header or footer. */
export type { MoveCaretOptions } from './caret-line-edge-navigation.ts';

function lineEdgeDeps(
  layout: SemanticLayout,
  measurer?: TextMeasurer,
  stops?: readonly CaretGeometry[]
): LineEdgeDeps {
  return {
    locate: (position, lineId) =>
      caretAt(layout, position, {
        ...(measurer ? { measurer } : {}),
        ...(lineId !== undefined ? { preferredLineId: lineId } : {}),
      }),
    hasStop: ({ paragraphId, offset }) =>
      stops
        ? stops.some((s) => s.position.paragraphId === paragraphId && s.position.offset === offset)
        : (paragraphCaretStops(layout, paragraphId, measurer).index.get(paragraphId)?.has(offset) ??
          false),
  };
}

function moveHorizontalCaret(
  layout: SemanticLayout,
  position: SemanticPosition,
  direction: -1 | 1,
  measurer?: TextMeasurer
): { position: SemanticPosition; desiredX: null } | null {
  const order = documentOrder(layout);
  const orderIndex = documentOrderIndex(layout);
  let paragraphIndex = orderIndex.get(position.paragraphId);
  if (paragraphIndex === undefined) return null;
  const group = mergedCaretGroup(layout, position.paragraphId);
  const indexed = navigationCaretStops(layout, position.paragraphId, measurer);
  const directionOf = (stop: VisualCaretStop) => bidiDirectionOfStop(layout, stop);
  if (group) {
    const stopIndex = indexed.index.get(position.paragraphId)?.get(position.offset);
    const logicalDirection =
      stopIndex === undefined
        ? directionThroughGap(indexed.stops, position, direction, directionOf)
        : horizontalCaretStep(indexed.stops, stopIndex, direction, directionOf).logicalDirection;
    const members = group.members
      .map((id) => orderIndex.get(id))
      .filter((value): value is number => value !== undefined);
    paragraphIndex = logicalDirection === -1 ? Math.min(...members) : Math.max(...members);
  }
  return moveIndexedHorizontalCaret(
    position,
    direction,
    order,
    paragraphIndex,
    (id) => (id === position.paragraphId ? indexed : paragraphCaretStops(layout, id, measurer)),
    directionOf
  );
}

/** Move a caret; vertical movement carries a desired X through shorter lines. */
export function moveCaret(
  layout: SemanticLayout,
  position: SemanticPosition,
  command: NavigationCommand,
  desiredX: number | null = null,
  options: MoveCaretOptions = {}
): {
  position: SemanticPosition;
  desiredX: number | null;
  /**
   * The line the caret shows on after the motion, when it is not the default line for the
   * position (End at a wrap shows on the upper line). Pass it back as
   * {@link MoveCaretOptions.lineId} and as `CaretAtOptions.preferredLineId`.
   */
  lineId?: string;
} | null {
  const directionOf = (stop: VisualCaretStop) => bidiDirectionOfStop(layout, stop);
  if (!options.stops && (command === 'left' || command === 'right')) {
    return moveHorizontalCaret(layout, position, command === 'left' ? -1 : 1, options.measurer);
  }
  if (!options.stops && (command === 'wordLeft' || command === 'wordRight')) {
    const physicalDirection = command === 'wordLeft' ? -1 : 1;
    const indexed = navigationCaretStops(layout, position.paragraphId, options.measurer);
    const stopIndex = indexed.index.get(position.paragraphId)?.get(position.offset);
    const text = paragraphTextFromLayout(layout, position.paragraphId);
    const boundaries = wordMotionBoundaries(layout, position.paragraphId);
    const target =
      stopIndex === undefined
        ? wordBoundary(
            text,
            position.offset,
            directionThroughGap(indexed.stops, position, physicalDirection, directionOf),
            boundaries
          )
        : visualWordBoundary(
            text,
            indexed.stops,
            stopIndex,
            physicalDirection,
            directionOf,
            boundaries
          );
    return target === position.offset
      ? moveHorizontalCaret(layout, position, physicalDirection, options.measurer)
      : { position: { paragraphId: position.paragraphId, offset: target }, desiredX: null };
  }
  if (command === 'lineStart' || command === 'lineEnd') {
    // Home and End read the LOGICAL edges of the caret's own line, in every story.
    const deps = lineEdgeDeps(layout, options.measurer, options.stops);
    const direction = command === 'lineStart' ? -1 : 1;
    const edge = lineEdgeTarget(layout, position, direction, options.lineId, deps);
    if (edge) return { ...edge, desiredX: null };
  }
  if (!options.stops && (command === 'lineStart' || command === 'lineEnd')) {
    // Home and End mean the ends of the LINE a reader sees. One paragraph's stops describe
    // that line only while the line holds one paragraph: on a line a resolved view merged,
    // they stopped at the member boundary, in the middle of the text on screen.
    const target = moveToLineEdge(
      position,
      command === 'lineStart' ? -1 : 1,
      navigationCaretStops(layout, position.paragraphId, options.measurer),
      directionOf
    );
    return target ? { position: target, desiredX: null } : null;
  }
  if (!options.stops && (command === 'documentStart' || command === 'documentEnd')) {
    const target = moveToDocumentEdge(
      command === 'documentStart' ? -1 : 1,
      documentOrder(layout),
      (paragraphId) => paragraphCaretStops(layout, paragraphId, options.measurer)
    );
    return target ? { position: target, desiredX: null } : null;
  }
  if (!options.stops && (command === 'up' || command === 'down')) {
    const paragraphIndex = documentOrderIndex(layout).get(position.paragraphId);
    if (paragraphIndex === undefined) return null;
    const deps = lineEdgeDeps(layout, options.measurer);
    const start = verticalStartOnAffineLine(position, options.lineId, deps);
    const moved = moveVerticalCaret(
      start?.position ?? position,
      command === 'up' ? -1 : 1,
      desiredX ?? start?.x ?? null,
      documentOrder(layout),
      paragraphIndex,
      (paragraphId) => paragraphCaretStops(layout, paragraphId, options.measurer)
    );
    const end = moved && verticalLineEndTarget(layout, moved.position, moved.desiredX, deps);
    return end ? { ...end, desiredX: moved!.desiredX } : moved;
  }
  const stops = options.stops ?? caretStops(layout, options.measurer);
  if (stops.length === 0) return null;
  let index = stops.findIndex(
    (stop) =>
      stop.position.paragraphId === position.paragraphId && stop.position.offset === position.offset
  );
  if (index === -1) {
    // NO stop owns this position — a gesture endpoint left inside deleted content, whose
    // interior is deliberately not navigable. Refusing made every key from there a dead
    // press. For horizontal motion the nearest stop in the direction of travel IS the move;
    // everything else proceeds from the nearest stop of the same paragraph.
    if (command === 'left' || command === 'right') {
      const resolved =
        stopInDirection(
          stops,
          position,
          directionThroughGap(stops, position, command === 'left' ? -1 : 1, directionOf)
        ) ?? nearestStop(stops, position);
      return resolved ? { position: resolved.position, desiredX: null } : null;
    }
    const resolved = nearestStop(stops, position);
    if (!resolved) return null;
    index = stops.indexOf(resolved);
  }
  const current = stops[index]!;

  switch (command) {
    case 'left':
    case 'right': {
      const next =
        horizontalCaretStep(stops, index, command === 'left' ? -1 : 1, (stop) =>
          bidiDirectionOfStop(layout, stop)
        ).target ?? current;
      return { position: next.position, desiredX: null };
    }
    case 'lineStart': {
      return {
        position: visualLineEdge(stops, current, -1, directionOf).position,
        desiredX: null,
      };
    }
    case 'lineEnd': {
      return {
        position: visualLineEdge(stops, current, 1, directionOf).position,
        desiredX: null,
      };
    }
    case 'wordLeft':
    case 'wordRight': {
      const text = paragraphTextFromLayout(layout, position.paragraphId);
      const target = visualWordBoundary(
        text,
        stops,
        index,
        command === 'wordLeft' ? -1 : 1,
        directionOf,
        wordMotionBoundaries(layout, position.paragraphId)
      );
      // Already at the paragraph edge: step into the neighbouring paragraph the way a plain
      // arrow would, so the key is never a dead press at a boundary.
      if (target === position.offset) {
        const next =
          horizontalCaretStep(stops, index, command === 'wordLeft' ? -1 : 1, (stop) =>
            bidiDirectionOfStop(layout, stop)
          ).target ?? current;
        return { position: next.position, desiredX: null };
      }
      return { position: { paragraphId: position.paragraphId, offset: target }, desiredX: null };
    }
    case 'documentStart':
      return { position: stops[0]!.position, desiredX: null };
    case 'documentEnd':
      return { position: stops[stops.length - 1]!.position, desiredX: null };
    case 'pageUp':
    case 'pageDown': {
      // A page IS a unit here: this moves to the next sheet with text rather than guessing a
      // line count, and keeps the column position across the jump, like an arrow key does.
      const targetX = desiredX ?? current.x;
      const step = command === 'pageUp' ? -1 : 1;
      const targetPage = nearestPageWithStops(stops, current.pageIndex, step);
      const onTarget = stops.filter((stop) => stop.pageIndex === targetPage);
      if (onTarget.length === 0) {
        // Off the first or last sheet: the document edge, which is what every editor does
        // rather than refusing the key.
        const edge = command === 'pageUp' ? stops[0]! : stops[stops.length - 1]!;
        return { position: edge.position, desiredX: targetX };
      }
      // The stop nearest the SAME point on the target sheet, both axes: the caret should
      // land where the eye expects it, not at the top of the page.
      let best = onTarget[0]!;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const stop of onTarget) {
        const distance = Math.abs(stop.y - current.y) * 1000 + Math.abs(stop.x - targetX);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = stop;
        }
      }
      return { position: best.position, desiredX: targetX };
    }
    case 'up':
    case 'down': {
      const targetX = desiredX ?? current.x;
      const lineIds: string[] = [];
      const seenLineIds = new Set<string>();
      for (const stop of stops) {
        if (seenLineIds.has(stop.lineId)) continue;
        seenLineIds.add(stop.lineId);
        lineIds.push(stop.lineId);
      }
      const lineIndex = lineIds.indexOf(current.lineId);
      const nextLineIndex = command === 'up' ? lineIndex - 1 : lineIndex + 1;
      if (nextLineIndex < 0 || nextLineIndex >= lineIds.length) {
        // Already at the first or last line: go to its start or end, which is what every
        // editor does rather than refusing the key.
        const edge = command === 'up' ? stops[0]! : stops[stops.length - 1]!;
        return { position: edge.position, desiredX: targetX };
      }
      const target = stops.filter((stop) => stop.lineId === lineIds[nextLineIndex]);
      let best = target[0]!;
      for (const stop of target) {
        if (Math.abs(stop.x - targetX) < Math.abs(best.x - targetX)) best = stop;
      }
      return { position: best.position, desiredX: targetX };
    }
    default:
      return null;
  }
}

/**
 * The anchor an IME composition is attached to.
 *
 * Composition needs a position that survives the intermediate transactions it produces, so
 * it is expressed in model coordinates and re-resolved against each new layout rather than
 * cached as geometry.
 */
export function compositionAnchor(
  layout: SemanticLayout,
  position: SemanticPosition,
  /** For an exact mid-span x (layout publishes no eager caret edges; see caretAt). */
  measurer?: TextMeasurer
): CaretGeometry | null {
  return caretAt(layout, position, measurer);
}

/** The style spans a selection touches, for reporting active formatting. */
export function spansInSelection(
  layout: SemanticLayout,
  selection: SemanticSelection,
  /**
   * Reading order of the ACTIVE story. See {@link orderPositions}.
   *
   * REQUIRED. A default here can only be one story's order, and whichever one it is will be
   * wrong for every caret in another — which is exactly how this read came to answer about the
   * body while the caret sat in a header. Requiring it is what makes the compiler find a call
   * site that forgot, and it already found one.
   *
   * A caller with no story in hand passes {@link everyStoryOrder}, which covers all of them: a
   * selection cannot span two stories, so only the order WITHIN one is ever compared.
   */
  order: readonly string[]
): StyleSpanRecord[] {
  const ordered = orderPositions(selection, order);
  if (!ordered) return [];
  if (
    ordered.from.paragraphId === ordered.to.paragraphId &&
    ordered.from.offset === ordered.to.offset
  ) {
    return caretSpan(layout, ordered.from);
  }
  const spans: StyleSpanRecord[] = [];
  // Only the paragraphs the selection touches; iterating every line of the document made
  // the toolbar's formatting read scale with document length instead of selection length.
  if (ordered.from.paragraphId === ordered.to.paragraphId) {
    for (const { line } of paragraphLinesFor(layout, ordered.from.paragraphId) ?? []) {
      const segment = lineSegmentFor(line, ordered.from.paragraphId);
      if (!segment) continue;
      const overlap = segmentOverlap(layout, segment, ordered.from, ordered.to);
      if (!overlap) continue;
      for (const span of segment.spans) {
        if (span.range.end > overlap.start && span.range.start < overlap.end) spans.push(span);
      }
    }
    return spans;
  }
  const lines = paragraphLinesIndex(layout);
  // Positions WITHIN the given order, not the body index: the two agree for the body and
  // nowhere else, and `paragraphLinesIndex` already covers every story.
  const first = positionIn(order, ordered.from.paragraphId);
  const last = positionIn(order, ordered.to.paragraphId);
  if (first === -1 || last === -1) return [];
  for (let at = first; at <= last; at += 1) {
    for (const { line } of lines.get(order[at]!) ?? []) {
      const segment = lineSegmentFor(line, order[at]!);
      if (!segment) continue;
      const overlap = segmentOverlap(
        layout,
        segment,
        ordered.from,
        ordered.to,
        indexPositions(order)
      );
      if (!overlap) continue;
      for (const span of segment.spans) {
        if (span.range.end > overlap.start && span.range.start < overlap.end) spans.push(span);
      }
    }
  }
  return spans;
}

/**
 * The span a collapsed caret reports formatting from: the character to its LEFT (Word's
 * rule — typing continues what came before), falling back to the character to its right
 * at a paragraph start.
 */
function caretSpan(layout: SemanticLayout, position: SemanticPosition): StyleSpanRecord[] {
  let leftward: StyleSpanRecord | null = null;
  let rightward: StyleSpanRecord | null = null;
  let furniture: StyleSpanRecord | null = null;
  for (const { line } of paragraphLinesFor(layout, position.paragraphId) ?? []) {
    // This paragraph's spans only: on a merged line the other member's runs sit beside these
    // and would report their formatting for a caret that is not in them.
    for (const span of lineSegmentFor(line, position.paragraphId)?.spans ?? []) {
      const { start, end } = span.range;
      if (start < position.offset && position.offset <= end) leftward ??= span;
      // A zero-width projected span (a field-code atom) paints in its own face but is no run
      // the caret types into: the character after it answers, and the atom itself only when
      // the paragraph holds nothing else.
      else if (start === position.offset && end === start && span.projected) furniture ??= span;
      else if (start === position.offset) rightward ??= span;
    }
  }
  const chosen = spanBesideSymbol(leftward, rightward) ?? leftward ?? rightward ?? furniture;
  return chosen ? [chosen] : [];
}
