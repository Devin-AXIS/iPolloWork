// Where many single-paragraph ranges paint, in every story.
//
// `presenceRangeRects` tests every range against every line segment, which suits a handful of
// remote selections. Search results and glossary terms are thousands of short ranges that
// each sit inside one paragraph, so this walk buckets them by paragraph first: a line costs
// one map lookup plus the ranges that actually sit on it.

import { textboxDrawingsOnPage } from './textbox-drawing-records.ts';
import { lineSegments } from './line-segments.ts';
import { rangeBandsWithinLine } from './line-geometry.ts';
import { clipParagraphBox } from './paragraph-frame-clip.ts';
import { paragraphFragmentsOfBlocks } from './semantic-records.ts';
import type {
  BlockFragmentRecord,
  LineRecord,
  PageRecord,
  SemanticLayout,
  TextMeasurer,
} from './semantic-records.ts';
import type { SelectionRect } from './semantic-interaction.ts';
import { storyBoxContentOffset } from './selection-rects.ts';
import { bottomToTopRectInLayout } from './table-cell-text-direction.ts';

/** A range inside one paragraph, as half-open model offsets. */
export interface ParagraphRange {
  readonly key: number;
  readonly start: number;
  readonly end: number;
}

/** A painted band and the range it belongs to, in page-content coordinates. */
export interface KeyedParagraphRect extends SelectionRect {
  readonly key: number;
}

/**
 * The glyph band of a line: the line box without the spacing above or below the text, so a
 * mark or an underline sits on the glyphs under double or exact line spacing.
 */
function glyphBand(line: LineRecord): { readonly y: number; readonly height: number } {
  const leading = Math.max(0, line.leading);
  const height = line.box.height - leading - Math.max(0, line.trailingSpacing ?? 0);
  return height > 0
    ? { y: line.box.y + leading, height }
    : { y: line.box.y, height: line.box.height };
}

/**
 * Visit each story's blocks on one page: the body with no offset, then headers, footers, and
 * notes with their story box's offset into page-content coordinates.
 */
function forEachStory(
  page: PageRecord,
  visit: (
    blocks: readonly BlockFragmentRecord[],
    offset: { readonly x: number; readonly y: number } | null
  ) => void
): void {
  visit(page.fragments, null);
  for (const story of [page.header, page.footer]) {
    if (story) visit(story.fragments, storyBoxContentOffset(page, story.box));
  }
  for (const area of [page.footnotes, page.endnotes]) {
    for (const note of area?.notes ?? []) {
      visit(note.fragments, storyBoxContentOffset(page, note.box));
    }
  }
}

/**
 * Rectangles for single-paragraph ranges over the named pages, every story included.
 *
 * Body fragments are page-content relative. Header, footer, and note fragments are relative
 * to their story box, so their bands take that box's offset, the same as remote presence.
 * Pass a layout with text box stories projected in to cover text boxes.
 */
export function paragraphRangeRects(
  layout: SemanticLayout,
  byParagraph: ReadonlyMap<string, readonly ParagraphRange[]>,
  pages?: ReadonlySet<number>,
  measurer?: TextMeasurer
): KeyedParagraphRect[] {
  const rects: KeyedParagraphRect[] = [];
  if (byParagraph.size === 0) return rects;
  const take = (
    blocks: readonly BlockFragmentRecord[],
    pageIndex: number,
    offset: { readonly x: number; readonly y: number } | null
  ): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) {
          const ranges = byParagraph.get(segment.paragraphId);
          if (!ranges) continue;
          for (const range of ranges) {
            const start = Math.max(segment.start, range.start);
            const end = Math.min(segment.end, range.end);
            if (end <= start) continue;
            for (const band of rangeBandsWithinLine(line, start, end, measurer, segment)) {
              const clipped = clipParagraphBox(
                { pageIndex, ...band, ...glyphBand(line) },
                fragment.clipToBox ? fragment.box : undefined
              );
              if (!clipped) continue;
              const placed = offset
                ? { ...clipped, x: clipped.x + offset.x, y: clipped.y + offset.y }
                : bottomToTopRectInLayout(layout, segment.paragraphId, clipped);
              rects.push({ ...placed, key: range.key });
            }
          }
        }
      }
    }
  };
  for (const page of layout.pages) {
    if (pages && !pages.has(page.index)) continue;
    forEachStory(page, (blocks, offset) => take(blocks, page.index, offset));
  }
  return rects;
}

/**
 * Paragraph ids with a laid-out line on one page, in any story. Remembered on the page record:
 * incremental layout hands an untouched page back as the same object, so a keystroke walks
 * only the pages it changed.
 */
const pagePlacedCache = new WeakMap<PageRecord, readonly string[]>();

/** @internal `to` draws the same lines as `from`; only list marker labels moved. */
export function carryPagePlacedIds(from: PageRecord, to: PageRecord): void {
  const ids = pagePlacedCache.get(from);
  if (ids) pagePlacedCache.set(to, ids);
}
function pagePlacedIds(page: PageRecord): readonly string[] {
  const cached = pagePlacedCache.get(page);
  if (cached) return cached;
  const ids = new Set<string>();
  const collect = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
      for (const line of fragment.lines) {
        for (const segment of lineSegments(line)) ids.add(segment.paragraphId);
      }
    }
  };
  forEachStory(page, (blocks) => collect(blocks));
  // Body text boxes, anchored or inline, paint their own story on the page.
  for (const drawing of textboxDrawingsOnPage(page)) collect(drawing.textboxStory.fragments);
  // Header and footer text boxes, anchored or inline, paint their stories with the furniture.
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const owners = [
      ...(story.anchoredDrawings ?? []),
      ...paragraphFragmentsOfBlocks(story.fragments).flatMap((fragment) =>
        fragment.lines.flatMap((line) => line.drawings ?? [])
      ),
    ];
    for (const drawing of owners) {
      if (drawing.textboxStory && !drawing.accessibility.hidden) {
        collect(drawing.textboxStory.fragments);
      }
    }
  }
  const placed = [...ids];
  pagePlacedCache.set(page, placed);
  return placed;
}

/**
 * Every paragraph id with a laid-out line, in any story or anchored text box. Memoized per
 * layout; pass the layout as published, so untouched pages keep their identity.
 */
const placedCache = new WeakMap<SemanticLayout, ReadonlySet<string>>();
export function placedParagraphIds(layout: SemanticLayout): ReadonlySet<string> {
  const cached = placedCache.get(layout);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const page of layout.pages) for (const id of pagePlacedIds(page)) ids.add(id);
  placedCache.set(layout, ids);
  return ids;
}
