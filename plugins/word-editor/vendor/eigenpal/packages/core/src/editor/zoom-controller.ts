// Keeping a fit mode fitted: measure the room, ask `zoom-fit.ts` for the scale, apply it.
//
// Split out of `docx-editor.ts` because that file is already near its max-lines cap and this
// is the DOM half of the feature — a `ResizeObserver`, a computed-style read and a frame
// callback. The arithmetic lives next door and is testable without any of it.
//
// THE MEASUREMENT IS THE CONTENT BOX, not the width. `clientWidth` includes padding, and
// padding on the scroll container is exactly how the chrome around the page reserves room:
// the comments rail sets `padding-right`, the docked navigation pane sets
// `padding-inline-start`. Subtracting both leaves the room the page actually has, which is
// why "opening comments shrinks the document" needs no wiring — the observer fires on the
// content-box change and the next fit is simply smaller.

import type { ZoomMode } from '../contracts/editor.ts';
import { surfaceScroller } from './surface-pages.ts';
import {
  REVIEW_MARKERS_GUTTER_PX,
  fitZoom,
  isFitMode,
  reviewPaneEntitledZoom,
} from './zoom-fit.ts';
import { hostTimers, hostWindowOf } from './host-realm.ts';

/** What the controller needs from the editor it serves. */
export interface ZoomControllerHost {
  /** The element the surface mounted into, or null while detached. */
  container(): HTMLElement | null;
  /** The active mode. Read every time — a `setZoomMode` must take effect without a re-install. */
  mode(): ZoomMode;
  /** One page's width at 100%, in CSS pixels, or null before the first layout. */
  pageWidthPx(): number | null;
  /**
   * The authored page width in twips, or null with no document.
   *
   * The guard `refitIfPageResized` compares, and deliberately NOT `pageWidthPx`. That one
   * reads the laid-out page, which means flushing pending layout — safe from a resize
   * callback, but this guard runs inside the session's commit notification, and forcing a
   * flush there re-enters the surface mid-transaction. Section properties are model state and
   * answer the same question: the page is a different size exactly when they say so.
   */
  pageWidthTwips(): number | null;
  /** The scale in force right now. */
  zoom(): number;
  /** Apply a fitted scale. The editor routes this through the same path as `setZoom`. */
  applyZoom(zoom: number): void;
  /**
   * Whether the review pane scrolls beside the page instead of shrinking a capped fit
   * (`overflow: 'scroll'`). Scoped to the review pane: the navigation pane still counts.
   */
  reviewPaneScrolls?(): boolean;
}

export interface ZoomController {
  /** Start observing. Safe to call again; the previous observation is dropped first. */
  attach(): void;
  /** Recompute now — after a load, a page-setup change, or a mode change. */
  refit(): void;
  /**
   * Recompute ONLY if the page is a different width than the last fit was computed against.
   *
   * The cheap hook for the commit path. `refit` reads `clientWidth` and computed style, which
   * forces layout — too much to pay per keystroke — but the page width comes from a layout
   * that has already flushed, so this costs a number comparison on a commit that moved text
   * and a real refit only on one that moved the page.
   */
  refitIfPageResized(): void;
  /** Stop observing and cancel any pending frame. */
  detach(): void;
}

/**
 * The closed review pane's marker strip on both edges, in CSS px. The fallback for a host
 * that marks the pane but has not published `--docx-review-strip`, so an unmeasured first
 * frame fits as a measured one does.
 */
const REVIEW_STRIP_FALLBACK_PX = 2 * REVIEW_MARKERS_GUTTER_PX;

/**
 * The scroller's content box, or null when it cannot be measured.
 *
 * `reviewPaneScrolls` (the review pane's `overflow: 'scroll'`) changes what the REVIEW pane
 * takes from the fit, and nothing else. With a review rail mounted, the review pane takes
 * only the closed pane's marker strip (`--docx-review-strip`), whether it is open or closed,
 * so opening or closing it never relays the page out.
 *
 * The navigation pane keeps its docked behavior in every overflow mode: the room it takes
 * at the start edge still shrinks a fit. That room is the start padding beyond the closed
 * strip's own half — `--docx-nav-shift` plus `--docx-review-gutter-start`, less half the
 * strip. Reading the shift alone would size the page differently with the review pane open
 * and closed, because the shift is solved against the start reservation standing beside it
 * (the page clearance while open, the strip while closed). The sum is the same in both.
 *
 * Without a rail the setting has nothing to act on, and the paddings count as always.
 */
