// Headers and footers away from the screen, projected after the edit that moved their numbers.
//
// A footer that shows the page count changes on every page when an edit adds or removes one,
// and a tail of pages reused some pages away changes every page number in it. Projecting them
// all inside the keystroke laid out a footer per page: about a twentieth of a millisecond
// each, which a long document turns into most of the edit. The pass therefore projects only the
// headers and footers near the screen (`withFurnitureLater`), and these steps project the rest
// afterwards, in short steps the deferred layout runs in the background. Until then a page off
// the screen can show its previous numbers; the deferred layout already shows the previous
// layout's pages there.

import {
  completeFurniture,
  pageFurnitureStale,
  withFurnitureLater,
} from '../layout/published-story-projections.ts';
import type { LayoutSteps } from '../layout/layout-steps.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';

/** Pages either side of the screen projected with the edit. */
const NEAR_SCREEN_PAGES = 2;
/** Pages whose headers and footers one background step projects. */
const PAGES_PER_STEP = 100;

/**
 * `steps`, leaving the headers and footers of pages away from `visible` to steps of their own
 * at the end. With nothing on screen, `steps` as they are.
 */
export function* furnitureLaterSteps(
  steps: LayoutSteps<SemanticLayout>,
  visible: ReadonlySet<number> | undefined
): LayoutSteps<SemanticLayout> {
  if (!visible || visible.size === 0) return yield* steps;
  let low = Infinity;
  let high = -Infinity;
  for (const index of visible) {
    low = Math.min(low, index);
    high = Math.max(high, index);
  }
  const later = (index: number): boolean =>
    index < low - NEAR_SCREEN_PAGES || index > high + NEAR_SCREEN_PAGES;
  let layout: SemanticLayout;
  for (;;) {
    const next = withFurnitureLater(later, () => steps.next());
    if (next.done) {
      layout = next.value;
      break;
    }
    const progress = next.value;
    const finalize = progress?.finalize;
    yield progress && finalize
      ? { ...progress, finalize: (pages) => withFurnitureLater(later, () => finalize(pages)) }
      : progress;
  }
  const count = layout.pages.length;
  let from = layout.pages.findIndex((page) => pageFurnitureStale(page, count));
  if (from < 0) return layout;
  for (; from < count; from += PAGES_PER_STEP) {
    const shown = layout;
    // The session already holds this pass's end; only the projection is left.
    yield { pages: shown.pages, finalize: () => shown, settled: true };
    layout = completeFurniture(layout, from, from + PAGES_PER_STEP);
  }
  return layout;
}
