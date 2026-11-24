import { expect, test } from 'bun:test';
import { contentInsets } from '../table-cell-geometry.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

test.each(['double', 'triple'] as const)(
  '%s borders do not overlap text in cells with zero padding',
  (style) => {
    const rule = ['top', 'bottom', 'left', 'right']
      .map((side) => `<w:${side} w:val="${style}" w:sz="24"/>`)
      .join('');
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:tbl><w:tblPr><w:tblCellMar>
      ${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}
      </w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:tcBorders>${rule}</w:tcBorders></w:tcPr>
      <w:p><w:r><w:t>Content</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!read.ok) throw new Error(read.reason);
    const before = serializeOoxmlPart(read.part);
    const options = { measurer: createFixedMeasurer(5, 12) };
    const session = createLayoutSession();
    const result = layoutSemanticDocument(read.part, 0, { ...options, session });
    const table = result.pages[0]!.fragments.find((fragment) => fragment.kind === 'table')!;
    const cell = table.rows[0]!.cells[0]!;
    const text = cell.blocks[0]!.box;
    expect(cell.borders?.strokes?.length).toBe(style === 'double' ? 8 : 12);
    for (const stroke of cell.borders!.strokes!) {
      const overlaps =
        stroke.x < text.x + text.width - 1e-8 &&
        stroke.x + stroke.width > text.x + 1e-8 &&
        stroke.y < text.y + text.height - 1e-8 &&
        stroke.y + stroke.height > text.y + 1e-8;
      expect(overlaps).toBe(false);
    }
    const warm = layoutSemanticDocument(read.part, 0, { ...options, session });
    expect(warm.pages).toEqual(result.pages);
    expect(serializeOoxmlPart(read.part)).toBe(before);
  }
);

test('compound strokes can use existing padding without adding it twice', () => {
  for (const style of ['double', 'triple'] as const) {
    const edge = { state: 'edge' as const, style, widthPt: 0.375, color: null };
    expect(
      contentInsets(
        { top: 4, right: 6, bottom: 4, left: 6 },
        { top: edge, right: edge, bottom: edge, left: edge }
      )
    ).toEqual({ top: 4.175, right: 6.35, bottom: 4.175, left: 6.35 });
  }
});
