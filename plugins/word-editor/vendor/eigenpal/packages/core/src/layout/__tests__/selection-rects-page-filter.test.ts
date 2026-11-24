// A range paints on the pages that draw its paragraphs, including a paragraph cut across pages.

import { describe, expect, test } from 'bun:test';
import { everyStoryOrder } from '../document-order.ts';
import { rangeMayShowOnPages, selectionMarkRects } from '../selection-rects.ts';
import type {
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
} from '../semantic-records.ts';

function line(paragraphId: string, index: number, start: number): LineRecord {
  return {
    id: `${paragraphId}-l${start}`,
    range: { paragraphId, start, end: start + 10 },
    spans: [],
    box: { x: 0, y: index * 14, width: 400, height: 14 },
    contentX: 0,
    baseline: 11,
    leading: 0,
  } as LineRecord;
}

function fragment(paragraphId: string, starts: readonly number[]): ParagraphFragmentRecord {
  return {
    kind: 'paragraph',
    id: `${paragraphId}-${starts[0]}`,
    paragraphId,
    fragmentIndex: 0,
    props: [],
    lines: starts.map((start, index) => line(paragraphId, index, start)),
    box: { x: 0, y: 0, width: 400, height: starts.length * 14 },
    range: { paragraphId, start: 0, end: 40 },
  } as unknown as ParagraphFragmentRecord;
}

function page(index: number, fragments: ParagraphFragmentRecord[]): PageRecord {
  return {
    index,
    box: { x: 0, y: index * 800, width: 600, height: 800 },
    contentBox: { x: 72, y: index * 800 + 72, width: 456, height: 656 },
    fragments,
  } as unknown as PageRecord;
}

// p3 starts on page 1 and ends on page 2; ten more pages follow with nothing selected.
const pages = [
  page(0, [fragment('p0', [0]), fragment('p1', [0])]),
  page(1, [fragment('p2', [0]), fragment('p3', [0, 10])]),
  page(2, [fragment('p3', [20, 30]), fragment('p4', [0])]),
  page(3, [fragment('p5', [0]), fragment('p6', [0])]),
  ...Array.from({ length: 10 }, (_, at) => page(4 + at, [fragment(`q${at}`, [0])])),
];
const layout = { pages } as unknown as SemanticLayout;

describe('selection mark rectangles', () => {
  test('mark each paragraph inside the range once, on the page its mark is on', () => {
    const rects = selectionMarkRects(
      layout,
      { anchor: { paragraphId: 'p2', offset: 0 }, head: { paragraphId: 'p6', offset: 0 } },
      everyStoryOrder(layout)
    );
    expect(rects.map((rect) => [rect.pageIndex, rect.y])).toEqual([
      [1, 0],
      [2, 14],
      [2, 0],
      [3, 0],
    ]);
  });

  test('a range ending on a later page still marks the paragraphs before it', () => {
    const rects = selectionMarkRects(
      layout,
      { anchor: { paragraphId: 'p6', offset: 0 }, head: { paragraphId: 'q2', offset: 0 } },
      everyStoryOrder(layout)
    );
    expect(rects.map((rect) => rect.pageIndex)).toEqual([3, 4, 5]);
  });
});

describe('rangeMayShowOnPages', () => {
  test('a range shows on a visible page that draws any paragraph inside it', () => {
    expect(rangeMayShowOnPages(layout, new Set([2]), 'p3', 'p3')).toBe(true);
    expect(rangeMayShowOnPages(layout, new Set([5]), 'p0', 'q4')).toBe(true);
    expect(rangeMayShowOnPages(layout, new Set([5]), 'p0', 'p6')).toBe(false);
  });

  test('a paragraph outside the body order is always kept', () => {
    expect(rangeMayShowOnPages(layout, new Set([5]), 'header-p', 'header-p')).toBe(true);
  });
});
