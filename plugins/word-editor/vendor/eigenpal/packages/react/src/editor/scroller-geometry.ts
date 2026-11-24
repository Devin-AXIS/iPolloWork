/**
 * Convert a client-space point into coordinates for `position: absolute` inside a scroller.
 *
 * Absolute children resolve against the scroller's padding edge. `getBoundingClientRect` is
 * the border box, so a reserved gutter (`scrollbar-gutter: stable both-edges` → non-zero
 * `clientLeft` / `clientTop` in Chromium) must be subtracted or the overlay drifts by that
 * gutter relative to painted content.
 */
export function absolutePointInScroller(
  scroller: HTMLElement,
  clientX: number,
  clientY: number
): { left: number; top: number } {
  const box = scroller.getBoundingClientRect();
  return {
    left: clientX - box.left - scroller.clientLeft + scroller.scrollLeft,
    top: clientY - box.top - scroller.clientTop + scroller.scrollTop,
  };
}
