// Which pages are worth building in detail (task 9.4).
//
// A five-hundred-page document has five hundred pages of records, and a screen holds two.
// Painting all of them costs memory and time for content nobody is looking at, and it is the
// difference between a document that opens and one that hangs.
//
// What must still be materialized beyond the visible window:
//
//   OVERSCAN   a band above and below, so scrolling reveals painted pages rather than blank
//              ones that fill in a frame later
//   CARET      the page the caret is on, even scrolled far away — a keystroke has to land
//              somewhere, and the answer must not depend on where the document is scrolled
//   SELECTION  every page a selection touches, for the same reason: copying a selection
//              that runs off-screen must not copy only the part that happens to be visible
//
// Geometry only. Nothing here reads the DOM; a viewport is two numbers the host supplies.

import type { SemanticLayout } from './semantic-records.ts';

/** The visible band of the document, in layout units. */
export interface ViewportWindow {
  /** Distance from the top of the document to the top of the visible area, in layout units. */
  readonly top: number;
  readonly height: number;
}

/**
 * Which pages to build in detail.
 *
 * A page left out keeps its size and position but no content, so the document's height and page
 * count are unchanged and scrolling to it reveals it rather than reflowing everything below.
 */
export interface MaterializationInput {
  readonly layout: SemanticLayout;
  /** Omitted means "no viewport": everything is materialized, which is the honest default. */
  readonly viewport?: ViewportWindow;
  /** Extra pages kept ready either side of the visible band. */
  readonly overscanPages?: number;
  /** Pages that must be built wherever they are — caret, selection, a search hit. */
  readonly pinnedPages?: Iterable<number>;
}

/**
 * The page indices to build in detail.
 *
 * Returns indices rather than records so a caller can compare cheaply against what it
 * already has mounted, and so the decision can be made without touching the layout.
 */
export function pagesToMaterialize(input: MaterializationInput): Set<number> {
  const { layout, viewport } = input;
  const selected = new Set<number>();

  // No viewport means the caller has not said what it can see. Materializing everything is
  // the safe reading: a wrong guess here silently drops content from print or export.
  if (!viewport) {
    for (const page of layout.pages) selected.add(page.index);
    return selected;
  }

  const overscan = Math.max(0, Math.trunc(input.overscanPages ?? 1));
  const bottom = viewport.top + viewport.height;

  let first = -1;
  let last = -1;
  for (const page of layout.pages) {
    const pageTop = page.box.y;
    const pageBottom = pageTop + page.box.height;
    // Intersects the visible band, boundaries included: a page whose last pixel touches the
    // top of the viewport is on screen.
    if (pageBottom >= viewport.top && pageTop <= bottom) {
      if (first === -1) first = page.index;
      last = page.index;
    }
  }

  if (first === -1) {
    // Scrolled past the end, or into a gap. The nearest page is still the one the user is
    // looking at the edge of, so something is always materialized.
    const nearest = nearestPage(layout, viewport.top);
    if (nearest !== null) {
      first = nearest;
      last = nearest;
    }
  }

  if (first !== -1) {
    const from = Math.max(0, first - overscan);
    const to = Math.min(layout.pages.length - 1, last + overscan);
    for (let index = from; index <= to; index += 1) selected.add(index);
  }

  for (const pinned of input.pinnedPages ?? []) {
    if (pinned >= 0 && pinned < layout.pages.length) selected.add(pinned);
  }
  return selected;
}

/** The page whose box is closest to a vertical position. */
function nearestPage(layout: SemanticLayout, y: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const page of layout.pages) {
    const distance =
      y < page.box.y
        ? page.box.y - y
        : y > page.box.y + page.box.height
          ? y - (page.box.y + page.box.height)
          : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = page.index;
    }
  }
  return best;
}
