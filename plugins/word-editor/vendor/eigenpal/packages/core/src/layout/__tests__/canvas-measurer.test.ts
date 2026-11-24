// Canvas-backed text measurement: selection, security, and centered geometry.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  DEFAULT_CANVAS_FONT_STACK,
  DEFAULT_RUN_STYLE,
  createFixedMeasurer,
  isCanvasMeasurementAvailable,
  layoutSemanticDocument,
  linesOf,
  resolveDefaultSurfaceMeasurer,
  tryCreateCanvasMeasurer,
  type CanvasTextContext,
  type PageGeometry,
  type ResolvedRunStyle,
} from '../index.ts';
// Not re-exported from the lane index: an internal detail of the fallback stack, and the
// notice's detector imports it from the module for the same reason.
import { METRIC_COMPATIBLE_FALLBACK_FAMILIES } from '../canvas-measurer.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/**
 * A controllable 2d context: advance is derived from the px size embedded in `font`, not
 * from host font files — so assertions stay host-independent.
 *
 * Multiplier 0.7 is deliberately wider than the fixed measurer's 6pt*(size/11) grid at
 * typical sizes (the production bug: fixed underestimates real proportional faces ~20%).
 */
function mockContext(
  fonts: string[] = [],
  ratios: { ascent: number; descent: number } = { ascent: 0.8, descent: 0.2 }
): CanvasTextContext {
  let currentFont = '';
  return {
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
      fonts.push(value);
    },
    measureText(text: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const sizePx = match ? Number(match[1]) : 11;
      return {
        width: text.length * sizePx * 0.7,
        fontBoundingBoxAscent: sizePx * ratios.ascent,
        fontBoundingBoxDescent: sizePx * ratios.descent,
      };
    },
  };
}

/** Context that omits font bounding boxes — exercises the deterministic fallback. */
function mockContextWithoutBox(fonts: string[] = []): CanvasTextContext {
  let currentFont = '';
  return {
    get font() {
      return currentFont;
    },
    set font(value: string) {
      currentFont = value;
      fonts.push(value);
    },
    measureText(text: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(currentFont);
      const sizePx = match ? Number(match[1]) : 11;
      return { width: text.length * sizePx * 0.7 };
    },
  };
}

const style = (overrides: Partial<ResolvedRunStyle> = {}): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  ...overrides,
});

