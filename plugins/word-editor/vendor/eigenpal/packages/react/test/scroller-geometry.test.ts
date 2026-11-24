import { describe, expect, test } from 'bun:test';
import { absolutePointInScroller } from '../src/editor/scroller-geometry.ts';

describe('absolutePointInScroller', () => {
  test('subtracts the scroller padding-edge gutter from border-box client coords', () => {
    const scroller = {
      getBoundingClientRect: () =>
        ({
          left: 10,
          top: 20,
          right: 810,
          bottom: 620,
          width: 800,
          height: 600,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        }) as DOMRect,
      clientLeft: 15,
      clientTop: 0,
      scrollLeft: 40,
      scrollTop: 80,
    } as HTMLElement;

    expect(absolutePointInScroller(scroller, 265, 146)).toEqual({ left: 280, top: 206 });
  });
});
