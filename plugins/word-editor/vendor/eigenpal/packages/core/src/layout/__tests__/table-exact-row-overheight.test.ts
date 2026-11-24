import { expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { cell, load, noMargins, p } from './table-exact-visible-fixtures.ts';

// Page content box: 80pt tall. Lines are 12pt exact.
const measurer = createFixedMeasurer(6, 11);
const geometry = { width: 220, height: 100, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => p(`${prefix}${index}`, 240)).join('');
const row = (content: string, height?: number, cantSplit = false) =>
  '<w:tr><w:trPr>' +
  (cantSplit ? '<w:cantSplit/>' : '') +
  (height === undefined ? '' : `<w:trHeight w:val="${height * 20}" w:hRule="exact"/>`) +
  `</w:trPr>${cell(content)}</w:tr>`;
const table = (...rows: string[]) =>
  `<w:tbl>${noMargins}<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

function pages(body: string) {
  const result = layoutSemanticDocument(load(body), 0, { measurer, geometry });
  return result.pages.map((page) => ({
    page,
    tables: page.fragments.filter((f): f is TableFragmentRecord => f.kind === 'table'),
    paragraphs: page.fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph'),
  }));
}
const text = (block: ParagraphFragmentRecord) =>
  block.lines.map((line) => line.spans.map((span) => span.text).join('')).join('/');

function expectClampedRow(page: ReturnType<typeof pages>[number], first: string) {
  const [fragment] = page.tables;
  expect(fragment).toBeDefined();
  const placed = fragment!.rows[0]!;
  // The row stops at the bottom margin: it neither runs past it nor splits.
  expect(placed.box.y).toBe(0);
  expect(placed.box.height).toBe(page.page.contentBox.height);
  expect(placed.placesWhole).toBe(true);
  const blocks = placed.cells[0]!.blocks as ParagraphFragmentRecord[];
  expect(text(blocks[0]!)).toBe(first);
  // The line the bottom margin cuts shows its visible part, clipped at the margin.
  const last = blocks.at(-1)!;
  expect(last.clipToBox).toBe(true);
  expect(last.box.y + last.box.height).toBeCloseTo(page.page.contentBox.height, 3);
  for (const block of blocks.slice(0, -1)) expect(block.clipToBox).not.toBe(true);
}

for (const [name, height, cantSplit] of [
  ['taller than the page body', 90, false],
  ['taller than the page body with w:cantSplit', 90, true],
  ['taller than the whole sheet', 140, false],
] as const) {
  test(`an exact row ${name} moves to a fresh page and paints to the bottom margin`, () => {
    const result = pages(
      p('intro', 240) +
        table(row(lines('A', 12), height, cantSplit), row(p('next', 240))) +
        p('tail', 240)
    );
    expect(result).toHaveLength(3);
    expect(result[0]!.tables).toHaveLength(0);
    expect(result[0]!.paragraphs.map(text)).toEqual(['intro']);
    expectClampedRow(result[1]!, 'A0');
    expect(result[1]!.paragraphs).toHaveLength(0);
    // Content after the row starts on the next page, not inside the clipped band.
    const after = result[2]!;
    expect(after.tables[0]!.rows[0]!.box.y).toBe(0);
    expect(text(after.tables[0]!.rows[0]!.cells[0]!.blocks[0] as ParagraphFragmentRecord)).toBe(
      'next'
    );
    expect(after.paragraphs.map(text)).toEqual(['tail']);
  });
}

test('an exact row that fits keeps its authored height beside the following content', () => {
  const [only, ...rest] = pages(
    p('intro', 240) + table(row(lines('A', 6), 40), row(p('next', 240)))
  );
  expect(rest).toHaveLength(0);
  const rows = only!.tables[0]!.rows;
  expect(rows[0]!.box).toMatchObject({ y: 12, height: 40 });
  expect(rows[1]!.box.y).toBe(52);
});

test('an over-tall exact row after a short row and before another one takes a page each', () => {
  const result = pages(
    table(row(p('first', 240), 20), row(lines('A', 12), 90), row(lines('B', 12), 90))
  );
  // The empty paragraph the body reads after the table takes the page after these.
  expect(result.filter((page) => page.tables.length > 0)).toHaveLength(3);
  expect(result[0]!.tables[0]!.rows).toHaveLength(1);
  expect(result[0]!.tables[0]!.rows[0]!.box.height).toBe(20);
  expectClampedRow(result[1]!, 'A0');
  expectClampedRow(result[2]!, 'B0');
});
