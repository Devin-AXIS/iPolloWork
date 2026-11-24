import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createLayoutSession, layoutSemanticDocument, linesOf } from '../index.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { flowBlocksInBox, layoutRowFragment } from '../semantic-table-layout.ts';
import { cellEndMarkHeight } from '../table-cell-end-mark.ts';
import { readTableStructure } from '../semantic-table.ts';
import type { PendingLine, TextMeasurer } from '../paragraph-flow.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** Script text measures at its glyph size, so a superscript line shows its floor. */
const glyph = (style: ResolvedRunStyle) => style.fontSizePt * glyphSizeFactorOf(style);
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: (style) => ({ height: glyph(style), baseline: glyph(style) * 0.8 }),
};
const paragraph = (text: string, mark = 20, run = '') =>
  `<w:p><w:pPr><w:rPr><w:sz w:val="${mark * 2}"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="10"/>${run}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/**
 * A superscript line keeps the 5pt line of its full-size run as a floor, not the mark's 20pt
 * or the 10pt cascade, except under a cell's end mark, so it shows which role the mark had.
 */
const superscript = (text: string) => paragraph(text, 20, '<w:vertAlign w:val="superscript"/>');
const table = (content: string, cellProperties = '', rowProperties = '') =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:trPr>${rowProperties}</w:trPr><w:tc><w:tcPr>${cellProperties}</w:tcPr>${content}</w:tc></w:tr></w:tbl>`;
/** The table's lines: the empty paragraph the body reads after its final table comes last. */
const cellLinesOf = (result: Parameters<typeof linesOf>[0]) => linesOf(result).slice(0, -1);
function load(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
function run(body: string, height = 200) {
  const part = load(body);
  const before = serializeOoxmlPart(part);
  const options = {
    measurer,
    session: createLayoutSession(),
    geometry: {
      width: 150,
      height,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    },
  };
  const result = layoutSemanticDocument(part, 0, options);
  expect(layoutSemanticDocument(part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(part)).toBe(before);
  return result;
}
function rows(result: ReturnType<typeof run>) {
  return result.pages.flatMap((p) =>
    p.fragments.flatMap((f) => (f.kind === 'table' ? f.rows : []))
  );
}

// Measured: a 20pt mark under 5pt text and a 10pt mark under 1pt text leave each row as tall
// as its text line, in left-to-right and right-to-left paragraphs. An empty end paragraph
// takes the mark's own line.
const emptyMark = (mark = 20) =>
  `<w:p><w:pPr><w:rPr><w:sz w:val="${mark * 2}"/></w:rPr></w:pPr></w:p>`;

test('a cell end mark sets no row minimum under text', () => {
  const result = run(table(paragraph('Short')));
  expect(rows(result)[0]!.box.height).toBe(5);
  expect(linesOf(result)[0]!.box.height).toBe(5);
  expect(linesOf(result)[0]!.baseline).toBe(4);
  const rtl = run(table(paragraph('Short').replace('<w:pPr>', '<w:pPr><w:bidi/>')));
  expect(rows(rtl)[0]!.box.height).toBe(5);
});

test('an empty end paragraph takes the mark line', () => {
  expect(rows(run(table(emptyMark())))[0]!.box.height).toBe(20);
});

test('an end paragraph of hidden or deleted runs takes the mark line', () => {
  expect(rows(run(table(paragraph('Hidden', 20, '<w:vanish/>'))))[0]!.box.height).toBe(20);
  const deleted = paragraph('Gone').replace(
    /<w:r>(.*)<\/w:r>/u,
    (_, inner: string) =>
      `<w:del w:id="1" w:author="A"><w:r>${inner.replace(/w:t\b/gu, 'w:delText')}</w:r></w:del>`
  );
  expect(rows(run(table(deleted)))[0]!.box.height).toBe(20);
});

test('wrapped small text grows beyond the cell marker without enlarging its last line', () => {
  const result = run(table(paragraph('Small text '.repeat(30))));
  const lines = cellLinesOf(result);
  expect(lines.length).toBeGreaterThan(4);
  expect(lines.every((line) => line.box.height === 5)).toBe(true);
  expect(rows(result)[0]!.box.height).toBe(lines.length * 5);
});

test('no text line grows from its mark, and the row holds its text lines', () => {
  const result = run(table(paragraph('First') + paragraph('Last'), '<w:vAlign w:val="bottom"/>'));
  const lines = cellLinesOf(result);
  expect(lines.map((line) => line.box.height)).toEqual([5, 5]);
  expect(rows(result)[0]!.box.height).toBe(10);
  expect(lines[1]!.box.y + lines[1]!.box.height).toBe(rows(result)[0]!.box.height);
  const single = run(table(paragraph('Last'), '<w:vAlign w:val="bottom"/>'));
  const row = rows(single)[0]!;
  const line = linesOf(single)[0]!;
  expect(line.box.y + line.box.height).toBe(row.box.y + row.box.height);
});

for (const [rule, expected] of [
  ['exact', 8],
  ['atLeast', 8],
] as const) {
  test(`an ${rule} row retains its authored height constraint`, () => {
    const result = run(
      table(paragraph('Small'), '', `<w:trHeight w:val="160" w:hRule="${rule}"/>`)
    );
    expect(rows(result)[0]!.box.height).toBe(expected);
    expect(linesOf(result)[0]!.box.height).toBe(5);
  });
}

test('a row moves when its empty end paragraph mark does not fit', () => {
  const prefix = '<w:p><w:r><w:rPr><w:sz w:val="30"/></w:rPr><w:t>Prefix</w:t></w:r></w:p>';
  const result = run(prefix + table(emptyMark()), 30);
  expect(result.pages).toHaveLength(2);
  expect(result.pages[0]!.fragments.every((f) => f.kind !== 'table')).toBe(true);
  expect(rows(result)[0]!.box.height).toBe(20);
});

test('split rows keep all their text', () => {
  const text = 'Small text '.repeat(35);
  const result = run(table(paragraph(text)), 30);
  expect(result.pages.length).toBeGreaterThan(1);
  expect(rows(result).every((row) => row.box.height <= 30)).toBe(true);
  expect(
    linesOf(result)
      .flatMap((line) => line.spans.map((span) => span.text))
      .join('')
  ).toBe(text);
});

test('a collapsed nested-table terminator cannot restore its oversized marker floor', () => {
  const nested = table(paragraph('Nested', 5));
  const terminator = '<w:p><w:pPr><w:rPr><w:sz w:val="72"/></w:rPr></w:pPr></w:p>';
  const result = run(table(nested + terminator));
  expect(rows(result)[0]!.box.height).toBe(5);
  expect(cellLinesOf(result).at(-1)!.box.height).toBe(0);
  expect(rows(run(table('<w:tbl/>' + terminator)))[0]!.box.height).toBe(36);
});

test('vertical cells keep their existing rotated paragraph-marker geometry', () => {
  expect(
    linesOf(run(table(paragraph('Small'), '<w:textDirection w:val="btLr"/>')))[0]!.box.height
  ).toBe(5);
  const result = run(table(superscript('Small'), '<w:textDirection w:val="btLr"/>'));
  expect(linesOf(result)[0]!.box.height).toBe(5);
});

test('a script line keeps its full-size height in either cell-end role', () => {
  const part = load(table(superscript('Small')));
  const body = part.root.children.find((n) => n.kind !== 'textValue' && n.localName === 'body')!;
  if (body.kind === 'textValue') throw new Error('body');
  const node = body.children.find((n) => n.kind === 'table')!;
  const structure = readTableStructure(node, 100, 0)!;
  const row = structure.rows[0]!;
  const paragraphNode = row.cells[0]!.blocks[0]!;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  const deps = { measurer, cache, producer: 'cell-marker-test', nextLineId: () => 'line' };
  for (const end of [false, true, false, true]) {
    const placed = end
      ? layoutRowFragment(row, [100], 0, 0, false, 0, deps).record.cells[0]!.blocks[0]!
      : flowBlocksInBox([paragraphNode], 0, 100, 0, 0, deps).blocks[0]!;
    if (placed.kind !== 'paragraph') throw new Error('paragraph');
    expect(placed.lines[0]!.box.height).toBeCloseTo(5, 5);
  }
  expect(cache.stats.hits).toBeGreaterThan(0);
});

test('reused mark styles still read current font availability and metrics', () => {
  const part = load(table(emptyMark()));
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw Error('Missing body');
  const node = body.children.find((child) => child.kind === 'table')!;
  const cell = readTableStructure(node, 100, 0)!.rows[0]!.cells[0]!;
  let resolved = false;
  let height = 10;
  const deps = {
    producer: 'changing-font',
    nextLineId: () => 'line',
    measurer: {
      ...measurer,
      hasResolvedFont: () => resolved,
      lineMetrics: () => ({ height, baseline: height * 0.8 }),
    },
  };
  expect(cellEndMarkHeight(cell, 100, deps)).toBe(0);
  resolved = true;
  expect(cellEndMarkHeight(cell, 100, deps)).toBe(10);
  height = 24;
  expect(cellEndMarkHeight(cell, 100, deps)).toBe(24);
  expect(cellEndMarkHeight({ ...cell, hideEndMark: true }, 100, deps)).toBe(0);
});
