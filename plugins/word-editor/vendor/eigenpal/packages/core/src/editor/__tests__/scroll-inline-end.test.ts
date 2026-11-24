import { expect, test } from 'bun:test';
import { keepScrollAtInlineEnd } from '../scroll-inline-end.ts';

/** A scroller with a settable content width and its own window, without a DOM. */
function fakeScroller(direction: 'ltr' | 'rtl' = 'ltr') {
  const listeners = new Map<string, () => void>();
  const resizeCallbacks: Array<() => void> = [];
  const view = {
    getComputedStyle: () => ({ direction }),
    ResizeObserver: class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  };
  const scroller = {
    scrollWidth: 1500,
    clientWidth: 1000,
    scrollLeft: 0,
    children: [{}],
    ownerDocument: { defaultView: view },
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const grow = (width: number) => {
    scroller.scrollWidth = width;
    for (const callback of resizeCallbacks) callback();
  };
  const scrollTo = (left: number) => {
    scroller.scrollLeft = left;
    listeners.get('scroll')?.();
  };
  return { scroller, grow, scrollTo, listeners };
}

test('starts at the right end and follows content that grows', () => {
  const { scroller, grow } = fakeScroller();
  const stop = keepScrollAtInlineEnd(scroller as unknown as HTMLElement);
  expect(scroller.scrollLeft).toBe(500);
  // A navigation shift padding the right edge widens the content.
  grow(1620);
  expect(scroller.scrollLeft).toBe(620);
  stop();
});

test('stops following while the reader scrolls away, and resumes at the end', () => {
  const { scroller, grow, scrollTo, listeners } = fakeScroller();
  const stop = keepScrollAtInlineEnd(scroller as unknown as HTMLElement);
  scrollTo(100);
  grow(1700);
  expect(scroller.scrollLeft).toBe(100);
  scrollTo(700);
  grow(1800);
  expect(scroller.scrollLeft).toBe(800);
  stop();
  expect(listeners.size).toBe(0);
});

test('its own scroll, reported after the content grew again, does not unpin it', () => {
  const { scroller, grow, listeners } = fakeScroller();
  const stop = keepScrollAtInlineEnd(scroller as unknown as HTMLElement);
  grow(1600);
  expect(scroller.scrollLeft).toBe(600);
  // The content grows before the event for the write above arrives.
  scroller.scrollWidth = 1650;
  listeners.get('scroll')?.();
  grow(1700);
  expect(scroller.scrollLeft).toBe(700);
  stop();
});

test('a right-to-left scroller keeps its right end by itself, so nothing is pinned', () => {
  const { scroller, grow, listeners } = fakeScroller('rtl');
  const stop = keepScrollAtInlineEnd(scroller as unknown as HTMLElement);
  // Its `scrollLeft` is 0 at the right end; a left-to-right write would move it away.
  expect(scroller.scrollLeft).toBe(0);
  grow(1620);
  expect(scroller.scrollLeft).toBe(0);
  expect(listeners.size).toBe(0);
  stop();
});
