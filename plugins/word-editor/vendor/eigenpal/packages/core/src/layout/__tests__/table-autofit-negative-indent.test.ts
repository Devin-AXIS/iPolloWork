import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// A negative paragraph indent moves cell text into the cell margin, so an AutoFit column
// whose widest word fits once the indent is applied keeps its authored width.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function firstColumnWidth(indent: string): number {
  return firstColumnWidthFor(indent ? `<w:ind w:left="${indent}"/>` : '');
}

function firstColumnWidthFor(ind: string): number {
  const cell = (width: number, text: string, pPr = '') =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/>
    <w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>
    </w:tblPr><w:tblGrid><w:gridCol w:w="959"/><w:gridCol w:w="5041"/></w:tblGrid>
    <w:tr>${cell(959, 'WWWWWWWWW', ind ? `<w:pPr>${ind}</w:pPr>` : '')}${cell(5041, 'x')}</w:tr>
    </w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 400, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
  });
  const table = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  )!;
  return table.rows[0]!.cells[0]!.box.width;
}

test('a negative indent lets a 45pt word keep a 47.95pt AutoFit column', () => {
  // The 5.65pt negative indent moves the word into the cell margin.
  expect(firstColumnWidth('-113')).toBeCloseTo(47.95, 6);
  // Without the indent the word widens the column.
  expect(firstColumnWidth('')).toBeGreaterThan(48);
});

test('a negative trailing indent does not lower the AutoFit column', () => {
  const withRight = firstColumnWidthFor('<w:ind w:left="-113" w:right="-1134"/>');
  expect(withRight).toBeCloseTo(firstColumnWidth('-113'), 6);
});
