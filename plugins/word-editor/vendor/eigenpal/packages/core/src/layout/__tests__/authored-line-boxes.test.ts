// A recorded family with no face of its own keeps its authored line box on the fallback face.

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
  tryCreateCanvasMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type ResolvedRunStyle,
} from '../index.ts';
import { authoredLineBox } from '../authored-line-boxes.ts';

await initializeHarfBuzz();

const style = (fontFamily: string, fontSizePt: number): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily,
  fontSizePt,
});

// Garamond's `hhea`: ascent 1765, descent 539, no gap, over 2048 units per em.
const GARAMOND_HEIGHT_EM = 2304 / 2048;
const GARAMOND_BASELINE_EM = 1765 / 2048;

test('Garamond at 8 pt measures 9 pt above and below the baseline on any fallback', () => {
  const measurer = createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => null,
    fallback: createFixedMeasurer(6, 14),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  for (const family of ['Garamond', 'garamond ']) {
    const metrics = measurer.lineMetrics(style(family, 8), 'Body text');
    expect(metrics.height).toBeCloseTo(8 * GARAMOND_HEIGHT_EM, 9);
    expect(metrics.baseline).toBeCloseTo(8 * GARAMOND_BASELINE_EM, 9);
  }
  expect(measurer.lineMetrics(style('Garamond', 8), 'x').height).toBeCloseTo(9, 9);
  // Bold and italic share the box.
  const bold = { ...style('Garamond', 12), bold: true, italic: true };
  expect(measurer.lineMetrics(bold, 'x').height).toBeCloseTo(12 * GARAMOND_HEIGHT_EM, 9);
});

test('a family that is not recorded keeps the fallback box', () => {
  const fallback = createFixedMeasurer(6, 14);
  const measurer = createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => null,
    fallback,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  const run = style('Rockwell', 10);
  expect(measurer.lineMetrics(run, 'x')).toEqual(fallback.lineMetrics(run, 'x'));
  expect(authoredLineBox(run)).toBeUndefined();
});

test('a face the host supplies for the family keeps its own box', () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const request = { family: 'Garamond', weight: 400, style: 'normal' } as const;
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [{ request, id: 'supplied', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: harfBuzzFontValidator,
  });
  const font = snapshot.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  const measurer = createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => font,
    fallback: createFixedMeasurer(6, 14),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
  const metrics = measurer.lineMetrics(style('Garamond', 10), 'x');
  expect(metrics.height).not.toBeCloseTo(10 * GARAMOND_HEIGHT_EM, 3);
});

/** A canvas whose fallback face reports a 1.0 em box; `Garamond` resolves when `installed`. */
function canvasContext(installed: boolean) {
  let font = '';
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    textAlign: 'left',
    textBaseline: 'alphabetic',
    measureText(text: string) {
      const garamond = installed && font.includes('"Garamond"');
      const size = Number(/([\d.]+)px/.exec(font)?.[1] ?? 16);
      return {
        width: text.length * size * (garamond ? 0.45 : 0.5),
        fontBoundingBoxAscent: size * (garamond ? 0.95 : 0.8),
        fontBoundingBoxDescent: size * (garamond ? 0.35 : 0.2),
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: 0,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 0,
      };
    },
  };
}

test('in the browser, Garamond keeps its box only when the browser has no Garamond face', () => {
  const missing = tryCreateCanvasMeasurer({ context: canvasContext(false) as never })!;
  expect(missing.lineMetrics(style('Garamond', 8), 'x').height).toBeCloseTo(9, 9);
  const installed = tryCreateCanvasMeasurer({ context: canvasContext(true) as never })!;
  expect(installed.lineMetrics(style('Garamond', 8), 'x').height).not.toBeCloseTo(9, 3);
});
