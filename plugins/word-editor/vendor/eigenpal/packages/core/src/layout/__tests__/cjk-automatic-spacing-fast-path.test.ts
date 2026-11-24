import { expect, test } from 'bun:test';
import { withAuthoredCjkGapMetric } from '../cjk-auto-spacing-metric-port.ts';
import {
  automaticLineTextGap,
  automaticTextGap,
  candidateAutomaticGap,
  piecesMayTakeAutomaticSpacing,
} from '../cjk-automatic-spacing.ts';
import { DEFAULT_CJK_TYPOGRAPHY } from '../cjk-typography.ts';
import type { FieldAwarePiece } from '../field-pieces.ts';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

const style = (fontSizePt = 20): ResolvedRunStyle => ({
  ...DEFAULT_RUN_STYLE,
  fontFamily: 'Fixture face',
  fontFamilyEastAsia: 'Fixture face',
  fontSizePt,
});
const boundary = (text: string, fontSizePt = 20) => ({ text, style: style(fontSizePt) });
const policy = DEFAULT_CJK_TYPOGRAPHY;
const measurer = withAuthoredCjkGapMetric(
  {
    measure: (text: string) => text.length * 10,
    lineMetrics: () => ({ height: 24, baseline: 18 }),
  },
  (value) => value.fontSizePt / 4
) satisfies TextMeasurer;

function span(text: string, start: number, x: number, width: number): StyleSpanRecord {
  return {
    range: { paragraphId: 'p', start, end: start + text.length },
    text,
    props: [],
    style: style(),
    box: { x, y: 0, width, height: 24 },
  };
}
function piece(text: string, start: number): FieldAwarePiece {
  return { text, props: [], style: style(), start, end: start + text.length };
}

test('boundaries without an East Asian side take no gap, marks included', () => {
  expect(automaticTextGap(boundary('word'), boundary('next'), policy, measurer)).toBe(0);
  expect(automaticTextGap(boundary('2026'), boundary('-11'), policy, measurer)).toBe(0);
  expect(automaticTextGap(boundary('é'), boundary('Ä'), policy, measurer)).toBe(0);
  // A trailing combining mark is not a base, so the base before it decides the boundary.
  expect(automaticTextGap(boundary('甲́'), boundary('A'), policy, measurer)).toBe(5);
  expect(automaticTextGap(boundary('Á'), boundary('乙'), policy, measurer)).toBe(5);
  expect(automaticTextGap(boundary('甲'), boundary('A'), policy, measurer)).toBe(5);
  expect(automaticTextGap(boundary('A'), boundary('한'), policy, measurer)).toBe(5);
});

test('a paragraph takes automatic gaps only when its text has an East Asian side', () => {
  expect(
    piecesMayTakeAutomaticSpacing([{ text: 'Plain ' }, { text: 'Latin, 2026.' }], policy)
  ).toBe(false);
  expect(piecesMayTakeAutomaticSpacing([{ text: 'Price ' }, { text: '価格' }], policy)).toBe(true);
  expect(piecesMayTakeAutomaticSpacing([{ text: '한국어 text' }], policy)).toBe(true);
  expect(
    piecesMayTakeAutomaticSpacing([{ text: '価格 1' }], {
      ...policy,
      autoSpaceDE: false,
      autoSpaceDN: false,
    })
  ).toBe(false);
});

test('a paragraph that cannot take a gap never prices one', () => {
  const gap = candidateAutomaticGap(false, piece('word', 0), style(), 'word', 0);
  expect(gap()).toBe(0);
  expect(gap('other', 3)).toBe(0);
});

test('a candidate keeps its gap until the line it lands on changes', () => {
  // A Latin letter before East Asian text reads the reverse metric each time it is priced.
  let priced = 0;
  const counting = withAuthoredCjkGapMetric({ ...measurer }, (value) => {
    priced += 1;
    return value.fontSizePt / 4;
  });
  let line: { spans: StyleSpanRecord[]; width: number } = {
    spans: [span('A', 0, 0, 10)],
    width: 10,
  };
  const next = piece('乙', 1);
  const gap = candidateAutomaticGap(
    {
      line: () => line,
      lineOrigin: () => 0,
      paragraphId: 'p',
      typography: policy,
      measurer: counting,
    },
    next,
    style(),
    '乙',
    1
  );
  const direct = () =>
    automaticLineTextGap(line, () => 0, 'p', 1, next, '乙', style(), policy, measurer);
  expect(gap()).toBe(5);
  expect(gap()).toBe(direct());
  expect(priced).toBe(1);
  // A wrap gives the candidate a fresh line: no previous span, so no gap.
  line = { spans: [], width: 0 };
  expect(gap()).toBe(0);
  expect(gap()).toBe(direct());
  // A later line ending in Latin text prices the gap again.
  line = { spans: [span('B', 0, 0, 10)], width: 10 };
  expect(gap()).toBe(5);
  expect(priced).toBe(2);
  // Another text or start is another question.
  expect(gap('丙', 2)).toBe(0);
});
