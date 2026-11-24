// Line metrics shape a word only when the shaper can substitute a face for it.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type ResolvedFont,
} from '../index.ts';
import { withFontShapingPolicy } from '../font-shaping-policy.ts';
import { LAYOUT_HARFBUZZ_SHAPER_POLICY } from '../layout-shaper-policy.ts';
import {
  markFacePreservingShaper,
  preservesShapingFace,
  type ShapeInput,
  type TextShaper,
} from '../shaped-run.ts';

await initializeHarfBuzz();

function dejaVu(): ResolvedFont {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [{ request, id: 'dejavu-400', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: harfBuzzFontValidator,
  });
  const font = snapshot.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  return font;
}

/** The production shaper, counting the texts it is asked to shape. */
function countingShaper(marked: boolean) {
  const base = createHarfBuzzTextShaper();
  const texts: string[] = [];
  const shaper: TextShaper = {
    shape(input: ShapeInput) {
      texts.push(input.text);
      return base.shape(input);
    },
  };
  return { shaper: marked ? markFacePreservingShaper(shaper) : shaper, texts };
}

function measurerOver(shaper: TextShaper, font: ResolvedFont) {
  return createShapedMeasurer({
    shaper,
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
    fixedPointScale: 1_000,
  });
}

const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 11 };

test('a face-preserving shaper answers line metrics from the face, without shaping the word', () => {
  const font = dejaVu();
  const marked = countingShaper(true);
  const plain = countingShaper(false);
  const fromFace = measurerOver(marked.shaper, font).lineMetrics(style, 'Agreement ');
  const shaped = measurerOver(plain.shaper, font).lineMetrics(style, 'Agreement ');
  // The same band either way: the word shapes in the face it was resolved to.
  expect(fromFace).toEqual(shaped);
  expect(marked.texts).not.toContain('Agreement ');
  expect(plain.texts).toContain('Agreement ');
});

test('the production shaper is face-preserving, and the policy wrapper keeps the mark', () => {
  const production = createHarfBuzzTextShaper();
  expect(preservesShapingFace(production)).toBe(true);
  expect(
    preservesShapingFace(withFontShapingPolicy(production, LAYOUT_HARFBUZZ_SHAPER_POLICY))
  ).toBe(true);
  // A shaper that may substitute a face, a host's own one included, is never assumed to.
  const own: TextShaper = { shape: (input) => production.shape(input) };
  expect(preservesShapingFace(own)).toBe(false);
  expect(preservesShapingFace(withFontShapingPolicy(own, LAYOUT_HARFBUZZ_SHAPER_POLICY))).toBe(
    false
  );
});
