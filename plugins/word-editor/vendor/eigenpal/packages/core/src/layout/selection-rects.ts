// Where a selection paints.
//
// Rectangles, not positions: the interaction lane answers "which position is this point", and
// this answers "which pixels does this range cover". They meet at `segmentOverlap`, which is
// the one part of both that has to know a line can carry more than one paragraph.

import { lineContentEdges } from './pending-line.ts';
import {
  fragmentParagraphs,
  lineSegments,
  logicalLineSegments,
  segmentOverlap,
} from './line-segments.ts';
import { xWithinLine, rangeBandsWithinLine, mergeLineRangeBands } from './line-geometry.ts';
import { paragraphIsRtl } from './rtl-paragraph.ts';
import { clipParagraphBox } from './paragraph-frame-clip.ts';
import { paragraphFragmentsOf, paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  SemanticLayout,
  TextMeasurer,
} from './semantic-records.ts';
import { documentOrderIndex } from './document-order.ts';
import { orderPositions } from './semantic-interaction.ts';
import type { SemanticPosition, SemanticSelection, SelectionRect } from './semantic-interaction.ts';
import { bottomToTopRectInLayout } from './table-cell-text-direction.ts';

/**
 * The physical rectangles covering a selection, including disjoint bands within bidi lines.
 *
 * BODY fragments only, and a selection outside the body paints nothing. That is a real gap —
 * a retained pin in a header shows no highlight, and a comment anchored in one draws no band
 * even though the review queue lists it — but it is the honest shape of what this can answer
 * today. Widening the walk to the other stories is not enough on its own: header and footer
 * fragments carry positions relative to their own story box, note fragments relative to their
 * note area, and one header story object is attached to EVERY page it applies to. Fed straight
 * into a page-content-relative rect, those produce a band per page, at coordinates belonging
 * to a different box. Measured, that put a header comment's band on all six pages of a
 * document at the top-left of the body text. Painting nothing is wrong; painting over the
 * wrong words is worse, so the walk stays here until the geometry is carried with it.
 */
export function selectionRects(
  layout: SemanticLayout,
  selection: SemanticSelection,
  /**
   * Reading order of the ACTIVE story.
   *
   * REQUIRED, for the reason `spansInSelection` gives: any default is one story's order, and
   * it is wrong for every caret outside that story. A caller with no story in hand passes
   * {@link everyStoryOrder}.
   */
  order: readonly string[],
  /**
   * For EXACT edge x positions inside a span. Layout no longer publishes eager per-character
   * caret edges, so without a measurer an intra-span boundary interpolates across the span's
   * advance — visibly wrong in a proportional face. Pass the layout's measurer.
   */
  measurer?: TextMeasurer
): SelectionRect[] {
  return rangeRects(layout, selection, order, true, measurer);
}

/**
 * Rectangles for selected paragraph marks only.
 *
 * Native DOM selection paints characters, but it cannot paint the paragraph mark after a
 * filled line or the only position on an empty line. The active surface draws these small
 * semantic rectangles beside the native highlight.
 */
export function selectionMarkRects(
  layout: SemanticLayout,
  selection: SemanticSelection,
  order: readonly string[],
  measurer?: TextMeasurer
): SelectionRect[] {
  return rangeRects(layout, selection, order, false, measurer);
}

interface ParagraphTerminal {
  end: number;
  start: number;
  /** Lines that draw one field cut across them share a range; the last one is terminal. */
  lineId: string;
}

/** Last visual segment range for each paragraph drawn on `pages`. */
function paragraphTerminals(pages: readonly PageRecord[]): ReadonlyMap<string, ParagraphTerminal> {
  const terminals = new Map<string, ParagraphTerminal>();
  for (const page of pages)
    for (const fragment of paragraphFragmentsOf(page))
      for (const line of fragment.lines)
        for (const segment of lineSegments(line)) {
          const previous = terminals.get(segment.paragraphId);
          if (
            !previous ||
            segment.end > previous.end ||
            (segment.end === previous.end && segment.start >= previous.start)
          ) {
            const { end, start } = segment;
            terminals.set(segment.paragraphId, { end, start, lineId: line.id });
          }
        }
  return terminals;
}

