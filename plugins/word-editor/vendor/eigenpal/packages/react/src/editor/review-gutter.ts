// The gutter the review rail reserves beside the page, and no more.
//
// THE RULE: the column is either fully reserved or not reserved at all, and, under the
// default `overflow: 'float'`, a column that cannot be afforded becomes SYMMETRIC.
// The page stack centres itself in the scroller's padding box, so padding one edge by P
// shifts the sheet left by P/2 — pleasant on a wide window, where the sheet and its card
// column read as one centred pair, and wrong on a narrow one, where any one-sided
// reservation (the fixed 316px, or a proportional slice of the leftover) parks the sheet
// visibly off-centre beside a mostly-empty band. There is no width at which a partial
// column looks right: it is too narrow for a card and still wide enough to unbalance the
// page. So the column is either fully affordable or it is not:
//
//   - Affordable (the viewport holds the page at its entitled width, the full column,
//     and a little clearance): the column stands and the pair centres, as it always has.
//   - Not affordable, `overflow: 'float'`: the SAME marker strip is reserved on BOTH
//     edges, so the sheet sits dead-centre and the strip still guarantees room for the
//     markers and the add-comment affordance beside the page. The open card floats over
//     the page.
//   - Not affordable, `overflow: 'scroll'`: the full column stays at the end and the
//     page's clearance is reserved at the start. The fit measures the viewport less the
//     closed pane's strip in both states, so the page keeps ONE size whether the pane is
//     open or closed, and the viewport scrolls sideways to reach the cards.
//   - Closed: the marker strip on both edges, whichever overflow is set.
//
// THE PAGE'S WIDTH IN THAT ARITHMETIC IS ITS ENTITLEMENT, NOT ITS PAINT. Under a fit the
// painted width follows the padded box, so a threshold computed from it chases itself:
// collapsing the column widens the box, which widens the page, which asks the column
// back. The width the page is ENTITLED to — the authored width at the fit's own cap, or
// at the fixed zoom in force — is independent of the padding, so the mode settles in one
// pass. A fit with NO cap has no entitlement to measure against — it fills whatever box
// it is given — so the full column stands and the page absorbs it, exactly as it always
// has. Under the review pane's `overflow: 'shrinkPage'`, a fit is entitled to its FLOOR instead:
// the column stands whenever any scale the fit may take leaves room for it, and the fit
// then paints at the largest such scale inside the padded box. The floor is still a
// property of the mode, not of the padding, so this too settles in one pass. Core's
// `reviewPaneEntitledZoom` owns that rule for both adapters.
//
// ONE value, three consumers. The scroll container pads by it, the horizontal ruler
// mirrors it to stay over the page, and the vertical ruler subtracts it to decide
// "cramped". Two components deciding independently is how a ruler ends up an inch off
// the page it is measuring, so they all read `useReviewGutter`.

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import {
  hostWindowOf,
  REVIEW_MARKERS_GUTTER_PX,
  hostDirectionOf,
  observeHostDirection,
  reviewPaneEntitledZoom,
} from '@docx-editor.dev/core/editor';
import { twipsToPixels } from '../lib/units';
import { useChromeDir } from '../i18n';
import { ReviewRailContext, claimsReviewGutter } from './context';
import { useEditorState } from './useEditorState';
import {
  useNavigationReservation,
  useNavigationViewportElement,
} from './navigation/navigation-layout';

/** Full reservation: the 300px card column plus its 16px gutter off the page edge. */
export const REVIEW_PANE_GUTTER = 316;

/** The marker strip: anchors and the add-comment button, no cards. */
export const REVIEW_MARKERS_GUTTER = REVIEW_MARKERS_GUTTER_PX;

/**
 * Breathing room the page keeps on EACH side for the full column to count as affordable.
 *
 * Without it the column flips in at the exact break-even width and the sheet lands flush
 * against the viewport's left edge — technically the centred pair, visually a page shoved
 * into the corner. 24px is the vertical breathing the viewport already gives the page
 * (`padding: 24px 0`) and the `--doc-page-gap` between sheets, so the horizontal minimum
 * matches what the layout already calls "clear of the edge".
 */
