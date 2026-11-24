import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  FontResolutionError,
  harfBuzzFontValidator,
  HARFBUZZ_SHAPING_LIBRARY,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { createShapingEnvironment, MAX_SHAPING_CONTEXT, type ShapeInput } from '../shaped-run.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' as const };
const fonts = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
});
const font = fonts.resolve(request);
if (font instanceof FontResolutionError) throw font;
const environment = createShapingEnvironment({
  font,
  variationAxes: {},
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
  normalization: 'none',
  script: 'Arab',
  language: 'ar',
  direction: 'rtl',
  features: {},
  fallbackOrder: [],
  fixedPointScale: 1000,
  roundingMode: 'halfAwayFromZero',
});
const input = (text: string, context?: ShapeInput['context']): ShapeInput => ({
  text,
  fontSizeHalfPoints: 22,
  bidiLevel: 1,
  environment,
  ...(context ? { context } : {}),
});
const ids = (run: { glyphs: readonly { id: number; cluster: number }[] }) =>
  [...run.glyphs].sort((a, b) => a.cluster - b.cluster).map((glyph) => glyph.id);

test('context joins the boundary letters and is never shaped', () => {
  const shaper = createHarfBuzzTextShaper();
  try {
    const whole = shaper.shape(input('المستفيد'));
    const head = shaper.shape(input('المستف', { before: '', after: 'يد' }));
    const tail = shaper.shape(input('يد', { before: 'المستف', after: '' }));
    expect([...ids(head), ...ids(tail)]).toEqual(ids(whole));
    // Clusters index the shaped text alone.
    for (const glyph of tail.glyphs) expect(glyph.cluster).toBeLessThan(2);
    expect(tail.text).toBe('يد');
  } finally {
    shaper.dispose();
  }
});

test('the result cache keeps runs with different context apart', () => {
  const shaper = createHarfBuzzTextShaper();
  try {
    const alone = shaper.shape(input('يد'));
    const joined = shaper.shape(input('يد', { before: 'المستف', after: '' }));
    expect(ids(joined)).not.toEqual(ids(alone));
    expect(shaper.shape(input('يد'))).toBe(alone);
  } finally {
    shaper.dispose();
  }
});

test('context longer than the bound is refused', () => {
  const shaper = createHarfBuzzTextShaper();
  try {
    const long = 'ب'.repeat(MAX_SHAPING_CONTEXT + 1);
    expect(() => shaper.shape(input('يد', { before: long, after: '' }))).toThrow();
  } finally {
    shaper.dispose();
  }
});