const terminalsCache = new WeakMap<SemanticLayout, ReadonlyMap<string, ParagraphTerminal>>();

/** {@link paragraphTerminals} over every page, once per layout. */
function layoutTerminals(layout: SemanticLayout): ReadonlyMap<string, ParagraphTerminal> {
  let terminals = terminalsCache.get(layout);
  if (!terminals) terminalsCache.set(layout, (terminals = paragraphTerminals(layout.pages)));
  return terminals;
}

const orderIndexCache = new WeakMap<readonly string[], ReadonlyMap<string, number>>();

/** Per page, the last spans asked for: one per order index (layout order, story order). */
const pageSpans = new WeakMap<
  PageRecord,
  { index: ReadonlyMap<string, number>; span: readonly [number, number] }[]
>();

/** The lowest and highest index `index` gives any paragraph drawn on `page`. */
function pageOrderSpan(
  page: PageRecord,
  index: ReadonlyMap<string, number>
): readonly [number, number] {
  const entries = pageSpans.get(page) ?? [];
  const cached = entries.find((entry) => entry.index === index);
  if (cached) return cached.span;
  let low = Infinity;
  let high = -Infinity;
  for (const fragment of paragraphFragmentsOf(page))
    for (const paragraphId of fragmentParagraphs(fragment)) {
      const at = index.get(paragraphId);
      if (at === undefined) continue;
      low = Math.min(low, at);
      high = Math.max(high, at);
    }
  const span = [low, high] as const;
  pageSpans.set(page, [{ index, span }, ...entries].slice(0, 2));
  return span;
}

/**
 * A test of whether a range between two paragraphs can draw on any of `pages`, by body layout
 * order. Built once per set of pages: the spans of the visible pages are read once, not once
 * per range.
 *
 * A paragraph the body order cannot place (a header's, a note's) answers true: this is only a
 * filter in front of measuring, and a false keep costs one range's measurement.
 */
export function rangesOnPages(
  layout: SemanticLayout,
  pages: ReadonlySet<number>
): (fromParagraphId: string, toParagraphId: string) => boolean {
  const index = documentOrderIndex(layout);
  const spans: (readonly [number, number])[] = [];
  for (const pageIndex of pages) {
    const page = layout.pages[pageIndex];
    if (page) spans.push(pageOrderSpan(page, index));
  }
  return (fromParagraphId, toParagraphId) => {
    const from = index.get(fromParagraphId);
    const to = index.get(toParagraphId);
    if (from === undefined || to === undefined) return true;
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    for (const span of spans) if (span[1] >= low && span[0] <= high) return true;
    return false;
  };
}

/** {@link rangesOnPages} for one range. */
export function rangeMayShowOnPages(
  layout: SemanticLayout,
  pages: ReadonlySet<number>,
  fromParagraphId: string,
  toParagraphId: string
): boolean {
  return rangesOnPages(layout, pages)(fromParagraphId, toParagraphId);
}

/**
 * The pages a range can paint on: those drawing a paragraph inside it, in either order.
 *
 * A segment paints only when its paragraph lies between the range's ends — by layout order for
 * text, by story order for a paragraph mark — so a page drawing no such paragraph has nothing
 * to paint, and every segment of a paragraph inside the range is on a page that is kept.
 * Walking every line of a long document for a one-word selection cost tens of milliseconds per
 * selection change. An end neither order can place keeps every page.
 */
function pagesHoldingRange(
  layout: SemanticLayout,
  from: SemanticPosition,
  to: SemanticPosition,
  orderIndex: ReadonlyMap<string, number>
): readonly PageRecord[] {
  const layoutIndex = documentOrderIndex(layout);
  const fromLayout = layoutIndex.get(from.paragraphId);
  const toLayout = layoutIndex.get(to.paragraphId);
  const fromOrder = orderIndex.get(from.paragraphId);
  const toOrder = orderIndex.get(to.paragraphId);
  if (
    fromLayout === undefined ||
    toLayout === undefined ||
    fromOrder === undefined ||
    toOrder === undefined
  )
    return layout.pages;
  return layout.pages.filter((page) => {
    const layoutSpan = pageOrderSpan(page, layoutIndex);
    const orderSpan = pageOrderSpan(page, orderIndex);
    return (
      (layoutSpan[1] >= fromLayout && layoutSpan[0] <= toLayout) ||
      (orderSpan[1] >= fromOrder && orderSpan[0] <= toOrder)
    );
  });
}

