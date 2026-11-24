import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// Every cell of a row starts its content below the row's largest top margin.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function tops(first: number, second: number): number[] {
  const cell = (top: number, text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:tcMar><w:top w:w="${top}" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>
    <w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar>
    </w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
    <w:tr>${cell(first, 'A')}${cell(second, 'B')}</w:tr></w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 400, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
  });
  const table = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  )!;
  return table.rows[0]!.cells.map((item) => item.blocks[0]!.box.y - table.box.y);
}

test('a cell with a smaller top margin starts at the row largest one', () => {
  expect(tops(300, 0)).toEqual([15, 15]);
  expect(tops(0, 300)).toEqual([15, 15]);
  expect(tops(200, 100)).toEqual([10, 10]);
});
