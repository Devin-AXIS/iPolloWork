import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// An AutoFit table whose stated width already runs past the text column widens for a word no
// break can split, even past the page; one that fits the column breaks the word instead.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function layout(tableTwips: number, chars: number) {
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="${tableTwips}" w:type="dxa"/>
    <w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>
    </w:tblPr><w:tblGrid><w:gridCol w:w="${tableTwips}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${tableTwips}" w:type="dxa"/></w:tcPr>
    <w:p><w:r><w:t>${'_'.repeat(chars)}</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    // A 200pt text column on a 220pt page.
    geometry: { width: 220, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
  });
  const table = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  )!;
  const cell = table.rows[0]!.cells[0]!;
  const paragraph = cell.blocks[0]!;
  return {
    width: cell.box.width,
    lines: paragraph.kind === 'paragraph' ? paragraph.lines.length : 0,
  };
}

test('a table stated wider than the text column widens for an unbreakable word', () => {
  // A 250pt table and a longer word: the table grows to the word, past the 220pt page.
  const result = layout(5000, 70);
  expect(result.lines).toBe(1);
  expect(result.width).toBeGreaterThan(300);
});

test('a table that fits the text column breaks an unbreakable word instead', () => {
  const result = layout(3000, 60);
  expect(result.width).toBeLessThanOrEqual(200);
  expect(result.lines).toBeGreaterThan(1);
});
