// An autofit table whose absolute w:tblW is wider than its 451.3pt text column (A4, 1" margins)
// is laid out at its own width: a narrower grid stretches to it, and content that needs more
// widens the table past it instead of breaking. A table no wider than the column fits its
// content into the column. The measured cases use a 489.7pt five-column grid.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A4 =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const GRID = [3686, 1599, 1466, 1466, 1577];
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function table(
  tblW: number,
  texts: readonly string[],
  { noWrap = false, tblPr = '', grid = GRID } = {}
): string {
  const cells = grid
    .map(
      (width, index) =>
        `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${noWrap ? '<w:noWrap/>' : ''}` +
        `</w:tcPr>${p(texts[index] ?? 'x')}</w:tc>`
    )
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${tblW}" w:type="dxa"/>${tblPr}</w:tblPr><w:tblGrid>` +
    grid.map((width) => `<w:gridCol w:w="${width}"/>`).join('') +
    `</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`
  );
}

function lay(body: string, sectPr = A4): SemanticLayout {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${sectPr}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 12) });
}

/** The first table's width, rounded to 0.1pt. */
function width(body: string, sectPr = A4): number {
  const layout = lay(body, sectPr);
  const fragment = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  return Math.round(fragment.box.width * 10) / 10;
}

test('a grid narrower than a width past the column stretches to that width', () => {
  expect(width(table(10000, []))).toBeCloseTo(500, 0);
  // Also past the page edge.
  expect(width(table(14000, []))).toBeCloseTo(700, 0);
});

test('unwrapped cells keep their widths and widen a table past the column', () => {
  const grid = [...GRID, 1577, 600];
  expect(width(table(10000, [], { noWrap: true, grid }))).toBeCloseTo(598.5, 0);
  expect(width(table(11263, [], { noWrap: true, grid }))).toBeCloseTo(598.5, 0);
});

test('a word that needs more than its share widens a table past the column', () => {
  // 120 unbreakable characters need more than the column, past the table's 500pt.
  expect(width(table(10000, ['A'.repeat(120)]))).toBeGreaterThan(600);
});

test('the growth stops at the widest page', () => {
  expect(width(table(10000, ['A'.repeat(400)]))).toBeCloseTo(1584, 0);
});

test('a table no wider than the column fits its content into the column', () => {
  const grid = [...GRID, 1577, 600];
  expect(width(table(9000, [], { noWrap: true, grid }))).toBeCloseTo(451.3, 0);
  expect(width(table(9000, ['A'.repeat(120)]))).toBeCloseTo(451.3, 0);
});

test('a fixed-layout table stretches its grid to its width too', () => {
  // Measured: a fixed 475pt grid under 490pt and 550pt widths lays out at those widths.
  const fixed = table(10000, ['A'.repeat(120)], { tblPr: '<w:tblLayout w:type="fixed"/>' });
  expect(width(fixed)).toBeCloseTo(500, 0);
});

test('a nested table stretches its grid to its width past the cell', () => {
  // Measured: a 144pt nested grid under a 350pt width in a 300pt cell lays out at 350pt.
  const inner = table(10000, ['A'.repeat(120)]);
  const outer =
    '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
    `<w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${inner}${p('')}</w:tc></w:tr></w:tbl>`;
  const layout = lay(outer);
  const cell = (layout.pages[0]!.fragments.find((f) => f.kind === 'table') as any).rows[0].cells[0];
  const nested = cell.blocks.find((block: { kind: string }) => block.kind === 'table');
  expect(nested.box.width).toBeCloseTo(500, 0);
});

test('the rule starts just past the column, whatever the indent', () => {
  const url = `https://example.com/${'a'.repeat(99)}`;
  const indent = '<w:tblInd w:w="-108" w:type="dxa"/>';
  // The 451.3pt column is 9026 twips: a table exactly as wide breaks the URL to fit the
  // column, plus the 5.4pt its indent moves it into the margin, plus its two 0.5pt outer
  // cell margins, since its outer cells' content meets the text edges.
  expect(width(table(9026, [url], { tblPr: indent }))).toBeCloseTo(457.7, 0);
  // 10.8pt wider, it grows to hold the URL, with or without a negative indent.
  expect(width(table(9242, [url], { tblPr: indent }))).toBeGreaterThan(600);
  expect(width(table(9242, [url]))).toBeGreaterThan(600);
});

test('in a section of two columns, the rule measures against one column', () => {
  const twoColumns = A4.replace('</w:sectPr>', '<w:cols w:num="2" w:space="720"/></w:sectPr>');
  const grid = [1000, 1000, 1000];
  // A 300pt table in a 207.7pt column stretches its 150pt grid to 300pt.
  expect(width(table(6000, [], { grid }), twoColumns)).toBeCloseTo(300, 0);
  expect(width(table(6000, ['A'.repeat(60)], { grid }), twoColumns)).toBeGreaterThan(300);
});

test('a right-aligned table past the column keeps its right edge on the margin', () => {
  // The 500pt table reaches 48.7pt into the left margin.
  const layout = lay(table(10000, [], { tblPr: '<w:jc w:val="right"/>' }));
  const fragment = layout.pages[0]!.fragments.find((f) => f.kind === 'table')!;
  expect(fragment.box.width).toBeCloseTo(500, 0);
  expect(fragment.box.x + fragment.box.width).toBeCloseTo(451.3, 0);
});

test('a floating table past the column follows the same rule', () => {
  const floating = '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="0"/>';
  expect(width(table(10000, [], { tblPr: floating }))).toBeCloseTo(500, 0);
  expect(width(table(10000, ['A'.repeat(120)], { tblPr: floating }))).toBeGreaterThan(600);
});

test('a percentage width keeps the column rule', () => {
  // 120% of the column is 541.6pt; the word breaks rather than widening the table.
  const pct = table(0, ['A'.repeat(120)]).replace(
    '<w:tblW w:w="0" w:type="dxa"/>',
    '<w:tblW w:w="6000" w:type="pct"/>'
  );
  expect(width(pct)).toBeCloseTo(541.6, 0);
});
