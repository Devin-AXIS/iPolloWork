import { expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { withAutomaticTextSpacing, automaticTextSpacingBefore } from '../cjk-automatic-spacing.ts';
import { withLayoutDerivedSpacing } from '../layout-derived-spacing.ts';
import type { PendingLine } from '../pending-line.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

// Deterministic metrics verify source geometry and safe fitting boundaries.
const style: ResolvedRunStyle = {
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'EA',
  fontFamilyEastAsia: 'EA',
  fontSizePt: 12,
  kerningEnabled: true,
  kerningMinPt: 1,
};
const policy = { ...DEFAULT_CJK_TYPOGRAPHY, autoSpaceDE: true, autoSpaceDN: true };
const measurer: TextMeasurer = {
  measure: (text) => text.length * 12,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    return text === '）' || text === '》'
      ? { left: 2, right: 4 }
      : text === '（'
        ? { left: 8, right: 10 }
        : { left: 0.5, right: 11.5 };
  },
};
const pid = 'synthetic';
type Options = {
  opening?: boolean;
  gap?: number;
  witness?: number;
  staleWitness?: boolean;
  wrap?: number;
  drawing?: boolean;
  measure?: TextMeasurer;
  style?: ResolvedRunStyle;
  openingReduction?: number;
};
function setup(o: Options = {}) {
  const s = o.style ?? style,
    m = o.measure ?? measurer,
    texts = o.opening ? ['甲', '》', '（'] : ['甲', '）', '乙', 'A'];
  const pieces: FieldAwarePiece[] = [...texts, '乙', '丙'].map((text, i) => ({
    text,
    start: i,
    end: i + 1,
    style: s,
    props: [],
    ...(text === 'A' ? {} : { fontSlot: 'eastAsia' as const }),
  }));
  let x = 0;
  const spans: StyleSpanRecord[] = texts.map((text, i) => {
    const amount = text === '（' ? (o.openingReduction ?? 0) : 0,
      gap = text === 'A' ? (o.gap ?? 2) : 0;
    x += gap;
    let span: StyleSpanRecord = {
      text,
      range: { paragraphId: pid, start: i, end: i + 1 },
      style: amount ? withLayoutDerivedSpacing(s, -amount) : s,
      props: [],
      ...(text === 'A' ? {} : { fontSlot: 'eastAsia' as const }),
      box: { x, y: 3, width: 12 - amount, height: 16 },
    };
    if (text === 'A' && o.witness !== undefined) span = withAutomaticTextSpacing(span, o.witness);
    if (text === 'A' && o.staleWitness)
      span = {
        ...withAutomaticTextSpacing({ ...span, range: { ...span.range, start: 99 } }, o.gap ?? 2),
        range: span.range,
      };
    if (text === 'A' && o.wrap) span = { ...span, wrapAdvanceBefore: o.wrap };
    x += span.box.width;
    return span;
  });
  const line: PendingLine = {
    spans,
    drawings: o.drawing ? [{} as never] : [],
    start: 0,
    end: texts.length,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const original = snapshot(line),
    available = line.width + 10;
  const fit = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), m, {
    hangingPunctuation: false,
    requireLocalQualification: true,
  });
  const run = () =>
    fit(
      line,
      texts.length,
      '乙',
      { paragraphId: pid, start: texts.length, end: texts.length + 1 },
      12,
      line.width,
      available,
      true
    );
  return { line, pieces, original, available, run, fit };
}
function snapshot(line: PendingLine) {
  return {
    width: line.width,
    height: line.height,
    baseline: line.baseline,
    leading: line.leading,
    trailing: line.trailingSpacing,
    spans: line.spans.map((s) => ({
      text: s.text,
      range: { ...s.range },
      box: { ...s.box },
      style: { ...s.style },
      glyphOffset: s.glyphOffsetPt,
      gap: automaticTextSpacingBefore(s),
      wrap: s.wrapAdvanceBefore,
    })),
  };
}
function rejected(o: Options) {
  const a = setup(o);
  expect(a.run()).toBeUndefined();
  expect(snapshot(a.line)).toEqual(a.original);
  return a;
}

