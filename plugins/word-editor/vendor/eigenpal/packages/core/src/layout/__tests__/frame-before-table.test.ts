// A text frame (`w:framePr`, ECMA-376 Part 1, 17.3.1.11) right before an ordinary table anchors
// at that table: the frame stands where the table would start. The table then moves beside the
// frame when the passage holds it, keeping its `w:jc` alignment (17.4.28), or starts below the
// frame. The page is 200 pt wide without margins.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { layoutContext } from './anchored-drawing-test-fixtures.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>';
const p = (text: string, props = '') =>
  `<w:p><w:pPr>${SPACING}${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** A 60 pt wide frame at the text position. */
const frame = p(
  'Frame',
  '<w:framePr w:w="1200" w:wrap="around" w:vAnchor="text" w:hAnchor="text" w:y="1"/>'
);
const tableOf = (width: number, jc: string) =>
  `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:type="dxa" w:w="${width * 20}"/>` +
  `<w:jc w:val="${jc}"/><w:tblCellMar><w:left w:type="dxa" w:w="0"/><w:right w:type="dxa" w:w="0"/>` +
  `</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${width * 20}"/></w:tblGrid>` +
  `<w:tr><w:tc>${p('Cell')}</w:tc></w:tr></w:tbl>`;

function render(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const fragments = layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: 200, height: 300, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    compatibilityMode: 15,
    inlineDrawingLayout: layoutContext(read.part),
  }).pages[0]!.fragments;
  const paragraphs = fragments.filter((f): f is ParagraphFragmentRecord => f.kind === 'paragraph');
  return {
    framed: paragraphs.find((f) => f.positionedFrame)!,
    table: fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!,
    after: paragraphs.at(-1)!,
  };
}

test('a frame before a table stands at the table, and a table that fits stands beside it', () => {
  const { framed, table, after } = render(p('Lead') + frame + tableOf(100, 'right') + p('After'));
  expect(framed.box.y).toBeCloseTo(12.05, 6);
  expect(table.box.y).toBe(12);
  expect(table.box.x).toBe(100);
  expect(after.lines[0]!.box.y).toBe(24);
});

test('a table wider than the passage beside a frame starts below the frame', () => {
  const { framed, table } = render(p('Lead') + frame + tableOf(180, 'left') + p('After'));
  expect(framed.box.y).toBeCloseTo(12.05, 6);
  expect(table.box.y).toBeCloseTo(framed.box.y + framed.box.height, 1);
  expect(table.box.x).toBe(0);
});
