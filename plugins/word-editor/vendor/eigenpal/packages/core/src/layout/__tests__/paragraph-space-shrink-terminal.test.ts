import { anyShrunk, spacingOf } from './shrunk-space.ts';
import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { caretAt } from '../semantic-interaction.ts';
import { alignSpans } from '../paragraph-alignment.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';
import type { PendingLine } from '../pending-line.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

// A letter is 10pt and a space 4pt, so `aa bb cc` is 68pt. Two spaces may give up 1pt
// each (the 75% floor), so it fits a 66pt measure and no narrower one.
const measurer: TextMeasurer = {
  measure(text, style) {
    return [...text].reduce(
      (n, c) => n + (c === ' ' ? 4 + (style.shaping?.wordSpacingPt ?? 0) : c === ' ' ? 4 : 10),
      0
    );
  },
  lineMetrics() {
    return { height: 14, baseline: 11 };
  },
};

const paragraph = (runsXml: string, width = 66, pPr = '<w:jc w:val="both"/>') =>
  loadBody(
    `<w:p><w:pPr>${pPr}</w:pPr>${runsXml}</w:p><w:sectPr><w:pgSz w:w="${(width + 50) * 20}" ` +
      `w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
  );
const runs = (texts: readonly string[], boldIndex = -1) =>
  texts
    .map(
      (text, index) =>
        `<w:r>${index === boldIndex ? '<w:rPr><w:b/></w:rPr>' : ''}` +
        `<w:t xml:space="preserve">${text}</w:t></w:r>`
    )
    .join('');
const layout = (body: ReturnType<typeof loadBody>, compatibilityMode?: number) =>
  layoutSemanticDocument(body, 1, { measurer, compatibilityMode });
const modern = (body: ReturnType<typeof loadBody>) => layout(body, 15);
const content = (result: ReturnType<typeof layoutSemanticDocument>) =>
  linesOf(result).map((l) =>
    l.spans
      .map((s) => s.text)
      .join('')
      .trimEnd()
  );
const compressed = (result: ReturnType<typeof layoutSemanticDocument>) =>
  linesOf(result).some((l) => anyShrunk(l.spans));
/** Where the last visible glyph of `word` ends, from the line's first span. */
const wordEnd = (result: ReturnType<typeof layoutSemanticDocument>, word: string) => {
  const spans = linesOf(result)[0]!.spans;
  const span = spans.filter((s) => s.text.trimEnd().endsWith(word)).at(-1)!;
  return span.box.x + measurer.measure(span.text.trimEnd(), span.style) - spans[0]!.box.x;
};

test("a justified paragraph's last word borrows inter-word space, with measurable spans", () => {
  const result = modern(paragraph(runs(['aa bb cc'])));
  expect(content(result)).toEqual(['aa bb cc']);
  const spans = linesOf(result)[0]!.spans;
  expect(spacingOf(spans)).toEqual([-1, -1, 0]);
  for (const span of spans)
    expect(measurer.measure(span.text, span.style)).toBeCloseTo(span.box.width, 6);
  for (let i = 1; i < spans.length; i++)
    expect(spans[i]!.box.x).toBeCloseTo(spans[i - 1]!.box.x + spans[i - 1]!.box.width - 1, 6);
  expect(wordEnd(result, 'cc')).toBeCloseTo(66, 6);
});

test('a last line that fits keeps its natural spacing and never stretches', () => {
  for (const text of ['aa bb', 'aa bb cc dd']) {
    const last = linesOf(modern(paragraph(runs([text])))).at(-1)!.spans;
    expect(anyShrunk(last)).toBe(false);
    for (let i = 1; i < last.length; i++)
      expect(last[i]!.box.x).toBeCloseTo(last[i - 1]!.box.x + last[i - 1]!.box.width, 6);
  }
});

test('a last word split across styled runs, or followed by blank runs, still fits', () => {
  for (const [texts, boldIndex] of [
    [['aa bb c', 'c'], -1],
    [['aa bb ', 'c', 'c'], 1],
    [['aa bb cc '], -1],
    [['aa bb cc', ' ', '  '], -1],
    [['aa bb cc ', ' '], 2],
  ] as const) {
    const result = modern(paragraph(runs(texts, boldIndex)));
    expect(content(result)).toEqual(['aa bb cc']);
    expect(wordEnd(result, 'c')).toBeCloseTo(66, 6);
  }
});

test('a page field after or as the last word keeps the wrap', () => {
  const ref = (result: string) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">` +
    ` REF bm1 \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:t>${result}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  for (const xml of [
    runs(['aa bb ']) + `<w:fldSimple w:instr="PAGE"><w:r><w:t>cc</w:t></w:r></w:fldSimple>`,
    // A page reference and a note reference can change width after the line is decided.
    runs(['aa bb ']) + ref('cc').replace(' REF bm1 ', ' PAGEREF bm1 '),
    runs(['aa bb ']) + ref('cc').replace(' REF bm1 ', ' NOTEREF bm1 '),
  ]) {
    const result = modern(paragraph(xml));
    expect(content(result)[0]).toBe('aa bb');
    expect(compressed(result)).toBe(false);
  }
  // A cross-reference result keeps its width through pagination: it compresses like text.
  const result = modern(paragraph(runs(['aa bb ']) + ref('cc')));
  expect(content(result)[0]).toBe('aa bb cc');
  expect(compressed(result)).toBe(true);
});

test('no-break spaces are neither slots nor word ends for the last word', () => {
  for (const [text, expected] of [
    ['aa bb cc', ['aa', 'bb cc']],
    ['aa bb cc', ['aa bb', 'cc']],
  ] as const) {
    const result = modern(paragraph(runs([text])));
    expect(content(result)).toEqual([...expected]);
    expect(compressed(result)).toBe(false);
  }
});

test('the space floor and the expansion preference still decide for the last word', () => {
  expect(content(modern(paragraph(runs(['aa bb cc']), 65)))).toEqual(['aa bb', 'cc']);
  // Ten spaces could absorb the 9pt overflow, but the line without the word is only 1pt
  // short: stretching it is the gentler change, so the word wraps.
  const text = Array(10).fill('aa').join(' ') + ' b';
  expect(content(modern(paragraph(runs([text]), 241)))).toEqual([
    Array(10).fill('aa').join(' '),
    'b',
  ]);
});

test('legacy, unspecified and left-aligned paragraphs keep the wrap', () => {
  const body = paragraph(runs(['aa bb cc']));
  for (const mode of [undefined, 14]) expect(content(layout(body, mode))).toEqual(['aa bb', 'cc']);
  expect(content(modern(paragraph(runs(['aa bb cc']), 66, '<w:jc w:val="left"/>')))).toEqual([
    'aa bb',
    'cc',
  ]);
});

test('justified right-to-left paragraphs compress the last word like left-to-right ones', () => {
  const rtl = modern(paragraph(runs(['aa bb cc']), 66, '<w:bidi/><w:jc w:val="both"/>'));
  expect(linesOf(rtl).length).toBe(1);
  expect(compressed(rtl)).toBe(true);
});

test('retained layout publishes the same last-line geometry as a fresh one', () => {
  const body = paragraph(runs(['aa bb c', 'c']));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const options = { measurer, session, cache, producer: 'terminal-shrink-test' };
  const boxes = (result: ReturnType<typeof layoutSemanticDocument>) =>
    linesOf(result).map((l) => l.spans.map((s) => [s.text, s.box.x, s.box.width]));
  const fresh = boxes(modern(body));
  expect(content(layoutSemanticDocument(body, 1, { ...options, compatibilityMode: 14 }))).toEqual([
    'aa bb',
    'cc',
  ]);
  for (const revision of [2, 3])
    expect(
      boxes(layoutSemanticDocument(body, revision, { ...options, compatibilityMode: 15 }))
    ).toEqual(fresh);
  // Without a session, the second pass reads the frozen cached lines, which keep the admission.
  const frozen = createParagraphLayoutCache<readonly PendingLine[]>();
  for (const revision of [1, 2])
    expect(
      boxes(
        layoutSemanticDocument(body, revision, { measurer, cache: frozen, compatibilityMode: 15 })
      )
    ).toEqual(fresh);
});

test('the caret follows the compressed last line', () => {
  const result = modern(paragraph(runs(['aa bb cc'])));
  const spans = linesOf(result)[0]!.spans;
  const paragraphId = spans[0]!.range.paragraphId;
  const x = (offset: number) => caretAt(result, { paragraphId, offset }, measurer)!.x;
  expect(x(3)).toBeCloseTo(spans[1]!.box.x, 6);
  expect(x(6)).toBeCloseTo(spans[2]!.box.x, 6);
  expect(x(8) - x(0)).toBeCloseTo(66, 6);
});

// Alignment never guesses from the spans why a last line overflows: only the flow's
// admission of the paragraph's last word, carried on the line, lets it compress.
test('a last line compresses only when the flow admitted its last word', () => {
  const span = (text: string, x: number): StyleSpanRecord => ({
    range: { paragraphId: 'p', start: x, end: x + text.length },
    text,
    props: [],
    style: DEFAULT_RUN_STYLE,
    box: { x, y: 0, width: measurer.measure(text, DEFAULT_RUN_STYLE), height: 14 },
  });
  const words = [span('aa ', 0), span('bb ', 24), span('cc', 48)];
  const align = (lastLineShrinks: boolean) =>
    alignSpans(words, measurer, 0, 66, 'both', true, undefined, false, false, lastLineShrinks);
  expect(align(false)).toEqual(words);
  const shrunk = align(true);
  expect(shrunk.at(-1)!.box.x + shrunk.at(-1)!.box.width).toBeCloseTo(66, 6);
  // A line that is not the paragraph's last compresses whenever it overflows, as before.
  const middle = alignSpans(words, measurer, 0, 66, 'both', false);
  expect(middle.at(-1)!.box.x + middle.at(-1)!.box.width).toBeCloseTo(66, 6);
});

test('a word before a text-wrapping break or a tab borrows inter-word space', () => {
  for (const xml of [
    '<w:r><w:t>aa bb cc</w:t><w:br/></w:r>',
    '<w:r><w:t>aa bb cc</w:t><w:br/><w:t>dd</w:t></w:r>',
    '<w:r><w:t>aa bb cc</w:t><w:tab/></w:r>',
    '<w:r><w:t>aa bb cc</w:t><w:tab/><w:t>dd</w:t></w:r>',
    '<w:r><w:t xml:space="preserve">aa bb cc </w:t><w:br/></w:r>',
  ]) {
    const result = modern(paragraph(xml));
    expect(content(result)[0]).toBe('aa bb cc');
    expect(compressed(result)).toBe(true);
  }
});
