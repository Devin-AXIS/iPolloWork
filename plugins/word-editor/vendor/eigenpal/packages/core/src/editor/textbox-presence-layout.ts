import type {
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../layout/semantic-records.ts';
import { translateParagraphFragment } from '../layout/paragraph-frame.ts';
import { textboxDrawingsOnPage } from '../layout/textbox-drawing-records.ts';
import { forEachStoryParagraphFragment } from '../layout/semantic-record-queries.ts';
import { headerFooterAnchoredDrawingOrigin } from '../layout/header-footer-drawing-origin.ts';
import { documentOrderIndex } from '../layout/document-order.ts';
import { keyedRangeRects, type KeyedRange } from '../layout/selection-rects.ts';
import type { SelectionRect } from '../layout/semantic-interaction.ts';
import type { TextMeasurer } from '../layout/index.ts';

const cache = new WeakMap<SemanticLayout, SemanticLayout>();

/** Header and footer text-box paragraphs, moved into the page's content coordinates. */
function furnitureTextboxFragments(page: PageRecord): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  const pageOrigin = { x: page.box.x, y: page.box.y };
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const origin = { x: story.box.x, y: story.box.y };
    forEachStoryParagraphFragment(
      story,
      (fragment, context) => {
        if (context.textboxDepth === 0 || context.textboxOwner?.accessibility.hidden) return;
        // Overlay boxes stay upright, so a turned story has none rather than misplaced ones.
        if (context.textboxOwner?.textboxStory?.contentRotation) return;
        fragments.push(
          translateParagraphFragment(
            fragment,
            context.storyOrigin.x - page.contentBox.x,
            context.storyOrigin.y - page.contentBox.y
          )
        );
      },
      origin,
      (drawing) => headerFooterAnchoredDrawingOrigin(drawing, origin, pageOrigin)
    );
  }
  return fragments;
}

/**
 * Include text-box paragraphs in the geometry used to paint remote carets, ranges, and
 * highlights: body boxes, anchored or inline, and boxes in headers and footers.
 */
export function textboxPresenceLayout(layout: SemanticLayout): SemanticLayout {
  const cached = cache.get(layout);
  if (cached) return cached;
  const pages = layout.pages.map((page) => {
    const fragments = textboxFragmentsOf(page);
    return fragments.length ? { ...page, fragments: [...page.fragments, ...fragments] } : page;
  });
  const projected = pages.every((page, index) => page === layout.pages[index])
    ? layout
    : { ...layout, pages };
  cache.set(layout, projected);
  return projected;
}

/** The page's text box paragraphs, body and furniture, in the page's content coordinates. */
function textboxFragmentsOf(page: PageRecord): ParagraphFragmentRecord[] {
  const fragments = textboxDrawingsOnPage(page).flatMap((drawing) => {
    const story = drawing.textboxStory;
    // Overlay boxes stay upright, so a turned story has none rather than misplaced ones.
    if (story.contentRotation) return [];
    return story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            translateParagraphFragment(
              fragment,
              drawing.x + story.contentOffset.x,
              drawing.y + story.contentOffset.y
            ),
          ]
        : []
    );
  });
  fragments.push(...furnitureTextboxFragments(page));
  return fragments;
}

const boxLayouts = new WeakMap<SemanticLayout, SemanticLayout>();
const boxPages = new WeakMap<PageRecord, PageRecord>();

/**
 * Each page with ONLY its text box paragraphs as fragments, and no furniture or notes. Review
 * geometry for box text reads this rather than {@link textboxPresenceLayout}: it holds a few
 * paragraphs per page instead of every one, and an unchanged page keeps its record across an
 * edit, so every per-page cache downstream hits.
 */
export function textboxOnlyLayout(layout: SemanticLayout): SemanticLayout {
  const cached = boxLayouts.get(layout);
  if (cached) return cached;
  const pages = layout.pages.map((page) => {
    let boxes = boxPages.get(page);
    if (!boxes) {
      const { header: _header, footer: _footer, footnotes: _notes, endnotes: _end, ...rest } = page;
      boxes = { ...rest, fragments: textboxFragmentsOf(page) };
      boxPages.set(page, boxes);
    }
    return boxes;
  });
  const projected = { ...layout, pages };
  boxLayouts.set(layout, projected);
  return projected;
}

/**
 * {@link keyedRangeRects}, with comment ranges in text boxes measured too. Box text is laid out
 * inside its drawing, never in the page's own fragments, so a comment on it had no band. Only a
 * comment range that found no rect and starts in no page paragraph is measured again, against the
 * box paragraphs alone, so a document without such ranges pays nothing more.
 */
export function keyedRangeRectsWithTextboxes(
  layout: SemanticLayout,
  ranges: readonly KeyedRange[],
  pages?: ReadonlySet<number>,
  measurer?: TextMeasurer
): Map<string, SelectionRect[]> {
  const found = keyedRangeRects(layout, ranges, pages, measurer);
  let order: ReadonlyMap<string, number> | null = null;
  const missing = ranges.filter((range) => {
    // Comments only. A tracked change in a box keeps its own marks and no band, as one in a
    // header or a note does.
    if (found.has(range.key) || !range.key.startsWith('comment-')) return false;
    order ??= documentOrderIndex(layout);
    return !order.has(range.from.paragraphId);
  });
  if (missing.length === 0) return found;
  for (const [key, rects] of keyedRangeRects(textboxOnlyLayout(layout), missing, pages, measurer))
    found.set(key, rects);
  return found;
}