function indexesOf(order: readonly string[]): ReadonlyMap<string, number> {
  const cached = orderIndexCache.get(order);
  if (cached) return cached;
  const index = new Map(order.map((paragraphId, at) => [paragraphId, at]));
  orderIndexCache.set(order, index);
  return index;
}

/** A compact Word-like block for a selected paragraph mark, in layout points. */
function paragraphMarkWidth(lineHeight: number): number {
  return Math.max(3, Math.min(8, lineHeight * 0.25));
}

function rangeRects(
  layout: SemanticLayout,
  selection: SemanticSelection,
  order: readonly string[],
  includeText: boolean,
  measurer?: TextMeasurer
): SelectionRect[] {
  // A caret paints no range or paragraph mark. This is the common typing path;
  // do not build document-wide terminal/order indexes just to return no rectangles.
  if (
    selection.anchor.paragraphId === selection.head.paragraphId &&
    selection.anchor.offset === selection.head.offset
  )
    return [];
  const ordered = orderPositions(selection, order);
  if (!ordered) return [];
  const orderIndex = indexesOf(order);
  const fromIndex = orderIndex.get(ordered.from.paragraphId);
  const toIndex = orderIndex.get(ordered.to.paragraphId);
  const pages = pagesHoldingRange(layout, ordered.from, ordered.to, orderIndex);
  const terminals = pages === layout.pages ? layoutTerminals(layout) : paragraphTerminals(pages);
  const rects: SelectionRect[] = [];
  for (const page of pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        const segments = logicalLineSegments(line);
        for (const [segmentIndex, segment] of segments.entries()) {
          const overlap = segmentOverlap(layout, segment, ordered.from, ordered.to);
          const paragraphIndex = orderIndex.get(segment.paragraphId);
          const terminal = terminals.get(segment.paragraphId);
          // A paragraph mark is the boundary AFTER this paragraph. The range selects it only
          // when its head reaches a later paragraph; the head paragraph's own mark stays out.
          const markSelected =
            fromIndex !== undefined &&
            toIndex !== undefined &&
            paragraphIndex !== undefined &&
            paragraphIndex >= fromIndex &&
            paragraphIndex < toIndex &&
            terminal?.lineId === line.id &&
            terminal.end === segment.end &&
            segmentIndex === segments.length - 1;
          if ((!includeText || !overlap) && !markSelected) continue;
          const bands =
            includeText && overlap
              ? rangeBandsWithinLine(line, overlap.start, overlap.end, measurer, segment)
              : [];
          if (markSelected) {
            const width = paragraphMarkWidth(
              Math.max(0, line.box.height - line.leading - (line.trailingSpacing ?? 0))
            );
            const baseLevel = segment.spans[0]?.style.shaping?.baseLevel;
            const rtl =
              baseLevel === undefined ? paragraphIsRtl(fragment.props) : baseLevel % 2 === 1;
            // The paragraph mark follows the base-direction visual edge, even when
            // the final logical run has the opposite direction.
            let markX = xWithinLine(line, segment.end, measurer, segment);
            const edges = lineContentEdges(segment.spans, segment.drawings);
            if (edges && segment.spans.some((span) => span.style.shaping !== undefined)) {
              markX = rtl ? edges.left : edges.right;
            }
            bands.push({ x: rtl ? markX - width : markX, width });
          }
          for (const band of mergeLineRangeBands(bands)) {
            const clipped = clipParagraphBox(
              {
                pageIndex: page.index,
                ...band,
                y: line.box.y,
                height: line.box.height,
              },
              fragment.clipToBox ? fragment.box : undefined
            );
            if (clipped) rects.push(bottomToTopRectInLayout(layout, segment.paragraphId, clipped));
          }
        }
      }
    }
  }
  return rects;
}

