import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure } from '../semantic-table.ts';
import { positionedTableOriginX } from '../table-origin.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';

const frames = {
  text: { left: 72, width: 468 },
  margin: { left: 72, width: 468 },
  page: { left: 0, width: 612 },
};
function document(margin = 108, extra = '', position = 'w:tblpY="1"') {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="text" w:vertAnchor="text" ${position}/>` +
      '<w:tblW w:type="dxa" w:w="2880"/><w:tblLayout w:type="fixed"/>' +
      `<w:tblCellMar><w:left w:type="dxa" w:w="${margin}"/></w:tblCellMar>` +
      '<w:tblBorders><w:left w:val="single" w:sz="4"/></w:tblBorders>' +
      extra +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="2880"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p><w:r><w:t>After</w:t></w:r></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
function structure(margin = 108, extra = '', position?: string) {
  const body = document(margin, extra, position).root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  ) as OoxmlElement;
  const table = body.children.find((node) => node.kind === 'table') as OoxmlElement;
  return readTableStructure(table, 468, 0)!;
}

test('legacy numeric text anchors align the leading content edge across cell margins', () => {
  for (const mode of [undefined, 11, 12, 14]) {
    for (const [margin, origin] of [
      [0, 71.5],
      [108, 66.35],
      [200, 61.75],
    ] as const) {
      expect(positionedTableOriginX(structure(margin), frames, mode)).toBeCloseTo(origin, 6);
    }
    expect(positionedTableOriginX(structure(108, '', 'w:tblpX="1441"'), frames, mode)).toBeCloseTo(
      138.35,
      6
    );
  }
});

test('legacy anchors of every kind and left alignments align the leading content edge', () => {
  // ECMA-376 Part 1, 17.4.58 and 17.4.66: the anchor kind does not change the content origin.
  for (const anchors of [
    'w:horzAnchor="margin" w:vertAnchor="text"',
    'w:horzAnchor="text" w:vertAnchor="margin"',
    'w:horzAnchor="margin" w:vertAnchor="page"',
  ]) {
    const read = (extra: string) => {
      const table = structure(108, '', extra);
      return { ...table, float: { ...table.float!, ...anchorsOf(anchors) } };
    };
    expect(positionedTableOriginX(read('w:tblpY="1"'), frames, 12)).toBeCloseTo(66.35, 6);
    expect(positionedTableOriginX(read('w:tblpXSpec="left"'), frames, 12)).toBeCloseTo(66.35, 6);
    expect(positionedTableOriginX(read('w:tblpXSpec="inside"'), frames, 12)).toBeCloseTo(66.35, 6);
  }
  // The outer edge may leave the sheet.
  const page = { ...structure(108, '', 'w:tblpXSpec="left"') };
  const atPage = { ...page, float: { ...page.float!, horzAnchor: 'page' as const } };
  expect(positionedTableOriginX(atPage, frames, 12)).toBeCloseTo(-5.65, 6);
});

function anchorsOf(attributes: string) {
  const horzAnchor = /w:horzAnchor="(\w+)"/.exec(attributes)![1] as 'text' | 'margin' | 'page';
  const vertAnchor = /w:vertAnchor="(\w+)"/.exec(attributes)![1] as 'text' | 'margin' | 'page';
  return { horzAnchor, vertAnchor };
}

test('modern, centered, separated, and bidirectional tables retain their outer-edge anchor', () => {
  expect(positionedTableOriginX(structure(), frames, 15)).toBe(72);
  expect(positionedTableOriginX(structure(), frames, 99)).toBe(72);
  expect(positionedTableOriginX(structure(108, '', 'w:tblpXSpec="left"'), frames, 15)).toBe(72);
  expect(positionedTableOriginX(structure(108, '', 'w:tblpXSpec="center"'), frames, 12)).toBe(234);
  expect(
    positionedTableOriginX(structure(108, '<w:tblCellSpacing w:type="dxa" w:w="20"/>'), frames, 12)
  ).toBe(72);
  expect(positionedTableOriginX(structure(108, '<w:bidiVisual/>'), frames, 12)).toBe(72);
});

test('legacy table fragments, rows, and cell text use the same origin in cold and warm layout', () => {
  const part = document();
  const session = createLayoutSession();
  const options = { measurer: createFixedMeasurer(), compatibilityMode: 12, session };
  const cold = layoutSemanticDocument(part, 1, options);
  const table = cold.pages
    .flatMap((page) => page.fragments)
    .find((block) => block.kind === 'table')!;
  expect(table.box.x).toBeCloseTo(-5.65, 6);
  expect(table.rows[0]!.box.x).toBeCloseTo(-5.65, 6);
  expect(table.rows[0]!.cells[0]!.box.x).toBeCloseTo(-5.65, 6);
  const first = table.rows[0]!.cells[0]!.blocks[0]!;
  if (first.kind !== 'paragraph') throw new Error('Expected cell paragraph');
  expect(first.lines[0]!.spans[0]!.box.x).toBeCloseTo(0, 6);
  expect(layoutSemanticDocument(part, 1, options).pages).toEqual(cold.pages);
});

/** A 144pt right-aligned table with a table right cell margin and a narrower cell margin. */
function rightAligned(tableMargin: number, width = 2880) {
  const parsed = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:tbl><w:tblPr><w:tblpPr w:horzAnchor="margin" w:vertAnchor="text" w:tblpXSpec="right" w:tblpY="1" w:leftFromText="180"/>' +
      `<w:tblW w:type="dxa" w:w="${width}"/><w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:right w:type="dxa" w:w="${tableMargin}"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid><w:tr><w:tc><w:tcPr>` +
      '<w:tcMar><w:right w:type="dxa" w:w="14"/></w:tcMar></w:tcPr>' +
      '<w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:p/></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const body = parsed.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  ) as OoxmlElement;
  return readTableStructure(body.children[0] as OoxmlElement, 468, 0)!;
}

test('legacy right alignment moves the table right by its table cell margin', () => {
  for (const mode of [undefined, 12, 14]) {
    // The table margin counts, not the narrower margin of the cell itself.
    expect(positionedTableOriginX(rightAligned(108), frames, mode)).toBeCloseTo(401.4, 6);
    expect(positionedTableOriginX(rightAligned(216), frames, mode)).toBeCloseTo(406.8, 6);
    expect(positionedTableOriginX(rightAligned(0), frames, mode)).toBeCloseTo(396, 6);
    // A table whose band covers the text column keeps its outer edge.
    expect(positionedTableOriginX(rightAligned(108, 9360), frames, mode)).toBe(72);
  }
  expect(positionedTableOriginX(rightAligned(108), frames, 15)).toBe(396);
});
