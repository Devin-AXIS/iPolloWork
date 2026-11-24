// The navigation pane's own state: open, which tab, and how far it displaces the page.
//
// The displacement is the interesting half. An open pane must not move the document while
// there is room for it in the left gutter — see `navigation-geometry.ts` for why a fixed
// push is wrong and how the exact padding is derived. This hook measures the two inputs
// (the scroll container's width, the page's rendered width) and publishes the result on
// the layout store, where `DocxEditor.Viewport` and `DocxEditor.HorizontalRuler` pick it up.
//
// Measurement is a ResizeObserver on the registered viewport plus the snapshot's page
// setup and zoom, NOT a DOM query for a painted page: a pane opened before the first paint
// would otherwise measure nothing and settle a frame later, which reads as a flinch.

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorSnapshot, PageSetup } from '@docx-editor.dev/core/contracts/editor';
import { hostWindowOf, ZOOM_MAX, ZOOM_MIN } from '@docx-editor.dev/core/editor';
import { twipsToPixels } from '../../lib/units';
import { ReviewRailContext, useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useReviewGutter, visibleInlineEndReservation } from '../review-gutter';
import {
  NAVIGATION_PANE_WIDTH,
  navigationPaneOverlays,
  navigationPaneReservation,
  navigationShift,
} from './navigation-geometry';
import { useNavigationLayoutStore, useNavigationViewportElement } from './navigation-layout';
import { trackWidestPage, type WidestPageTracker } from './navigation-widest-page';

/** The pane's tabs: the outline, Find, and Go to (bookmarks). */
export type NavigationTab = 'headings' | 'find' | 'goto';

/** @internal */
export interface PaneGeometry {
  readonly pageSetup: PageSetup | null;
  readonly zoom: number;
  readonly reviewPaneOpen: boolean;
  /** Whether the page's width follows the padding — see `navigationShift`'s `docked`. */
  readonly fitting: boolean;
}

/**
 * The pane's view of the snapshot. Exported for the test that pins `fitting`, which is a rule
 * about two bounds and deserves to be checked against the real selector rather than a copy.
 *
 * @internal
 */
export const selectPaneGeometry = (snapshot: EditorSnapshot): PaneGeometry => {
  const mode = snapshot.zoomMode;
  return {
    pageSetup: snapshot.pageSetup ?? null,
    zoom: snapshot.zoom,
    reviewPaneOpen: snapshot.reviewPaneOpen ?? true,
    // BINDING, and bounded at BOTH ends. A fit resting against either of its own bounds has a
    // page of fixed width and belongs on the proportional branch: at the cap, which the
    // default `'auto'` sits at on every container with room for the page, and equally at the
    // floor, which it sits at on one too narrow for the fit to help. Only in between is the
    // page actually being scaled to the box, which is the condition that makes its width
    // follow the padding.
    fitting:
      mode?.type === 'fit' &&
      snapshot.zoom < (mode.maxZoom ?? ZOOM_MAX) &&
      snapshot.zoom > (mode.minZoom ?? ZOOM_MIN),
  };
};

const samePageGeometry = (a: PaneGeometry, b: PaneGeometry) =>
  a.zoom === b.zoom &&
  a.reviewPaneOpen === b.reviewPaneOpen &&
  a.fitting === b.fitting &&
  a.pageSetup?.pageWidthTwips === b.pageSetup?.pageWidthTwips;

const selectPageCount = (snapshot: EditorSnapshot): number => snapshot.page.total;

/** How `useNavigationPane` is configured. @public */
export interface UseNavigationPaneOptions {
  /** Open state for the first render when the pane is uncontrolled. Defaults to closed. */
  defaultOpen?: boolean;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tab shown first when uncontrolled. Defaults to `'headings'`. */
  defaultTab?: NavigationTab;
  /** Controlled tab. Pair with `onTabChange`. */
  tab?: NavigationTab;
  onTabChange?: (tab: NavigationTab) => void;
  /** Panel width in px. Defaults to {@link NAVIGATION_PANE_WIDTH}. */
  paneWidth?: number;
}

/** What `useNavigationPane` answers. @public */
export interface UseNavigationPaneResult {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
  readonly tab: NavigationTab;
  readonly setTab: (tab: NavigationTab) => void;
  readonly paneWidth: number;
  /**
   * Px the chrome is displaced by, right now. `0` while the pane is closed AND whenever
   * the left gutter was already wide enough to hold it — which is the point.
   */
  readonly shift: number;
  /**
   * Whether the open pane covers the page instead of moving it. True on a viewport too
   * narrow to show a readable page beside the pane (see `NAVIGATION_PANE_MIN_PAGE_ROOM`);
   * `shift` is then 0, and `DocxEditor.Navigation` closes after a heading or result is picked.
   */
  readonly overlay: boolean;
}

/**
 * The navigation pane's behavior, with no UI attached: open state, the active tab, and
 * the document displacement an open pane is entitled to.
 *
 * `DocxEditor.Navigation` calls this and shares the result with its parts. Call it
 * directly to drive a pane of your own.
 *
 * @public
 */
