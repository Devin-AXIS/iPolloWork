// The one channel between an open navigation pane and the chrome it displaces.
//
// The pane and the viewport are SIBLINGS, not ancestor and descendant — the pane floats
// over the left gutter and the viewport scrolls the pages — so the shift cannot travel
// down through props. It travels through a tiny store published by `DocxEditor.Root`.
//
// A store rather than `useState` in the provider on purpose: the shift is recomputed on
// every viewport resize, and a state-in-provider would re-render the WHOLE editor subtree
// at resize frequency. Only the two consumers (`Viewport`, `HorizontalRuler`) subscribe,
// so a resize repaints the padding and nothing else.
//
// With no `Navigation` mounted nothing ever writes, `getShift()` stays 0, and the viewport
// renders exactly as it did before this existed.

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

/** The published layout channel. Internal: hosts read it through the hooks. */
export interface NavigationLayoutStore {
  getShift(): number;
  setShift(px: number): void;
  subscribeShift(listener: () => void): () => void;
  /**
   * The start-edge room an OPEN pane asks for (`navigationPaneReservation`), 0 while it
   * is closed or unmounted. STATIC on purpose — a function of the pane's own state, never
   * of the measured shift: the review gutter reads this to decide whether its column is
   * affordable, and the shift in turn depends on the gutter, so publishing the shift here
   * instead would close a cycle the two reservations then chase around.
   */
  getReservation(): number;
  setReservation(px: number): void;
  subscribeReservation(listener: () => void): () => void;
  /** The scroll container, registered by `DocxEditor.Viewport` so the pane can measure it. */
  getViewport(): HTMLElement | null;
  setViewport(element: HTMLElement | null): void;
  subscribeViewport(listener: () => void): () => void;
}

export function createNavigationLayoutStore(): NavigationLayoutStore {
  let shift = 0;
  let reservation = 0;
  let viewport: HTMLElement | null = null;
  const shiftListeners = new Set<() => void>();
  const reservationListeners = new Set<() => void>();
  const viewportListeners = new Set<() => void>();
  const notify = (listeners: Set<() => void>) => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getShift: () => shift,
    setShift(px) {
      // Sub-pixel churn would repaint the padding on every resize frame for no visible
      // difference; the shift is only ever consumed as a whole-pixel padding.
      const next = Math.max(0, Math.round(px));
      if (next === shift) return;
      shift = next;
      notify(shiftListeners);
    },
    subscribeShift(listener) {
      shiftListeners.add(listener);
      return () => shiftListeners.delete(listener);
    },
    getReservation: () => reservation,
    setReservation(px) {
      const next = Math.max(0, Math.round(px));
      if (next === reservation) return;
      reservation = next;
      notify(reservationListeners);
    },
    subscribeReservation(listener) {
      reservationListeners.add(listener);
      return () => reservationListeners.delete(listener);
    },
    getViewport: () => viewport,
    setViewport(element) {
      if (element === viewport) return;
      viewport = element;
      notify(viewportListeners);
    },
    subscribeViewport(listener) {
      viewportListeners.add(listener);
      return () => viewportListeners.delete(listener);
    },
  };
}

export const NavigationLayoutContext = createContext<NavigationLayoutStore | null>(null);

export function useNavigationLayoutStore(): NavigationLayoutStore | null {
  return useContext(NavigationLayoutContext);
}

const ZERO = () => 0;
const NOOP_UNSUBSCRIBE = () => () => {};

/**
 * The px the chrome is currently displaced by an open navigation pane. `0` when no pane
 * is mounted, when it is closed, and whenever the left gutter was already wide enough.
 *
 * @public
 */
export function useNavigationShift(): number {
  const store = useNavigationLayoutStore();
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribeShift(listener) : NOOP_UNSUBSCRIBE()),
    [store]
  );
  const getSnapshot = useCallback(() => (store ? store.getShift() : 0), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, ZERO);
}

/**
 * The start-edge room the navigation pane is asking for right now — 0 while it is closed
 * or unmounted. Internal: the review gutter subtracts it before judging whether its card
 * column is affordable, so the two panes never claim the same pixels.
 */
export function useNavigationReservation(): number {
  const store = useNavigationLayoutStore();
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribeReservation(listener) : NOOP_UNSUBSCRIBE()),
    [store]
  );
  const getSnapshot = useCallback(() => (store ? store.getReservation() : 0), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, ZERO);
}

/** The registered scroll container, for the pane's own measurement. Internal. */
export function useNavigationViewportElement(): HTMLElement | null {
  const store = useNavigationLayoutStore();
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribeViewport(listener) : NOOP_UNSUBSCRIBE()),
    [store]
  );
  const getSnapshot = useCallback(() => (store ? store.getViewport() : null), [store]);
  const getServerSnapshot = useCallback(() => null, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
