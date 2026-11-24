import { expect, test } from 'bun:test';
import { spaceShrinkWordTail } from '../space-shrink-word-tail.ts';
import { loadBody } from './float-over-table-harness.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type TextMeasurer } from '../semantic-records.ts';

const measurer: TextMeasurer = {
  measure(text, style) {
    return [...text].reduce(
      (sum, c) =>
        sum +
        (c === ' '
          ? 4 + (style.shaping?.wordSpacingPt ?? 0)
          : (c === '.' ? 1 : 10) * (style.bold ? 1.2 : 1)),
      0
    );
  },
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
const prefix = 'aa '.repeat(10);
type Run = string | { text: string; props: string };
function layout(runs: readonly Run[], width = 255, mode = 15) {
  return layoutSemanticDocument(
    loadBody(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs.map((run) => `<w:r>${typeof run === 'string' ? '' : `<w:rPr>${run.props}</w:rPr>`}<w:t xml:space="preserve">${typeof run === 'string' ? run : run.text}</w:t></w:r>`).join('')}</w:p>` +
        `<w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    ),
    1,
    { measurer, compatibilityMode: mode }
  );
}
const text = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) =>
    line.spans
      .map((span) => span.text)
      .join('')
      .trimEnd()
  );

test('terminal punctuation across a run seam keeps the same complete-word fit', () => {
  const whole = layout([prefix + 'cc.']);
  const split = layout([prefix + 'cc', '.']);
  expect(text(whole)).toEqual([prefix + 'cc.']);
  expect(text(split)).toEqual(text(whole));
  const line = linesOf(split)[0]!;
  expect(line.spans.at(-1)!.box.x + line.spans.at(-1)!.box.width).toBeCloseTo(255, 6);
  for (const span of line.spans)
    expect(measurer.measure(span.text, span.style)).toBeCloseTo(span.box.width, 6);
});

test('complete-word fitting retains formatting and model ranges across several seams', () => {
  for (const suffix of ['', ' ', ' dd']) {
    const whole = layout([prefix, { text: 'cc.' + suffix, props: '<w:b/>' }], 259);
    const split = layout(
      [
        prefix,
        { text: 'c', props: '<w:b/>' },
        { text: 'c', props: '<w:b/>' },
        { text: '.' + suffix, props: '<w:b/>' },
      ],
      259
    );
    expect(text(split)).toEqual(text(whole));
    const lines = linesOf(split);
    expect(lines[0]!.spans.filter((s) => s.text.includes('c')).every((s) => s.style.bold)).toBe(
      true
    );
    const spans = lines.flatMap((line) => line.spans);
    expect(spans.map((s) => s.text).join('')).toBe(prefix + 'cc.' + suffix);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]!.range.start).toBe(spans[i - 1]!.range.end);
  }
});

test('lookahead includes the following face advance and respects the space floor', () => {
  const regular = layout([prefix + 'cc', '.']);
  expect(text(regular)).toHaveLength(1);
  const oversized = layout([prefix + 'cc', { text: 'dddd', props: '<w:b/>' }]);
  expect(text(oversized)).toEqual(text(layout([prefix, { text: 'ccdddd', props: '<w:b/>' }])));
  expect(text(layout([prefix + 'cc', '.'], 249))).toEqual(text(layout([prefix + 'cc.'], 249)));
});

test('legacy modes and nonbreaking whitespace keep their existing fit decisions', () => {
  for (const mode of [14, 15, 16]) {
    for (const tail of ['.\u00a0', '.\tmore', '.\nmore']) {
      expect(text(layout([prefix + 'cc', tail], 255, mode))).toEqual(
        text(layout([prefix + 'cc' + tail], 255, mode))
      );
    }
  }
  expect(text(layout([prefix + 'cc', '.'], 255, 14))).toEqual([prefix.trimEnd(), 'cc.']);
});

test('many source seams preserve the complete-word fit', () => {
  const whole = layout([prefix + 'cccccccccc.'], 334);
  const split = layout([prefix, ...Array.from({ length: 10 }, () => 'c'), '.'], 334);
  expect(text(split)).toEqual(text(whole));
  expect(text(split)).toHaveLength(1);
});

test('lookahead measures each future piece once across a long split word', () => {
  const style = linesOf(layout(['a']))[0]!.spans[0]!.style;
  const pieces = Array.from({ length: 400 }, (_, start) => ({
    text: 'c',
    start,
    end: start + 1,
    props: [],
    style,
  }));
  let calls = 0;
  const tail = spaceShrinkWordTail(pieces, {
    ...measurer,
    measure(text, face) {
      calls++;
      return measurer.measure(text, face);
    },
  });
  for (let i = 0; i < pieces.length - 1; i++) expect(tail(i, 1)).toBe((pieces.length - i - 1) * 10);
  expect(calls).toBe(pieces.length - 1);
});

test('visual ordering retains measurable compressed advances', () => {
  const result = layout([prefix + 'cc.']);
  for (const span of linesOf(result)[0]!.spans)
    expect(measurer.measure(span.text, span.style)).toBeCloseTo(span.box.width, 6);
});