/** A model range to highlight, and the key the caller knows it by. */
export interface KeyedRange {
  readonly key: string;
  readonly from: SemanticPosition;
  readonly to: SemanticPosition;
}

/**
 * Rectangles for MANY ranges in ONE pass over the lines.
 *
 * Not `selectionRects` in a loop. That walks every page, fragment and line per range, and a
 * contract with two hundred comments would re-walk the whole document two hundred times on
 * every layout — the highlight would cost more than the layout it decorates. One pass tests
 * each line against every range instead, which is the same work a single selection does.
 */
export function keyedRangeRects(
  layout: SemanticLayout,
  ranges: readonly KeyedRange[],
  /**
   * Pages to measure, or every page when absent.
   *
   * A band that is not on screen is not painted, so measuring it is pure cost — and it is
   * cost paid per keystroke, because an edit republishes the layout. Bounding this to the
   * materialized pages is what keeps typing in a heavily reviewed document as fast as
   * typing in a clean one.
   */
  pages?: ReadonlySet<number>,
  /** For exact intra-span edge positions (see {@link selectionRects}). */
  measurer?: TextMeasurer
): Map<string, SelectionRect[]> {
  const found = new Map<string, SelectionRect[]>();
  if (ranges.length === 0) return found;
  for (const page of layout.pages) {
    if (pages && !pages.has(page.index)) continue;
    for (const fragment of paragraphFragmentsOf(page)) {
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line))
          for (const range of ranges) {
            const overlap = segmentOverlap(layout, segment, range.from, range.to);
            if (!overlap) continue;
            const rects = found.get(range.key) ?? [];
            for (const band of rangeBandsWithinLine(
              line,
              overlap.start,
              overlap.end,
              measurer,
              segment
            )) {
              const clipped = clipParagraphBox(
                {
                  pageIndex: page.index,
                  ...band,
                  y: line.box.y,
                  height: line.box.height,
                },
                fragment.clipToBox ? fragment.box : undefined
              );
              if (!clipped) continue;
              rects.push(bottomToTopRectInLayout(layout, segment.paragraphId, clipped));
              found.set(range.key, rects);
            }
          }
      }
    }
  }
  return found;
}

/**
 * Page-content origin in stacked page coordinates.
 *
 * `contentBox` already lives in page-stack space. Destinations and review geometry add
 * page-content rects to this origin; they must not reconstruct it from `page.box`.
 */
export function pageContentOrigin(page: PageRecord): { readonly x: number; readonly y: number } {
  return { x: page.contentBox.x, y: page.contentBox.y };
}

/**
 * Offset from a story box into page-content coordinates.
 *
 * Header, footer, and note fragments are relative to their own box. Subtract `contentBox`
 * here so destination caret math and review geometry cannot drift apart.
 */
export function storyBoxContentOffset(
  page: PageRecord,
  storyBox: { readonly x: number; readonly y: number }
): { readonly x: number; readonly y: number } {
  return {
    x: storyBox.x - page.contentBox.x,
    y: storyBox.y - page.contentBox.y,
  };
}

/**
 * Content-box offset for a story-relative position.
 *
 * Body fragments are already in page-content space. Header, footer and note fragments are
 * relative to their own box, so a caret or range painted against `page.contentBox` has to
 * add this or it lands in the body.
 */
export function storyContentOffset(
  layout: SemanticLayout,
  paragraphId: string,
  pageIndex: number
): { readonly x: number; readonly y: number } {
  if (documentOrderIndex(layout).has(paragraphId)) return { x: 0, y: 0 };
  const page = layout.pages[pageIndex];
  if (!page) return { x: 0, y: 0 };
  const inBlocks = (blocks: readonly BlockFragmentRecord[]): boolean =>
    paragraphFragmentsOfBlocks(blocks).some((fragment) => fragment.paragraphId === paragraphId);
  if (page.header && inBlocks(page.header.fragments)) {
    return storyBoxContentOffset(page, page.header.box);
  }
  if (page.footer && inBlocks(page.footer.fragments)) {
    return storyBoxContentOffset(page, page.footer.box);
  }
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) {
      if (!inBlocks(note.fragments)) continue;
      return storyBoxContentOffset(page, note.box);
    }
  }
  return { x: 0, y: 0 };
}

