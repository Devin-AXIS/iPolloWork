import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/index.ts';
import { linesOf } from '../semantic-records.ts';
import { createLayoutSession, layoutSemanticDocument } from '../semantic-layout.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import type { LineRecord, StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const fonts = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
});
const font = fonts.resolve(request);
if (font instanceof FontResolutionError) throw font;
const shaped = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => font,
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});
// A letter joined to an Arabic neighbour is narrower than one standing alone, so a word
// measures differently whole than letter by letter.
const arabic = /\p{Script=Arabic}/u;
const joining: TextMeasurer = {
  measure(text, style) {
    const chars = [...text];
    return chars.reduce((sum, char, index) => {
      if (char === ' ') return sum + 3 + (style.shaping?.wordSpacingPt ?? 0);
      const joined =
        arabic.test(char) &&
        (arabic.test(chars[index - 1] ?? '') || arabic.test(chars[index + 1] ?? ''));
      return sum + (joined ? 4 : 7);
    }, 0);
  },
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};

const ARABIC =
  'المستفيد من العقد يلتزم بتقديم جميع المستندات المطلوبة خلال مدة لا تتجاوز ثلاثين يوما من تاريخ التوقيع على هذا الاتفاق';
const HEBREW = 'שלום עולם זה טקסט בעברית שנועד לבדוק יישור של שורות ארוכות בפסקה צרה מאוד';
const MIXED = 'المستفيد من العقد ABC Company يلتزم بتقديم 123 جميع المستندات المطلوبة خلال مدة';
const LATIN = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';
const WIDTH = 120;
const MARGIN = 15;
// Line geometry is relative to the page content box.
const START = 0;

const font10 =
  '<w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans" w:cs="DejaVu Sans"/>' +
  '<w:sz w:val="20"/><w:szCs w:val="20"/>';
/** One justified paragraph; with `brk`, the text, that break, then `after`. */
function body(
  text: string,
  rtl: boolean,
  table = false,
  brk = '',
  after = '',
  pPr = '<w:jc w:val="both"/>'
) {
  const run = (content: string) =>
    `<w:r><w:rPr>${font10}${rtl ? '<w:rtl/>' : ''}</w:rPr>${content}</w:r>`;
  const words = (value: string) => run(`<w:t xml:space="preserve">${value}</w:t>`);
  const paragraph =
    `<w:p><w:pPr>${rtl ? '<w:bidi/>' : ''}${pPr}</w:pPr>${words(text)}` +
    `${brk ? run(brk) + words(after) : ''}</w:p>`;
  const cell =
    `<w:tbl><w:tblPr><w:tblW w:w="${WIDTH * 20}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${WIDTH * 20}"/></w:tblGrid><w:tr><w:tc>` +
    `<w:tcPr><w:tcW w:w="${WIDTH * 20}" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`;
  const xml =
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    `${table ? cell : paragraph}<w:sectPr><w:pgSz w:w="${(WIDTH + 2 * MARGIN) * 20}" w:h="12000"/>` +
    `<w:pgMar w:left="${MARGIN * 20}" w:right="${MARGIN * 20}" w:top="300" w:bottom="300"/>` +
    '</w:sectPr></w:body></w:document>';
  const part = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!part.ok) throw Error(part.reason);
  return part.part;
}

/** Where a span's glyphs sit: its box less the spaces at its logical end. */
function ink(span: StyleSpanRecord, measurer: TextMeasurer): readonly [number, number] {
  const visible = span.text.trim();
  const style = span.style.shaping
    ? { ...span.style, shaping: { ...span.style.shaping, wordSpacingPt: 0 } }
    : span.style;
  const width = measurer.measure(visible, style);
  return (span.style.shaping?.level ?? 0) % 2
    ? [span.box.x + span.box.width - width, span.box.x + span.box.width]
    : [span.box.x, span.box.x + width];
}
function edges(line: LineRecord, measurer: TextMeasurer): readonly [number, number] {
  const boxes = line.spans.filter((span) => span.text.trim()).map((span) => ink(span, measurer));
  return [Math.min(...boxes.map((box) => box[0])), Math.max(...boxes.map((box) => box[1]))];
}
const text = (line: LineRecord) =>
  line.spans
    .map((span) => span.text)
    .join('')
    .trim();

