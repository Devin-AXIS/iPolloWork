// Which pages are worth building in detail (task 9.4).

import { describe, expect, test } from 'bun:test';
import { pagesToMaterialize, type SemanticLayout } from '../index.ts';

/** Ten pages of 100 units each, stacked without gaps. */
const layout = {
  revision: 1,
  pages: Array.from({ length: 10 }, (_, index) => ({
    index,
    box: { x: 0, y: index * 100, width: 200, height: 100 },
    contentBox: { x: 10, y: index * 100 + 10, width: 180, height: 80 },
    fragments: [],
  })),
} as unknown as SemanticLayout;

const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);

describe('the visible band, plus what must be ready around it (task 9.4)', () => {
  test('no viewport materializes everything, because the caller has not said otherwise', () => {
    // A wrong guess here silently drops content from print or export, so the default is the
    // safe reading rather than the fast one.
    expect(pagesToMaterialize({ layout }).size).toBe(10);
  });

  test('a viewport over one page takes that page and the overscan band', () => {
    const pages = pagesToMaterialize({
      layout,
      viewport: { top: 320, height: 60 },
      overscanPages: 1,
    });
    expect(sorted(pages)).toEqual([2, 3, 4]);
  });

  test('a viewport straddling two pages takes both', () => {
    const pages = pagesToMaterialize({
      layout,
      viewport: { top: 290, height: 40 },
      overscanPages: 0,
    });
    expect(sorted(pages)).toEqual([2, 3]);
  });

  test('overscan is clamped at the ends rather than producing invalid indices', () => {
    expect(
      sorted(pagesToMaterialize({ layout, viewport: { top: 0, height: 50 }, overscanPages: 3 }))
    ).toEqual([0, 1, 2, 3]);
    expect(
      sorted(pagesToMaterialize({ layout, viewport: { top: 950, height: 50 }, overscanPages: 3 }))
    ).toEqual([6, 7, 8, 9]);
  });

  test('a page touching the very edge of the viewport counts as visible', () => {
    // Off by one here means the top of the screen is blank whenever a boundary lands there.
    expect(
      pagesToMaterialize({ layout, viewport: { top: 300, height: 10 }, overscanPages: 0 }).has(3)
    ).toBe(true);
  });

  test('pinned pages are materialized wherever they are', () => {
    // The caret's page must be built even when scrolled far away: a keystroke has to land
    // somewhere, and the answer cannot depend on the scroll position.
    const pages = pagesToMaterialize({
      layout,
      viewport: { top: 0, height: 100 },
      overscanPages: 0,
      pinnedPages: [9],
    });
    expect(sorted(pages)).toEqual([0, 1, 9]);
  });

  test('a selection spanning pages pins every page it touches', () => {
    const pages = pagesToMaterialize({
      layout,
      viewport: { top: 0, height: 50 },
      overscanPages: 0,
      pinnedPages: [4, 5, 6],
    });
    expect(sorted(pages)).toEqual([0, 4, 5, 6]);
  });

  test('an out-of-range pin is ignored rather than producing a phantom page', () => {
    const pages = pagesToMaterialize({
      layout,
      viewport: { top: 0, height: 50 },
      overscanPages: 0,
      pinnedPages: [-1, 99],
    });
    expect(sorted(pages)).toEqual([0]);
  });

  test('scrolled past the end, the nearest page is still materialized', () => {
    // Something is always built: a viewport past the last page must not come back empty.
    const pages = pagesToMaterialize({
      layout,
      viewport: { top: 5000, height: 100 },
      overscanPages: 0,
    });
    expect(sorted(pages)).toEqual([9]);
  });

  test('a big document materializes a bounded window, not the document', () => {
    const big = {
      revision: 1,
      pages: Array.from({ length: 500 }, (_, index) => ({
        index,
        box: { x: 0, y: index * 100, width: 200, height: 100 },
        contentBox: { x: 10, y: index * 100 + 10, width: 180, height: 80 },
        fragments: [],
      })),
    } as unknown as SemanticLayout;
    const pages = pagesToMaterialize({
      layout: big,
      viewport: { top: 20_000, height: 200 },
      overscanPages: 2,
    });
    // Bounded by the window, not by the document: four pages touch a 200-unit viewport once
    // both boundaries count, plus two of overscan either side.
    expect(pages.size).toBe(8);
    expect(pages.has(200)).toBe(true);
    expect(pages.size).toBeLessThan(big.pages.length / 10);
  });
});
