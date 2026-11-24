import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createFontResourceSnapshot,
  FontResolutionError,
  sha256FontBytes,
} from '../font-resource.ts';
import {
  createHarfBuzzTextShaper,
  HARFBUZZ_SHAPING_LIBRARY,
  initializeHarfBuzz,
  harfBuzzFontValidator,
} from '../harfbuzz-shaper.ts';
import { createShapedMeasurer } from '../shaped-measurer.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

await initializeHarfBuzz();

const STAND_IN = { family: 'Missing CJK Family', weight: 400, style: 'normal' as const };
const FIXTURE = { family: 'Metric Fixture', weight: 400, style: 'normal' as const };
const BOLD = { family: 'Metric Fixture', weight: 700, style: 'normal' as const };

function measurer(
  codePageBit: number,
  gap = 0,
  ascent = 1760,
  request: typeof FIXTURE | typeof STAND_IN | typeof BOLD = FIXTURE
) {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < view.getUint16(4); index++) {
    const record = 12 + index * 16;
    const offset = view.getUint32(record + 8);
    if (view.getUint32(record) === 0x68686561) {
      view.setInt16(offset + 4, ascent);
      view.setInt16(offset + 6, -288);
      view.setInt16(offset + 8, gap);
    }
    if (view.getUint32(record) === 0x4f532f32) {
      view.setUint16(offset, 1);
      view.setUint16(offset + 62, 0); // Do not prefer typo metrics.
      view.setUint32(offset + 78, 1 << codePageBit);
    }
  }
  const snapshot = createFontResourceSnapshot({
    epoch: 0,
    maxFontBytes: 2_000_000,
    validateFont: harfBuzzFontValidator,
    resources: [
      { id: 'metrics', request: FIXTURE, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
    ],
    // A missing family answered by the fixture, as a packaged stand-in is.
    substitutions: [
      { from: STAND_IN, to: FIXTURE },
      { from: BOLD, to: FIXTURE },
    ],
  });
  const font = snapshot.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  return createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });
}

test.each([17, 18, 19, 20])(
  'one-em CJK faces reserve symmetric leading (code page bit %s)',
  (bit) => {
    const measure = measurer(bit);
    for (const size of [10, 11, 18]) {
      const style = { ...DEFAULT_RUN_STYLE, fontSizePt: size };
      const metrics = measure.lineMetrics(style);
      expect(metrics.height).toBeCloseTo(size * 1.3, 2);
      expect(metrics.baseline).toBeCloseTo(size * (1760 / 2048 + 0.15), 2);
      expect(measure.lineMetrics(style)).toEqual(metrics);
      const script = measure.lineMetrics({ ...style, verticalAlign: 'superscript' });
      expect(script.height).toBeCloseTo(metrics.height * 0.65, 3);
    }
  }
);

test.each([0, 16, 21, 31])('other code pages do not add CJK leading (bit %s)', (bit) => {
  expect(measurer(bit).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 }).height).toBeCloseTo(
    11,
    3
  );
});

test('a one-em CJK face with a small gap takes the same 1.3em line', () => {
  // SimSun declares a one-em box plus 36/256 em of leading; Word lays its 12pt lines
  // 15.6pt apart, the same box as a face with no leading.
  const metrics = measurer(18, 288).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 12 });
  expect(metrics.height).toBeCloseTo(12 * 1.3, 2);
  expect(metrics.baseline).toBeCloseTo(12 * (1760 / 2048 + 0.15), 2);
});

test('a CJK face that stands in for another family keeps a larger gap or taller box', () => {
  expect(
    measurer(17, 820).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 }).height
  ).toBeCloseTo((11 * 2868) / 2048, 2);
  expect(
    measurer(17, 0, 2304).lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 }).height
  ).toBeCloseTo((11 * 2592) / 2048, 2);
});

/** A run that names the fixture family, so the fixture draws as itself. */
const named = (fontSizePt: number) => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Metric Fixture',
  fontSizePt,
});

test.each([17, 18, 19, 20])(
  'a taller CJK face drawn as itself takes 1.3 times its own box (code page bit %s)',
  (bit) => {
    // Box 2592/2048 em, as a face with a tall ascent and no leading.
    const measure = measurer(bit, 0, 2304);
    for (const size of [10.5, 11, 12, 20]) {
      const box = (size * 2592) / 2048;
      const metrics = measure.lineMetrics(named(size));
      expect(metrics.height).toBeCloseTo(box * 1.3, 2);
      expect(metrics.baseline).toBeCloseTo((size * 2304) / 2048 + (box * 0.3) / 2, 2);
      expect(measure.lineMetrics(named(size), 'Latin text')).toEqual(metrics);
    }
  }
);

test('a 1.448em CJK face drawn as itself takes 1.882em at 11pt', () => {
  // A 1.448em box: ascent 2678 and descent 288 in the fixture's 2048 units.
  const metrics = measurer(17, 0, 2678).lineMetrics(named(11));
  expect(metrics.height).toBeCloseTo(20.71, 2);
});

test('a CJK face drawn as itself absorbs leading above 0.3 of its box', () => {
  // Box 2257/2048 em plus half an em of leading takes 1.3 boxes, not box plus leading.
  const metrics = measurer(17, 1024, 1969).lineMetrics(named(11));
  const box = (11 * 2257) / 2048;
  expect(metrics.height).toBeCloseTo(box * 1.3, 2);
  expect(metrics.baseline).toBeCloseTo((11 * 1969) / 2048 + (box * 0.3) / 2, 2);
});

test('a taller face without CJK code pages keeps its own box when drawn as itself', () => {
  expect(measurer(0, 0, 2304).lineMetrics(named(11)).height).toBeCloseTo((11 * 2592) / 2048, 2);
});

test('the same face object keeps separate lines as itself and as a stand-in', () => {
  const measure = measurer(17, 0, 2304);
  const asItself = measure.lineMetrics(named(11));
  const asStandIn = measure.lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 });
  expect(asStandIn.height).toBeCloseTo((11 * 2592) / 2048, 2);
  expect(asItself.height).toBeCloseTo(((11 * 2592) / 2048) * 1.3, 2);
  expect(measure.lineMetrics({ ...DEFAULT_RUN_STYLE, fontSizePt: 11 })).toEqual(asStandIn);
  expect(measure.lineMetrics(named(11))).toEqual(asItself);
});

test('a taller CJK face that answers a substitution keeps its own box', () => {
  const measure = measurer(17, 0, 2304, STAND_IN);
  const box = (11 * 2592) / 2048;
  for (const fontFamily of ['Missing CJK Family', 'Metric Fixture']) {
    const style = { ...DEFAULT_RUN_STYLE, fontFamily, fontSizePt: 11 };
    expect(measure.lineMetrics(style).height).toBeCloseTo(box, 2);
  }
});

test('a bold run that the regular face of the same family answers keeps the CJK line', () => {
  const measure = measurer(17, 0, 2304, BOLD);
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: 'Metric Fixture', fontSizePt: 11, bold: true };
  expect(measure.lineMetrics(style).height).toBeCloseTo(((11 * 2592) / 2048) * 1.3, 2);
});