export function useNavigationPane(options: UseNavigationPaneOptions = {}): UseNavigationPaneResult {
  const {
    defaultOpen = false,
    defaultTab = 'headings',
    paneWidth = NAVIGATION_PANE_WIDTH,
  } = options;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [uncontrolledTab, setUncontrolledTab] = useState<NavigationTab>(defaultTab);
  const open = options.open ?? uncontrolledOpen;
  const tab = options.tab ?? uncontrolledTab;

  const { onOpenChange, onTabChange } = options;
  const isOpenControlled = options.open !== undefined;
  const isTabControlled = options.tab !== undefined;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isOpenControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isOpenControlled, onOpenChange]
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const setTab = useCallback(
    (next: NavigationTab) => {
      if (!isTabControlled) setUncontrolledTab(next);
      onTabChange?.(next);
    },
    [isTabControlled, onTabChange]
  );

  // ── Displacement ────────────────────────────────────────────────────────────────────
  const store = useNavigationLayoutStore();
  const viewport = useNavigationViewportElement();
  const rail = useContext(ReviewRailContext);
  const { pageSetup, zoom, reviewPaneOpen, fitting } = useEditorState(
    selectPaneGeometry,
    samePageGeometry
  );
  const editor = useDocxEditor();
  const pageCount = useEditorState(selectPageCount);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [widestPage, setWidestPage] = useState<number | null>(null);
  const [inlineEndReservation, setInlineEndReservation] = useState(0);
  const [inlineStartReservation, setInlineStartReservation] = useState(0);
  // The review gutter the viewport pads by. A dependency of the measurement below: the
  // gutter settles AFTER the pane state it follows, so a measurement keyed on the pane state
  // alone read the previous gutter and left the page off its reservation by the difference.
  const reviewGutter = useReviewGutter();

  // `open` is a dependency as well as `viewport`: a window resized while the pane was
  // closed leaves no observation to react to (a hidden or throttled tab delivers no
  // ResizeObserver callbacks at all), and opening onto a stale width would put the page
  // in the wrong place for one frame. Opening always re-measures.
  useEffect(() => {
    if (!viewport) {
      setViewportWidth(0);
      setInlineEndReservation(0);
      setInlineStartReservation(0);
      return undefined;
    }
    const measure = () => {
      setViewportWidth(viewport.clientWidth);
      const style = hostWindowOf(viewport).getComputedStyle(viewport);
      // A right-to-left interface opens the pane at the right, so the shift pads the right
      // edge and the other edge is the left. The viewport keeps a left-to-right base.
      const rtl = viewport.getAttribute('data-chrome-dir') === 'rtl';
      const padding = Number.parseFloat(rtl ? style.paddingLeft : style.paddingInlineEnd);
      setInlineEndReservation(Number.isFinite(padding) ? padding : 0);
      // The review gutter's value on the SAME edge the shift pads. The custom property, not
      // the computed padding: that already contains this hook's own published shift, and
      // measuring it back would be circular.
      const strip = Number.parseFloat(style.getPropertyValue('--docx-review-gutter-start'));
      setInlineStartReservation(Number.isFinite(strip) ? strip : 0);
    };
    measure();
    const Observer = hostWindowOf(viewport).ResizeObserver;
    if (typeof Observer === 'undefined') return undefined;
    const observer = new Observer(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport, open, reviewPaneOpen, rail?.mounted, rail?.gutters, reviewGutter]);

  // The snapshot reports `pageSetup` as null on some ticks even with a document loaded,
  // and a shift derived from one of those would collapse to zero and snap the page
  // sideways for a frame. The last width a document actually had is the honest answer for
  // a tick that reports none — it only resets when the editor itself goes away.
  const lastPageWidthTwips = useRef<number | null>(null);
  if (pageSetup) lastPageWidthTwips.current = pageSetup.pageWidthTwips;
  const pageWidthTwips = pageSetup?.pageWidthTwips ?? lastPageWidthTwips.current;

  // The page stack is as wide as its WIDEST page (see `navigation-widest-page.ts`). Tracked
  // only while the pane is open; page-count steps and caret-section changes nudge a settled
  // re-read, and the tracker itself listens for document changes.
  const widestTracker = useRef<WidestPageTracker | null>(null);
  useEffect(() => {
    if (!open || !editor) return undefined;
    const tracker = trackWidestPage(editor, setWidestPage, () => viewport);
    widestTracker.current = tracker;
    return () => {
      tracker.dispose();
      if (widestTracker.current === tracker) widestTracker.current = null;
    };
  }, [open, editor, viewport]);
  useEffect(() => widestTracker.current?.nudge(), [pageCount, pageWidthTwips]);

  const reservation = navigationPaneReservation(paneWidth);
  // The review rail takes the inline-end padding, so the room beside the pane is the width
  // left after it. A scrolling review column counts only its visible marker strip.
  const visibleEnd = visibleInlineEndReservation(reviewGutter, inlineEndReservation);
  const overlay = open && navigationPaneOverlays(viewportWidth - visibleEnd, reservation);

  const shift = useMemo(() => {
    if (!open || overlay) return 0;
    if (pageWidthTwips === null) return 0;
    return navigationShift({
      viewportWidth,
      pageWidthPx: Math.max(widestPage ?? 0, twipsToPixels(pageWidthTwips)) * zoom,
      reservation,
      inlineEndReservation,
      inlineStartReservation,
      docked: fitting,
    });
  }, [
    open,
    overlay,
    pageWidthTwips,
    widestPage,
    zoom,
    viewportWidth,
    reservation,
    inlineEndReservation,
    inlineStartReservation,
    fitting,
  ]);

  useEffect(() => {
    if (!store) return undefined;
    store.setShift(shift);
    // A pane unmounting mid-shift would otherwise leave the chrome permanently displaced.
    return () => store.setShift(0);
  }, [store, shift]);

  // What an OPEN pane is asking for, published for the review gutter's affordability
  // check. The STATIC reservation, never the measured shift — the shift depends on the
  // gutter, and publishing it here would close a cycle (see the store's own comment). An
  // overlaying pane reserves nothing: it covers the page and leaves the gutters alone.
  useEffect(() => {
    if (!store) return undefined;
    store.setReservation(open && !overlay ? reservation : 0);
    return () => store.setReservation(0);
  }, [store, open, overlay, reservation]);

  return { open, setOpen, toggle, tab, setTab, paneWidth, shift, overlay };
}
