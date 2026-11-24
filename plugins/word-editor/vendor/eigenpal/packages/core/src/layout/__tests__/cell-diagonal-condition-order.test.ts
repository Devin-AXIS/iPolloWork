import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable, readTableStructure } from '../index.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function part(xml: string, name: string) {
  const value = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!value.ok) throw Error(value.reason);
  return value.part;
}
const condition = (type: string, value: string) =>
  `<w:tblStylePr w:type="${type}"><w:tcPr>${value}</w:tcPr></w:tblStylePr>`;
const diagonal = (direction = 'tl2br', value = 'single', color = 'FF0000') =>
  `<w:tcBorders><w:${direction} w:val="${value}" w:color="${color}"/></w:tcBorders>`;
const shading = '<w:shd w:fill="ABCDEF"/>';
function borders(base: string, derived: string, direct = '') {
  const styles = part(
    `<w:styles xmlns:w="${W}"><w:style w:type="table" w:styleId="Base">${base}</w:style><w:style w:type="table" w:styleId="Derived"><w:basedOn w:val="Base"/>${derived}</w:style></w:styles>`,
    '/word/styles.xml'
  );
  const document = part(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="Derived"/><w:tblW w:w="1200" w:type="dxa"/><w:tblLook w:firstRow="1" w:lastRow="1" w:firstColumn="1" w:lastColumn="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid><w:tr><w:tc><w:tcPr>${direct}</w:tcPr><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>`,
    '/word/document.xml'
  );
  const body = document.root.children.find((node: any) => node.localName === 'body')!;
  const table = body.children.find((node: any) => node.localName === 'tbl')!;
  return readTableStructure(table, 468, 0, buildStyleCascadeTable(styles.root))!.rows[0]!.cells[0]!;
}
// A one-cell table is in the first row, the first and last column, and both top corners
// (17.7.6): firstCol < lastCol < firstRow < nwCell < neCell. A one-row table is never the last
// row while the header row applies.
const blueFirst = condition('firstCol', diagonal('tl2br', 'single', '0000FF'));
test('later inherited firstRow diagonal wins over earlier direct firstCol', () => {
  const cell = borders(
    condition('firstRow', diagonal()),
    blueFirst + condition('firstRow', shading)
  );
  expect(cell.borders.tl2br).toMatchObject({ state: 'edge', color: 'FF0000' });
  expect(cell.shading).toBe('ABCDEF');
});
test('intersecting conditional inheritance resolves both diagonal directions independently', () => {
  const cell = borders(
    condition('firstRow', diagonal('tr2bl')),
    condition('firstCol', diagonal('tr2bl', 'single', '0000FF')) + condition('firstRow', shading)
  );
  expect(cell.borders.tr2bl).toMatchObject({ state: 'edge', color: 'FF0000' });
  expect(cell.borders.tl2br?.state ?? 'omitted').toBe('omitted');
});
test('later inherited nil suppresses an earlier direct diagonal', () => {
  expect(
    borders(
      condition('firstRow', diagonal('tl2br', 'nil')),
      blueFirst + condition('firstRow', shading)
    ).borders.tl2br?.state
  ).toBe('none');
});
test('later inherited none suppresses an earlier direct diagonal', () => {
  expect(
    borders(
      condition('firstRow', diagonal('tl2br', 'none')),
      blueFirst + condition('firstRow', shading)
    ).borders.tl2br?.state
  ).toBe('none');
});
test('derived explicit nil overrides its inherited condition diagonal', () => {
  expect(
    borders(
      condition('firstRow', diagonal()),
      blueFirst + condition('firstRow', diagonal('tl2br', 'nil'))
    ).borders.tl2br?.state
  ).toBe('none');
});
test('later inherited corner wins over earlier direct row and corner', () => {
  const cell = borders(
    condition('neCell', diagonal()),
    blueFirst +
      condition('nwCell', diagonal('tl2br', 'single', '00FF00')) +
      condition('neCell', shading)
  );
  expect(cell.borders.tl2br).toMatchObject({ state: 'edge', color: 'FF0000' });
});
test('later inherited corner nil suppresses an earlier direct corner', () => {
  const cell = borders(
    condition('neCell', diagonal('tr2bl', 'nil')),
    condition('nwCell', diagonal('tr2bl')) + condition('neCell', shading)
  );
  expect(cell.borders.tr2bl?.state).toBe('none');
});
test('direct cell suppression still overrides resolved conditional corners', () => {
  const cell = borders(
    condition('neCell', diagonal()),
    blueFirst + condition('neCell', shading),
    diagonal('tl2br', 'none')
  );
  expect(cell.borders.tl2br?.state).toBe('none');
});
