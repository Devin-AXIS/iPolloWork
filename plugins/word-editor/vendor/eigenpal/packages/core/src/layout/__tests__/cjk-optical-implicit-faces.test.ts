import { expect, test } from 'bun:test';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { createCjkOpticalFitter, createParagraphCjkOpticalFitter } from '../cjk-optical-fit.ts';
import { cjkParagraphBreaks } from '../cjk-paragraph-breaks.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import type { PendingLine } from '../pending-line.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

const style: ResolvedRunStyle = {
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'EA',
  fontFamilyEastAsia: 'EA',
  fontSizePt: 12,
  kerningEnabled: true,
  kerningMinPt: 1,
};
const measure: TextMeasurer = {
  measure: (text) => text.length * 12,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds(text) {
    return text === '）' ? { left: 2, right: 4 } : { left: 0.5, right: 11.5 };
  },
};
const policy = { ...DEFAULT_CJK_TYPOGRAPHY, autoSpaceDE: false, autoSpaceDN: false };
function attempt(
  options: {
    slot?: StyleSpanRecord['fontSlot'];
    style?: ResolvedRunStyle;
    measure?: TextMeasurer;
    prefix?: string;
    flags?: Partial<FieldAwarePiece>;
    spanFlags?: Partial<StyleSpanRecord>;
  } = {}
) {
  const s = options.style ?? style,
    m = options.measure ?? measure,
    prefix = options.prefix ?? '甲）',
    slot = options.slot;
  const pieces: FieldAwarePiece[] = [
    {
      text: prefix,
      start: 0,
      end: prefix.length,
      style: s,
      props: [],
      fontSlot: slot,
      ...options.flags,
    },
    {
      text: '乙',
      start: prefix.length,
      end: prefix.length + 1,
      style: s,
      props: [],
      fontSlot: slot,
    },
  ];
  const span: StyleSpanRecord = {
    text: prefix,
    range: { paragraphId: 'synthetic', start: 0, end: prefix.length },
    style: s,
    props: [],
    fontSlot: slot,
    box: { x: 0, y: 0, width: prefix.length * 12, height: 16 },
    ...options.spanFlags,
  };
  const before = { ...span, box: { ...span.box } },
    line: PendingLine = {
      spans: [span],
      drawings: [],
      start: 0,
      end: prefix.length,
      width: prefix.length * 12,
      height: 16,
      baseline: 12,
      leading: 0,
      trailingSpacing: 0,
    },
    originalWidth = line.width;
  const available = originalWidth + 10;
  const result = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), m, {
    hangingPunctuation: false,
    requireLocalQualification: true,
  })(
    line,
    1,
    '乙',
    { paragraphId: 'synthetic', start: prefix.length, end: prefix.length + 1 },
    12,
    line.width,
    available,
    true
  );
  return { result, line, before, available, originalWidth };
}
function unchanged(value: ReturnType<typeof attempt>) {
  expect(value.result).toBeUndefined();
  expect(value.line.spans).toEqual([value.before]);
  expect(value.line.width).toBe(value.originalWidth);
}
test('identical declared faces let implicit Han use the existing qualified East Asian cells', () => {
  const implicit = attempt(),
    explicit = attempt({ slot: 'eastAsia' });
  expect(implicit.result).toBeDefined();
  expect(explicit.result).toBeDefined();
  expect(implicit.line.width + implicit.result!.width).toBeCloseTo(implicit.available, 8);
  const geometry = (a: ReturnType<typeof attempt>) =>
    [...a.line.spans, ...a.result!.candidate].map((s) => ({
      text: s.text,
      range: s.range,
      box: s.box,
      glyphOffsetPt: s.glyphOffsetPt,
      spacing: s.style.characterSpacingPt,
    }));
  expect(geometry(implicit)).toEqual(geometry(explicit));
  expect(implicit.line.spans.every((s) => s.fontSlot === undefined)).toBe(true);
  expect(style.characterSpacingPt).toBe(0);
});
test('explicit non-East-Asian slots and different or absent declared faces keep the old refusal', () => {
  unchanged(attempt({ slot: 'ascii' }));
  unchanged(attempt({ style: { ...style, fontFamily: 'Other' } }));
  unchanged(attempt({ style: { ...style, fontFamilyEastAsia: undefined } }));
});
test('a mixed coalesced span is not relabelled or split into new Latin shaping cells', () => {
  for (const prefix of ['甲AV）', '甲18）', '甲0.015）', '甲GB 50025）'])
    unchanged(attempt({ prefix }));
});
test('authored tracking, scaling, and complex shaping remain strict refusal gates', () => {
  for (const change of [
    { characterSpacingPt: -0.2 },
    { characterSpacingPt: 0.2 },
    { horizontalScalePercent: 90 },
    { shaping: { script: 'Hani', direction: 'ltr' as const, level: 0, baseLevel: 0 } },
  ])
    unchanged(attempt({ style: { ...style, ...change } }));
  for (const m of [
    { ...measure, hasResolvedFont: undefined },
    { ...measure, hasResolvedFont: () => false },
  ])
    unchanged(attempt({ measure: m }));
});
test('fields projected spans revisions and unknown script retain unmodified geometry', () => {
  unchanged(attempt({ spanFlags: { fieldAtom: true } }));
  unchanged(attempt({ spanFlags: { projected: true } }));
  unchanged(attempt({ spanFlags: { revisions: [{ kind: 'insert', id: 'r' }] as never } }));
  for (const prefix of ['甲Ω）', '甲ب）', '甲\t）', '甲\u00a0）']) unchanged(attempt({ prefix }));
});
test('implicit slot admission cannot activate a missing source East Asian paragraph policy', () => {
  const pieces: FieldAwarePiece[] = [
    { text: 'A甲）', start: 0, end: 3, style, props: [] },
    { text: '乙', start: 3, end: 4, style, props: [] },
  ];
  const settings = {
    strict: false,
    compression: 'compressPunctuation' as const,
    punctuationKerning: true,
    sourceEastAsianFont: false,
    before: {},
    after: {},
  };
  const typography = { ...policy, settings },
    breaks = cjkParagraphBreaks(pieces, typography);
  expect(
    createParagraphCjkOpticalFitter(pieces, pieces, breaks, measure, typography, false, false, true)
      .opticalCompression
  ).toBe(false);
  expect(
    createParagraphCjkOpticalFitter(
      pieces,
      pieces,
      breaks,
      measure,
      { ...typography, settings: { ...settings, sourceEastAsianFont: true } },
      false,
      false,
      true
    ).opticalCompression
  ).toBe(true);
});