let presenceWalkPages = 0;
let presenceWalkLines = 0;

/**
 * @internal Warm-path recorder for remote-presence geometry walks.
 *
 * Presence highlights must not scan every line of the document per paint. Tests assert
 * the walk stays bounded to the pages the caller names.
 */
export function presenceWalkRecorder(): {
  readonly pages: number;
  readonly lines: number;
  reset(): void;
} {
  return {
    get pages() {
      return presenceWalkPages;
    },
    get lines() {
      return presenceWalkLines;
    },
    reset() {
      presenceWalkPages = 0;
      presenceWalkLines = 0;
    },
  };
}

/**
 * Selection rectangles in page-content coordinates, every story included.
 *
 * {@link selectionRects} stays body-only: feeding header coordinates into that walk without
 * an origin painted a band on every page at the top of the body. This walk carries the story
 * box, so a remote caret in a header lands in the header.
 *
 * Pass `pages` to measure only those sheets. A band that is not on screen is not painted, so
 * measuring it is pure cost — and it is cost paid per keystroke, because an edit republishes
 * the layout. Bounding this to the materialized pages is what keeps typing beside a large
 * remote selection as fast as typing beside a caret.
 */
export function presenceSelectionRects(
  layout: SemanticLayout,
  selection: SemanticSelection,
  order: readonly string[],
  pages?: ReadonlySet<number>,
  measurer?: TextMeasurer
): SelectionRect[] {
  return (
    presenceRangeRects(
      layout,
      [{ key: 'selection', from: selection.anchor, to: selection.head }],
      order,
      pages,
      measurer
    ).get('selection') ?? []
  );
}

/**
 * Rectangles for MANY presence ranges in ONE pass over the named pages.
 *
 * Not {@link presenceSelectionRects} in a loop. That walks every page, fragment and line per
 * range, and a room with several remote selections would re-walk the document once each.
 */
export function presenceRangeRects(
  layout: SemanticLayout,
  ranges: readonly KeyedRange[],
  order: readonly string[],
  pages?: ReadonlySet<number>,
  measurer?: TextMeasurer
): Map<string, SelectionRect[]> {
  const found = new Map<string, SelectionRect[]>();
  const ordered: { key: string; from: SemanticPosition; to: SemanticPosition }[] = [];
  for (const range of ranges) {
    const pair = orderPositions({ anchor: range.from, head: range.to }, order);
    if (pair) ordered.push({ key: range.key, from: pair.from, to: pair.to });
  }
  if (ordered.length === 0) return found;
  const orderIndex = indexesOf(order);
  const take = (
    blocks: readonly BlockFragmentRecord[],
    pageIndex: number,
    offsetX: number,
    offsetY: number
  ): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
      for (const line of fragment.lines) {
        presenceWalkLines += 1;
        for (const segment of lineSegments(line)) {
          for (const range of ordered) {
            const overlap = segmentOverlap(layout, segment, range.from, range.to, orderIndex);
            if (!overlap) continue;
            const rects = found.get(range.key) ?? [];
            for (const band of rangeBandsWithinLine(
              line,
              overlap.start,
              overlap.end,
              measurer,
              segment
            )) {
              const clipped = clipParagraphBox(
                {
                  pageIndex,
                  ...band,
                  y: line.box.y,
                  height: line.box.height,
                },
                fragment.clipToBox ? fragment.box : undefined
              );
              if (!clipped) continue;
              rects.push({ ...clipped, x: clipped.x + offsetX, y: clipped.y + offsetY });
              found.set(range.key, rects);
            }
          }
        }
      }
    }
  };
  for (const page of layout.pages) {
    if (pages && !pages.has(page.index)) continue;
    presenceWalkPages += 1;
    take(page.fragments, page.index, 0, 0);
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      const origin = storyBoxContentOffset(page, story.box);
      take(story.fragments, page.index, origin.x, origin.y);
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        const origin = storyBoxContentOffset(page, note.box);
        take(note.fragments, page.index, origin.x, origin.y);
      }
    }
  }
  return found;
}