export const REVIEW_GUTTER_PAGE_CLEARANCE = 24;

/** What the scroll container reserves on each edge, in px. */
export interface ReviewGutter {
  readonly inlineStart: number;
  readonly inlineEnd: number;
}

/** The affordable pair: nothing at the start, the full column at the end. */
const FULL_COLUMN: ReviewGutter = { inlineStart: 0, inlineEnd: REVIEW_PANE_GUTTER };

/** The symmetric pair: the marker strip mirrored, so the sheet centres exactly. */
const BALANCED_STRIP: ReviewGutter = {
  inlineStart: REVIEW_MARKERS_GUTTER,
  inlineEnd: REVIEW_MARKERS_GUTTER,
};

/** No rail mounted: nothing reserved anywhere. */
const NO_GUTTER: ReviewGutter = { inlineStart: 0, inlineEnd: 0 };

/**
 * `overflow: 'scroll'` when the column does not fit: the full column at the end, and the
 * page's clearance at the start, so the sheet does not sit flush against the viewport edge
 * while the viewport scrolls sideways to the cards.
 */
const SCROLLING_COLUMN: ReviewGutter = {
  inlineStart: REVIEW_GUTTER_PAGE_CLEARANCE,
  inlineEnd: REVIEW_PANE_GUTTER,
};

/**
 * Whether the gutter is the `overflow: 'scroll'` column that did not fit: the full column
 * stands at the end, but the viewport scrolls sideways to reach it, so only the marker strip
 * is on screen beside the page.
 */
export function reviewGutterScrolls(gutter: ReviewGutter): boolean {
  return (
    gutter.inlineStart === SCROLLING_COLUMN.inlineStart &&
    gutter.inlineEnd === SCROLLING_COLUMN.inlineEnd
  );
}

/**
 * The part of the measured inline-end padding that is on screen. Under a scrolling column
 * the cards sit past the visible edge, so only the marker strip takes room beside the page.
 */
export function visibleInlineEndReservation(gutter: ReviewGutter, measured: number): number {
  if (!reviewGutterScrolls(gutter)) return measured;
  return Math.max(0, measured - (REVIEW_PANE_GUTTER - REVIEW_MARKERS_GUTTER));
}

/**
 * The side of the page the review column takes. It follows the interface: a right-to-left
 * interface reads the page from the right, so its comments sit on the left. The scroll
 * container keeps a left-to-right base for its scroll offsets, so the side is physical.
 */
export type ReviewColumnSide = 'left' | 'right';

/**
 * The side the review column takes: the left when the interface reads right to left. The
 * direction a `LocaleProvider` decides comes first; without one, the `dir` attribute nearest
 * the viewport decides, which is the direction the toolbar inherits too.
 */
export function useReviewColumnSide(): ReviewColumnSide {
  const chrome = useChromeDir();
  const viewport = useNavigationViewportElement();
  const [host, setHost] = useState<'ltr' | 'rtl'>('ltr');
  useLayoutEffect(() => {
    const around = viewport?.parentElement;
    if (chrome || !around) return undefined;
    // `dir` attributes, not the computed style: reading the style here forced a style pass
    // on the first commit, and the padding flip after it then animated on mount.
    const read = () => setHost(hostDirectionOf(around));
    read();
    // A host that flips `dir` at run time moves the toolbar at once; follow it.
    return observeHostDirection(around, read);
  }, [chrome, viewport]);
  return (chrome ?? host) === 'rtl' ? 'left' : 'right';
}

/** The physical paddings for `gutter` with the column on `side`. */
export function physicalReviewGutter(
  gutter: ReviewGutter,
  side: ReviewColumnSide
): { readonly left: number; readonly right: number } {
  return side === 'left'
    ? { left: gutter.inlineEnd, right: gutter.inlineStart }
    : { left: gutter.inlineStart, right: gutter.inlineEnd };
}

