import { expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { createCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import { automaticTextSpacingBefore, withAutomaticTextSpacing } from '../cjk-automatic-spacing.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { PendingLine } from '../pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

// Deterministic metrics verify source geometry and safe fitting boundaries.
const pid = 'synthetic-mathematical-barrier';
const style: ResolvedRunStyle = {
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'EA',
  fontFamilyEastAsia: 'EA',
  fontSizePt: 12,
  kerningEnabled: true,
  kerningMinPt: 1,
};
const math = /^\p{Sm}+$/u;
const measurer: TextMeasurer = {
  measure(text) {
    if (math.test(text)) throw new Error('Mathematical span must retain its published advance');
    return text.length * 12;
  },
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    if (math.test(text)) throw new Error('Mathematical barrier must not request ink capacity');
    return text === '）'
      ? { left: 2, right: 4 }
      : text === '（'
        ? { left: 8, right: 10 }
        : { left: 0.5, right: 11.5 };
  },
  textOutline(text) {
    if (math.test(text)) throw new Error('Mathematical barrier must not request a whole outline');
    return { ink: { left: 0.5, right: text.length * 12 - 0.5 } } as never;
  },
};
type Options = {
  texts?: string[];
  style?: ResolvedRunStyle;
  measure?: TextMeasurer;
  gapBeforeA?: boolean;
  mathSlot?: boolean;
};
function setup(o: Options = {}) {
  const texts = o.texts ?? ['甲', '）', '乙', '≥', '丙'];
  const s = o.style ?? style,
    m = o.measure ?? measurer;
  let start = 0,
    x = 0;
  const pieces: FieldAwarePiece[] = [];
  const spans: StyleSpanRecord[] = [];
  for (const text of [...texts, '丁']) {
    const from = start;
    start += text.length;
    const slot =
      text === 'A' || (math.test(text) && o.mathSlot === false)
        ? {}
        : { fontSlot: 'eastAsia' as const };
    pieces.push({ text, start: from, end: start, style: s, props: [], ...slot });
    if (pieces.length > texts.length) break;
    const width = math.test(text) ? (text.length === 1 ? 7.25 : 19.125) : text.length * 12;
    const gap = text === 'A' && o.gapBeforeA ? 2 : 0;
    x += gap;
    let span: StyleSpanRecord = {
      text,
      range: { paragraphId: pid, start: from, end: start },
      style: s,
      props: [],
      ...slot,
      glyphOffsetPt: math.test(text) ? 0.25 : undefined,
      box: { x, y: 3, width, height: 16 },
    };
    if (gap) span = withAutomaticTextSpacing(span, gap);
    spans.push(span);
    x += width;
  }
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: start - 1,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const fitter = createCjkOpticalFitter(
    pieces,
    cjkParagraphBreaks(pieces, DEFAULT_CJK_TYPOGRAPHY),
    m,
    { hangingPunctuation: false, requireLocalQualification: true }
  );
  const before = snapshot(line),
    available = line.width + 10;
  const run = (room = available) =>
    fitter(
      line,
      texts.length,
      '丁',
      { paragraphId: pid, start: start - 1, end: start },
      12,
      line.width,
      room,
      true
    );
  return { line, pieces, before, available, run };
}
function snapshot(line: PendingLine) {
  return {
    width: line.width,
    height: line.height,
    baseline: line.baseline,
    leading: line.leading,
    trailing: line.trailingSpacing,
    spans: line.spans.map((s) => ({
      ...s,
      range: { ...s.range },
      box: { ...s.box },
      gap: automaticTextSpacingBefore(s),
    })),
  };
}
function reject(a: ReturnType<typeof setup>, room?: number) {
  const before = snapshot(a.line);
  expect(a.run(room)).toBeUndefined();
  expect(snapshot(a.line)).toEqual(before);
}

test('a qualified mathematical barrier permits a separate proven CJK closing seam without changing its face or advance', () => {
  const a = setup(),
    original = a.line.spans[3]!,
    result = a.run();
  expect(result).toBeDefined();
  const held = a.line.spans.find((s) => s.text === '≥')!;
  expect(held).toEqual({ ...original, box: { ...original.box, x: original.box.x - 2 } });
  expect(a.line.spans.find((s) => s.text === '）')!.box.width).toBeCloseTo(10, 8);
  expect(a.line.width + result!.width).toBeCloseTo(a.available, 8);
  expect(a.line.height).toBe(16);
  expect(a.line.baseline).toBe(12);
});
test('a whole multi-symbol run retains its nonadditive shaped width and exact UTF16 range for either declared slot', () => {
  for (const mathSlot of [true, false]) {
    const a = setup({ texts: ['甲', '）', '乙', '≤≥', '丙'], mathSlot });
    const old = a.line.spans[3]!,
      result = a.run();
    expect(result).toBeDefined();
    const held = a.line.spans.filter((s) => s.text.includes('≤'));
    expect(held).toHaveLength(1);
    expect(held[0]).toEqual({ ...old, box: { ...old.box, x: old.box.x - 2 } });
    expect(held[0]!.box.width).toBe(19.125);
  }
});
test('mathematical runs provide neither their own nor their adjacent ink as compression capacity', () => {
  reject(setup({ texts: ['≥', '（'] }));
  reject(setup({ texts: ['）', '≥'] }));
});
test('missing real CJK ink, insufficient capacity and the existing half-glyph precondition still reject unchanged', () => {
  reject(setup({ measure: { ...measurer, inkBounds: () => ({ left: 0, right: 12 }) } }));
  const a = setup();
  reject(a, a.line.width + 5);
  reject(setup({ measure: { ...measurer, inkBounds: undefined } }));
});
test('unknown script, a math variation sequence and mixed nonmath text remain outside the new barrier', () => {
  for (const text of ['Ж', '≥\ufe0f', '≥x', '≥\t'])
    reject(setup({ texts: ['甲', '）', '乙', text, '丙'] }));
});
test('resolved source face, authored tracking, scale, and complex direction gates remain strict', () => {
  reject(setup({ measure: { ...measurer, hasResolvedFont: () => false } }));
  for (const delta of [
    { characterSpacingPt: -0.25 },
    { horizontalScalePercent: 95 },
    { shaping: { direction: 'rtl' } },
    { shaping: { direction: 'ltr' } },
  ])
    reject(setup({ style: { ...style, ...delta } as ResolvedRunStyle }));
});
test('field revision projected caret float and inline-object ownership cannot qualify a mathematical barrier', () => {
  for (const delta of [
    { projected: true },
    { fieldAtom: {} },
    { equation: {} },
    { revisions: [{}] },
    { caretEdges: [] },
    { wrapAdvanceBefore: 1 },
  ]) {
    const a = setup();
    a.line.spans[3] = { ...a.line.spans[3]!, ...delta } as StyleSpanRecord;
    reject(a);
  }
  const a = setup();
  a.line.drawings.push({} as never);
  reject(a);
});
test('a genuine existing automatic gap remains outside barrier capacity and survives the fitted source ranges', () => {
  const a = setup({ texts: ['甲', '）', '乙', 'A', '≥'], gapBeforeA: true }),
    oldMath = a.line.spans[4]!,
    result = a.run();
  expect(result).toBeDefined();
  const latin = a.line.spans.find((s) => s.text === 'A')!,
    preceding = a.line.spans[a.line.spans.indexOf(latin) - 1]!;
  expect(automaticTextSpacingBefore(latin)).toBe(2);
  expect(latin.box.x - preceding.box.x - preceding.box.width).toBeCloseTo(2, 8);
  expect(a.line.spans.at(-1)).toEqual({
    ...oldMath,
    box: { ...oldMath.box, x: oldMath.box.x - 2 },
  });
  expect(a.line.width + result!.width).toBeCloseTo(a.available, 8);
});