describe('tryCreateCanvasMeasurer', () => {
  test('returns null when no 2d context is injected', () => {
    expect(tryCreateCanvasMeasurer({ context: null })).toBeNull();
    expect(tryCreateCanvasMeasurer({})).toBeNull();
  });

  test('measures at the painted size and converts back to layout points', () => {
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(), scale: 2 });
    expect(measurer).not.toBeNull();
    // 11pt * scale 2 = 22px; mock advance = len * 22 * 0.7; / scale → len * 11 * 0.7
    expect(measurer!.measure('abcd', style({ fontSizePt: 11 }))).toBeCloseTo(4 * 11 * 0.7, 5);
  });

  test('bold, italic, small caps, and point size enter the canvas font shorthand like paint', () => {
    const fonts: string[] = [];
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    measurer.measure(
      'X',
      style({
        fontFamily: 'Arial',
        fontSizePt: 26,
        bold: true,
        italic: true,
        smallCaps: true,
      })
    );
    expect(fonts.at(-1)).toBe(
      'italic small-caps bold 26px "Arial", Calibri, Carlito, Helvetica, Arial, sans-serif'
    );
  });

  test('refuses attacker-controlled family strings instead of interpolating them', () => {
    const fonts: string[] = [];
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    measurer.measure(
      'X',
      style({ fontFamily: 'Arial"; } body { background: url(evil)', fontSizePt: 12 })
    );
    const font = fonts.at(-1)!;
    expect(font).not.toContain('evil');
    expect(font).not.toContain('url(');
    expect(font.startsWith('normal normal normal 12px Calibri')).toBe(true);
  });

  test('super/subscript shrink measurement the same way paint shrinks glyphs', () => {
    const fonts: string[] = [];
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    measurer.measure('X', style({ fontSizePt: 20, verticalAlign: 'superscript' }));
    expect(fonts.at(-1)).toContain('13px');
  });

  test('line metrics use fontBoundingBox ascent + descent when reported', () => {
    // The mock reports 1.22 em, ABOVE the 1.15 floor, so the reported box is what is used —
    // the shape of Carlito, Calibri's metric twin and the face the default stack leads with.
    // A face that tall must not be shortened to the floor.
    const measurer = tryCreateCanvasMeasurer({
      context: mockContext(undefined, { ascent: 0.95, descent: 0.27 }),
      scale: 1,
    })!;
    const metrics = measurer.lineMetrics(style({ fontSizePt: 20 }));
    // Mock: ascent 0.95*20 + descent 0.27*20 = 24.4; baseline = ascent.
    expect(metrics.height).toBeCloseTo(24.4, 5);
    expect(metrics.baseline).toBeCloseTo(19, 5);
  });

  test('line metrics fall back to size×1.15 / 0.8 when boxes are absent', () => {
    const measurer = tryCreateCanvasMeasurer({
      context: mockContextWithoutBox(),
      scale: 1,
    })!;
    const metrics = measurer.lineMetrics(style({ fontSizePt: 20 }));
    expect(metrics.height).toBeCloseTo(20 * 1.15, 5);
    expect(metrics.baseline).toBeCloseTo(20 * 0.8, 5);
  });

  test('super/subscript shrinks line metrics with the painted size', () => {
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(), scale: 1 })!;
    const baseline = measurer.lineMetrics(style({ fontSizePt: 20 }));
    const raised = measurer.lineMetrics(style({ fontSizePt: 20, verticalAlign: 'superscript' }));
    expect(raised.height).toBeCloseTo(baseline.height * 0.65, 5);
    expect(raised.baseline).toBeCloseTo(baseline.baseline * 0.65, 5);
  });

  test('mixed sizes reserve the taller run height on a line', () => {
    const measurer = tryCreateCanvasMeasurer({ context: mockContext(), scale: 1 })!;
    const small = measurer.lineMetrics(style({ fontSizePt: 10 }));
    const large = measurer.lineMetrics(style({ fontSizePt: 24 }));
    expect(large.height).toBeGreaterThan(small.height);
    expect(Math.max(small.height, large.height)).toBe(large.height);
  });

  test('scale converts painted-pixel boxes back to layout points', () => {
    // A face box above the floor, so the conversion is what the numbers show rather than
    // the floor standing in for it.
    const measurer = tryCreateCanvasMeasurer({
      context: mockContext(undefined, { ascent: 0.95, descent: 0.27 }),
      scale: 2,
    })!;
    const metrics = measurer.lineMetrics(style({ fontSizePt: 10 }));
    // Painted at 20px; ascent 19 + descent 5.4 → 24.4px / scale 2 = 12.2 layout units.
    expect(metrics.height).toBeCloseTo(12.2, 5);
    expect(metrics.baseline).toBeCloseTo(9.5, 5);
  });

  test('the reported face box is a floor, never shorter than Word’s 1.15 em', () => {
    // `TextMetrics` reports no leading, so the face box is ascent + descent and nothing
    // else — a LOWER BOUND on Word's ascent + descent + lineGap. The mock reports
    // 0.8 + 0.2 = 1.0 em, under the 1.15 floor, so the floor stands. Measured in Chrome,
    // taking the raw face box here left Liberation Sans and Liberation Serif 4.3% short of
    // the shaped measurer, and this measurer is the whole document's whenever no shaper was
    // injected.
    const reported = tryCreateCanvasMeasurer({ context: mockContext(), scale: 1 })!;
    const sized = style({ fontSizePt: 10 });
    expect(reported.lineMetrics(sized).height).toBeCloseTo(11.5, 5);
    // The baseline still comes from the reported ascent, so it never exceeds the height.
    expect(reported.lineMetrics(sized).baseline).toBeCloseTo(8, 5);
    // With no reported box at all the same deterministic floor stands in.
    const deterministic = tryCreateCanvasMeasurer({
      context: mockContextWithoutBox(),
      scale: 1,
    })!;
    expect(deterministic.lineMetrics(sized).height).toBeCloseTo(11.5, 5);
  });

  test('the floor is a trade: a face under 1.15 em is rounded UP, not matched', () => {
    // Pinned so the residual the module header records cannot drift unrecorded. Liberation
    // Mono is 1.1328 em with no gap, so the shaped measurer returns 11.328 at 10pt where
    // this one returns the 11.5 floor. Canvas cannot tell a gapless face from a gapped one,
    // so the two measurers do not agree here and the header says so.
    const mono = tryCreateCanvasMeasurer({
      context: mockContext(undefined, { ascent: 0.8916, descent: 0.2412 }),
      scale: 1,
    })!;
    // Liberation Mono's own face box at 10 pt, which the mock reports.
    const monoFaceBox = 10 * (0.8916 + 0.2412);
    const metrics = mono.lineMetrics(style({ fontSizePt: 10 }));
    expect(metrics.height).toBeGreaterThan(monoFaceBox);
    expect(metrics.height).toBeCloseTo(11.5, 5);
  });
});