test('a real automatic spacing witness preserves its gap, source range, glyph advance and line band during optical fit', () => {
  const a = setup({ witness: 2 }),
    result = a.run();
  expect(result).toBeDefined();
  const index = a.line.spans.findIndex((s) => s.text === 'A'),
    current = a.line.spans[index]!,
    previous = a.line.spans[index - 1]!;
  expect(automaticTextSpacingBefore(current)).toBe(2);
  expect(current.box.x - previous.box.x - previous.box.width).toBeCloseTo(2, 8);
  expect(current.box.width).toBe(12);
  expect(current.style.characterSpacingPt).toBe(0);
  expect(current.range).toEqual({ paragraphId: pid, start: 3, end: 4 });
  expect(a.line.width + result!.width).toBeCloseTo(a.available, 8);
  expect(a.line.height).toBe(16);
  expect(a.line.baseline).toBe(12);
  expect(a.line.spans.every((s) => s.box.y === 3 && s.box.height === 16)).toBe(true);
});
test('unwitnessed gaps and a stale or mismatched automatic witness remain disjoint passages', () => {
  rejected({});
  rejected({ witness: 3 });
  rejected({ staleWitness: true });
  rejected({ witness: -2 });
  rejected({ witness: Number.NaN });
});
test('a float wrap advance or inline drawing remains ineligible even with an automatic witness', () => {
  rejected({ witness: 2, wrap: 2 });
  rejected({ witness: 2, drawing: true });
  rejected({ witness: 2, gap: 5 });
});
test('automatic gap allowance does not create punctuation ink capacity or bypass unresolved fonts', () => {
  rejected({ witness: 2, measure: { ...measurer, inkBounds: () => ({ left: 0, right: 12 }) } });
  rejected({ witness: 2, measure: { ...measurer, hasResolvedFont: () => false } });
  rejected({ witness: 2, measure: { ...measurer, inkBounds: undefined } });
});
test('source authored tracking, scaling, and projected span gates stay strict with witnessed gaps', () => {
  for (const delta of [{ characterSpacingPt: -0.1 }, { horizontalScalePercent: 90 }])
    rejected({ witness: 2, style: { ...style, ...delta } });
  const a = setup({ witness: 2 });
  a.line.spans[0] = { ...a.line.spans[0]!, projected: true };
  const before = snapshot(a.line);
  expect(a.run()).toBeUndefined();
  expect(snapshot(a.line)).toEqual(before);
});
test('a witnessed gap is retained conservatively rather than being spent to rescue an overwide candidate', () => {
  const a = setup({ witness: 2 });
  const before = snapshot(a.line),
    candidate = '乙';
  const result = a.fit(
    a.line,
    4,
    candidate,
    { paragraphId: pid, start: 4, end: 5 },
    12,
    a.line.width,
    a.line.width + 5,
    true
  );
  expect(result).toBeUndefined();
  expect(snapshot(a.line)).toEqual(before);
});
test('a closing mark before an opening mark shares the fit over both blank sides', () => {
  const a = setup({ opening: true }),
    result = a.run();
  expect(result).toBeDefined();
  const closing = a.line.spans.find((s) => s.text === '》')!,
    opening = a.line.spans.find((s) => s.text === '（')!;
  expect(closing.box.width).toBeCloseTo(11, 8);
  expect(closing.style.characterSpacingPt).toBeCloseTo(-1, 8);
  expect(opening.box.width).toBeCloseTo(11, 8);
  expect(opening.glyphOffsetPt).toBeCloseTo(-1, 8);
  expect(a.line.width + result!.width).toBeCloseTo(a.available, 8);
  expect(opening.box.x + 8 + opening.glyphOffsetPt! - closing.box.x - 4).toBeGreaterThanOrEqual(0);
});
test('a seam with missing ink or too little room between the two inks cannot fit', () => {
  for (const inkBounds of [
    (text: string) => (text === '（' ? undefined : measurer.inkBounds!(text, style)),
    (text: string) =>
      text === '（'
        ? { left: 0.5, right: 10 }
        : text === '》'
          ? { left: 2, right: 11 }
          : measurer.inkBounds!(text, style),
    (text: string) => (text === '》' ? { left: 2, right: 22 } : measurer.inkBounds!(text, style)),
  ])
    rejected({ opening: true, measure: { ...measurer, inkBounds } });
});
test('a pre-reduced opening spends only the rest of its half glyph and the closing side takes the remainder', () => {
  const a = setup({ opening: true, openingReduction: 5 }),
    result = a.run();
  expect(result).toBeDefined();
  expect(a.line.spans.find((s) => s.text === '（')!.box.width).toBeCloseTo(6, 8);
  expect(a.line.spans.find((s) => s.text === '》')!.box.width).toBeCloseTo(11, 8);
});
test('a repeated optical fit keeps prior reductions and never takes more than half of a glyph', () => {
  const a = setup({ opening: true, openingReduction: 4 }),
    result = a.run();
  expect(result).toBeDefined();
  expect(a.line.spans.find((s) => s.text === '（')!.box.width).toBeCloseTo(7, 8);
  expect(a.line.spans.find((s) => s.text === '》')!.box.width).toBeCloseTo(11, 8);
  a.line.spans.push(...result!.candidate);
  a.line.width += result!.width;
  a.line.end = 4;
  const again = a.fit(
    a.line,
    4,
    '丙',
    { paragraphId: pid, start: 4, end: 5 },
    12,
    a.line.width,
    a.line.width + 10,
    true
  );
  expect(again).toBeDefined();
  expect(a.line.spans.find((s) => s.text === '（')!.box.width).toBeCloseTo(6, 8);
  expect(a.line.spans.find((s) => s.text === '》')!.box.width).toBeCloseTo(10, 8);
});
