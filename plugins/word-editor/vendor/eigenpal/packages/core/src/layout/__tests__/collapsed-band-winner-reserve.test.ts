import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

// A collapsed horizontal band reserves the width of the rule painted across the boundary,
// whichever side authored it. A `nil` on one side does not cancel the other side's rule.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
type Edge = number | 'nil' | 'omit';
const edge = (side: string, value: Edge): string =>
  value === 'omit'
    ? ''
    : value === 'nil'
      ? `<w:${side} w:val="nil"/>`
      : `<w:${side} w:val="single" w:sz="${value * 8}"/>`;
const paragraph = (text: string): string =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function rowPitches(top: Edge, bottom: Edge, insideH = ''): number[] {
  const rows = Array.from(
    { length: 4 },
    (_, index) =>
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1600" w:type="dxa"/><w:tcBorders>${edge('top', top)}${edge('bottom', bottom)}</w:tcBorders></w:tcPr>${paragraph(`R${index}`)}</w:tc></w:tr>`
  ).join('');
  const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>
    <w:tblLayout w:type="fixed"/><w:tblW w:w="1600" w:type="dxa"/>
    <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
    ${insideH ? `<w:tblBorders>${insideH}</w:tblBorders>` : ''}</w:tblPr><w:tblGrid><w:gridCol w:w="1600"/></w:tblGrid>
    ${rows}</w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 200, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
    measurer: createFixedMeasurer(5, 12),
  });
  const table = result.pages[0]!.fragments.find(
    (item): item is TableFragmentRecord => item.kind === 'table'
  )!;
  const tops = table.rows.map((row) => {
    const block = row.cells[0]!.blocks.find((item) => item.kind === 'paragraph')!;
    return block.box.y;
  });
  return tops.slice(1).map((y, index) => y - tops[index]!);
}

test('a bottom rule over a nil top reserves its own width in the row below', () => {
  for (const pitch of rowPitches('nil', 1)) expect(pitch).toBeCloseTo(13, 6);
  for (const pitch of rowPitches('nil', 3)) expect(pitch).toBeCloseTo(15, 6);
});

test('a wider bottom rule over a narrower authored top reserves the wider width', () => {
  for (const pitch of rowPitches(1, 4)) expect(pitch).toBeCloseTo(16, 6);
  for (const pitch of rowPitches(4, 1)) expect(pitch).toBeCloseTo(16, 6);
});

test('a nil bottom under an inherited inside rule still reserves that rule', () => {
  const insideH = edge('insideH', 4);
  for (const pitch of rowPitches('omit', 'nil', insideH)) expect(pitch).toBeCloseTo(16, 6);
  for (const pitch of rowPitches('nil', 'omit', insideH)) expect(pitch).toBeCloseTo(16, 6);
  for (const pitch of rowPitches('nil', 1, insideH)) expect(pitch).toBeCloseTo(13, 6);
  for (const pitch of rowPitches('nil', 'nil', insideH)) expect(pitch).toBeCloseTo(12, 6);
});
