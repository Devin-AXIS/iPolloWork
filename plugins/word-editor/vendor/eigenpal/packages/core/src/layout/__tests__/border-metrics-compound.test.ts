// Triple and thin-thick borders paint their own strokes and gaps, top to bottom in page space.

import { describe, expect, test } from 'bun:test';
import {
  borderStrokeWidthPt,
  compoundBorderStrokesForExtentPt,
  compoundBorderStrokesPt,
} from '../border-metrics.ts';

/** Strokes and gaps in order, as `[stroke, gap, stroke, ...]`. */
function sequence(val: string, widthPt: number): number[] {
  const strokes = compoundBorderStrokesPt(val, widthPt)!;
  const out: number[] = [];
  strokes.forEach((stroke, index) => {
    if (index) {
      const previous = strokes[index - 1]!;
      out.push(stroke.offsetPt - previous.offsetPt - previous.widthPt);
    }
    out.push(stroke.widthPt);
  });
  return out;
}

describe('compound border strokes', () => {
  test.each([
    ['triple', [3, 3, 3, 3, 3]],
    ['thinThickSmallGap', [3, 0.75, 0.75]],
    ['thickThinSmallGap', [0.75, 0.75, 3]],
    ['thinThickMediumGap', [3, 1.5, 1.5]],
    ['thickThinMediumGap', [1.5, 1.5, 3]],
    ['thinThickLargeGap', [1.5, 3, 0.75]],
    ['thickThinLargeGap', [0.75, 3, 1.5]],
    ['thinThickThinSmallGap', [0.75, 0.75, 3, 0.75, 0.75]],
    ['thinThickThinMediumGap', [1.5, 1.5, 3, 1.5, 1.5]],
    ['thinThickThinLargeGap', [0.75, 3, 1.5, 3, 0.75]],
  ] as const)('%s at 3pt', (val, expected) => {
    expect(sequence(val, 3)).toEqual([...expected]);
    expect(borderStrokeWidthPt(val, 3)).toBeCloseTo(
      expected.reduce((sum, part) => sum + part, 0),
      9
    );
  });

  test('a painter recovers the strokes from the published band', () => {
    for (const val of ['thinThickSmallGap', 'thinThickLargeGap', 'thinThickThinMediumGap']) {
      for (const widthPt of [0.75, 1.5, 3, 6]) {
        expect(compoundBorderStrokesForExtentPt(val, borderStrokeWidthPt(val, widthPt))).toEqual(
          compoundBorderStrokesPt(val, widthPt)
        );
      }
    }
  });

  test('double and single styles are not thin-thick sequences', () => {
    expect(compoundBorderStrokesPt('double', 3)).toBeNull();
    expect(compoundBorderStrokesPt('single', 3)).toBeNull();
    expect(borderStrokeWidthPt('double', 3)).toBe(9);
  });
});
