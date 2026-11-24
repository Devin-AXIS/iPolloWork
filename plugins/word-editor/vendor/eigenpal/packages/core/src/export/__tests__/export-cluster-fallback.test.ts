import { expect, test } from 'bun:test';
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
import {
  createShapedRun,
  createShapingEnvironment,
  type ShapeInput,
  type TextShaper,
} from '../../layout/shaped-run.ts';
import type { LayoutShapingOptions } from '../../layout/shaped-measurer.ts';
import { withExportGlyphFallbacks } from '../export-glyph-fallback.ts';
import { shapeExportHyphenFallback } from '../export-hyphen-fallback.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = (family: string) => ({ family, weight: 400, style: 'normal' as const });
const fonts = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: ['A', 'B', 'C'].map((family) => ({
    request: request(family),
    id: family,
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  })),
  validateFont: harfBuzzFontValidator,
});
const resolvedPrimary = fonts.resolve(request('A'));
if (resolvedPrimary instanceof FontResolutionError) throw resolvedPrimary;
const primary = resolvedPrimary;
const actual = createHarfBuzzTextShaper();
const coverage: TextShaper = {
  shape(input) {
    const result = actual.shape(input);
    return {
      ...result,
      glyphs: result.glyphs.map((glyph) => ({
        ...glyph,
        id: input.text[glyph.cluster] === input.environment.font.request.family ? glyph.id : 0,
      })),
    };
  },
};
const fallback = withExportGlyphFallbacks({ fonts, shaper: coverage } as LayoutShapingOptions, [
  request('B'),
  request('C'),
]).shaper;
function input(text: string, rtl = false): ShapeInput {
  return {
    text,
    fontSizeHalfPoints: 22,
    bidiLevel: rtl ? 1 : 0,
    environment: createShapingEnvironment({
      font: primary,
      variationAxes: {},
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      normalization: 'none',
      script: 'Latn',
      language: 'en',
      direction: rtl ? 'rtl' : 'ltr',
      features: { kern: 0 },
      fallbackOrder: [],
      fixedPointScale: 1000,
      roundingMode: 'halfAwayFromZero',
    }),
  };
}
for (const rtl of [false, true])
  test(`mixed-face fallback preserves logical clusters and visual glyph origins (rtl=${rtl})`, () => {
    const run = fallback.shape(input('ABBC', rtl));
    expect(run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
    expect(run.fontSpans.map((span) => span.font.request.family)).toEqual(
      rtl ? ['C', 'B', 'A'] : ['A', 'B', 'C']
    );
    expect(
      [...run.clusters]
        .sort((a, b) => a.textStart - b.textStart)
        .map((cluster) => [cluster.textStart, cluster.textEnd])
    ).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    let pen = 0;
    for (const glyph of run.glyphs) {
      expect(Number(glyph.originX)).toBe(pen);
      pen += glyph.advanceX;
    }
    for (const cluster of run.clusters) {
      const span = run.fontSpans[cluster.fontSpan]!;
      expect(cluster.glyphStart).toBeGreaterThanOrEqual(span.glyphStart);
      expect(cluster.glyphEnd).toBeLessThanOrEqual(span.glyphEnd);
    }
  });
test('uncovered text and excessive fragmentation remain explicit missing-glyph runs', () => {
  expect(fallback.shape(input('ABCD')).glyphs.some((glyph) => glyph.id === 0)).toBe(true);
  expect(fallback.shape(input('ABC'.repeat(700))).glyphs.some((glyph) => glyph.id === 0)).toBe(
    true
  );
});

test('a complete fallback face does not replace supported primary letters or spaces', () => {
  const shaping = withExportGlyphFallbacks(
    {
      fonts,
      shaper: {
        shape(value: ShapeInput) {
          return value.environment.font.request.family === 'A'
            ? coverage.shape(value)
            : actual.shape(value);
        },
      },
    } as LayoutShapingOptions,
    [request('B')]
  );
  const run = shaping.shaper.shape(input('ABBA'));
  expect(run.fontSpans.map((span) => span.font.request.family)).toEqual(['A', 'B', 'A']);
  expect(run.glyphs.every((glyph) => glyph.id !== 0)).toBe(true);
});

test('missing nonbreaking hyphens use the primary hyphen without losing source Unicode', () => {
  const value = input('A\u2011A');
  const shaped = actual.shape(value);
  const missing = {
    ...shaped,
    glyphs: shaped.glyphs.map((glyph) => ({ ...glyph, id: glyph.cluster === 1 ? 0 : glyph.id })),
  };
  const run = shapeExportHyphenFallback(actual, value, missing);
  expect(run.text).toBe(value.text);
  expect(run.glyphs.map((glyph) => glyph.id)).toEqual(
    actual.shape(input('A-A')).glyphs.map((glyph) => glyph.id)
  );
  expect(run.clusters.map((cluster) => [cluster.textStart, cluster.textEnd])).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  expect(run.fontSpans[0]!.font).toBe(primary);
  expect(shapeExportHyphenFallback(actual, value, shaped)).toBe(shaped);
});

// Cluster fallback rebuilds the run through `createShapedRun`. A synthesized small-caps glyph
// carries `drawScale: 0.8` with its advance already scaled; dropping the scale on the rebuild
// painted full-size letters on short advances. The frozen glyph must keep it.
test('createShapedRun keeps drawScale on the glyphs it freezes', () => {
  const base = actual.shape(input('Ab'));
  const scaled = {
    ...base,
    glyphs: base.glyphs.map((glyph, index) => (index === 1 ? { ...glyph, drawScale: 0.8 } : glyph)),
  };
  const rebuilt = createShapedRun(scaled, input('Ab').environment);
  expect(rebuilt.glyphs[0]!.drawScale).toBeUndefined();
  expect(rebuilt.glyphs[1]!.drawScale).toBe(0.8);
});
