// How wide the page may be drawn so that it fits the room it has.
//
// DOM-FREE ON PURPOSE. Everything here is arithmetic over two numbers a caller measured —
// how much room there is, and how wide one page is at 100%. `zoom-controller.ts` owns the
// measuring and the observing; this module owns the answer, so the rule can be tested
// without a layout, a browser, or a document.
//
// The unit is CSS pixels at 96dpi with zoom NOT applied, which is exactly what
// `Editor.getPageGeometry()` reports. Multiplying that by the number returned here gives
// the width the page will actually paint at.

import type { ZoomMode } from '../contracts/editor.ts';
import type { ReviewPaneOverflow } from '../contracts/review-pane.ts';

/**
 * The review pane's marker strip on one page edge, in CSS px: the markers and the
 * add-comment button. The adapters' review gutters and the zoom fit share this value.
 *
 * Shared adapter glue, not for hosts.
 *
 * @internal
 */
export const REVIEW_MARKERS_GUTTER_PX = 44;

/** The narrowest scale the editor contract accepts. One definition, every user. */
export const ZOOM_MIN = 0.1;
/** The widest scale the editor contract accepts. */
export const ZOOM_MAX = 5;

/**
 * Room left beside the page, per side, when fitting.
 *
 * The page stack hugs its pages (`.docx-editor-one-surface__pages` is `width: max-content`),
 * so a fit computed against the bare available width paints the sheet flush against both
 * edges of the scroller with its drop shadow clipped. This is the breathing room Word leaves.
 */
export const FIT_GUTTER_PX = 24;

/**
 * How small `'auto'` will shrink a page before it stops trying.
 *
 * There is a width below which fitting stops helping. A comments rail takes a fixed 316px
 * whether or not the container can spare it, so on a narrow screen with the pane open the
 * page has a sliver left, and fitting to the sliver produces a document nobody can read to
 * avoid a scrollbar nobody minds. Below this the page keeps a legible size and the container
 * scrolls sideways, which is the ordinary answer to "this does not fit".
 *
 * The ladder carries a rung below this, so a reader who wants to go smaller still has a
 * control that does it — a floor at the ladder's own bottom would leave every zoom-out
 * affordance greyed out in exactly the case the floor exists for.
 */
export const AUTO_ZOOM_FLOOR = 0.5;

/**
 * Fit the page width, but never magnify and never shrink past legibility: the default.
 *
 * A wide container keeps the 100% it has always had, and only one too narrow to hold the
 * sheet shrinks. Uncapped fitting would render a Letter page at 183% on a 1600px monitor,
 * which is a reader app, not Word; unfloored fitting would render it at 20% beside an open
 * comments rail on a phone.
 */
export const AUTO_ZOOM_MODE: ZoomMode = {
  type: 'fit',
  fit: 'pageWidth',
  minZoom: AUTO_ZOOM_FLOOR,
  maxZoom: 1,
};

/**
 * Fit the page width in BOTH directions — the uncapped fit, unlike `'auto'`.
 *
 * A shared constant rather than a literal per call site: modes are compared by value, but a
 * control also has to render its own selected state, and two spellings of one mode in two
 * files is how a menu ends up ticking a row the editor is not in.
 */
export const FIT_WIDTH_ZOOM_MODE: ZoomMode = { type: 'fit', fit: 'pageWidth' };

/** The 100% that has no fitting behind it. */
export const FIXED_ZOOM_MODE: ZoomMode = { type: 'fixed' };

/**
 * Normalize the `'auto'` shorthand a host may pass anywhere a {@link ZoomMode} is accepted.
 *
 * Returns `null` for a value that is neither, so callers refuse rather than silently
 * substituting a mode the caller did not ask for.
 */
export function resolveZoomMode(mode: ZoomMode | 'auto'): ZoomMode | null {
  if (mode === 'auto') return AUTO_ZOOM_MODE;
  if (!mode || typeof mode !== 'object') return null;
  if (mode.type === 'fixed') return FIXED_ZOOM_MODE;
  if (mode.type === 'fit' && mode.fit === 'pageWidth') {
    // The canonical fit gets the shared object back, so a host writing the long form of
    // `'auto'` is reference-equal to `'auto'`.
    return sameZoomMode(mode, AUTO_ZOOM_MODE) ? AUTO_ZOOM_MODE : mode;
  }
  return null;
}

/**
 * Whether two modes say the same thing.
 *
 * `snapshotsEqual` compares `zoomMode` by IDENTITY, and a host's `zoomMode` prop is an object
 * — `<DocxEditor zoomMode={{ type: 'fit', fit: 'pageWidth' }} />` is a fresh literal on every
 * render, which is the spelling the docs show. Without a value comparison somewhere, each of
 * those renders reinstalled the observer, refitted, bumped the tick, and re-rendered every
 * `useEditorState` consumer in the tree — including the page selector that the slice
 * memoization exists to keep asleep. The lane holds its object and compares by value here.
 */
export function sameZoomMode(a: ZoomMode, b: ZoomMode): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.type !== 'fit' || b.type !== 'fit') return true;
  // `Object.is`, not `===`: a bound that arrived as `NaN` — `maxZoom: Number(props.cap)` with
  // nothing in `cap` — is not equal to itself under `===`, so an unchanged prop reported as a
  // change on every render and took the observer, the refit and every consumer's re-render
  // with it. `fitZoom` treats a non-finite bound as absent, so the two really are one mode.
  return a.fit === b.fit && Object.is(a.minZoom, b.minZoom) && Object.is(a.maxZoom, b.maxZoom);
}