function markerAttempt(marker: string, slot?: StyleSpanRecord['fontSlot'], family = 'EA') {
  const s = { ...style, fontFamily: family };
  let offset = 0,
    x = 0;
  const pieces: FieldAwarePiece[] = [marker, '甲', '）', '乙'].map((text, index) => {
    const piece: FieldAwarePiece = {
      text,
      start: offset,
      end: offset + text.length,
      props: [],
      style: s,
      ...(index === 0 ? (slot ? { fontSlot: slot } : {}) : { fontSlot: 'eastAsia' as const }),
    };
    offset = piece.end;
    return piece;
  });
  const spans: StyleSpanRecord[] = pieces.slice(0, -1).map((piece, index) => {
    const width = index === 0 ? 23.5 : 12;
    const span = {
      text: piece.text,
      style: piece.style,
      props: piece.props,
      fontSlot: piece.fontSlot,
      range: { paragraphId: 'marker', start: piece.start, end: piece.end },
      box: { x, y: 0, width, height: 16 },
    };
    x += width;
    return span;
  });
  const before = spans.map((span) => ({ ...span, box: { ...span.box } }));
  const line: PendingLine = {
    spans,
    drawings: [],
    start: 0,
    end: pieces[2]!.end,
    width: x,
    height: 16,
    baseline: 12,
    leading: 0,
    trailingSpacing: 0,
  };
  const last = pieces[3]!;
  const result = createCjkOpticalFitter(pieces, cjkParagraphBreaks(pieces, policy), measure, {
    hangingPunctuation: false,
    requireLocalQualification: true,
  })(
    line,
    3,
    last.text,
    { paragraphId: 'marker', start: last.start, end: last.end },
    12,
    x,
    x + 10,
    true
  );
  return { result, line, before, width: x };
}
test('a same-face coalesced numeric marker retains its full nonadditive advance and source range', () => {
  for (const marker of ['12、', '3．']) {
    const value = markerAttempt(marker);
    expect(value.result).toBeDefined();
    const span = value.line.spans[0]!,
      original = value.before[0]!;
    expect(span.text).toBe(marker);
    expect(span.range).toEqual(original.range);
    expect(span.box.width).toBe(23.5);
    expect(span.style).toBe(original.style);
    expect(span.fontSlot).toBeUndefined();
    expect(span.style.characterSpacingPt).toBe(0);
  }
});
test('numeric markers do not infer an East Asian face from explicit Latin slots or unrelated families', () => {
  for (const value of [
    markerAttempt('12、', 'ascii'),
    markerAttempt('12、', undefined, 'Other'),
    markerAttempt('12。'),
    markerAttempt('12、甲'),
  ]) {
    expect(value.result).toBeUndefined();
    expect(value.line.spans).toEqual(value.before);
    expect(value.line.width).toBe(value.width);
  }
});
