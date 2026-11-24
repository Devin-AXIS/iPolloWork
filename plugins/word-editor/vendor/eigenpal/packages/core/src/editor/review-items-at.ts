// Review items under a client point, and the bands one item paints: the engine half of
// `Editor.getReviewItemsAt()` and `Editor.getReviewItemRects()`.
//
// Geometry comes from layout records, the same walk the text-highlight marks use, never from
// painted DOM attributes. The frame is the one the surface last painted, so a hit and its
// rectangle match the text on screen at the scale and page offsets the reader sees.

import type { HighlightRect } from '../contracts/editor-highlights.ts';
import type { ReviewItemHit } from '../contracts/editor-review-hits.ts';
import type { ReviewItemPlacement, ReviewItemQuery } from '../contracts/editor.ts';
import { logicalLineSegments } from '../layout/line-segments.ts';
import {
  paragraphRangeRects,
  type KeyedParagraphRect,
  type ParagraphRange,
} from '../layout/paragraph-range-rects.ts';
import { paragraphFragmentsOfBlocks } from '../layout/semantic-records.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  SemanticLayout,
} from '../layout/semantic-records.ts';
import type { ReviewRange } from '../store/store/review-items.ts';
import type { SurfaceOverlayFrame } from './surface-overlay-sheet.ts';
import { textboxPresenceLayout } from './textbox-presence-layout.ts';
import { findReviewPlacement } from './review-replacement-pairs.ts';

/** Where a paragraph sits: the story it belongs to and its position in that story. */
interface StoryPosition {
  readonly story: string;
  readonly index: number;
}

interface StoryOrder {
  readonly positions: ReadonlyMap<string, StoryPosition>;
  readonly paragraphs: ReadonlyMap<string, readonly string[]>;
}

const storyOrderCache = new WeakMap<SemanticLayout, StoryOrder>();

/**
 * Paragraph order PER STORY, from the published layout.
 *
 * A range never crosses stories, but a whole-layout order interleaves them page by page, so
 * a body range spanning a page break would otherwise appear to contain that page's header.
 * Text-box paragraphs are not in page fragments; they match only ranges inside one paragraph.
 */
function storyOrderOf(layout: SemanticLayout): StoryOrder {
  const cached = storyOrderCache.get(layout);
  if (cached) return cached;
  const positions = new Map<string, StoryPosition>();
  const paragraphs = new Map<string, string[]>();
  const add = (story: string, paragraphId: string): void => {
    if (positions.has(paragraphId)) return;
    let list = paragraphs.get(story);
    if (!list) {
      list = [];
      paragraphs.set(story, list);
    }
    positions.set(paragraphId, { story, index: list.length });
    list.push(paragraphId);
  };
  const take = (story: string, blocks: readonly BlockFragmentRecord[]): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
      for (const line of fragment.lines) {
        for (const segment of logicalLineSegments(line)) add(story, segment.paragraphId);
      }
      if (fragment.lines.length === 0) add(story, fragment.paragraphId);
    }
  };
  for (const page of layout.pages) {
    take('body', page.fragments);
    for (const story of [page.header, page.footer]) {
      if (story) take(`part:${story.partName}`, story.fragments);
    }
    for (const area of [page.footnotes, page.endnotes]) {
      for (const note of area?.notes ?? []) take(`notes:${note.noteKind}`, note.fragments);
    }
  }
  const order = { positions, paragraphs };
  storyOrderCache.set(layout, order);
  return order;
}

/** One paragraph's share of a review range, half-open, keyed to its source. */
function addRangePieces(
  range: ReviewRange,
  key: number,
  order: StoryOrder,
  into: Map<string, ParagraphRange[]>
): void {
  const push = (paragraphId: string, start: number, end: number): void => {
    if (end <= start) return;
    const list = into.get(paragraphId);
    if (list) list.push({ key, start, end });
    else into.set(paragraphId, [{ key, start, end }]);
  };
  const { start, end } = range;
  if (start.paragraphId === end.paragraphId) {
    push(start.paragraphId, start.offset, end.offset);
    return;
  }
  const from = order.positions.get(start.paragraphId);
  const to = order.positions.get(end.paragraphId);
  push(start.paragraphId, start.offset, Number.POSITIVE_INFINITY);
  push(end.paragraphId, 0, end.offset);
  if (!from || !to || from.story !== to.story || to.index <= from.index) return;
  const list = order.paragraphs.get(from.story)!;
  for (let index = from.index + 1; index < to.index; index += 1) {
    push(list[index]!, 0, Number.POSITIVE_INFINITY);
  }
}

/** Width in story-order units, for the narrowest-first rule `reviewItemsAt` uses. */
function rangeWidth(range: ReviewRange, order: StoryOrder): number {
  if (range.start.paragraphId === range.end.paragraphId) {
    return range.end.offset - range.start.offset;
  }
  const from = order.positions.get(range.start.paragraphId);
  const to = order.positions.get(range.end.paragraphId);
  if (!from || !to || from.story !== to.story) return Number.MAX_SAFE_INTEGER;
  return (to.index - from.index) * 1_000_000 + (range.end.offset - range.start.offset);
}

function rangesOf(placement: ReviewItemPlacement): readonly ReviewRange[] {
  const item = placement.item;
  if (item.kind === 'revision') return item.ranges;
  return item.range ? [item.range] : [];
}

const KIND_RANK: Readonly<Record<ReviewItemPlacement['kind'], number>> = {
  comment: 0,
  custom: 1,
  revision: 2,
};