export interface ReviewGutterInput {
  /** Whether the pane is showing its cards (`snapshot.reviewPaneOpen`). */
  readonly open: boolean;
  /** Client width of the scroll container. */
  readonly viewportWidth: number;
  /** The width the page is entitled to paint at — authored width times the entitled zoom. */
  readonly pageWidthPx: number;
  /**
   * Start-edge room OTHER chrome is asking for — an open navigation pane's reservation.
   * Without it the column judged only page-against-viewport, stood in the two-pane case,
   * and the pane's displacement then squeezed the fit below the page's entitlement — the
   * very symptom the measurement exists to remove. The STATIC ask (open pane × width),
   * never the pane's computed shift: the shift depends on this gutter, and reading it
   * back would close a cycle the two reservations then chase around.
   */
  readonly inlineStartReservation?: number;
  /**
   * An uncapped fit is in force: the page fills whatever box it is given, so there is no
   * entitlement to measure the leftover against. The full column stands.
   */
  readonly docked?: boolean;
  /**
   * `overflow: 'scroll'`: the full column stands even when it does not fit. The page
   * keeps the one size it has with the pane closed, and the viewport scrolls sideways to
   * reach the cards.
   */
  readonly scroll?: boolean;
}

/**
 * The paddings, in px, the scroll container reserves for the review rail.
 *
 * Returns the FULL column for a degenerate measurement (a viewport that has not been
 * laid out yet, a document with no page setup) rather than guessing: that is the value
 * the stylesheet fell back to before this measurement existed, so an unmeasured first
 * frame paints exactly as it always did and collapses only once there is a real width
 * to decide by.
 */
export function reviewGutter({
  open,
  viewportWidth,
  pageWidthPx,
  inlineStartReservation = 0,
  docked = false,
  scroll = false,
}: ReviewGutterInput): ReviewGutter {
  if (!open) return BALANCED_STRIP;
  if (docked) return FULL_COLUMN;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return FULL_COLUMN;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return FULL_COLUMN;
  const start =
    Number.isFinite(inlineStartReservation) && inlineStartReservation > 0
      ? inlineStartReservation
      : 0;
  const leftover = viewportWidth - start - pageWidthPx - 2 * REVIEW_GUTTER_PAGE_CLEARANCE;
  if (leftover >= REVIEW_PANE_GUTTER) return FULL_COLUMN;
  return scroll ? SCROLLING_COLUMN : BALANCED_STRIP;
}

interface GutterGeometry {
  readonly pageSetup: PageSetup | null;
  readonly reviewPaneOpen: boolean;
  /**
   * The zoom the page is entitled to, whatever it paints at right now: a fit's own cap
   * (`'auto'` caps at 1), a fit's floor under `overflow: 'shrinkPage'`, or the fixed scale in force. Reading the LIVE zoom instead
   * re-creates the feedback loop the module comment describes — under a fit the live
   * zoom already includes whatever this gutter reserved last frame. `null` marks an
   * uncapped fit, which has no entitlement to measure against.
   */
  readonly entitledZoom: number | null;
  /** `overflow: 'scroll'` is in force. */
  readonly scroll: boolean;
}

const selectGutterGeometry = (snapshot: EditorSnapshot): GutterGeometry => {
  const mode = snapshot.zoomMode;
  return {
    pageSetup: snapshot.pageSetup ?? null,
    reviewPaneOpen: snapshot.reviewPaneOpen ?? true,
    entitledZoom: reviewPaneEntitledZoom(mode, snapshot.zoom, snapshot.reviewPane.overflow),
    scroll: snapshot.reviewPane.overflow === 'scroll',
  };
};

const sameGutterGeometry = (a: GutterGeometry, b: GutterGeometry) =>
  a.reviewPaneOpen === b.reviewPaneOpen &&
  a.scroll === b.scroll &&
  a.entitledZoom === b.entitledZoom &&
  a.pageSetup?.pageWidthTwips === b.pageSetup?.pageWidthTwips;