test.each([
  ['Arabic shaped by HarfBuzz', ARABIC, shaped],
  ['Arabic with joining-dependent widths', ARABIC, joining],
  ['Hebrew', HEBREW, shaped],
  ['mixed-direction text', MIXED, shaped],
] as const)('every justified %s line fills the measure and no further', (_, source, measurer) => {
  for (const table of [false, true]) {
    const lines = linesOf(
      layoutSemanticDocument(body(source, true, table), 0, { measurer, compatibilityMode: 15 })
    ).filter((line) => line.spans.some((span) => span.text.trim()));
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(0, -1)) {
      expect(text(line).length).toBeGreaterThan(0);
      const [left, right] = edges(line, measurer);
      expect(left).toBeCloseTo(START, 3);
      expect(right).toBeCloseTo(START + WIDTH, 3);
    }
    const [left, right] = edges(lines.at(-1)!, measurer);
    expect(left).toBeGreaterThan(START);
    expect(right).toBeCloseTo(START + WIDTH, 3);
  }
});

test('the line-end space of a justified right-to-left line hangs in the left margin', () => {
  const line = linesOf(
    layoutSemanticDocument(body(ARABIC, true), 0, { measurer: shaped, compatibilityMode: 15 })
  )[0]!;
  expect(text(line)).toBe('المستفيد من العقد يلتزم');
  const space = line.spans.find((span) => span.text === ' ')!;
  expect(space.box.x + space.box.width).toBeCloseTo(START, 3);
  expect(line.contentX).toBeCloseTo(space.box.x, 6);
  // Spans stay in source order and keep their own ranges.
  expect(line.spans.map((span) => span.text).join('')).toBe('المستفيد من العقد يلتزم ');
});

test('justified left-to-right lines keep their geometry', () => {
  const lines = linesOf(
    layoutSemanticDocument(body(LATIN, false), 0, { measurer: shaped, compatibilityMode: 15 })
  );
  for (const line of lines.slice(0, -1)) {
    expect(line.spans[0]!.box.x).toBeCloseTo(START, 6);
    expect(edges(line, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
  }
});

test('the painted line starts its text at the margin', () => {
  const result = layoutSemanticDocument(body(ARABIC, true), 0, {
    measurer: shaped,
    compatibilityMode: 15,
  });
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1 });
  const line = linesOf(result)[0]!;
  const element = host.querySelector<HTMLElement>('.docx-line')!;
  const runs = Array.from(element.querySelectorAll<HTMLElement>('.layout-run-text'));
  expect(runs.map((run) => run.textContent)).toEqual(line.spans.map((span) => span.text));
  // Runs flow in source order, each shifted to its visual place relative to the flow.
  let flow = parseFloat(element.style.left);
  const painted = runs.map((run) => {
    const width = parseFloat(run.style.width);
    const x = flow + parseFloat(run.style.left);
    flow += width;
    return [x, x + width] as const;
  });
  const space = painted.at(-1)!;
  const words = painted.slice(0, -1);
  // The hanging space paints in the margin; the text runs from the margin across.
  expect(space[1]).toBeCloseTo(START, 3);
  expect(Math.min(...words.map((box) => box[0]))).toBeCloseTo(START, 3);
  expect(Math.max(...words.map((box) => box[1]))).toBeCloseTo(START + WIDTH, 3);
});

const firstLine = (part: ReturnType<typeof body>) =>
  linesOf(layoutSemanticDocument(part, 0, { measurer: shaped, compatibilityMode: 15 }))[0]!;

