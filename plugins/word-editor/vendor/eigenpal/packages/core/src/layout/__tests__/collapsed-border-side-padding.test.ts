import { expect, test } from 'bun:test';
import { contentInsets } from '../table-cell-geometry.ts';
import type { CellBorderBox } from '../table-borders.ts';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

function insets(widthPt: number, margin: number, collapsed = true, style = 'single' as const) {
  const edge = { state: 'edge' as const, style, widthPt, color: '000000' };
  const borders: CellBorderBox = { top: edge, right: edge, bottom: edge, left: edge };
  return contentInsets(
    { top: 0, right: margin, bottom: 0, left: margin },
    borders,
    false,
    collapsed
  );
}

test.each([
  [0.5, 0, 0.5],
  [0.5, 0.5, 0.75],
  [0.5, 5.4, 5.65],
  [0.5, 10, 10.25],
  [1, 0, 1],
  [6, 0, 6],
  [6, 5.4, 8.4],
])(
  'collapsed side padding clears the stroke (%s pt border, %s pt margin)',
  (width, margin, expected) => {
    const result = insets(width!, margin!);
    expect(result.left).toBeCloseTo(expected!, 8);
    expect(result.right).toBeCloseTo(expected!, 8);
    expect(result.top).toBeCloseTo(width! / 2, 8);
    expect(result.bottom).toBeCloseTo(width! / 2, 8);
  }
);

test('separated cells retain independent full-border padding', () => {
  const result = insets(0.5, 5.4, false);
  expect(result.left).toBeCloseTo(5.9, 8);
  expect(result.right).toBeCloseTo(5.9, 8);
  expect(result.top).toBe(0.5);
  expect(result.bottom).toBe(0.5);
});

test('modern side clearance participates in wrapping and survives cache reuse', () => {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="1200" w:type="dxa"/>
    <w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>
    <w:tblBorders><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tblBorders>
    </w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid><w:tr><w:tc>
    <w:p><w:r><w:t>ABCD</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  // A mode 15 or newer fixed left `dxa` table shares the grid line, so the text keeps half the
  // stroke as side clearance (`legacy-table-side-rules.ts`). Mode 16 lays out as mode 15.
  const options = {
    compatibilityMode: 16,
    measurer: createFixedMeasurer(12.16, 12),
    session: createLayoutSession(),
  };
  const layout = layoutSemanticDocument(parsed.part, 1, options);
  const table = layout.pages[0]!.fragments.find((block) => block.kind === 'table')!;
  const cell = table.rows[0]!.cells[0]!;
  const paragraph = cell.blocks.find((block) => block.kind === 'paragraph')!;
  expect(paragraph.lines).toHaveLength(1);
  expect(paragraph.lines[0]!.spans.map((span) => span.text).join('')).toBe('ABCD');
  expect(paragraph.lines[0]!.box.width).toBeCloseTo(49.2, 8);
  expect(layoutSemanticDocument(parsed.part, 1, options).pages).toEqual(layout.pages);
  expect(
    layoutSemanticDocument(parsed.part, 1, {
      ...options,
      compatibilityMode: 15,
      session: createLayoutSession(),
    }).pages
  ).toEqual(layout.pages);
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
});