describe('canvas measurer cache bounds', () => {
  function countingContext(): CanvasTextContext & { measureCalls: string[] } {
    const measureCalls: string[] = [];
    const base = mockContext();
    return {
      ...base,
      measureCalls,
      measureText(text: string) {
        measureCalls.push(text);
        return base.measureText(text);
      },
    };
  }

  test('width cache re-measures evicted entries instead of growing without bound', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxWidthEntries: 2 })!;
    const s = () => style({ fontSizePt: 11 });

    measurer.measure('aaa', s);
    measurer.measure('bbb', s);
    measurer.measure('ccc', s); // evicts 'aaa'
    const afterEviction = ctx.measureCalls.filter((text) => text === 'aaa').length;
    measurer.measure('aaa', s); // must miss again

    expect(afterEviction).toBe(1);
    expect(ctx.measureCalls.filter((text) => text === 'aaa').length).toBe(2);
  });

  test('width cache hits skip canvas measurement', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxWidthEntries: 8 })!;
    const s = () => style({ fontSizePt: 11 });

    measurer.measure('repeat', s);
    measurer.measure('repeat', s);
    measurer.measure('repeat', s);

    expect(ctx.measureCalls.filter((text) => text === 'repeat').length).toBe(1);
  });

  test('a width cache hit keeps the entry and moves it to most recently used', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxWidthEntries: 3 })!;
    const s = () => style({ fontSizePt: 11 });
    const calls = (text: string) => ctx.measureCalls.filter((call) => call === text).length;

    measurer.measure('aaa', s);
    measurer.measure('bbb', s);
    measurer.measure('ccc', s);
    // Hit the middle entry, then the oldest: recency becomes ccc, bbb, aaa.
    measurer.measure('bbb', s);
    measurer.measure('aaa', s);
    expect(calls('aaa')).toBe(1);
    expect(calls('bbb')).toBe(1);

    measurer.measure('ddd', s); // evicts ccc, now the least recently used
    measurer.measure('aaa', s);
    measurer.measure('bbb', s);
    expect(calls('aaa')).toBe(1);
    expect(calls('bbb')).toBe(1);
    measurer.measure('ccc', s);
    expect(calls('ccc')).toBe(2);
  });

  test('a line-metrics cache hit keeps the entry and moves it to most recently used', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxMetricsEntries: 2 })!;
    const probes = () => ctx.measureCalls.filter((text) => text === 'Hxg').length;

    measurer.lineMetrics(style({ fontSizePt: 10 }));
    measurer.lineMetrics(style({ fontSizePt: 12 }));
    measurer.lineMetrics(style({ fontSizePt: 10 })); // hit: 10pt becomes most recent
    expect(probes()).toBe(2);

    measurer.lineMetrics(style({ fontSizePt: 14 })); // evicts 12pt, not 10pt
    measurer.lineMetrics(style({ fontSizePt: 10 }));
    expect(probes()).toBe(3);
    measurer.lineMetrics(style({ fontSizePt: 12 }));
    expect(probes()).toBe(4);
  });

  test('line-metrics cache evicts least-recent font shorthands at the configured limit', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxMetricsEntries: 2 })!;

    measurer.lineMetrics(style({ fontSizePt: 10 }));
    measurer.lineMetrics(style({ fontSizePt: 12 }));
    measurer.lineMetrics(style({ fontSizePt: 14 })); // evicts 10pt
    const afterEviction = ctx.measureCalls.filter((text) => text === 'Hxg').length;
    measurer.lineMetrics(style({ fontSizePt: 10 })); // miss again

    expect(afterEviction).toBe(3);
    expect(ctx.measureCalls.filter((text) => text === 'Hxg').length).toBe(4);
  });

  function expectWidthCacheEvictsAtOne(maxWidthEntries: number, label: string): void {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxWidthEntries })!;
    const s = () => style({ fontSizePt: 11 });

    measurer.measure('aaa', s);
    measurer.measure('bbb', s); // capacity 1 → evicts 'aaa'
    const afterEviction = ctx.measureCalls.filter((text) => text === 'aaa').length;
    measurer.measure('aaa', s); // miss again

    expect(afterEviction, label).toBe(1);
    expect(ctx.measureCalls.filter((text) => text === 'aaa').length, label).toBe(2);
  }

  function expectMetricsCacheEvictsAtOne(maxMetricsEntries: number, label: string): void {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxMetricsEntries })!;

    measurer.lineMetrics(style({ fontSizePt: 10 }));
    measurer.lineMetrics(style({ fontSizePt: 12 })); // capacity 1 → evicts 10pt
    const afterEviction = ctx.measureCalls.filter((text) => text === 'Hxg').length;
    measurer.lineMetrics(style({ fontSizePt: 10 })); // miss again

    expect(afterEviction, label).toBe(2);
    expect(ctx.measureCalls.filter((text) => text === 'Hxg').length, label).toBe(3);
  }

  test.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
  ] as const)(
    'invalid width capacity (%s) normalizes to 1 and evicts',
    (label, maxWidthEntries) => {
      expectWidthCacheEvictsAtOne(maxWidthEntries, label);
    }
  );

  test.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -3],
    ['zero', 0],
  ] as const)(
    'invalid metrics capacity (%s) normalizes to 1 and evicts',
    (label, maxMetricsEntries) => {
      expectMetricsCacheEvictsAtOne(maxMetricsEntries, label);
    }
  );

  test('fractional width capacity floors and evicts at the floored limit', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxWidthEntries: 2.7 })!;
    const s = () => style({ fontSizePt: 11 });

    measurer.measure('aaa', s);
    measurer.measure('bbb', s);
    measurer.measure('ccc', s); // capacity 2 → evicts 'aaa'
    const afterEviction = ctx.measureCalls.filter((text) => text === 'aaa').length;
    measurer.measure('aaa', s);

    expect(afterEviction).toBe(1);
    expect(ctx.measureCalls.filter((text) => text === 'aaa').length).toBe(2);
  });

  test('fractional metrics capacity floors and evicts at the floored limit', () => {
    const ctx = countingContext();
    const measurer = tryCreateCanvasMeasurer({ context: ctx, maxMetricsEntries: 2.7 })!;

    measurer.lineMetrics(style({ fontSizePt: 10 }));
    measurer.lineMetrics(style({ fontSizePt: 12 }));
    measurer.lineMetrics(style({ fontSizePt: 14 })); // capacity 2 → evicts 10pt
    const afterEviction = ctx.measureCalls.filter((text) => text === 'Hxg').length;
    measurer.lineMetrics(style({ fontSizePt: 10 }));

    expect(afterEviction).toBe(3);
    expect(ctx.measureCalls.filter((text) => text === 'Hxg').length).toBe(4);
  });
});

