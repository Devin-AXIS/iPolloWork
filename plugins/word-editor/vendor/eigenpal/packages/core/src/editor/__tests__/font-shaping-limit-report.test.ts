import { expect, test } from 'bun:test';
import type { EditorFontError, FontConfiguration } from '../../contracts/editor.ts';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HarfBuzzShapingError,
  boundedStructuralFontValidator,
  createFontResourceSnapshot,
  fixedPoint,
  resolveDefaultSurfaceMeasurer,
  sha256FontBytes,
  type FontRequest,
  type LayoutShapingOptions,
  type ShapeInput,
  type ShapedRun,
  type TextShaper,
} from '../../layout/index.ts';
import { resolvedFontMeasurement } from '../resolved-font-measurement.ts';

const request: FontRequest = { family: 'Public Fixture', weight: 400, style: 'normal' };
const bytes = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const limit = 16 * 1024 * 1024;
const refusal = () => new HarfBuzzShapingError('fontOverLimit', { limit, actual: limit + 1 });

// These tests exercise the real admission, adapter, and fallback. A scripted shaper
// supplies the refusal. The 12-byte fixture is not a complete or oversized font.
function fixture(shaper: TextShaper, extraRequest?: FontRequest) {
  const sources = [request, ...(extraRequest ? [extraRequest] : [])].map((face, index) => ({
    request: face,
    id: `public-fixture-${index}`,
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  }));
  const fonts = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 64 * 1024 * 1024,
    resources: sources,
    validateFont: boundedStructuralFontValidator,
  });
  const resolved = fonts.resolve(request);
  if (resolved instanceof FontResolutionError) throw resolved;
  const configuration: FontConfiguration = {
    epoch: 1,
    maxFontBytes: 64 * 1024 * 1024,
    sources,
    defaultFont: { family: request.family, sizeHalfPoints: 22 },
  };
  const shaping: LayoutShapingOptions = {
    fonts,
    shaper,
    defaultFont: configuration.defaultFont,
    environment: {
      script: 'Latn',
      variationAxes: {},
      shapingLibrary: { name: 'public-scripted-shaper', version: '1.0.0' },
      unicodeDataVersion: '16.0.0',
      normalization: 'none',
      language: 'en',
      features: {},
      fixedPointScale: 1000,
      roundingMode: 'halfToEven',
    },
    ligatureCaretPolicy: 'cluster-edges-only',
    operation: {
      resourceEpoch: fonts.epoch,
      configEpoch: 1,
      extensionFingerprint: 'public-fixture',
      shapingHash: 'scripted-shaper-policy',
      producerVersion: 1,
    },
  };
  const fallback = resolveDefaultSurfaceMeasurer(1, { context: null });
  const style = { ...DEFAULT_RUN_STYLE, fontFamily: request.family, fontSizePt: 11 };
  const measure = (onError?: (error: EditorFontError) => void) =>
    resolvedFontMeasurement(shaping, configuration, fallback, 1, 1, onError);
  return { shaping, fonts, resolved, fallback, style, measure };
}

function shaped(input: ShapeInput): ShapedRun {
  const glyphs = [...input.text].map((_character, cluster) => ({
    id: 1,
    cluster,
    originX: fixedPoint(cluster * 3000),
    originY: fixedPoint(0),
    advanceX: fixedPoint(3000),
    advanceY: fixedPoint(0),
    offsetX: fixedPoint(0),
    offsetY: fixedPoint(0),
    outline: { path: '', unitsPerEm: 1000 },
  }));
  return {
    text: input.text,
    direction: input.environment.direction,
    bidiLevel: input.bidiLevel,
    glyphs,
    clusters: glyphs.map((_glyph, index) => ({
      textStart: index,
      textEnd: index + 1,
      glyphStart: index,
      glyphEnd: index + 1,
      advance: fixedPoint(3000),
      caretEdges: [fixedPoint(0), fixedPoint(3000)],
      fontSpan: 0,
    })),
    fontSpans: [
      { glyphStart: 0, glyphEnd: glyphs.length, font: input.environment.font, fallbackIndex: null },
    ],
    metrics: { ascent: fixedPoint(8000), descent: fixedPoint(2000), lineGap: fixedPoint(0) },
  };
}

test('execution refusal reports the admitted request and original cause while width falls back', () => {
  const error = refusal();
  const observed: EditorFontError[] = [];
  const f = fixture({
    shape() {
      throw error;
    },
  });
  const { measurer } = f.measure((reported) => observed.push(reported));
  expect(measurer.measure('AB', f.style)).toBe(f.fallback.measurer.measure('AB', f.style));
  expect(observed).toHaveLength(1);
  expect(observed[0]?.code).toBe('overLimit');
  expect(observed[0]?.request).toEqual(request);
  expect(observed[0]?.cause).toBe(error);
  expect(error.limit).toBe(limit);
  expect(error.actual).toBe(limit + 1);
});

