import { describe, expect, test } from 'bun:test';
import {
  centreViewportOn,
  inlineScrollOffset,
  setInlineScrollOffset,
  viewportCentreX,
} from '../surface-pages.ts';

/**
 * A scroller as a browser reports it: a right-to-left one has `scrollLeft` 0 at its right end
 * and negative values toward the left, clamped to its range like a real one.
 */
function fakeScroller(direction: 'ltr' | 'rtl', scrollWidth = 1500, clientWidth = 1000) {
  const range = scrollWidth - clientWidth;
  let raw = 0;
  const scroller = {
    scrollWidth,
    clientWidth,
    clientLeft: 0,
    offsetLeft: 0,
    get scrollLeft() {
      return raw;
    },
    set scrollLeft(value: number) {
      raw =
        direction === 'rtl'
          ? Math.min(0, Math.max(-range, value))
          : Math.min(range, Math.max(0, value));
    },
    getBoundingClientRect: () => ({ left: 0, width: 0 }),
    ownerDocument: { defaultView: { getComputedStyle: () => ({ direction }) } },
  };
  return scroller as unknown as HTMLElement & { scrollLeft: number };
}

describe('inline scroll offsets', () => {
  test('count from the left end in both directions', () => {
    const ltr = fakeScroller('ltr');
    const rtl = fakeScroller('rtl');
    expect(inlineScrollOffset(ltr)).toBe(0);
    // A right-to-left scroller starts at its right end: 500 from the left end.
    expect(inlineScrollOffset(rtl)).toBe(500);
    setInlineScrollOffset(ltr, 120);
    setInlineScrollOffset(rtl, 120);
    expect(ltr.scrollLeft).toBe(120);
    expect(rtl.scrollLeft).toBe(-380);
    expect(inlineScrollOffset(rtl)).toBe(120);
  });

  test('clamp to the scroll range', () => {
    const rtl = fakeScroller('rtl');
    setInlineScrollOffset(rtl, -50);
    expect(inlineScrollOffset(rtl)).toBe(0);
    setInlineScrollOffset(rtl, 9000);
    expect(inlineScrollOffset(rtl)).toBe(500);
  });

  test('a scroller that reports no width keeps the raw offset', () => {
    const scroller = fakeScroller('rtl');
    Object.defineProperty(scroller, 'scrollWidth', { value: Number.NaN });
    expect(inlineScrollOffset(scroller)).toBe(0);
  });

  test('a rescale keeps the viewport centre in a right-to-left scroller without boxes', () => {
    const rtl = fakeScroller('rtl', 2000, 1000);
    const container = { offsetLeft: 0, getBoundingClientRect: () => ({ left: 0, width: 0 }) };
    setInlineScrollOffset(rtl, 300);
    const x = viewportCentreX(container as unknown as HTMLElement, rtl, 1);
    expect(x).toBe(800);
    centreViewportOn(container as unknown as HTMLElement, rtl, x / 2, 2);
    expect(inlineScrollOffset(rtl)).toBe(300);
  });
});
