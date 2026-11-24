// Synthesized small caps scale lowercase letters and spaces to the small capital size, also
// spaces between capitals. Capitals, digits and punctuation keep the run size.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  initializeHarfBuzz,
  harfBuzzFontValidator,
  sha256FontBytes,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
} from '../../layout/index.ts';
import { createShapingEnvironment, type ShapeInput } from '../../layout/shaped-run.ts';
import { synthesizeExportSmallCaps, syntheticSmallCapsScale } from '../export-small-caps.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'A', weight: 400, style: 'normal' as const };
const fonts = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'A', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
});
const resolved = fonts.resolve(request);
if (resolved instanceof FontResolutionError) throw resolved;
const font = resolved;
const shaper = createHarfBuzzTextShaper();
const HALF_POINTS = 24;

function input(text: string, smcp: 0 | 1): ShapeInput {
  return {
    text,
    fontSizeHalfPoints: HALF_POINTS,
    bidiLevel: 0,
    environment: createShapingEnvironment({
      font,
      variationAxes: {},
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      normalization: 'none',
      script: 'Latn',
      language: 'en',
      direction: 'ltr',
      features: { kern: 0, smcp },
      fallbackOrder: [],
      fixedPointScale: 1000,
      roundingMode: 'halfAwayFromZero',
    }),
  };
}

/** The draw scale of each glyph of `text` in synthesized small caps. */
function scales(text: string): (number | undefined)[] {
  const smallCaps = input(text, 1);
  const run = synthesizeExportSmallCaps(shaper, smallCaps, shaper.shape(smallCaps));
  return run.glyphs.map((glyph) => glyph.drawScale);
}

describe('synthesized small caps', () => {
  const scale = syntheticSmallCapsScale(HALF_POINTS);

  test('lowercase letters and spaces take the small capital size', () => {
    expect(scales('a b')).toEqual([scale, scale, scale]);
  });

  test('a space between capitals takes it too; capitals keep the run size', () => {
    expect(scales('A B')).toEqual([1, scale, 1]);
  });

  test('digits and punctuation keep the run size', () => {
    expect(scales('a1(')).toEqual([scale, 1, 1]);
  });
});
