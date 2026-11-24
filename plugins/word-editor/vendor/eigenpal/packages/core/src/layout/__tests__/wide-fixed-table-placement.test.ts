// Tables wider than the text area stay where their position puts them.
//
// A floating table centered on the margin extends past both margins by the same amount, and a
// fixed table pulled left by a negative indent keeps a right-aligned number inside its narrow
// first column.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { ParagraphFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

const p = (text: string, props = '') =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function layout(body: string, sectPr: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}${sectPr}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, { measurer });
}

const tableOf = (pages: ReturnType<typeof layout>['pages']): TableFragmentRecord => {
  const found = pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (!found || found.kind !== 'table') throw new Error('no table');
  return found;
};

test('a floating table centered on the margin overhangs both margins equally', () => {
  // A4, 85.05 pt margins: a 425.2 pt text area under a 542.35 pt table.
  const sectPr =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="993" w:right="1701" w:bottom="851" w:left="1701" w:header="708" w:footer="708"/></w:sectPr>';
  const cell = (width: number, text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
  const table =
    '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="page" ' +
    'w:horzAnchor="margin" w:tblpXSpec="center" w:tblpY="861"/><w:tblW w:w="10847" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="5495"/><w:gridCol w:w="5352"/></w:tblGrid>' +
    `<w:tr>${cell(5495, 'Left column')}${cell(5352, 'Right column')}</w:tr></w:tbl>`;
  const result = layout(table + p(''), sectPr);
  const page = result.pages[0]!;
  const fragment = tableOf(result.pages);
  // Fragment boxes are relative to the content box.
  const left = page.contentBox.x + fragment.box.x - page.box.x;
  const right = page.box.width - (left + fragment.box.width);
  expect(fragment.box.width).toBeCloseTo(542.35, 1);
  expect(left).toBeCloseTo(right, 1);
  expect(left).toBeGreaterThan(0);
});

test('a right-aligned number stays inside a narrow first column of a fixed table', () => {
  const sectPr =
    '<w:sectPr><w:pgSz w:w="11907" w:h="16840"/>' +
    '<w:pgMar w:top="1985" w:right="1134" w:bottom="1418" w:left="1134" w:header="720" w:footer="720"/></w:sectPr>';
  const cell = (width: number, inner: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
  const table =
    '<w:tbl><w:tblPr><w:tblW w:w="10065" w:type="dxa"/><w:tblInd w:w="-356" w:type="dxa"/>' +
    '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="568"/><w:gridCol w:w="5245"/><w:gridCol w:w="4252"/></w:tblGrid>' +
    `<w:tr>${cell(568, p('1', '<w:jc w:val="right"/>'))}${cell(5245, p('Item'))}${cell(4252, p('Value'))}</w:tr></w:tbl>`;
  const fragment = tableOf(layout(table + p(''), sectPr).pages);
  const first = fragment.rows[0]!.cells[0]!;
  const paragraph = first.blocks[0] as ParagraphFragmentRecord;
  const columnWidth = fragment.columnEdges[1]! - fragment.columnEdges[0]!;
  expect(columnWidth).toBeCloseTo(28.4, 1);
  for (const line of paragraph.lines) {
    // Cell and line boxes share the content-box frame.
    expect(line.box.x).toBeGreaterThanOrEqual(first.box.x);
    expect(line.box.x + line.box.width).toBeLessThanOrEqual(first.box.x + first.box.width + 0.01);
  }
});