/**
 * The scroll container's client width, kept live by a ResizeObserver.
 *
 * `null` while no viewport is registered — a bare composition without
 * `DocxEditor.Viewport` gets no measurement and must not act on one.
 */
export function useViewportClientWidth(): number | null {
  const viewport = useNavigationViewportElement();
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!viewport) {
      setWidth(null);
      return undefined;
    }
    const sync = () => setWidth(viewport.clientWidth);
    sync();
    const Observer = hostWindowOf(viewport).ResizeObserver;
    if (typeof Observer === 'undefined') return undefined;
    const observer = new Observer(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);

  return width;
}

/**
 * The gutter the review rail reserves right now: nothing with no rail mounted, and the
 * measured `reviewGutter` pair otherwise. The one source for the scroll container's
 * paddings and both rulers.
 *
 * The result is reference-stable — the pure function answers with one of four shared
 * constants — and the hook stores THAT, never the raw width: a resize sweeps through
 * hundreds of widths that all resolve to the same constant, and holding the width as
 * state re-rendered every consumer (the review rail among them) once per pixel. Storing
 * the derived constant lets the state setter bail on identity, so consumers re-render
 * only when the reservation actually flips.
 */
export function useReviewGutter(): ReviewGutter {
  // The SNAPSHOT, not the review hook — this needs a boolean and the page's width, not
  // the queue. And no gutter at all unless a rail is mounted to occupy it.
  const rail = useContext(ReviewRailContext);
  const { pageSetup, reviewPaneOpen, entitledZoom, scroll } = useEditorState(
    selectGutterGeometry,
    sameGutterGeometry
  );
  const viewport = useNavigationViewportElement();
  // An open navigation pane's STATIC ask, from the shared layout store — see the input's
  // own doc for why it is never the pane's computed shift.
  const navigationReservation = useNavigationReservation();
  // The snapshot reports `pageSetup` as null on some ticks even with a document loaded,
  // and a gutter derived from one of those would snap to the full column and back inside
  // one frame. The last width a document actually had is the honest answer for a tick
  // that reports none — same rule as the navigation pane's shift.
  const lastPageWidthTwips = useRef<number | null>(null);
  if (pageSetup) lastPageWidthTwips.current = pageSetup.pageWidthTwips;
  const pageWidthTwips = pageSetup?.pageWidthTwips ?? lastPageWidthTwips.current;

  const mounted = claimsReviewGutter(rail);
  const compute = useCallback(
    (width: number | null): ReviewGutter => {
      if (!mounted) return NO_GUTTER;
      return reviewGutter({
        open: reviewPaneOpen,
        viewportWidth: width ?? 0,
        pageWidthPx:
          pageWidthTwips === null || entitledZoom === null
            ? 0
            : twipsToPixels(pageWidthTwips) * entitledZoom,
        inlineStartReservation: navigationReservation,
        docked: entitledZoom === null,
        scroll,
      });
    },
    [mounted, reviewPaneOpen, pageWidthTwips, entitledZoom, navigationReservation, scroll]
  );

  // A changed input derives the gutter DURING render, not in an effect: the pane's own state
  // and the padding it asks for then reach the DOM in one commit. Deriving it a render later
  // painted one frame with the column open beside a page that had not moved yet.
  const read = (): ReviewGutter => compute(viewport ? viewport.clientWidth : null);
  const [state, setState] = useState(() => ({ compute, viewport, gutter: read() }));
  let current = state;
  if (state.compute !== compute || state.viewport !== viewport) {
    current = { compute, viewport, gutter: read() };
    setState(current);
  }
  useEffect(() => {
    const Observer = viewport ? hostWindowOf(viewport).ResizeObserver : undefined;
    if (!viewport || typeof Observer === 'undefined') return undefined;
    const sync = () =>
      setState((previous) => {
        const gutter = compute(viewport.clientWidth);
        return gutter === previous.gutter ? previous : { compute, viewport, gutter };
      });
    const observer = new Observer(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport, compute]);
  return current.gutter;
}
