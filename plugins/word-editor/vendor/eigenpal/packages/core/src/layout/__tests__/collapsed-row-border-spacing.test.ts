import { expect, test } from 'bun:test';
import { contentInsets } from '../table-cell-geometry.ts';

const edge = { state: 'edge' as const, style: 'single' as const, widthPt: 0.125, color: null };
const margins = { top: 4, right: 6, bottom: 4, left: 6 };
const borders = { top: edge, right: edge, bottom: edge, left: edge };

test('collapsed rows reserve one shared border instead of two at every boundary', () => {
  const inset = contentInsets(margins, borders);
  // Arial 9pt's native single line plus authored 4pt top/bottom padding.
  // The saved Word summary rows average 18.46pt; double-charging gives 18.60pt.
  const row = 10.348 + inset.top + inset.bottom;
  expect(row).toBeCloseTo(18.448, 6);
  expect(row * 52).toBeCloseTo(959.296, 6);
});

test('nonzero cell spacing keeps independent full borders', () => {
  expect(contentInsets(margins, borders, false, false)).toEqual({
    top: 4.1,
    right: 6.1,
    bottom: 4.1,
    left: 6.1,
  });
});

test('zero padding clears each half of a centered horizontal stroke', () => {
  expect(contentInsets({ top: 0, right: 0, bottom: 0, left: 0 }, borders)).toEqual({
    top: 0.0625,
    right: 0.125,
    bottom: 0.0625,
    left: 0.125,
  });
});