function availableWidth(container: HTMLElement, reviewPaneScrolls = false): number | null {
  const scroller = surfaceScroller(container);
  if (!scroller) return null;
  const width = scroller.clientWidth;
  if (!Number.isFinite(width) || width <= 0) return null;
  const style = scroller.ownerDocument.defaultView?.getComputedStyle(scroller);
  if (reviewPaneScrolls && scroller.hasAttribute('data-review-pane')) {
    const published = Number.parseFloat(style?.getPropertyValue('--docx-review-strip') ?? '');
    const strip = Number.isFinite(published) ? published : REVIEW_STRIP_FALLBACK_PX;
    const half = strip / 2;
    const shift = Number.parseFloat(style?.getPropertyValue('--docx-nav-shift') ?? '');
    const start = Number.parseFloat(style?.getPropertyValue('--docx-review-gutter-start') ?? '');
    const navigation =
      (Number.isFinite(shift) ? shift : 0) + (Number.isFinite(start) ? start : half) - half;
    return Math.max(width - strip - Math.max(navigation, 0), 0);
  }
  if (!style) return width;
  // PHYSICAL, not logical. `clientWidth` is content + padding in physical terms, so these are
  // the two that reduce it whichever way the text runs — and the chrome above uses both
  // spellings (the comments rail sets `padding-right`, the navigation pane sets
  // `padding-inline-start`), which computed style resolves into these regardless.
  //
  // NaN from a value that is not px (a stylesheet that has not applied, a DOM that reports '')
  // means "no reservation known", not "give up" — hence `|| 0` rather than bailing out, which
  // would leave the fit permanently stale.
  const left = Number.parseFloat(style.paddingLeft) || 0;
  const right = Number.parseFloat(style.paddingRight) || 0;
  return Math.max(width - left - right, 0);
}

/**
 * Drive one editor's fit.
 *
 * COALESCED TO A FRAME. A `ResizeObserver` on a dragged window delivers a callback per frame
 * and a fit re-lays out the document, so an uncoalesced controller would re-paginate sixty
 * times a second. One pending frame at a time; the last measurement wins.
 *
 * IDEMPOTENT AT THE APPLY. `fitZoom` quantizes to whole percent, and a recomputation equal to
 * the scale already in force applies nothing. That is what breaks the scrollbar loop: fitting
 * can remove a vertical scrollbar, which widens the content box, which would fit larger and
 * bring the scrollbar back. With the quantum and `scrollbar-gutter: stable` on the viewport,
 * the second pass lands on the same percent and stops.
 */
export function createZoomController(host: ZoomControllerHost): ZoomController {
  let observer: ResizeObserver | null = null;
  let observed: HTMLElement | null = null;
  // Cancelled on the window that issued it: the scroller can move to another one in between.
  const frames = hostTimers(() => observed);
  let frame: number | null = null;
  /** The authored page width the last fit was computed against; see `refitIfPageResized`. */
  let fittedPageWidthTwips: number | null = null;

  function cancelFrame(): void {
    if (frame === null) return;
    frames.cancelAnimationFrame(frame);
    frame = null;
  }

  function refit(): void {
    const mode = host.mode();
    if (!isFitMode(mode)) return;
    const container = host.container();
    if (!container) return;
    // A capped fit keeps its size beside the review pane under `overflow: 'scroll'`. An
    // uncapped fit still fills the padded box.
    const reviewPaneScrolls =
      host.reviewPaneScrolls?.() === true && reviewPaneEntitledZoom(mode, host.zoom()) !== null;
    const width = availableWidth(container, reviewPaneScrolls);
    if (width === null) return;
    const pageWidthPx = host.pageWidthPx();
    if (pageWidthPx === null) return;
    fittedPageWidthTwips = host.pageWidthTwips();

    const next = fitZoom({
      availableWidthPx: width,
      pageWidthPx,
      ...(mode.minZoom !== undefined ? { minZoom: mode.minZoom } : {}),
      ...(mode.maxZoom !== undefined ? { maxZoom: mode.maxZoom } : {}),
    });
    if (next === null || next === host.zoom()) return;
    // A rescale keeps the viewport centre in place, which scrolls sideways once the page is
    // wider than the box (`overflow: 'scroll'`). A reader at the start edge stays there.
    const scroller = surfaceScroller(container);
    const atStart = scroller !== null && scroller.scrollLeft === 0;
    host.applyZoom(next);
    if (atStart && scroller && scroller.scrollLeft !== 0) scroller.scrollLeft = 0;
  }

  function schedule(): void {
    // No rAF (headless, a detached document) means measure now. Losing the coalescing is a
    // performance cost; losing the fit is a correctness one.
    if (!observed || typeof hostWindowOf(observed).requestAnimationFrame !== 'function') {
      refit();
      return;
    }
    frames.migrate();
    if (frame !== null) return;
    frame = frames.requestAnimationFrame(() => {
      frame = null;
      refit();
    });
  }

  return {
    refitIfPageResized(): void {
      const twips = host.pageWidthTwips();
      if (twips === null || twips === fittedPageWidthTwips) return;
      refit();
    },

    attach(): void {
      this.detach();
      const container = host.container();
      if (!container) return;
      const scroller = surfaceScroller(container);
      if (!scroller) return;
      observed = scroller;
      // Absent in a headless host. The editor still fits on attach, load and mode change; it
      // just does not track a resize nobody can perform.
      // The scroller's own window: an observer from another one never reports its boxes.
      const view = hostWindowOf(scroller);
      if (typeof view.ResizeObserver === 'function') {
        observer = new view.ResizeObserver(schedule);
        observer.observe(scroller);
      }
      refit();
    },
    refit,
    detach(): void {
      cancelFrame();
      observer?.disconnect();
      observer = null;
      observed = null;
      // The next document may be any size; a width carried over from the last one would make
      // the guard above answer "unchanged" for a page that changed completely.
      fittedPageWidthTwips = null;
    },
  };
}
