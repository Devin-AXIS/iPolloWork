// Scrolling a band of the pages into view, from layout coordinates.

/** Where a revealed band lands in the scroller, and how the scroll moves. */
export interface ContentScrollOptions {
  block?: 'start' | 'center' | 'centerIfNeeded' | 'nearest';
  offsetPx?: number;
  behavior?: ScrollBehavior;
}

/**
 * Scroll `scroller` so the band from `top` with `height` (scroller pixels) is in view. False
 * when the band was already in view for a `nearest` or `centerIfNeeded` reveal, so nothing
 * moved.
 */
export function scrollBandIntoView(
  scroller: HTMLElement,
  top: number,
  height: number,
  options?: ContentScrollOptions
): boolean {
  const padding = options?.offsetPx ?? 24;
  const block = options?.block ?? 'start';
  const viewport = scroller.clientHeight;
  if (block === 'nearest' || block === 'centerIfNeeded') {
    const above = top < scroller.scrollTop;
    const below = top + height > scroller.scrollTop + viewport;
    if (!above && !below) return false;
  }
  const target =
    block === 'center' || block === 'centerIfNeeded'
      ? top - Math.max(0, (viewport - height) / 2)
      : block === 'nearest' && top > scroller.scrollTop
        ? top + height + padding - viewport
        : top - padding;
  const maxScroll = Math.max(0, scroller.scrollHeight - viewport);
  scroller.scrollTo({
    top: Math.max(0, Math.min(target, maxScroll)),
    behavior: options?.behavior ?? 'auto',
  });
  return true;
}
