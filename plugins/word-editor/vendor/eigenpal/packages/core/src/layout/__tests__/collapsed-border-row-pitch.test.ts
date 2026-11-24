import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { contentInsets } from '../table-cell-geometry.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

// A captured reference charges a collapsed horizontal band ENTIRELY to the row below it:
// that row reserves its own top rule at full width and the row above reserves nothing.
// See `.cache/pdf/claude-row-clearance/FINDING.md`, whose 4pt control excludes a half share
// outright (+4.08 measured against the +2.0 a half model predicts).
test.each([0.5, 3, 12])(
  'a collapsed horizontal band is charged to the row below it (%s pt)',
  (widthPt) => {
    const margins = { top: 0, right: 5, bottom: 0, left: 5 };
    const edge = { state: 'edge' as const, style: 'single' as const, widthPt, color: '000000' };
    const borders = {
      top: edge,
      bottom: edge,
      left: { state: 'omitted' as const },
      right: { state: 'omitted' as const },
    };
    const insets = contentInsets(margins, borders, false, true, false, false, widthPt);
    expect(insets.top).toBe(widthPt);
    expect(insets.bottom).toBe(0);
  }
);

test('twenty exact-height lines reserve shared border insets', () => {
  const rule = '<w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/>';
  const row = (index: number) => `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>
    <w:tcBorders>${rule}</w:tcBorders></w:tcPr><w:p><w:pPr>
    <w:spacing w:line="312" w:lineRule="exact"/></w:pPr><w:r><w:t>${index}</w:t></w:r></w:p></w:tc></w:tr>`;
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:tbl><w:tblPr><w:tblBorders>${rule}</w:tblBorders><w:tblCellMar>
    <w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>
    </w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
    ${Array.from({ length: 20 }, (_, index) => row(index + 1)).join('')}
    </w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 200, height: 352, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
  });
  // The table fills the first page exactly; the empty paragraph the body reads after it starts
  // the next one.
  expect(result.pages).toHaveLength(2);
  expect(result.pages[1]!.fragments.map((fragment) => fragment.kind)).toEqual(['paragraph']);
  const rows = result.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) => (fragment.kind === 'table' ? fragment.rows : []))
  );
  expect(rows).toHaveLength(20);
  for (const [index, item] of rows.entries())
    expect(item.box.height).toBeCloseTo(index === 19 ? 16.6 : 16.1, 7);
  const cell = rows[0]!.cells[0]!;
  expect(cell.blocks[0]!.box.y - cell.box.y).toBeCloseTo(0.5, 7);
  const topStroke = cell.borders.strokes!.find((stroke) => stroke.side === 'top')!;
  expect(topStroke.y).toBe(0);
  expect(topStroke.height).toBe(0.5);
  const last = rows[19]!.cells[0]!;
  const bottomStroke = last.borders.strokes!.find((stroke) => stroke.side === 'bottom')!;
  expect(bottomStroke.y + bottomStroke.height).toBeCloseTo(last.box.height, 7);
  expect(
    last.box.y + last.box.height - last.blocks[0]!.box.y - last.blocks[0]!.box.height
  ).toBeCloseTo(0.5, 7);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
});
