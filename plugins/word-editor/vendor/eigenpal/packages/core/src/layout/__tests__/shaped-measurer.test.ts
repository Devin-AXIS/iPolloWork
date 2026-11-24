// Exact line metrics and advances read from the font itself (task 7.7).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { hitTestPage, spanOffsetX } from '../semantic-hit-test.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';
import {
  DEFAULT_RUN_STYLE,
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createLayoutShapedMeasurer,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
  type LayoutShapingOptions,
  type ResolvedFont,
  type ResolvedRunStyle,
} from '../index.ts';

await initializeHarfBuzz();

const REQUEST: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };

function resolvedFixture(): ResolvedFont {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: REQUEST,
        id: 'dejavu-400',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const result = snapshot.resolve(REQUEST);
  if (result instanceof FontResolutionError) throw result;
  return result;
}

function resolvedSubstitute(): ResolvedFont {
  const bytes = new Uint8Array(
    readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const requested: FontRequest = { family: 'Original Face', weight: 400, style: 'normal' };
  const snapshot = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: REQUEST,
        id: 'dejavu-substitute',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    substitutions: [
      {
        from: requested,
        to: REQUEST,
        lineMetrics: { heightEm: 1.2, baselineEm: 0.95 },
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  const result = snapshot.resolve(requested);
  if (result instanceof FontResolutionError) throw result;
  return result;
}

const font = resolvedFixture();
const fallback = createFixedMeasurer(6, 14);

const measurer = (resolve: (style: ResolvedRunStyle) => ResolvedFont | null = () => font) =>
  createShapedMeasurer({
    shaper: createHarfBuzzTextShaper(),
    resolveFont: resolve,
    fallback,
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
  });

const style = (overrides: Partial<ResolvedRunStyle> = {}): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontSizePt: 11,
  ...overrides,
});

test('layout adapter executes the exact environment carried by its operation identity', () => {
  const actualShaper = createHarfBuzzTextShaper();
  const observed: LayoutShapingOptions['environment'][] = [];
  const environment: LayoutShapingOptions['environment'] = {
    script: 'Arab',
    variationAxes: {},
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '16.0.0',
    normalization: 'none',
    language: 'pl',
    features: { kern: 0, liga: 0 },
    fixedPointScale: 777,
    roundingMode: 'towardZero',
  };
  const shaping = {
    fonts: {} as LayoutShapingOptions['fonts'],
    shaper: {
      shape(input) {
        observed.push(input.environment);
        return actualShaper.shape(input);
      },
    },
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
    environment,
    ligatureCaretPolicy: 'cluster-edges-only',
    operation: {
      resourceEpoch: 1,
      configEpoch: 1,
      extensionFingerprint: 'font-config:test',
      shapingHash: 'shaping:test',
      producerVersion: 1,
    },
  } satisfies LayoutShapingOptions;
  const adapted = createLayoutShapedMeasurer(shaping, {
    resolveFont: () => font,
    fallback,
  });

  adapted.measure('Adapter', style());

  expect(observed[0]).toMatchObject(environment);
  expect(observed[0]?.script).toBe('Arab');
  expect(observed[0]?.fixedPointScale).toBe(777);
  expect(observed[0]?.roundingMode).toBe('towardZero');
  expect(observed[0]?.features).toEqual({ kern: 0, liga: 0 });
  actualShaper.dispose();
});

describe('line metrics come from the font, not from a multiplier (task 7.7)', () => {
  test('bounds the document-scoped shaped-width working set', () => {
    let calls = 0;
    const bounded = createShapedMeasurer({
      shaper: {
        shape(input) {
          calls += 1;
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [
              {
                id: 1,
                cluster: 0,
                originX: 0,
                originY: 0,
                advanceX: 1_000,
                advanceY: 0,
                offsetX: 0,
                offsetY: 0,
                outline: { path: '', unitsPerEm: 1_000 },
              },
            ],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 0 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    bounded.measure('oldest', style());
    for (let index = 0; index < 4_096; index += 1) bounded.measure(`unique-${index}`, style());
    bounded.measure('unique-4095', style());
    expect(calls).toBe(4_097);
    bounded.measure('oldest', style());
    expect(calls).toBe(4_098);
  });

  test('the line height is the face ascent plus descent', () => {
    const metrics = measurer().lineMetrics(style());
    expect(metrics.height).toBeGreaterThan(0);
    expect(metrics.baseline).toBeGreaterThan(0);
    // The baseline is the ascent, so it is strictly inside the line.
    expect(metrics.baseline).toBeLessThan(metrics.height);
  });

  test('a metric substitute can preserve the requested face line box', () => {
    const substitute = resolvedSubstitute();
    const metrics = measurer(() => substitute).lineMetrics(style({ fontSizePt: 10 }));
    expect(metrics).toEqual({ height: 12, baseline: 9.5 });
  });

  test('hhea lineGap precedes the baseline inside the Word line box', () => {
    const withExternalGap = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 500 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });

    // Word's single-spaced line box is ascent + descent + lineGap. Measured against Word's
    // own PDF: an Arial 10 pt line pitch is 11.50 pt, which is (1854 + 434 + 67) / 2048 em,
    // not the 11.17 pt that dropping the gap gives.
    expect(withExternalGap.lineMetrics(style())).toEqual({ height: 11.5, baseline: 9.5 });
  });

  test('Liberation Sans measures Word\u2019s Arial line box, gap included', () => {
    // Word\u2019s own PDF of an Arial 10 pt paragraph puts consecutive baselines 11.50 pt
    // apart. Liberation Sans carries Arial\u2019s metrics exactly \u2014 hhea 1854 / -434 / 67
    // over 2048 units \u2014 so the shipped substitute has to land on the same number.
    const bytes = new Uint8Array(
      readFileSync(new URL('../../../../fonts/assets/LiberationSans-Regular.ttf', import.meta.url))
    );
    const request: FontRequest = { family: 'Liberation Sans', weight: 400, style: 'normal' };
    const snapshot = createFontResourceSnapshot({
      epoch: 1,
      maxFontBytes: 2_000_000,
      resources: [
        { request, id: 'liberation-400', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
      ],
      validateFont: harfBuzzFontValidator,
    });
    const resolved = snapshot.resolve(request);
    if (resolved instanceof FontResolutionError) throw resolved;
    const metrics = measurer(() => resolved).lineMetrics(style({ fontSizePt: 10 }));
    expect(metrics.height).toBeCloseTo(11.5, 2);
    // The saved Word sample places Arial 36pt 1.2pt below its hhea ascent alone.
    // Arial/Liberation Sans external leading is 67/2048 em: 1.178pt at 36pt.
    expect(metrics.baseline).toBeCloseTo(9.38, 2);
  });

  test('a negative hhea lineGap cannot crush the line box', () => {
    // `hhea.lineGap` is a signed int16 read from a font, and a DOCX embeds fonts. A face
    // declaring a gap that cancels its own ascent and descent would otherwise give every run
    // in that family a one-unit line box, and the `height > 0` guard would not catch it.
    // External leading is non-negative on Windows and in GDI.
    const hostile = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: -10_999 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    expect(hostile.lineMetrics(style())).toEqual({ height: 11, baseline: 9 });
  });

  test('an enormous hhea lineGap cannot turn one run into a page', () => {
    // The other end of the same file-derived number. `lineGap = 32767` over 1000 units per em
    // is a ~337 pt line for a 10 pt run — one line to a page for the whole document — and
    // nothing downstream bounds a line box. Capped at half the face's own ascent + descent,
    // against a largest real gap among the shipped faces of 0.038 face boxes.
    const enormous = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 32_767_000 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    // Face box 11, so the gap is admitted up to 5.5 and the line box stops at 16.5 — 1.5x
    // the face, against the largest real gap among the shipped faces of 0.038 face boxes.
    expect(enormous.lineMetrics(style())).toEqual({ height: 16.5, baseline: 14.5 });
  });

  test('a face box far larger than the em is clamped, baseline with it', () => {
    // The gap ceiling is a multiple of the FACE BOX, and the face box is `hhea` int16 over
    // `head.unitsPerEm` — both from the same embedded font, and the shaper admits any safe
    // integer over any positive em. Bounding one attacker-controlled number against another
    // bounds nothing, so the face box is clamped against the size it is drawn at first.
    const huge = createShapedMeasurer({
      shaper: {
        shape(input) {
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [],
            clusters: [],
            fontSpans: [],
            // 900 pt of ascent and 100 pt of descent for an 11 pt run.
            metrics: { ascent: 900_000, descent: 100_000, lineGap: 0 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    // 4 em at 11 pt is 44, and the baseline keeps its 0.9 share of the box.
    const metrics = huge.lineMetrics(style());
    expect(metrics.height).toBeCloseTo(44, 6);
    expect(metrics.baseline).toBeCloseTo(39.6, 6);
  });

  test('it is NOT the flat multiplier the fallback uses, so the font is really being read', () => {
    // If the two agreed, the test would pass whether or not the font was consulted.
    const exact = measurer().lineMetrics(style());
    const approximate = fallback.lineMetrics(style());
    expect(exact.height).not.toBe(approximate.height);
  });

  test('line height scales with the run size', () => {
    const small = measurer().lineMetrics(style({ fontSizePt: 8 }));
    const large = measurer().lineMetrics(style({ fontSizePt: 24 }));
    expect(large.height).toBeGreaterThan(small.height * 2);
  });

  test('superscript measures at 65%, so it does not inflate its line', () => {
    const baseline = measurer().lineMetrics(style());
    const raised = measurer().lineMetrics(style({ verticalAlign: 'superscript' }));
    expect(raised.height).toBeLessThan(baseline.height);
  });

  test('superscript line metrics are EXACTLY 65% of the baseline metrics', () => {
    // 11pt × 0.65 = 7.15pt = 14.3 half-points. Do not round the scaled size
    // before shaping: advances must match the fractional size used by paint.
    const baseline = measurer().lineMetrics(style());
    const raised = measurer().lineMetrics(style({ verticalAlign: 'superscript' }));
    expect(raised.height).toBeCloseTo(baseline.height * 0.65, 6);
    expect(raised.baseline).toBeCloseTo(baseline.baseline * 0.65, 6);
  });
});

describe('advances are summed glyph advances (task 7.7)', () => {
  test('a longer string is wider, and width grows with size', () => {
    const measure = measurer();
    expect(measure.measure('mm', style())).toBeGreaterThan(measure.measure('m', style()));
    expect(measure.measure('hello', style({ fontSizePt: 22 }))).toBeGreaterThan(
      measure.measure('hello', style())
    );
  });

  test('a proportional face gives different widths to different letters', () => {
    // The whole reason for shaping rather than counting characters: `i` is not `m`.
    const measure = measurer();
    expect(measure.measure('i', style())).not.toBe(measure.measure('m', style()));
  });

  test('empty text has no width and never reaches the shaper', () => {
    expect(measurer().measure('', style())).toBe(0);
  });

  test('horizontal scaling multiplies the advance, character spacing adds to it', () => {
    // Word's order: scale the shaped advance, then add spacing per character, so spacing is
    // an absolute addition the scale does not multiply.
    const measure = measurer();
    const plain = measure.measure('abc', style());
    const scaled = measure.measure('abc', style({ horizontalScalePercent: 200 }));
    expect(scaled).toBeCloseTo(plain * 2, 5);
    const spaced = measure.measure('abc', style({ characterSpacingPt: 1 }));
    expect(spaced).toBeCloseTo(plain + 3, 5);
    const both = measure.measure(
      'abc',
      style({ horizontalScalePercent: 200, characterSpacingPt: 1 })
    );
    expect(both).toBeCloseTo(plain * 2 + 3, 5);
  });

  test('repeated measurement is cached and stays identical', () => {
    const measure = measurer();
    expect(measure.measure('cached', style())).toBe(measure.measure('cached', style()));
  });

  test('small caps enables smcp and has a separate shaped-width cache entry', () => {
    let calls = 0;
    const withSmallCaps = createShapedMeasurer({
      shaper: {
        shape(input) {
          calls += 1;
          const smallCaps = input.environment.features.smcp === 1;
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [
              {
                id: smallCaps ? 2 : 1,
                cluster: 0,
                originX: 0,
                originY: 0,
                advanceX: smallCaps ? 2_000 : 1_000,
                advanceY: 0,
                offsetX: 0,
                offsetY: 0,
                outline: { path: '', unitsPerEm: 1_000 },
              },
            ],
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 0 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    const plain = withSmallCaps.measure('abc', style());
    const smallCaps = withSmallCaps.measure('abc', style({ smallCaps: true }));
    expect(plain).toBe(1);
    expect(smallCaps).toBe(2);
    expect(withSmallCaps.measure('abc', style({ smallCaps: true }))).toBe(2);
    // 26 probe letters shaped twice to settle the FACE's `smcp` support, then one shaped call
    // per distinct (text, feature) pair. The repeat is served from the cache, and the second
    // small-caps measurement asks the face nothing: the answer is kept per face, not per text.
    expect(calls).toBe(26 * 2 + 2);
  });

  test('small caps uses CSS measurement when the face has no smcp glyphs', () => {
    const measure = measurer();
    const smallCapsStyle = style({ smallCaps: true });
    expect(measure.measure('abc', smallCapsStyle)).toBe(fallback.measure('abc', smallCapsStyle));
  });

  /**
   * A face that substitutes a small-cap glyph for exactly the characters `covered` names.
   * One glyph per character, so a prefix of the text is a prefix of the glyph run.
   */
  const measurerWithSmallCapsFor = (covered: (character: string) => boolean) =>
    createShapedMeasurer({
      shaper: {
        shape(input) {
          const enabled = input.environment.features.smcp === 1;
          const substituted = (character: string) => enabled && covered(character);
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [...input.text].map((character, index) => ({
              id: substituted(character) ? 2 : character.codePointAt(0)!,
              cluster: index,
              originX: index * 1_000,
              originY: 0,
              advanceX: substituted(character) ? 800 : 1_000,
              advanceY: 0,
              offsetX: 0,
              offsetY: 0,
              outline: { path: '', unitsPerEm: 1_000 },
            })),
            clusters: [...input.text].map((_, index) => ({
              textStart: index,
              textEnd: index + 1,
              glyphStart: index,
              glyphEnd: index + 1,
              advance: 1_000,
              caretEdges: [0, 1_000],
              fontSpan: 0,
            })),
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 0 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });

  test('partial smcp coverage uses CSS measurement for the complete text', () => {
    const partial = measurerWithSmallCapsFor((character) => character === 'a');
    const smallCapsStyle = style({ smallCaps: true });
    expect(partial.measure('ab', smallCapsStyle)).toBe(fallback.measure('ab', smallCapsStyle));
  });

  test('a small-caps span and EVERY prefix of it measure from the same source', () => {
    // `semantic-hit-test` derives every caret edge on a line as
    // `measureDisplayText(span.text.slice(0, offset), …)` through `measure`. Deciding `smcp`
    // coverage from the text made a prefix answer differently from the span it belongs to:
    // with a face carrying `smcp` for `a` alone, `measure('a')` took the shaped path (0.8)
    // while `measure('ab')` took the fallback (12), so the caret after `a` landed at 7% of
    // the painted span. The decision is per FACE, so both come from the fallback here.
    const partial = measurerWithSmallCapsFor((character) => character === 'a');
    const smallCapsStyle = style({ smallCaps: true });
    const whole = partial.measure('ab', smallCapsStyle);
    const prefix = partial.measure('a', smallCapsStyle);
    expect(prefix).toBe(fallback.measure('a', smallCapsStyle));
    expect(whole).toBe(fallback.measure('ab', smallCapsStyle));
    expect(prefix).toBeCloseTo(whole / 2, 6);
    expect(prefix).toBeLessThan(whole);
  });

  test('a fully covered face measures the span and its prefixes from the shaped path', () => {
    // The other direction of the same rule: a face that does carry small caps must not send
    // a prefix to the fallback, or the caret runs PAST the end of the painted span.
    const covered = measurerWithSmallCapsFor(() => true);
    const smallCapsStyle = style({ smallCaps: true });
    expect(covered.measure('ab', smallCapsStyle)).toBeCloseTo(1.6, 6);
    expect(covered.measure('a', smallCapsStyle)).toBeCloseTo(0.8, 6);
    // The plain face still measures at the lowercase advance, from its own cache.
    expect(covered.measure('ab', style())).toBeCloseTo(2, 6);
  });

  test('a face whose smcp shaping throws answers once and stays answered', () => {
    // Hit-testing measures once per caret prefix. Re-running the 26-letter probe on every
    // uncached prefix — and throwing out of it every time — turned one hostile face into the
    // cost of the whole line, so the refusal is cached exactly as an answer is.
    let calls = 0;
    const hostile = createShapedMeasurer({
      shaper: {
        shape(input) {
          calls += 1;
          if (input.environment.features.smcp === 1) throw new Error('refused');
          return {
            text: input.text,
            direction: 'ltr',
            bidiLevel: 0,
            glyphs: [...input.text].map((character, index) => ({
              id: character.codePointAt(0)!,
              cluster: index,
              originX: index * 1_000,
              originY: 0,
              advanceX: 1_000,
              advanceY: 0,
              offsetX: 0,
              offsetY: 0,
              outline: { path: '', unitsPerEm: 1_000 },
            })),
            clusters: [],
            fontSpans: [],
            metrics: { ascent: 9_000, descent: 2_000, lineGap: 0 },
          };
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
      fixedPointScale: 1_000,
    });
    const smallCapsStyle = style({ smallCaps: true });
    expect(hostile.measure('abc', smallCapsStyle)).toBe(fallback.measure('abc', smallCapsStyle));
    const afterFirst = calls;
    // The probe throws on its first letter, so it costs exactly one call and never more.
    expect(afterFirst).toBe(1);
    for (const prefix of ['a', 'ab', 'abc', 'abcd']) {
      expect(hostile.measure(prefix, smallCapsStyle)).toBe(
        fallback.measure(prefix, smallCapsStyle)
      );
    }
    expect(calls).toBe(afterFirst);
  });

  test('super/subscript advances are EXACTLY 65% of the baseline advance', () => {
    // Paint draws super/subscript at 0.65 of the run size, so measurement must be 0.65 of
    // the baseline advance — not the advance at the nearest whole half-point. At 11pt the
    // scaled size is 14.3 half-points. Rounding before shaping shifts following spans
    // and caret positions away from the painted glyphs.
    const measure = measurer();
    const plain = measure.measure('Superscript', style());
    expect(measure.measure('Superscript', style({ verticalAlign: 'superscript' }))).toBeCloseTo(
      plain * 0.65,
      6
    );
    expect(measure.measure('Superscript', style({ verticalAlign: 'subscript' }))).toBeCloseTo(
      plain * 0.65,
      6
    );
  });
});

describe('an unavailable font falls back rather than failing (task 7.7)', () => {
  test('a document naming a font nobody has still lays out', () => {
    const measure = measurer(() => null);
    expect(measure.measure('abc', style())).toBe(fallback.measure('abc', style()));
    expect(measure.lineMetrics(style())).toEqual(fallback.lineMetrics(style()));
  });

  test('a shaper that throws does not take the document down with it', () => {
    const hostile = createShapedMeasurer({
      shaper: {
        shape() {
          throw new Error('refused');
        },
      },
      resolveFont: () => font,
      fallback,
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '15.1',
    });
    expect(hostile.measure('abc', style())).toBe(fallback.measure('abc', style()));
    expect(hostile.lineMetrics(style())).toEqual(fallback.lineMetrics(style()));
  });
});

test('Arabic shaping uses resolved script/direction and isolates its width cache', () => {
  const m = measurer();
  const text = 'سلام';
  const rtl = style({ shaping: { script: 'Arab', direction: 'rtl', level: 1, baseLevel: 1 } });
  const plain = m.measure(text, style());
  const joined = m.measure(text, rtl);
  expect(joined).toBeLessThan(plain);
  expect(m.measure(text, style())).toBe(plain);
  expect(m.measure(text, rtl)).toBe(joined);
});

test('missing glyph boxes use host fallback measurement instead of .notdef advances', () => {
  const m = measurer();
  const missing = '\u{20000}\u{20001}';
  expect(m.measure(missing, style())).toBe(fallback.measure(missing, style()));
});

test.each([false, true])(
  'direction cache cannot collide with authored text (reverse=%s)',
  (reverse) => {
    const m = measurer();
    const shaped = style({ shaping: { script: 'Latn', direction: 'ltr', level: 2, baseLevel: 1 } });
    const original = 'Latn:ltr:hello';
    const expected = measurer().measure('hello', shaped);
    if (reverse) m.measure('hello', shaped);
    m.measure(original, style());
    expect(m.measure('hello', shaped)).toBe(expected);
    expect(m.measure(original, style())).toBe(measurer().measure(original, style()));
  }
);

describe('whole-span Arabic caret advances', () => {
  const arabic = style({ shaping: { script: 'Arab', direction: 'rtl', level: 1, baseLevel: 1 } });
  const spanFor = (text: string, resolved: ResolvedRunStyle, width: number): StyleSpanRecord => ({
    range: { paragraphId: 'arabic-caret', start: 0, end: text.length },
    text,
    props: [],
    style: resolved,
    box: { x: 20, y: 0, width, height: 14 },
  });

  test.each(['لا', 'سلام', 'العالم'])(
    'uses complete clusters for %s instead of isolated prefix forms',
    (text) => {
      const m = measurer();
      const width = m.measure(text, arabic);
      const advances = m.caretAdvances!(text, arabic)!;
      expect(advances).toHaveLength(text.length + 1);
      expect(advances[0]).toBe(0);
      expect(advances.at(-1)).toBeCloseTo(width, 6);
      expect(advances).toEqual([...advances].sort((a, b) => a - b));
      if (text === 'لا') {
        expect(m.measure('ل', arabic)).toBeGreaterThan(width);
        expect(advances[1]).toBe(0);
      }
      const span = spanFor(text, arabic, width);
      // Prefix interaction must never call the public independent-prefix measure path.
      const caretMeasurer: TextMeasurer = {
        ...m,
        measure: () => {
          throw new Error('reshaped a prefix');
        },
      };
      const xs = Array.from({ length: text.length + 1 }, (_, i) =>
        spanOffsetX(span, i, caretMeasurer)
      );
      expect(xs).toEqual([...xs].sort((a, b) => b - a));
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(span.box.x);
        expect(x).toBeLessThanOrEqual(span.box.x + width);
      }
    }
  );

  test('one missing glyph keeps every caret on the whole-span fallback source', () => {
    const text = 'ش'.repeat(10) + '\u08a0';
    const m = measurer();
    const width = m.measure(text, arabic);
    expect(width).toBe(fallback.measure(text, arabic));
    expect(m.measure(text.slice(0, -1), arabic)).toBeGreaterThan(width);
    const advances = m.caretAdvances!(text, arabic)!;
    expect(advances[10]).toBeCloseTo(fallback.measure(text.slice(0, -1), arabic), 6);
    const span = spanFor(text, arabic, width);
    for (let offset = 0; offset <= text.length; offset++) {
      expect(spanOffsetX(span, offset, m)).toBeCloseTo(20 + width - advances[offset]!, 6);
    }
  });

  test.each([false, true])(
    'includes justification spaces after natural widths (fallback=%s)',
    (missing) => {
      const text = missing ? 'لا \u08a0' : 'لا لا';
      const m = measurer();
      const justified = style({ shaping: { ...arabic.shaping!, wordSpacingPt: 9 } });
      expect(m.measure(text, justified)).toBeCloseTo(m.measure(text, arabic) + 9, 6);
      const base = m.caretAdvances!(text, arabic)!;
      const expanded = m.caretAdvances!(text, justified)!;
      expect(expanded[2]).toBeCloseTo(base[2]!, 6);
      expect(expanded[3]).toBeCloseTo(base[3]! + 9, 6);
      expect(expanded.at(-1)).toBeCloseTo(m.measure(text, justified), 6);
    }
  );

  test('negative tracking stays monotone and long fallback spans avoid eager vectors', () => {
    const m = measurer();
    const tracked = { ...arabic, characterSpacingPt: -2 };
    const advances = m.caretAdvances!('العالم', tracked)!;
    expect(advances).toEqual([...advances].sort((a, b) => a - b));
    expect(advances.at(-1)).toBeCloseTo(Math.max(0, m.measure('العالم', tracked)), 6);
    const unavailable = measurer(() => null);
    const text = 'ش'.repeat(65_537);
    expect(unavailable.caretAdvances!(text, arabic)).toBeUndefined();
    const span = spanFor(text, arabic, unavailable.measure(text, arabic));
    expect(spanOffsetX(span, text.length, unavailable)).toBe(20);
  });
  test.each(['لا', 'ش'.repeat(10) + '\u08a0'])(
    'hit testing stays on full-span edges for %s',
    (text) => {
      const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const parsed = readOoxmlPart(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
        { name: '/word/document.xml', contentType: 'app/xml' }
      );
      if (!parsed.ok) throw new Error(parsed.reason);
      const m = measurer();
      const layout = layoutSemanticDocument(parsed.part, 0, { measurer: m });
      const line = linesOf(layout)[0]!;
      const span = line.spans[0]!;
      let previousOffset = text.length;
      for (let step = 0; step <= 16; step++) {
        const x = span.box.x + (span.box.width * step) / 16;
        const hit = hitTestPage(
          layout,
          0,
          { x, y: line.box.y + line.box.height / 2 },
          { measurer: m }
        )!;
        expect(hit.position.offset).toBeLessThanOrEqual(previousOffset);
        previousOffset = hit.position.offset;
        const caretX = spanOffsetX(span, hit.position.offset, m);
        expect(caretX).toBeGreaterThanOrEqual(span.box.x);
        expect(caretX).toBeLessThanOrEqual(span.box.x + span.box.width);
      }
    }
  );
});

test('single-glyph ink bounds use the admitted outline and preserve tracking', () => {
  const measure = measurer();
  const natural = measure.inkBounds!('(', style())!;
  // DejaVu Sans parenleft outline: xMin=176, xMax=635, unitsPerEm=2048.
  expect(natural.left).toBeCloseTo((176 * 11) / 2048, 5);
  expect(natural.right).toBeCloseTo((635 * 11) / 2048, 5);
  expect(measure.inkBounds!('(', style({ characterSpacingPt: -3 }))).toEqual(natural);
  const scaled = measure.inkBounds!('(', style({ horizontalScalePercent: 50 }))!;
  expect(scaled.left).toBeCloseTo(natural.left / 2, 5);
  expect(scaled.right).toBeCloseTo(natural.right / 2, 5);
  const raised = measure.inkBounds!('(', style({ verticalAlign: 'superscript' }))!;
  expect(raised.right).toBeCloseTo(natural.right * 0.65, 5);
  expect(measure.inkBounds!('word', style())).toBeUndefined();
  expect(
    measure.inkBounds!('(', style({ shaping: { script: 'Arab', direction: 'rtl' } }))
  ).toBeUndefined();
});

test('resolved-face availability distinguishes admitted metrics from fallback metrics', () => {
  expect(measurer().hasResolvedFont?.(style())).toBe(true);
  expect(measurer(() => null).hasResolvedFont?.(style())).toBe(false);
});

test('fallback glyph faces own line metrics without contaminating primary-face cache entries', () => {
  const primary = resolvedFixture();
  const alternate = resolvedFixture();
  const m = createShapedMeasurer({
    shaper: {
      shape(input) {
        const fonts = input.text.includes('#') ? [primary, alternate] : [input.environment.font];
        return {
          text: input.text,
          direction: 'ltr',
          bidiLevel: 0,
          glyphs: [],
          clusters: [],
          fontSpans: fonts.map((font) => ({
            font,
            glyphStart: 0,
            glyphEnd: 0,
            fallbackIndex: null,
          })),
          metrics:
            input.environment.font === alternate
              ? { ascent: 7_000, descent: 6_000, lineGap: 0 }
              : { ascent: 10_000, descent: 2_000, lineGap: 0 },
        };
      },
    },
    resolveFont: () => primary,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
    fixedPointScale: 1_000,
  });
  const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 12 };
  expect(m.lineMetrics(style, 'abc')).toEqual({ height: 12, baseline: 10 });
  expect(m.lineMetrics(style, 'a#')).toEqual({ height: 16, baseline: 10 });
  expect(m.lineMetrics(style, '#')).toEqual({ height: 16, baseline: 10 });
  expect(m.lineMetrics(style)).toEqual({ height: 12, baseline: 10 });
  expect(m.lineMetrics(style, 'abc')).toEqual({ height: 12, baseline: 10 });
});

test('a face that cannot draw a space still reports its own vertical metrics', () => {
  // The exporter's glyph fallback replaces the face for text it cannot draw, so a probe
  // string is never neutral. A legacy symbol face is the real case: its cmap need not carry
  // U+0020 at all, and probing with a space made every Symbol and Wingdings line take the
  // metrics of whichever fallback face drew the space.
  const primary = resolvedFixture();
  const substitute = resolvedFixture();
  const m = createShapedMeasurer({
    shaper: {
      shape(input) {
        const font = input.text.length > 0 ? substitute : input.environment.font;
        return {
          text: input.text,
          direction: 'ltr',
          bidiLevel: 0,
          glyphs: [],
          clusters: [],
          fontSpans: [{ font, glyphStart: 0, glyphEnd: 0, fallbackIndex: null }],
          metrics:
            font === substitute
              ? { ascent: 13_000, descent: 3_000, lineGap: 0 }
              : { ascent: 10_000, descent: 2_000, lineGap: 0 },
        };
      },
    },
    resolveFont: () => primary,
    fallback: createFixedMeasurer(),
    shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
    unicodeDataVersion: '15.1',
    fixedPointScale: 1_000,
  });
  const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 12 };
  expect(m.lineMetrics(style)).toEqual({ height: 12, baseline: 10 });
  // Text the face really cannot draw still reports the substitute, because that face is the
  // one paint will use for it.
  expect(m.lineMetrics(style, 'x')).toEqual({ height: 16, baseline: 13 });
});

test('kerning follows the run threshold and cannot reuse unkerned width-cache entries', () => {
  const m = measurer();
  const off = style({ fontSizePt: 12 });
  const atThreshold = style({ fontSizePt: 12, kerningMinPt: 12 });
  const belowThreshold = style({ fontSizePt: 12, kerningMinPt: 14 });
  const unkerned = m.measure('AV', off);
  expect(unkerned).toBeCloseTo(m.measure('A', off) + m.measure('V', off), 3);
  expect(m.measure('AV', atThreshold)).toBeLessThan(unkerned);
  expect(m.measure('AV', belowThreshold)).toBe(unkerned);
  expect(m.measure('AV', off)).toBe(unkerned);
  expect(m.measure('AV', style({ fontSizePt: 12, kerningEnabled: true }))).toBe(unkerned);
  expect(m.caretAdvances!('AV', atThreshold)!.at(-1)).toBeCloseTo(m.measure('AV', atThreshold), 6);
});