describe('resolveDefaultSurfaceMeasurer', () => {
  // These name a size rather than leaning on the default: the claim under test is WHICH
  // measurer got resolved, and the fixed measurer's 6pt grid describes an 11pt run.
  const elevenPt = () => style({ fontSizePt: 11 });

  test('selects the canvas measurer when a 2d context is supplied', () => {
    const resolved = resolveDefaultSurfaceMeasurer(1, { context: mockContext() });
    expect(resolved.producer).toBe('canvas-measurer');
    // Distinct from the fixed 6pt-wide grid: three characters at 11pt → 23.1, not 18.
    expect(resolved.measurer.measure('abc', elevenPt())).toBeCloseTo(3 * 11 * 0.7, 5);
    expect(createFixedMeasurer().measure('abc', elevenPt())).toBe(18);
  });

  test('falls back to the fixed measurer when canvas is unavailable', () => {
    const resolved = resolveDefaultSurfaceMeasurer(1, { context: null });
    expect(resolved.producer).toBe('fixed-measurer');
    expect(resolved.measurer.measure('abc', elevenPt())).toBe(18);
  });

  test('without an injected context, canvas measurement is unavailable', () => {
    // Layout never probes the browser; happy-dom / SSR keep the fixed default.
    expect(isCanvasMeasurementAvailable()).toBe(false);
    expect(isCanvasMeasurementAvailable(null)).toBe(false);
    expect(isCanvasMeasurementAvailable(mockContext())).toBe(true);
  });
});

