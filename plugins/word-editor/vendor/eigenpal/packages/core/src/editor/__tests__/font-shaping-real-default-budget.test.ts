import { beforeAll, expect, test } from 'bun:test';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  HarfBuzzShapingError,
  boundedStructuralFontValidator,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  initializeHarfBuzz,
  resolveDefaultSurfaceMeasurer,
  sha256FontBytes,
  type LayoutShapingOptions,
} from '../../layout/index.ts';
import { resolvedFontMeasurement } from '../resolved-font-measurement.ts';
import type { EditorFontError, FontConfiguration } from '../../contracts/editor.ts';
// FontConfiguration belongs to the editor contract, not the layout export.
const request = { family: 'Public Budget Fixture', weight: 400, style: 'normal' as const };
const limit = 16 * 1024 * 1024;
beforeAll(async () => {
  await initializeHarfBuzz();
});
function fixture(length: number) {
  const bytes = new Uint8Array(length);
  bytes.set([0, 1, 0, 0]);
  const source = {
    request,
    id: `budget-${length}`,
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  };
  const fonts = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 64 * 1024 * 1024,
    resources: [source],
    validateFont: boundedStructuralFontValidator,
  });
  const font = fonts.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  expect(font.byteLength).toBe(length);
  const environment = createShapingEnvironment({
    font,
    variationAxes: {},
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '16.0.0',
    normalization: 'none',
    script: 'Latn',
    language: 'en',
    direction: 'ltr',
    features: {},
    fallbackOrder: [],
    fixedPointScale: 1000,
    roundingMode: 'halfToEven',
  });
  const input = { text: 'A', fontSizeHalfPoints: 22, bidiLevel: 0, environment };
  return { fonts, font, source, environment, input };
}
function caught(run: () => unknown): HarfBuzzShapingError {
  let value: unknown;
  try {
    run();
  } catch (error) {
    value = error;
  }
  expect(value).toBeInstanceOf(HarfBuzzShapingError);
  return value as HarfBuzzShapingError;
}
// These arrays have real lengths and owned font capabilities. They lack required font
// tables. Below/equal controls must reach malformedFont, never claim glyph success.
test('real default shaper below 16 MiB reaches required-table refusal instead of byte-limit refusal', () => {
  const f = fixture(limit - 1),
    shaper = createHarfBuzzTextShaper();
  try {
    expect(caught(() => shaper.shape(f.input)).code).toBe('malformedFont');
  } finally {
    shaper.dispose();
  }
});
test('real default shaper at 16 MiB reaches required-table refusal instead of byte-limit refusal', () => {
  const f = fixture(limit),
    shaper = createHarfBuzzTextShaper();
  try {
    expect(caught(() => shaper.shape(f.input)).code).toBe('malformedFont');
  } finally {
    shaper.dispose();
  }
});
test('real default shaper above 16 MiB rejects the true owned byte length before loading a face', () => {
  const f = fixture(limit + 1),
    shaper = createHarfBuzzTextShaper();
  try {
    const error = caught(() => shaper.shape(f.input));
    expect(error.code).toBe('fontOverLimit');
    expect(error.limit).toBe(limit);
    expect(error.actual).toBe(limit + 1);
  } finally {
    shaper.dispose();
  }
});
test('real default byte guard reaches the adapter callback once while fallback and original cause remain intact', () => {
  const f = fixture(limit + 1),
    shaper = createHarfBuzzTextShaper();
  const fonts: FontConfiguration = {
    epoch: 1,
    maxFontBytes: 64 * 1024 * 1024,
    sources: [f.source],
    defaultFont: { family: request.family, sizeHalfPoints: 22 },
  };
  const shaping: LayoutShapingOptions = {
    fonts: f.fonts,
    shaper,
    defaultFont: fonts.defaultFont,
    environment: {
      script: 'Latn',
      variationAxes: {},
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      normalization: 'none',
      language: 'en',
      features: {},
      fixedPointScale: 1000,
      roundingMode: 'halfToEven',
    },
    ligatureCaretPolicy: 'cluster-edges-only',
    operation: {
      resourceEpoch: 1,
      configEpoch: 1,
      extensionFingerprint: 'real-budget',
      shapingHash: 'default-policy',
      producerVersion: 1,
    },
  };
  const fallback = resolveDefaultSurfaceMeasurer(1, { context: null }),
    errors: EditorFontError[] = [];
  const measured = resolvedFontMeasurement(shaping, fonts, fallback, 1, 1, (error) =>
    errors.push(error)
  );
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: request.family, fontSizePt: 11 };
  try {
    expect(measured.measurer.measure('A', style)).toBe(fallback.measurer.measure('A', style));
    measured.measurer.measure('B', style);
    measured.measurer.lineMetrics?.(style);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.request).toEqual(f.font.request);
    const cause = errors[0]!.cause;
    expect(cause).toBeInstanceOf(HarfBuzzShapingError);
    expect((cause as HarfBuzzShapingError).code).toBe('fontOverLimit');
    expect((cause as HarfBuzzShapingError).actual).toBe(limit + 1);
  } finally {
    shaper.dispose();
  }
});
