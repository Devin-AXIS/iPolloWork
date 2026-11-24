// A synthesized small capital is 0.8 of its run's size, rounded to a whole half-point, so
// neighbouring run sizes can share one small-capital size.

import { describe, expect, test } from 'bun:test';
import { syntheticSmallCapsScale } from '../export-small-caps.ts';

const smallCapHalfPoints = (halfPoints: number): number =>
  Math.round(syntheticSmallCapsScale(halfPoints) * halfPoints * 1000) / 1000;

describe('synthetic small caps size', () => {
  test('rounds 0.8 of the run size to a whole half-point', () => {
    expect(
      [16, 18, 20, 21, 22, 23, 24, 28, 36, 48].map((halfPoints) => smallCapHalfPoints(halfPoints))
    ).toEqual([13, 14, 16, 17, 18, 18, 19, 22, 29, 38]);
  });

  test('keeps a positive size for tiny and invalid run sizes', () => {
    expect(smallCapHalfPoints(1)).toBe(1);
    expect(syntheticSmallCapsScale(0)).toBe(0.8);
    expect(syntheticSmallCapsScale(Number.NaN)).toBe(0.8);
  });
});
