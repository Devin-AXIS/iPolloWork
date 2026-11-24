import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// A mode-15 left-aligned table framed by a 0.5pt rule, whose middle cell is boxed by a wider
// rule, centres every vertical rule on its grid line and measures the margin from that
// centre. The grid moves inward by half the leading rule. The widest top rule in the first
// row moves the content of every cell in that row down.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rule = (side: string, sz: number) => `<w:${side} w:val="single" w:sz="${sz}"/>`;

function layout(sz: number, margin: number) {
  const frame = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => rule(side, 4))
    .join('');
  const box = ['top', 'left', 'bottom', 'right'].map((side) => rule(side, sz)).join('');
  const cell = (index: number, borders: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:tcBorders>${borders}</w:tcBorders></w:tcPr><w:p><w:r><w:t>C${index}</w:t></w:r></w:p></w:tc>`;
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    <w:tblW w:w="6000" w:type="dxa"/><w:tblBorders>${frame}</w:tblBorders><w:tblLayout w:type="fixed"/>
    <w:tblCellMar><w:left w:w="${margin * 20}" w:type="dxa"/><w:right w:w="${margin * 20}" w:type="dxa"/></w:tblCellMar>
    </w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
    <w:tr>${cell(0, '')}${cell(1, box)}${cell(2, '')}</w:tr></w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    compatibilityMode: 15,
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 400, height: 792, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const table = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  )!;
  const cells = table.rows[0]!.cells.map((item) => {
    const paragraph = item.blocks[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph');
    return { left: paragraph.lines[0]!.box.x, top: paragraph.box.y, cell: item };
  });
  return { table, cells };
}

for (const sz of [12, 24, 48]) {
  for (const margin of [0, 5.4]) {
    test(`a ${sz / 8}pt boxed cell centres its rules at margin ${margin}`, () => {
      const { table, cells } = layout(sz, margin);
      const width = sz / 8;
      // The grid moves inward by half the leading 0.5pt rule.
      expect(table.box.x).toBeCloseTo(0.25, 8);
      expect(cells[0]!.left).toBeCloseTo(0.25 + Math.max(margin, 0.25), 8);
      // Grid line 1 sits at 0.25 + 100; the boxed cell's text clears half its rule.
      expect(cells[1]!.left).toBeCloseTo(100.25 + Math.max(margin, width / 2), 8);
      // The wide rule is painted centred on that grid line, whichever cell owns it.
      const centres = cells.flatMap(({ cell }) =>
        cell
          .borders!.strokes!.filter((edge) => edge.width === width && edge.height > edge.width)
          .map((edge) => cell.box.x + edge.x + edge.width / 2)
      );
      expect(centres.some((centre) => Math.abs(centre - 100.25) < 1e-6)).toBe(true);
      // Every cell in the first row clears the row's widest top rule.
      expect(cells[0]!.top).toBeCloseTo(cells[1]!.top, 8);
      expect(cells[2]!.top).toBeCloseTo(cells[1]!.top, 8);
    });
  }
}
