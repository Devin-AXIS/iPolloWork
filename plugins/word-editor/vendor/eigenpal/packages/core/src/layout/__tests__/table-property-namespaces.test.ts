import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
} from '../../store/package/ooxml-tree.ts';
import { readTableStructure } from '../semantic-table.ts';
import { gridColumnElements, readPreferredWidth, readTableIndentPt } from '../table-widths.ts';
import { readMarginSides } from '../table-cell-margins.ts';
import { readGridSpan, readGridSkip } from '../table-row-properties.ts';

function element(xml: string): OoxmlElement {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:word="${WML_NAMESPACE_URI}" xmlns:foreign="urn:not-word"><w:body>${xml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw Error(parsed.reason);
  const body = parsed.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  ) as OoxmlElement;
  return body.children.find((node) => node.kind !== 'textValue') as OoxmlElement;
}

function table(
  properties: string,
  grid = '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>'
) {
  return element(
    `<w:tbl><w:tblPr>${properties}</w:tblPr>${grid}<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>`
  );
}

const structure = (properties: string, grid?: string) =>
  readTableStructure(table(properties, grid), 200, 0)!;

test('foreign width attributes cannot set table preferences', () => {
  expect(structure('<w:tblW w:type="pct" foreign:w="2500"/>').tableWidth).toEqual({
    type: 'auto',
    value: 0,
  });
  expect(structure('<w:tblW foreign:type="pct" w:w="2500"/>').tableWidth).toEqual({
    type: 'dxa',
    value: 125,
  });
  expect(
    structure('<w:tblW foreign:type="auto" w:type="pct" foreign:w="1000" w:w="2500"/>').tableWidth
  ).toEqual({ type: 'pct', value: 50 });
});

test('cell width and indent readers ignore foreign elements and attributes', () => {
  expect(readPreferredWidth(element('<foreign:tcW w:type="dxa" w:w="1440"/>'))).toEqual({
    type: 'auto',
    value: 0,
  });
  expect(readPreferredWidth(element('<w:tcW w:type="dxa" foreign:w="1440"/>'))).toEqual({
    type: 'auto',
    value: 0,
  });
  expect(readTableIndentPt(element('<foreign:tblInd w:w="720"/>'), 100)).toBeUndefined();
  expect(readTableIndentPt(element('<w:tblInd foreign:w="720"/>'), 100)).toBeUndefined();
  expect(readTableIndentPt(element('<w:tblInd foreign:w="720" word:w="240"/>'), 100)).toBe(12);
});

test('foreign grids and columns cannot seed table geometry', () => {
  const grid =
    '<foreign:tblGrid><w:gridCol w:w="9000"/></foreign:tblGrid>' +
    '<w:tblGrid><foreign:gridCol w:w="9000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>';
  expect(gridColumnElements(table('', grid))).toHaveLength(2);
  expect(structure('', grid).columnWidthsPt).toEqual(structure('').columnWidthsPt);
  const foreignAttribute =
    '<w:tblGrid><w:gridCol foreign:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>';
  const missingAttribute = '<w:tblGrid><w:gridCol/><w:gridCol w:w="2000"/></w:tblGrid>';
  expect(structure('', foreignAttribute).columnWidthsPt).toEqual(
    structure('', missingAttribute).columnWidthsPt
  );
});

test('foreign cell margins cannot change content width', () => {
  expect(
    readMarginSides(
      element('<w:tcMar><foreign:left w:w="720"/><w:right foreign:w="720"/></w:tcMar>')
    )
  ).toEqual({});
  expect(
    readMarginSides(
      element('<w:tcMar><foreign:left w:w="720"/><word:left word:w="240"/></w:tcMar>')
    ).left
  ).toBe(12);
});

test('foreign grid spans and row skips cannot add columns', () => {
  expect(readGridSpan(element('<w:tcPr><foreign:gridSpan w:val="20"/></w:tcPr>'))).toBe(1);
  expect(readGridSpan(element('<w:tcPr><w:gridSpan foreign:val="20"/></w:tcPr>'))).toBe(1);
  expect(
    readGridSkip(element('<w:trPr><foreign:gridBefore w:val="20"/></w:trPr>'), 'gridBefore')
  ).toBe(0);
  expect(
    readGridSkip(element('<w:trPr><w:gridBefore foreign:val="20"/></w:trPr>'), 'gridBefore')
  ).toBe(0);
  expect(
    readGridSpan(element('<w:tcPr><word:gridSpan foreign:val="20" word:val="2"/></w:tcPr>'))
  ).toBe(2);
});
