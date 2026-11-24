// `w:kern` turns pair kerning on for a run whose size is at least its value. Both are in
// half-points: `w:kern w:val="20"` kerns a 10pt run and leaves a 9.5pt run alone. A zero value
// turns kerning off. Measured on 96 runs in four faces at 9.5, 10, 10.5 and 12pt, with and
// without `w:balanceSingleByteDoubleByteWidth`.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { isRunKerningEnabled } from '../run-kerning.ts';
import { resolveRunStyle } from '../run-style.ts';

/** The run style of `w:sz` and, when given, `w:kern`, both in half-points. */
function style(sizeHalfPoints: number, kernHalfPoints?: number) {
  return resolveRunStyle([
    { localName: 'sz', attributes: { val: String(sizeHalfPoints) } },
    ...(kernHalfPoints === undefined
      ? []
      : [{ localName: 'kern', attributes: { val: String(kernHalfPoints) } }]),
  ] as Parameters<typeof resolveRunStyle>[0]);
}

describe('w:kern threshold', () => {
  test('a run kerns when its size is at least the kern value, in half-points', () => {
    // Size by kern value: [9.5pt, 10pt, 10.5pt, 12pt] x [1pt, 10pt, 10.5pt, 12pt].
    const measured: [size: number, kern: number, kerns: boolean][] = [
      [19, 2, true],
      [19, 20, false],
      [19, 21, false],
      [19, 24, false],
      [20, 2, true],
      [20, 20, true],
      [20, 21, false],
      [20, 24, false],
      [21, 20, true],
      [21, 21, true],
      [21, 24, false],
      [24, 2, true],
      [24, 20, true],
      [24, 24, true],
    ];
    for (const [size, kern, kerns] of measured) {
      expect(`${size}/${kern}: ${isRunKerningEnabled(style(size, kern))}`).toBe(
        `${size}/${kern}: ${kerns}`
      );
    }
  });

  test('a zero kern value turns kerning off at every size', () => {
    for (const size of [19, 20, 21, 24]) expect(isRunKerningEnabled(style(size, 0))).toBe(false);
  });
});

// The measured face does not ship with this repository. Set `REFERENCE_FONT_DIR` to a folder
// that holds `malgun.ttf` to run this check.
const MALGUN = process.env.REFERENCE_FONT_DIR
  ? join(process.env.REFERENCE_FONT_DIR, 'malgun.ttf')
  : '';

describe.skipIf(!MALGUN || !existsSync(MALGUN))('Malgun Gothic under w:kern', () => {
  test('"AVA To" keeps its width with kerning on: the face kerns no Latin pairs', async () => {
    await initializeHarfBuzz();
    const bytes = new Uint8Array(readFileSync(MALGUN));
    const request = { family: 'Malgun Gothic', weight: 400, style: 'normal' } as const;
    const font = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 50_000_000,
      resources: [{ request, id: 'malgun', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
      validateFont: harfBuzzFontValidator,
    }).resolve(request);
    if (font instanceof FontResolutionError) throw font;
    const shaper = createHarfBuzzTextShaper();
    const width = (kern: 0 | 1) =>
      shaper
        .shape({
          text: 'AVA To',
          fontSizeHalfPoints: 20,
          bidiLevel: 0,
          environment: createShapingEnvironment({
            font,
            variationAxes: {},
            shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
            unicodeDataVersion: '16.0.0',
            normalization: 'none',
            script: 'Latn',
            language: 'en',
            direction: 'ltr',
            features: { kern },
            fallbackOrder: [],
            fixedPointScale: 64,
            roundingMode: 'halfAwayFromZero',
          }),
        })
        .glyphs.reduce((sum, glyph) => sum + glyph.advanceX, 0);
    // Measured: 10pt "AVA To" spans 34.40pt with `w:kern w:val="20"`, as it does unkerned.
    // The shaper's 1/64pt advances sum to 34.34pt, 0.06pt short, with kerning on or off.
    expect(width(1)).toBe(width(0));
    expect(width(1) / 64).toBeCloseTo(34.344, 3);
  });
});
