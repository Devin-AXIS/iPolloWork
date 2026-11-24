import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// A table that states no width takes the text column as the width its `pct` cells share,
// and those shares replace any initial grid.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LONG = Array.from({ length: 30 }, () => 'word').join(' ');

function widths(grid: string): number[] {
  const cell = (pct: number, text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${pct}" w:type="pct"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    <w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>
    </w:tblPr>${grid}<w:tr>${cell(400, '1')}${cell(4600, LONG)}</w:tr></w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 520, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
  });
  const table = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  )!;
  return table.rows[0]!.cells.map((item) => item.box.width);
}

test('pct cells of a table without a width share the text column', () => {
  const [first, second] = widths('');
  expect(first).toBeCloseTo(40, 6);
  expect(second).toBeCloseTo(460, 6);
});

test('pct cells replace the initial grid of a table without a width', () => {
  const [first, second] = widths(
    '<w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>'
  );
  expect(first).toBeCloseTo(40, 6);
  expect(second).toBeCloseTo(460, 6);
});
