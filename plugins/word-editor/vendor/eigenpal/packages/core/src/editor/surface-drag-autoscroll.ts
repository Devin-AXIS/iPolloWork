// How a drag follows the pointer past the edge of the scroll container.

import type { HostTimers } from './host-realm.ts';

/** How close to the scroller's edge a drag must reach before the view starts following it. */
const AUTO_SCROLL_EDGE_PX = 40;
/** Fastest the view follows, per frame. */
const AUTO_SCROLL_MAX_PX = 12;

/** How far the view should move this frame, from how deep into the edge zone the drag is. */
export function autoScrollDelta(top: number, bottom: number, clientY: number): number {
  if (clientY < top + AUTO_SCROLL_EDGE_PX) {
    const depth = Math.max(0, top + AUTO_SCROLL_EDGE_PX - clientY);
    return -Math.min(AUTO_SCROLL_MAX_PX, (depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX);
  }
  if (clientY > bottom - AUTO_SCROLL_EDGE_PX) {
    const depth = Math.max(0, clientY - (bottom - AUTO_SCROLL_EDGE_PX));
    return Math.min(AUTO_SCROLL_MAX_PX, (depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX);
  }
  return 0;
}

/**
 * Scroll while the pointer rests in an edge zone. `onScroll` re-reads the last pointer every
 * frame, because a pointer held still at the edge produces no events of its own.
 */
export function createDragAutoScroll(options: {
  readonly scroller: () => HTMLElement | null;
  readonly frames: Pick<HostTimers, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
  readonly onScroll: () => void;
}): { follow(clientY: number): void; stop(): void } {
  let handle: number | null = null;
  let lastClientY = 0;
  const delta = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return autoScrollDelta(rect.top, rect.bottom, lastClientY);
  };
  const tick = () => {
    handle = null;
    const element = options.scroller();
    const step = element ? delta(element) : 0;
    if (!element || step === 0) return;
    element.scrollTop += step;
    options.onScroll();
    handle = options.frames.requestAnimationFrame(tick);
  };
  return {
    follow(clientY) {
      lastClientY = clientY;
      const element = options.scroller();
      if (handle === null && element && delta(element) !== 0) {
        handle = options.frames.requestAnimationFrame(tick);
      }
    },
    stop() {
      if (handle !== null) options.frames.cancelAnimationFrame(handle);
      handle = null;
    },
  };
}