interface RangeSource {
  readonly placement: number;
  readonly width: number;
}

/** Every range of every placement, split per paragraph and keyed back to its placement. */
function piecesOf(
  placements: readonly ReviewItemPlacement[],
  order: StoryOrder
): { readonly byParagraph: Map<string, ParagraphRange[]>; readonly sources: RangeSource[] } {
  const byParagraph = new Map<string, ParagraphRange[]>();
  const sources: RangeSource[] = [];
  placements.forEach((placement, at) => {
    for (const range of rangesOf(placement)) {
      const key = sources.length;
      sources.push({ placement: at, width: rangeWidth(range, order) });
      addRangePieces(range, key, order, byParagraph);
    }
  });
  return { byParagraph, sources };
}

function painted(frame: SurfaceOverlayFrame, page: PageRecord): boolean {
  return !frame.pages || frame.pages.has(page.index);
}

/** A content-relative band in client coordinates. */
function clientRect(
  frame: SurfaceOverlayFrame,
  origin: { readonly left: number; readonly top: number },
  page: PageRecord,
  rect: KeyedParagraphRect
): HighlightRect {
  const offsetX = frame.pageOffsetX?.get(page.index) ?? 0;
  const left = origin.left + (page.contentBox.x + rect.x + offsetX) * frame.scale;
  const top = origin.top + (page.contentBox.y + rect.y) * frame.scale;
  const width = rect.width * frame.scale;
  const height = rect.height * frame.scale;
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
}

export function createReviewItemsAt(deps: {
  /** The frame the surface last painted, or null before the first paint. */
  frame(): SurfaceOverlayFrame | null;
  placements(query?: ReviewItemQuery): readonly ReviewItemPlacement[];
}) {
  /** The painted frame and its client origin, or null when nothing is on screen. */
  function liveFrame(): {
    readonly frame: SurfaceOverlayFrame;
    readonly origin: DOMRect;
  } | null {
    const frame = deps.frame();
    if (!frame?.layer.isConnected || !(frame.scale > 0)) return null;
    return { frame, origin: frame.layer.getBoundingClientRect() };
  }

  return {
    getReviewItemsAt(
      clientX: number,
      clientY: number,
      query?: ReviewItemQuery
    ): readonly ReviewItemHit[] {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return [];
      const live = liveFrame();
      if (!live) return [];
      const { frame, origin } = live;
      const x = (clientX - origin.left) / frame.scale;
      const y = (clientY - origin.top) / frame.scale;
      const page = frame.layout.pages.find((candidate) => {
        if (!painted(frame, candidate)) return false;
        const left = candidate.box.x + (frame.pageOffsetX?.get(candidate.index) ?? 0);
        return (
          x >= left &&
          x < left + candidate.box.width &&
          y >= candidate.box.y &&
          y < candidate.box.y + candidate.box.height
        );
      });
      if (!page) return [];
      const placements = deps.placements(query);
      if (placements.length === 0) return [];
      const order = storyOrderOf(frame.layout);
      const { byParagraph, sources } = piecesOf(placements, order);
      const contentX = x - (frame.pageOffsetX?.get(page.index) ?? 0) - page.contentBox.x;
      const contentY = y - page.contentBox.y;
      const best = new Map<number, { width: number; rect: KeyedParagraphRect }>();
      const rects = paragraphRangeRects(
        textboxPresenceLayout(frame.layout),
        byParagraph,
        new Set([page.index]),
        frame.measurer
      );
      for (const rect of rects) {
        // Half-open on both axes: a band holds the characters it covers, so the right edge
        // of the last character belongs to the next one.
        if (contentX < rect.x || contentX >= rect.x + rect.width) continue;
        if (contentY < rect.y || contentY >= rect.y + rect.height) continue;
        const source = sources[rect.key]!;
        const held = best.get(source.placement);
        if (!held || source.width < held.width) {
          best.set(source.placement, { width: source.width, rect });
        }
      }
      const hits = [...best.entries()].map(([at, held]) => ({ at, ...held }));
      hits.sort((a, b) => {
        if (a.width !== b.width) return a.width - b.width;
        const left = placements[a.at]!;
        const right = placements[b.at]!;
        if (left.kind !== right.kind) return KIND_RANK[left.kind] - KIND_RANK[right.kind];
        if (left.kind === 'revision' && right.kind === 'revision') {
          const nesting = right.item.nesting - left.item.nesting;
          if (nesting !== 0) return nesting;
        }
        return a.at - b.at;
      });
      return hits.map((hit) => ({
        placement: placements[hit.at]!,
        rect: clientRect(frame, origin, page, hit.rect),
      }));
    },

    getReviewItemRects(key: string): readonly HighlightRect[] {
      if (typeof key !== 'string' || key.length === 0) return [];
      const live = liveFrame();
      if (!live) return [];
      const { frame, origin } = live;
      const placement = findReviewPlacement(deps.placements, key);
      if (!placement) return [];
      const pages = new Set(
        frame.layout.pages.filter((page) => painted(frame, page)).map((page) => page.index)
      );
      const { byParagraph } = piecesOf([placement], storyOrderOf(frame.layout));
      return paragraphRangeRects(
        textboxPresenceLayout(frame.layout),
        byParagraph,
        pages,
        frame.measurer
      ).map((rect) => clientRect(frame, origin, frame.layout.pages[rect.pageIndex]!, rect));
    },
  };
}