/**
 * The scale the page is ENTITLED to when the review rail decides whether its full card
 * column fits beside the page, or `null` when the page has no entitlement to measure.
 *
 * The rail must never measure the LIVE zoom under a fit: that zoom already includes the
 * room the rail reserved last frame, so a threshold computed from it chases itself. The
 * entitlement depends only on the mode (and on the held scale for a fixed mode), so the
 * rail settles in one pass.
 *
 * - A fixed mode is entitled to the scale in force.
 * - A fit with the review pane's `overflow: 'shrinkPage'` is entitled to its lower bound: the column stands
 *   whenever ANY scale the fit may take leaves room for it, and the fit then paints at
 *   the largest of those inside the padded box.
 * - A capped fit is entitled to its cap.
 * - An uncapped fit returns `null`: it fills whatever box it is given, so the full column
 *   always stands.
 *
 * Shared adapter glue for the review gutter, not for hosts.
 *
 * @internal
 */
export function reviewPaneEntitledZoom(
  mode: ZoomMode | undefined,
  zoom: number,
  overflow: ReviewPaneOverflow = 'float'
): number | null {
  if (mode?.type !== 'fit') return zoom;
  if (overflow === 'shrinkPage') {
    // The fit's lower bound. `fitZoom` lets that bound win when it exceeds the cap, so the
    // entitlement is the lower bound in every case.
    return mode.minZoom !== undefined && Number.isFinite(mode.minZoom)
      ? clampToRange(mode.minZoom)
      : ZOOM_MIN;
  }
  return mode.maxZoom !== undefined && mode.maxZoom < ZOOM_MAX ? mode.maxZoom : null;
}

/** Whether a mode makes the engine track the viewport rather than hold a number. */
export function isFitMode(mode: ZoomMode): mode is Extract<ZoomMode, { type: 'fit' }> {
  return mode.type === 'fit';
}

/** What {@link fitZoom} needs to know. All lengths in CSS pixels at 96dpi. */
export interface FitZoomInput {
  /** The scroller's CONTENT box width: `clientWidth` less both inline paddings. */
  readonly availableWidthPx: number;
  /** One page's width at 100%, from `Editor.getPageGeometry()`. */
  readonly pageWidthPx: number;
  /** Room to leave per side; defaults to {@link FIT_GUTTER_PX}. */
  readonly gutterPx?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

/**
 * The scale at which the page fits the room it has, or `null` when that cannot be known yet.
 *
 * NULL RATHER THAN A GUESS. A viewport that has not been laid out reports a zero width, and
 * a document that has not paginated reports no page. Substituting 1 there would paint at
 * 100% on the first frame and jump to the fitted scale on the second — a flinch on every
 * mount. The caller keeps the zoom it already had instead.
 *
 * CLAMPED, not refused, unlike `Editor.setZoom`. That method has a caller to tell about a bad
 * argument; this one is derived from a measurement, and the honest response to "the window is
 * 40px wide" is the narrowest scale there is.
 *
 * QUANTIZED DOWN to whole percent. Down because rounding 0.994 up to 1 paints a page wider
 * than the box it was fitted to; whole percent because the toolbar shows this number, and
 * because a sub-percent tremor from a scrollbar or a fractional device pixel would otherwise
 * re-lay out the whole document for a change nobody can see.
 */
export function fitZoom({
  availableWidthPx,
  pageWidthPx,
  gutterPx = FIT_GUTTER_PX,
  minZoom = ZOOM_MIN,
  maxZoom = ZOOM_MAX,
}: FitZoomInput): number | null {
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) return null;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return null;

  const gutter = Number.isFinite(gutterPx) && gutterPx > 0 ? gutterPx : 0;
  // A viewport narrower than the gutters themselves is still a viewport: fitting to what is
  // left of it after subtracting them would be a negative width, so the gutters give way
  // first. The floor below then catches whatever is left.
  const usable = Math.max(availableWidthPx - 2 * gutter, availableWidthPx * 0.5);

  // BOTH bounds land inside the contract's range, in both directions. Clamping `minZoom` up
  // to the floor but not down to the ceiling let `{ minZoom: 10 }` through as a scale of 10 —
  // a value `setZoom` refuses outright, arriving by the other public path.
  const lower = Number.isFinite(minZoom) ? clampToRange(minZoom) : ZOOM_MIN;
  const upper = Number.isFinite(maxZoom) ? clampToRange(maxZoom) : ZOOM_MAX;

  // QUANTIZE FIRST, clamp second. The other order rounds the bound itself: `x / 100 * 100`
  // floors down for x = 29, 57, 113, 201 and others, so a caller asking for `minZoom: 0.29`
  // was handed 0.28 — a silent one-percent violation of a bound it stated.
  const quantized = Math.floor((usable / pageWidthPx) * 100) / 100;
  // A caller that passes min > max has contradicted itself; the lower bound wins, because
  // an unreadably small page is a worse answer than a slightly-too-large one.
  return Math.min(Math.max(quantized, lower), Math.max(upper, lower));
}

function clampToRange(zoom: number): number {
  return Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
}
