import { describe, expect, test } from 'bun:test';
import { FontResolutionError, createShapingEnvironment } from '../index.ts';
import { shapedHorizontalBoundaries } from '../horizontal-boundary.ts';
import { createHarfBuzzLayoutOptions } from './fixtures/layout-shaping.ts';

function shape(text: string) {
  const shaping = createHarfBuzzLayoutOptions().shaping;
  const font = shaping.fonts.resolve({
    family: shaping.defaultFont.family,
    weight: 400,
    style: 'normal',
  });
  if (font instanceof FontResolutionError) throw font;
  return shaping.shaper.shape({
    text,
    fontSizeHalfPoints: shaping.defaultFont.sizeHalfPoints,
    bidiLevel: 0,
    environment: createShapingEnvironment({
      ...shaping.environment,
      font,
      direction: 'ltr',
      script: 'Latn',
      fallbackOrder: [],
    }),
  });
}

describe('shaped horizontal boundaries', () => {
  test('opaque ligatures expose only cluster edges', () => {
    expect(shapedHorizontalBoundaries(shape('fi'))).toEqual([0, 2]);
  });

  test('combining sequences expose only whole-grapheme edges', () => {
    expect(shapedHorizontalBoundaries(shape('x\u0301'))).toEqual([0, 2]);
  });

  test('ordinary text exposes every exact cluster edge', () => {
    expect(shapedHorizontalBoundaries(shape('abc'))).toEqual([0, 1, 2, 3]);
  });
});