describe('centered cover title uses measured width, not the fixed grid', () => {
  const geometry: PageGeometry = {
    width: 612,
    height: 792,
    margin: { top: 72, right: 72, bottom: 72, left: 72 },
  };
  const available = geometry.width - geometry.margin.left - geometry.margin.right;
  const title =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="52"/></w:rPr>` +
    `<w:t>Cover Title</w:t></w:r></w:p>`;

  const usedWidth = (line: { spans: readonly { box: { x: number; width: number } }[] }) => {
    const first = line.spans[0]!;
    const last = line.spans[line.spans.length - 1]!;
    return last.box.x + last.box.width - first.box.x;
  };

  test('centre slack is computed from the canvas-measured advance', () => {
    const fonts: string[] = [];
    const canvas = tryCreateCanvasMeasurer({ context: mockContext(fonts), scale: 1 })!;
    const layout = layoutSemanticDocument(load(title), 1, {
      measurer: canvas,
      geometry,
      producer: 'canvas-measurer',
    });
    const line = linesOf(layout)[0]!;
    const first = line.spans[0]!;
    const last = line.spans[line.spans.length - 1]!;
    // 26pt Arial Bold — mock advance = len * 26 * 0.5; must appear in the font shorthand.
    expect(
      fonts.some(
        (font) => font.includes('bold') && font.includes('26px') && font.includes('"Arial"')
      )
    ).toBe(true);
    // Layout splits on words; the line's used width is what centering reads.
    const measured = canvas.measure('Cover ', first.style) + canvas.measure('Title', last.style);
    expect(usedWidth(line)).toBeCloseTo(measured, 5);
    expect(first.box.x).toBeCloseTo((available - measured) / 2, 5);
    expect(available - (last.box.x + last.box.width)).toBeCloseTo(first.box.x, 5);
  });

  test('the fixed fallback underestimates and shifts the same title right', () => {
    const canvas = tryCreateCanvasMeasurer({ context: mockContext(), scale: 1 })!;
    const fixed = createFixedMeasurer(6, 14);
    const canvasLine = linesOf(
      layoutSemanticDocument(load(title), 1, { measurer: canvas, geometry })
    )[0]!;
    const fixedLine = linesOf(
      layoutSemanticDocument(load(title), 1, { measurer: fixed, geometry })
    )[0]!;
    // Fixed: 6*(26/11)*11 ≈ 156. Mock canvas: 0.7*26*11 = 200.2 — wider, like real Arial Bold.
    expect(usedWidth(fixedLine)).toBeLessThan(usedWidth(canvasLine));
    // Underestimated width → larger centre slack → origin shifts right of the true centre.
    expect(fixedLine.spans[0]!.box.x).toBeGreaterThan(canvasLine.spans[0]!.box.x);
  });
});

describe('METRIC_COMPATIBLE_FALLBACK_FAMILIES', () => {
  test('every twin is a face the default stack actually falls through to', () => {
    // The map is a promise about what the BROWSER will pick. A run declaring `X` measures
    // and paints against `"X", ${DEFAULT_CANVAS_FONT_STACK}`, so a twin the stack never
    // names would never be used — and the compatibility notice would go quiet about a
    // real fidelity loss. Adding an entry means adding it to the stack too.
    const stack = DEFAULT_CANVAS_FONT_STACK.split(',').map((entry) => entry.trim());
    for (const [declared, twin] of METRIC_COMPATIBLE_FALLBACK_FAMILIES) {
      expect(declared).toBe(declared.toLowerCase());
      expect(stack).toContain(twin);
      // The twin must precede nothing that would win first except the declared face.
      expect(stack.indexOf(twin)).toBeLessThan(stack.length - 1);
    }
  });
});

test('canvas ink bounds convert physical bearings without removing authored tracking', () => {
  const context: CanvasTextContext = {
    font: '',
    measureText: () => ({ width: 24, actualBoundingBoxLeft: -14, actualBoundingBoxRight: 22 }),
  };
  const measure = tryCreateCanvasMeasurer({ context, scale: 2 })!;
  const style = { ...DEFAULT_RUN_STYLE, horizontalScalePercent: 50, characterSpacingPt: -3 };
  expect(measure.inkBounds!('（', style)).toEqual({ left: 3.5, right: 5.5 });
  expect(
    tryCreateCanvasMeasurer({ context: mockContext() })!.inkBounds!('（', style)
  ).toBeUndefined();
  context.measureText = () => ({
    width: 24,
    actualBoundingBoxLeft: NaN,
    actualBoundingBoxRight: 22,
  });
  expect(measure.inkBounds!('（', style)).toBeUndefined();
});

test('canvas ink bounds normalize and restore the injected text origin', () => {
  const context: CanvasTextContext = {
    font: '',
    textAlign: 'right',
    direction: 'rtl',
    measureText() {
      expect(this.textAlign).toBe('left');
      expect(this.direction).toBe('ltr');
      return { width: 12, actualBoundingBoxLeft: -8, actualBoundingBoxRight: 11 };
    },
  };
  const measure = tryCreateCanvasMeasurer({ context })!;
  expect(measure.inkBounds!('（', DEFAULT_RUN_STYLE)).toEqual({ left: 8, right: 11 });
  expect(context.textAlign).toBe('right');
  expect(context.direction).toBe('rtl');
});

test('canvas kerning uses authored thresholds and separates width-cache entries', () => {
  const context: CanvasTextContext = {
    font: '',
    fontKerning: 'auto',
    measureText: () => ({ width: context.fontKerning === 'normal' ? 8 : 10 }),
  };
  const m = tryCreateCanvasMeasurer({ context })!;
  const plain = { ...DEFAULT_RUN_STYLE, fontSizePt: 12 };
  const kerned = { ...plain, kerningMinPt: 12 };
  const plainWidth = m.measure('AV', plain);
  expect(context.fontKerning).toBe('none');
  expect(m.measure('AV', kerned)).toBeLessThan(plainWidth);
  expect(context.fontKerning).toBe('normal');
  expect(m.measure('AV', plain)).toBe(plainWidth);
  // Full-width East Asian text keeps its advances in a kerned run.
  const kana = m.measure('アイ', plain);
  expect(m.measure('アイ', kerned)).toBe(kana);
  expect(context.fontKerning).toBe('none');
});

test('the canvas measures the unhinted advances that paint draws', () => {
  const context: CanvasTextContext = {
    font: '',
    textRendering: 'auto',
    measureText: () => ({ width: context.textRendering === 'geometricPrecision' ? 40.3 : 44 }),
  };
  const m = tryCreateCanvasMeasurer({ context })!;
  expect(context.textRendering).toBe('geometricPrecision');
  expect(m.measure('53.227', DEFAULT_RUN_STYLE)).toBeCloseTo(40.3, 5);
  // A context without the control measures as before.
  const older: CanvasTextContext = { font: '', measureText: () => ({ width: 10 }) };
  expect(tryCreateCanvasMeasurer({ context: older })!.measure('a', DEFAULT_RUN_STYLE)).toBe(10);
  expect('textRendering' in older).toBe(false);
});
