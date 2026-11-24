import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { borderExtentPt } from '../table-borders.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const border = (side: string, size: number, style = 'single') =>
  `<w:tcBorders><w:${side} w:val="${style}" w:sz="${size}"/></w:tcBorders>`;
const cell = (properties: string, text = 'A') =>
  `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
function layout(rows: string, rtl = false, spacing = 0, tableBorders = '') {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    ${rtl ? '<w:bidiVisual/>' : ''}<w:tblCellSpacing w:w="${spacing}" w:type="dxa"/>
    <w:tblBorders>${tableBorders}</w:tblBorders><w:tblCellMar>
    ${['top', 'left', 'bottom', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}
    </w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
    ${rows}</w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const before = serializeOoxmlPart(read.part);
  const options = { measurer: createFixedMeasurer(5, 12), session: createLayoutSession() };
  const result = layoutSemanticDocument(read.part, 0, options);
  expect(layoutSemanticDocument(read.part, 0, options).pages).toEqual(result.pages);
  expect(serializeOoxmlPart(read.part)).toBe(before);
  return result.pages[0]!.fragments.find((f) => f.kind === 'table')!;
}

for (const rtl of [false, true])
  for (const [a, b] of [
    [4, 48],
    [48, 4],
  ]) {
    test(`both cells clear the shared vertical winner (${a}/${b}, RTL=${rtl})`, () => {
      const table = layout(
        `<w:tr>${cell(border('right', a!))}${cell(border('left', b!))}</w:tr>`,
        rtl
      );
      for (const [index, c] of table.rows[0]!.cells.entries()) {
        const block = c.blocks[0]!;
        const left = (index === 0) === rtl;
        const clearance = left
          ? block.box.x - c.box.x
          : c.box.x + c.box.width - block.box.x - block.box.width;
        expect(clearance).toBeCloseTo(6, 6);
      }
      const edges = table.rows[0]!.cells.flatMap((c) => c.borders?.edgeSegments ?? []);
      expect(edges).toHaveLength(1);
      expect(edges[0]!.edge.widthPt).toBe(6);
    });
  }

test('separated cells keep independent edges', () => {
  const table = layout(
    `<w:tr>${cell(border('right', 4))}${cell(border('left', 48))}</w:tr>`,
    false,
    40
  );
  const [a, b] = table.rows[0]!.cells;
  expect(a!.box.x + a!.box.width - a!.blocks[0]!.box.x - a!.blocks[0]!.box.width).toBeCloseTo(
    0.5,
    6
  );
  expect(b!.blocks[0]!.box.x - b!.box.x).toBeCloseTo(6, 6);
});

// The opposing 6pt rule is then the table's only side rule. A legacy automatic-width AutoFit
// table centres it on the grid line, so each cell clears half of it (17.4.53).
for (const own of ['none', 'nil'])
  test(`an explicit ${own} clears an opposing authored rule`, () => {
    const table = layout(
      `<w:tr>${cell(border('right', 4, own))}${cell(border('left', 48))}</w:tr>`
    );
    const a = table.rows[0]!.cells[0]!;
    expect(a.box.x + a.box.width - a.blocks[0]!.box.x - a.blocks[0]!.box.width).toBeCloseTo(3, 6);
  });

// The receiving row carries the whole band, at its own 6pt top rule, and the row above
// carries none of it. The stroke starts at the boundary the two rows share and runs down
// into the receiving row, which is where its content then begins.
test('the receiving row alone clears the shared horizontal winner', () => {
  const table = layout(
    `<w:tr>${cell(border('bottom', 4) + '<w:gridSpan w:val="2"/>')}</w:tr><w:tr>${cell(border('top', 48) + '<w:gridSpan w:val="2"/>')}</w:tr>`
  );
  const a = table.rows[0]!.cells[0]!,
    b = table.rows[1]!.cells[0]!;
  expect(a.box.y + a.box.height - a.blocks[0]!.box.y - a.blocks[0]!.box.height).toBeCloseTo(0, 6);
  expect(b.blocks[0]!.box.y - b.box.y).toBeCloseTo(6, 6);
  const stroke = a.borders!.strokes!.find((s) => s.side === 'bottom')!;
  expect(stroke.y).toBeCloseTo(a.box.height, 6);
  expect(stroke.height).toBe(6);
  expect(a.box.y + stroke.y + stroke.height).toBeCloseTo(b.blocks[0]!.box.y, 6);
});

test('a merged head clears the strongest lower neighbor interval', () => {
  const table = layout(
    `<w:tr>${cell('<w:vMerge w:val="restart"/>' + border('right', 4))}${cell(border('left', 4))}</w:tr><w:tr>${cell('<w:vMerge/>', '')}${cell(border('left', 48))}</w:tr>`
  );
  const head = table.rows[0]!.cells[0]!;
  expect(head.rowSpan).toBe(2);
  expect(
    head.box.x + head.box.width - head.blocks[0]!.box.x - head.blocks[0]!.box.width
  ).toBeCloseTo(6, 6);
});

test('a merged receiving cell clears a border owned beside its continuation', () => {
  const table = layout(
    `<w:tr>${cell(border('right', 4))}${cell('<w:vMerge w:val="restart"/>' + border('left', 4))}</w:tr><w:tr>${cell(border('right', 48))}${cell('<w:vMerge/>', '')}</w:tr>`
  );
  const head = table.rows[0]!.cells[1]!;
  expect(head.rowSpan).toBe(2);
  expect(head.blocks[0]!.box.x - head.box.x).toBeCloseTo(6, 6);
});

test('merged clearance uses painted extent across compound intervals', () => {
  const table = layout(
    `<w:tr>${cell('<w:vMerge w:val="restart"/>')}${cell(border('left', 8))}</w:tr><w:tr>${cell('<w:vMerge/>', '')}${cell(border('left', 2, 'triple'))}</w:tr>`
  );
  const head = table.rows[0]!.cells[0]!;
  const extent = Math.max(...(head.borders!.edgeSegments ?? []).map((s) => borderExtentPt(s.edge)));
  expect(extent).toBeGreaterThan(1);
  expect(
    head.box.x + head.box.width - head.blocks[0]!.box.x - head.blocks[0]!.box.width
  ).toBeCloseTo(extent, 6);
});

// The 6pt bottom above charges the row below nothing: that row reserves only its own 0.5pt
// top rule, which the captured control in `.cache/pdf/claude-row-clearance/FINDING.md`
// measured directly (a 4pt rule above a `none` top keeps the borderless pitch). The two
// rows therefore need 24.5pt, not the 30pt the half-model asked for.
test('a new page measures its own top edge after the stronger preceding row stays behind', () => {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
    </w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>
    <w:tr>${cell(border('bottom', 48), 'Before')}</w:tr>
    <w:tr>${cell(border('top', 4), 'After')}</w:tr>
    </w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    measurer: createFixedMeasurer(5, 12),
    geometry: { width: 150, height: 24, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
  });
  expect(result.pages).toHaveLength(2);
  const second = result.pages[1]!.fragments.find((f) => f.kind === 'table')!.rows[0]!.cells[0]!;
  expect(second.borders!.top!.widthPt).toBe(0.5);
  expect(second.blocks[0]!.box.y - second.box.y).toBeCloseTo(0.5, 6);
  expect(second.box.y + second.box.height).toBeLessThanOrEqual(24);
});
