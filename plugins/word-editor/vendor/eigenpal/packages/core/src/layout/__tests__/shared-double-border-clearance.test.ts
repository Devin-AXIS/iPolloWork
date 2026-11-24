import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

function layout(size: number, owner: 'above' | 'below', height = 100, spacing = 0) {
  const rule = `<w:${owner === 'above' ? 'bottom' : 'top'} w:val="double" w:sz="${size}"/>`;
  const paragraph = (text: string) =>
    `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact" w:before="0" w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:tbl><w:tblPr><w:tblCellSpacing w:w="${spacing}" w:type="dxa"/><w:tblCellMar>
    ${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}
    </w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
    ${['First', 'Second'].map((text, index) => `<w:tr><w:tc><w:tcPr>${index === (owner === 'above' ? 0 : 1) ? `<w:tcBorders>${rule}</w:tcBorders>` : ''}</w:tcPr>${paragraph(text)}</w:tc></w:tr>`).join('')}
    </w:tbl>${paragraph('After')}</w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const options = {
    geometry: { width: 250, height, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    measurer: createFixedMeasurer(5, 12),
    session: createLayoutSession(),
  };
  const result = layoutSemanticDocument(parsed.part, 0, options);
  expect(layoutSemanticDocument(parsed.part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}

for (const owner of ['above', 'below'] as const) {
  test.each([1, 6, 24])(
    `a shared double rule authored ${owner} clears both cells without an extra stroke (size=%s)`,
    (size) => {
      const result = layout(size, owner);
      const table = result.pages[0]!.fragments[0]!;
      if (table.kind !== 'table') throw new Error('table');
      const above = table.rows[0]!.cells[0]!;
      const below = table.rows[1]!.cells[0]!;
      const strokes = above.borders.strokes!.filter((stroke) => stroke.side === 'bottom');
      expect(strokes).toHaveLength(2);
      const top = above.box.y + Math.min(...strokes.map((stroke) => stroke.y));
      const bottom = above.box.y + Math.max(...strokes.map((stroke) => stroke.y + stroke.height));
      const first = above.blocks[0]!.box;
      const second = below.blocks[0]!.box;
      expect(first.y + first.height).toBeCloseTo(top, 6);
      expect(second.y).toBeCloseTo(bottom, 6);
      expect(table.box.height).toBeCloseTo(24 + bottom - top, 6);
    }
  );
}

test('shared double clearance is used during row admission', () => {
  const result = layout(6, 'below', 26.5);
  const table = result.pages[0]!.fragments[0]!;
  if (table.kind !== 'table') throw new Error('table');
  expect(table.rows).toHaveLength(2);
  expect(table.box.height).toBe(26.25);
  expect(result.pages[1]!.fragments[0]!.kind).toBe('paragraph');
});

test('separated cells retain the independently painted top-band clearance', () => {
  const result = layout(6, 'below', 100, 20);
  const table = result.pages[0]!.fragments[0]!;
  if (table.kind !== 'table') throw new Error('table');
  const below = table.rows[1]!.cells[0]!;
  expect(below.blocks[0]!.box.y - below.box.y).toBe(1.5);
});