test('a justified line before a line break fills the measure and hangs its space', () => {
  const rtl = firstLine(body('المستفيد من العقد ', true, false, '<w:br/>', 'يلتزم بتقديم'));
  expect(edges(rtl, shaped)[0]).toBeCloseTo(START, 3);
  expect(edges(rtl, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
  const space = rtl.spans.find((span) => span.text === ' ')!;
  expect(space.box.x + space.box.width).toBeCloseTo(START, 3);
  const ltr = firstLine(body('lorem ipsum dolor ', false, false, '<w:br/>', 'sit amet'));
  expect(edges(ltr, shaped)[0]).toBeCloseTo(START, 3);
  expect(edges(ltr, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
});

test.each([
  ['page', '<w:br w:type="page"/>'],
  ['column', '<w:br w:type="column"/>'],
])('a justified line before a %s break sets like a last line', (_, brk) => {
  const rtl = firstLine(body('المستفيد من العقد ', true, false, brk, 'يلتزم بتقديم'));
  expect(edges(rtl, shaped)[0]).toBeGreaterThan(START + 1);
  expect(edges(rtl, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
  const space = rtl.spans.find((span) => span.text === ' ')!;
  expect(space.box.x + space.box.width).toBeCloseTo(edges(rtl, shaped)[0], 3);
  const ltr = firstLine(body('lorem ipsum dolor ', false, false, brk, 'sit amet'));
  expect(edges(ltr, shaped)[0]).toBeCloseTo(START, 3);
  expect(edges(ltr, shaped)[1]).toBeLessThan(START + WIDTH - 1);
  expect(ltr.spans.every((span) => !span.style.shaping?.wordSpacingPt)).toBe(true);
});

test("a justified right-to-left paragraph's last line hangs its trailing spaces", () => {
  for (const source of ['المستفيد من العقد ', 'المستفيد من العقد  ']) {
    const line = firstLine(body(source, true));
    expect(edges(line, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
  }
});

test('a tab before a line break keeps its stop and its leader inside the measure', () => {
  const pPr =
    '<w:tabs><w:tab w:val="right" w:leader="underscore" w:pos="2400"/></w:tabs>' +
    '<w:jc w:val="both"/>';
  const tabOf = (line: LineRecord) => line.spans.find((span) => span.text === '\t')!;
  const ltr = firstLine(body('Name of the party:', false, false, '<w:tab/><w:br/>', 'x', pPr));
  expect(tabOf(ltr).box.x + tabOf(ltr).box.width).toBeCloseTo(START + WIDTH, 3);
  expect(ltr.spans.every((span) => !span.style.shaping?.wordSpacingPt)).toBe(true);
  const rtl = firstLine(body('اسم الطرف:', true, false, '<w:tab/><w:br/>', 'التالي', pPr));
  expect(tabOf(rtl).box.x).toBeCloseTo(START, 3);
  expect(edges(rtl, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
});

test('a no-break space before a line break is content, not a hanging space', () => {
  const nbsp = shaped.measure(
    '\u00a0',
    linesOf(
      layoutSemanticDocument(body('x', false), 0, { measurer: shaped, compatibilityMode: 15 })
    )[0]!.spans[0]!.style
  );
  const ltr = firstLine(body('lorem ipsum dolor\u00a0', false, false, '<w:br/>', 'sit'));
  expect(edges(ltr, shaped)[1]).toBeCloseTo(START + WIDTH - nbsp, 3);
  const rtl = firstLine(body('المستفيد من العقد\u00a0', true, false, '<w:br/>', 'يلتزم'));
  expect(edges(rtl, shaped)[0]).toBeCloseTo(START + nbsp, 3);
  expect(edges(rtl, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
});

test.each([2, 3])('justified lines that wrap at %i spaces fill the measure', (count) => {
  const latin = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';
  for (const [source, rtl] of [
    [latin, false],
    [ARABIC, true],
  ] as const) {
    const part = body(source.split(' ').join(' '.repeat(count)), rtl);
    const lines = linesOf(
      layoutSemanticDocument(part, 0, { measurer: shaped, compatibilityMode: 15 })
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(0, -1)) {
      expect(edges(line, shaped)[0]).toBeCloseTo(START, 3);
      expect(edges(line, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
    }
  }
});

test('a distributed line before a page break still fills the measure', () => {
  const pPr = '<w:jc w:val="distribute"/>';
  const brk = '<w:br w:type="page"/>';
  for (const [source, rtl] of [
    ['lorem ipsum dolor ', false],
    ['المستفيد من العقد ', true],
  ] as const) {
    const line = firstLine(body(source, rtl, false, brk, 'x', pPr));
    expect(edges(line, shaped)[0]).toBeCloseTo(START, 3);
    expect(edges(line, shaped)[1]).toBeCloseTo(START + WIDTH, 3);
  }
});

test('an unchanged relayout returns the same pages', () => {
  const session = createLayoutSession();
  const part = body(ARABIC, true);
  const first = layoutSemanticDocument(part, 1, {
    measurer: shaped,
    session,
    compatibilityMode: 15,
  });
  const second = layoutSemanticDocument(part, 1, {
    measurer: shaped,
    session,
    compatibilityMode: 15,
  });
  expect(second.pages).toBe(first.pages);
});
