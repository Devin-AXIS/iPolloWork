import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type ResolvedFont,
  type ShapeInput,
} from '../index.ts';
import { fontShapingPolicy, withFontShapingPolicy } from '../font-shaping-policy.ts';

await initializeHarfBuzz();
const regularBytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const largeBytes = new Uint8Array(16 * 2 ** 20 + 1);
largeBytes.set(regularBytes);
function resolved(bytes: Uint8Array, family: string): ResolvedFont {
  const request = { family, weight: 400, style: 'normal' as const };
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 20 * 2 ** 20,
    validateFont: harfBuzzFontValidator,
    resources: [{ request, id: family, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  });
  const face = snapshot.resolve(request);
  if (face instanceof FontResolutionError) throw face;
  return face;
}
const regular = resolved(regularBytes, 'Public Regular');
const large = resolved(largeBytes, 'Public Large');
function input(font = regular, overrides: Partial<ShapeInput['environment']> = {}): ShapeInput {
  return {
    text: 'office AV',
    fontSizeHalfPoints: 24,
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
      features: { kern: 1, liga: 1 },
      fallbackOrder: [],
      fixedPointScale: 64,
      roundingMode: 'halfAwayFromZero',
      ...overrides,
    }),
  };
}
function failure(run: () => unknown): { name: string; code: unknown } {
  try {
    run();
    throw new Error('Expected refusal');
  } catch (error) {
    const value = error as Error & { code?: unknown };
    return { name: value.name, code: value.code };
  }
}

test('explicit execution samples its ceiling and retains the default and hard bounds', () => {
  expect(fontShapingPolicy(undefined).maxFontBytes).toBe(16 * 2 ** 20);
  const options = { maxFontBytes: 20 * 2 ** 20 };
  const sampled = fontShapingPolicy(options);
  options.maxFontBytes = 1;
  expect(sampled.maxFontBytes).toBe(20 * 2 ** 20);
  for (const maxFontBytes of [0, -1, NaN, Infinity, 1.5, 64 * 2 ** 20 + 1]) {
    expect(() => fontShapingPolicy({ maxFontBytes })).toThrow(RangeError);
  }
});

test('default refusal order matches the original shaper without reading unused fallback bytes', () => {
  const original = createHarfBuzzTextShaper();
  const bounded = withFontShapingPolicy(
    createHarfBuzzTextShaper(),
    fontShapingPolicy(undefined),
    true
  );
  try {
    const cases = [
      input(large),
      input(regular, { fallbackOrder: [large] }),
      input(regular, { normalization: 'NFC', fallbackOrder: [large] }),
    ];
    for (const value of cases)
      expect(failure(() => bounded.shape(value))).toEqual(failure(() => original.shape(value)));
    const untrusted = { ...regular, byteLength: large.byteLength } as ResolvedFont;
    const forged = {
      ...input(),
      environment: { ...input().environment, font: untrusted },
    } as ShapeInput;
    expect(failure(() => bounded.shape(forged))).toEqual(failure(() => original.shape(forged)));
  } finally {
    original.dispose();
    bounded.dispose();
  }
});

test('warming a shared native cache with an explicit large face cannot bypass another owner default', () => {
  const native = createHarfBuzzTextShaper({ maxFontBytes: 20 * 2 ** 20 });
  const explicit = withFontShapingPolicy(native, fontShapingPolicy({ maxFontBytes: 20 * 2 ** 20 }));
  const defaults = withFontShapingPolicy(native, fontShapingPolicy(undefined));
  try {
    const shaped = explicit.shape(input(large));
    expect(shaped.glyphs.length).toBeGreaterThan(0);
    expect(failure(() => defaults.shape(input(large))).code).toBe('fontOverLimit');
    explicit.dispose();
    explicit.dispose();
    expect(failure(() => explicit.shape(input(large))).code).toBe('disposed');
    expect(defaults.shape(input()).glyphs.length).toBeGreaterThan(0);
    expect(failure(() => defaults.shape(input(large))).code).toBe('fontOverLimit');
  } finally {
    defaults.dispose();
    native.dispose();
  }
});

test('an owned execution view disposes its native engine and cannot be revived', () => {
  const native = createHarfBuzzTextShaper();
  const owner = withFontShapingPolicy(native, fontShapingPolicy(undefined), true);
  owner.dispose();
  expect(failure(() => owner.shape(input(large))).code).toBe('disposed');
  expect(failure(() => native.shape(input())).code).toBe('disposed');
});
