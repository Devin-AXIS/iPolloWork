// How much the navigation pane is allowed to move the document, and no more.
//
// THE RULE: an open pane must not move the page while there is room for it in the left
// gutter. A fixed "push the page over by the panel's width" is what makes a wide window
// feel like the editor jumped sideways for no reason — on a 1600px window with a Letter
// page there is already 500px of empty gutter, and the pane fits in it untouched.
//
// The page stack centres itself in the viewport (`.docx-editor-one-surface__pages` is
// `width: max-content` + `margin-inline: auto`), so a left padding P on the viewport does
// NOT move the page by P: it shrinks the centring box, and the page moves by P/2 — until
// the box gets narrower than the page, at which point the auto margins collapse to zero
// and the page sits at exactly P with the overflow scrolling. Both regimes are solved
// here, so the page lands exactly where the pane needs it and never further.

/** Panel width, in px, when the host does not choose one. */
export const NAVIGATION_PANE_WIDTH = 280;

/**
 * Gap between the viewport's left edge and the panel.
 *
 * Clears a vertical ruler: `RULER_WIDTH` is 20px pinned at the viewport's left edge, so
 * anything less puts the panel and its collapsed disc on top of the tick marks.
 */
export const NAVIGATION_PANE_INSET = 32;

/** Clearance kept between the panel's right edge and the page. */
export const NAVIGATION_PANE_GAP = 16;

/** Total left space an open pane needs before the page may start. */
export function navigationPaneReservation(paneWidth = NAVIGATION_PANE_WIDTH): number {
  return NAVIGATION_PANE_INSET + paneWidth + NAVIGATION_PANE_GAP;
}

export interface NavigationShiftInput {
  /** Client width of the scroll container. */
  readonly viewportWidth: number;
  /** Rendered width of one page, zoom applied. */
  readonly pageWidthPx: number;
  /** Space the open pane needs, from {@link navigationPaneReservation}. */
  readonly reservation: number;
  /** Padding already reserved at the inline end, for example by the review rail. */
  readonly inlineEndReservation?: number;
  /**
   * Padding already standing at the inline START besides the shift itself — the review
   * gutter's mirrored strip. It moves the page exactly as the shift does, so a shift
   * computed without it lands the page that far past the reservation.
   */
  readonly inlineStartReservation?: number;
  /**
   * Whether the page's WIDTH follows the padding right now.
   *
   * This turns the answer binary, and it has to. The proportional branch below assumes a page
   * of fixed width sitting in a shrinking box, so padding P moves it by P/2. Where the page is
   * re-scaled to the padded box instead, a partial shift makes the page narrower, which widens
   * the gutter, which asks for a smaller shift, which makes the page wider — the pane and the
   * document chase each other every frame and never settle. Docked or not is a fixed point;
   * anything in between is not.
   *
   * NOT "a fit mode is selected". The default fit is capped at 100%, and on any container with
   * room for the sheet it sits AT that cap with the page a fixed width — exactly the case the
   * proportional branch was written for. Reading the mode alone docked those containers too
   * and pushed the page up to 128px further right than the pane needed. The question is
   * whether the fit is BINDING, which is `zoom < maxZoom`.
   */
  readonly docked?: boolean;
}

/**
 * The viewport's left padding, in px, that puts the page's left edge exactly at
 * `reservation` — and `0` whenever the gutter is already wide enough.
 *
 * Returns 0 for a degenerate measurement (a viewport that has not been laid out yet, a
 * document with no page setup) rather than guessing: shifting on a zero measurement would
 * make the pane jump on the first frame and settle on the second.
 */
export function navigationShift({
  viewportWidth,
  pageWidthPx,
  reservation,
  inlineEndReservation = 0,
  inlineStartReservation = 0,
  docked = false,
}: NavigationShiftInput): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return 0;
  if (!Number.isFinite(reservation) || reservation <= 0) return 0;
  if (!Number.isFinite(inlineEndReservation) || inlineEndReservation < 0) return 0;
  if (!Number.isFinite(inlineStartReservation) || inlineStartReservation < 0) return 0;

  // A review rail (or other inline-end chrome) reduces the box in which the page centres.
  // Ignoring it makes the left gutter look wider than it is, so navigation can cover the
  // page instead of pushing the combined layout into horizontal overflow.
  const gutter = (viewportWidth - inlineEndReservation - pageWidthPx) / 2;
  // The TOTAL start padding the page needs; the shift is what remains of it after the
  // padding already standing there. Solving for the shift alone and adding it on top of
  // the mirrored strip landed the page past the reservation by the strip's width.
  const total =
    // Already room to the left of the page: the pane overlays empty space, the page holds
    // still. This is the common case on any reasonably wide window, and it is the whole
    // point of computing a shift instead of hard-coding one.
    gutter >= reservation
      ? 0
      : // Still centred: total padding S moves the page by S/2, so twice the deficit lands it
        // exactly on the reservation. Valid while the padded box is still at least a page
        // wide, which is the same condition as `reservation <= 2 * gutter` — and only while
        // the page's width is independent of the padding, which a fit mode is exactly the
        // case where it is not.
        !docked && reservation <= 2 * gutter
        ? 2 * (reservation - gutter)
        : // The padded box is narrower than the page: `margin-inline: auto` resolves to zero,
          // the page pins to the padding edge, and the padding IS the offset. Horizontal
          // scrolling appears here, which is correct — there is genuinely not enough room.
          reservation;
  return Math.ceil(Math.max(0, total - inlineStartReservation));
}

/**
 * The narrowest page column, in px, an open pane must leave beside it.
 *
 * Below it a shift cannot help: a 390px phone viewport less the default 328px reservation
 * leaves a 62px strip of page. There the pane overlays the page instead, at the viewport's
 * full width less its inset on each side, and the page does not move.
 */
export const NAVIGATION_PANE_MIN_PAGE_ROOM = 320;

/**
 * Whether an open pane overlays the page rather than moving it: true when the viewport
 * leaves less than {@link NAVIGATION_PANE_MIN_PAGE_ROOM} beside the reservation. Uses the
 * viewport's client width only, never a padding the pane itself causes, so the answer cannot
 * feed back into its own input. `false` for a viewport that has not been measured.
 */
export function navigationPaneOverlays(viewportWidth: number, reservation: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;
  if (!Number.isFinite(reservation) || reservation <= 0) return false;
  return viewportWidth - reservation < NAVIGATION_PANE_MIN_PAGE_ROOM;
}
