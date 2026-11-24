import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';
import { cellContentInsets } from '../table-cell-geometry.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';

function fixture(extra = '', widthType = 'dxa', rule = 'single', fixed = true) {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="4000" w:type="${widthType}"/>
      ${fixed ? '<w:tblLayout w:type="fixed"/>' : ''}${extra}
      <w:tblBorders>${['top', 'bottom', 'left', 'right', 'insideV']
        .map((side) => `<w:${side} w:val="${rule}" w:sz="24"/>`)
        .join('')}</w:tblBorders>
      <w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>
      </w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
      <w:tr>${['First cell', 'Second cell']
        .map(
          (text) =>
            `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`
        )
        .join('')}</w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find((node) => node.kind === 'body') as OoxmlElement;
  return {
    part: parsed.part,
    table: body.children.find((node) => node.kind === 'table') as OoxmlElement,
  };
}

const read = (table: OoxmlElement, mode = 15, depth = 0) =>
  readTableStructure(table, 300, depth, undefined, 'proposed', undefined, mode)!;

for (const [alignment, expectedX] of [['left', 97]] as const) {
  test(`fixed bidi ${alignment} table shares its side rules with cell padding`, () => {
    const { part, table } = fixture(`<w:jc w:val="${alignment}"/>`);
    const before = serializeOoxmlPart(part);
    const structure = read(table);
    expect(tableOriginX(structure, 300)).toBe(expectedX);
    expect(structure.rows[0]!.cells.map((cell) => cell.gridColumn)).toEqual([1, 0]);
    for (const cell of structure.rows[0]!.cells) {
      expect(cell.centeredSideRules).toBe(true);
      expect(cell.centeredSidePaint).toBe(true);
      expect(cellContentInsets(cell, true).left).toBe(5.4);
      expect(cellContentInsets(cell, true).right).toBe(5.4);
    }
    const result = layoutSemanticDocument(part, 0, {
      compatibilityMode: 15,
      measurer: createFixedMeasurer(6, 12),
      geometry: { width: 300, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    });
    const fragment = result.pages[0]!.fragments[0]!;
    expect(fragment.kind).toBe('table');
    if (fragment.kind !== 'table') throw new Error('Expected table');
    expect(fragment.box.x).toBe(expectedX);
    expect(fragment.rows[0]!.cells[0]!.gridColumn).toBe(1);
    expect(serializeOoxmlPart(part)).toBe(before);
  });
}

test('leading bidi indent stays relative to the right edge', () => {
  const { table } = fixture('<w:tblInd w:w="-200" w:type="dxa"/>');
  expect(tableOriginX(read(table), 300)).toBe(107);
});

test('legacy, trailing-aligned and autofit bidi tables share their side rules too', () => {
  const standard = fixture().table;
  for (const structure of [
    read(standard, 14),
    read(fixture('<w:jc w:val="right"/>').table),
    read(fixture('', 'dxa', 'single', false).table),
  ])
    for (const cell of structure.rows[0]!.cells) expect(cell.centeredSideRules).toBe(true);
});

// Mode-15 reference renderings of right-to-left tables with 3pt rules put a centred table's
// grid half a rule left of centre, a leading percentage table one rule in from its visual
// right, and a nested leading table half a rule in from its cell's right edge.
test('percent, centred and nested bidi tables share their side rules too', () => {
  const centred = read(fixture('<w:jc w:val="center"/>').table);
  const percent = read(fixture('', 'pct').table);
  const nested = read(fixture().table, 15, 1);
  expect(centred.outerRuleOffsetPt).toBe(-1.5);
  expect(percent.outerRuleOffsetPt).toBe(-3);
  // 80% of the container less the rule.
  expect(percent.columnWidthsPt.reduce((sum, width) => sum + width, 0)).toBeCloseTo(237.6, 6);
  expect(nested.outerRuleOffsetPt).toBe(-1.5);
  for (const structure of [centred, percent, nested])
    for (const cell of structure.rows[0]!.cells) expect(cell.centeredSideRules).toBe(true);
});

test('spaced and compound tables keep their previous rules', () => {
  const cases = [
    read(fixture('<w:tblCellSpacing w:w="20" w:type="dxa"/>').table),
    read(fixture('', 'dxa', 'double').table),
  ];
  for (const structure of cases)
    for (const cell of structure.rows[0]!.cells) expect(cell.centeredSideRules).not.toBe(true);
});