test('width, caret, ink, and face metrics report one refusal per admitted face', () => {
  const observed: EditorFontError[] = [];
  const f = fixture({
    shape() {
      throw refusal();
    },
  });
  const { measurer } = f.measure((error) => observed.push(error));
  measurer.measure('A', f.style);
  expect(measurer.caretAdvances?.('AB', f.style)?.at(-1)).toBe(
    f.fallback.measurer.measure('AB', f.style)
  );
  expect(measurer.inkBounds?.('A', f.style)).toBeUndefined();
  expect(measurer.lineMetrics(f.style, '')).toEqual(f.fallback.measurer.lineMetrics(f.style));
  expect(measurer.lineMetrics(f.style, 'A')).toEqual(f.fallback.measurer.lineMetrics(f.style));
  expect(observed).toHaveLength(1);
});

test('a blank paragraph first reports the same execution refusal through face metrics', () => {
  const observed: EditorFontError[] = [];
  const f = fixture({
    shape() {
      throw refusal();
    },
  });
  const { measurer } = f.measure((error) => observed.push(error));
  expect(measurer.measure('', f.style)).toBe(0);
  expect(observed).toHaveLength(0);
  expect(measurer.lineMetrics(f.style, '')).toEqual(f.fallback.measurer.lineMetrics(f.style));
  expect(observed).toHaveLength(1);
});

test('different admitted faces report separately without changing their source identities', () => {
  const observed: EditorFontError[] = [];
  const bold: FontRequest = { ...request, weight: 700 };
  const seen: ShapeInput[] = [];
  const f = fixture(
    {
      shape(input) {
        seen.push(input);
        throw refusal();
      },
    },
    bold
  );
  const { measurer } = f.measure((error) => observed.push(error));
  measurer.measure('A', f.style);
  measurer.measure('A', { ...f.style, bold: true });
  expect(observed.map((error) => error.request)).toEqual([request, bold]);
  expect(seen[0]?.environment.font).toBe(f.resolved);
  expect(seen[1]?.environment.font).toBe(f.fonts.resolve(bold));
});

test('a fresh measurement owner reports again without a process-wide suppression cache', () => {
  const observed: EditorFontError[] = [];
  const f = fixture({
    shape() {
      throw refusal();
    },
  });
  f.measure((error) => observed.push(error)).measurer.measure('A', f.style);
  f.measure((error) => observed.push(error)).measurer.measure('A', f.style);
  expect(observed).toHaveLength(2);
});

test('a throwing diagnostic callback cannot interrupt width or caret fallback', () => {
  let reports = 0;
  const f = fixture({
    shape() {
      throw refusal();
    },
  });
  const { measurer } = f.measure(() => {
    reports++;
    throw new Error('host failure');
  });
  expect(measurer.measure('AB', f.style)).toBe(f.fallback.measurer.measure('AB', f.style));
  expect(measurer.caretAdvances?.('AB', f.style)?.at(-1)).toBe(
    f.fallback.measurer.measure('AB', f.style)
  );
  expect(reports).toBe(1);
});

test('successful shaping keeps the original measured advance and producer identity', () => {
  const observed: EditorFontError[] = [];
  const seen: ShapeInput[] = [];
  const f = fixture({
    shape(input) {
      seen.push(input);
      return shaped(input);
    },
  });
  const baseline = f.measure();
  const candidate = f.measure((error) => observed.push(error));
  expect(candidate.measurer.measure('AB', f.style)).toBe(6);
  expect(candidate.measurer.measure('AB', f.style)).toBe(baseline.measurer.measure('AB', f.style));
  expect(candidate.producer).toBe(baseline.producer);
  expect(seen.every((input) => input.environment.font === f.resolved)).toBe(true);
  expect(observed).toHaveLength(0);
});

test('an unresolved family still uses fallback without an execution error or shaper call', () => {
  let calls = 0;
  const observed: EditorFontError[] = [];
  const f = fixture({
    shape() {
      calls++;
      throw refusal();
    },
  });
  const unknown = { ...f.style, fontFamily: 'Missing Public Fixture' };
  const { measurer } = f.measure((error) => observed.push(error));
  expect(measurer.measure('AB', unknown)).toBe(f.fallback.measurer.measure('AB', unknown));
  expect(calls).toBe(0);
  expect(observed).toHaveLength(0);
});

test('a run-size refusal retains its previous fallback behavior outside this face-limit fix', () => {
  const observed: EditorFontError[] = [];
  const f = fixture({
    shape() {
      throw new HarfBuzzShapingError('textOverLimit');
    },
  });
  expect(f.measure((error) => observed.push(error)).measurer.measure('AB', f.style)).toBe(
    f.fallback.measurer.measure('AB', f.style)
  );
  expect(observed).toHaveLength(0);
});

test('omitting the host reporter preserves the original bounded fallback', () => {
  const f = fixture({
    shape() {
      throw refusal();
    },
  });
  expect(f.measure().measurer.measure('AB', f.style)).toBe(
    f.fallback.measurer.measure('AB', f.style)
  );
});
