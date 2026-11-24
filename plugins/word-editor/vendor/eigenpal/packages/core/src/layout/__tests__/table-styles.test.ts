// Table styles (17.7.6): `w:tblStyle`, `w:tblLook`, `w:tblStylePr`, `w:cnfStyle`, `w:tblHeader`.
//
// Word puts a table's appearance in styles.xml and writes only `<w:tblStyle w:val="..."/>`
// into the document. A reader that looks at the table's own `w:tblPr` draws a borderless,
// unshaded table where Word draws a full grid with a header row and banding.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { buildStyleCascadeTable, readTableStructure } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** `Table Grid`, as Word actually writes it: the grid lives in the style. */
const TABLE_GRID =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
  '<w:tblPr><w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:left w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:bottom w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:right w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:insideH w:val="single" w:sz="4" w:color="auto"/>' +
  '<w:insideV w:val="single" w:sz="4" w:color="auto"/>' +
  '</w:tblBorders><w:tblCellMar>' +
  '<w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/>' +
  '</w:tblCellMar></w:tblPr>' +
  '<w:tblStylePr w:type="firstRow"><w:tcPr>' +
  '<w:shd w:val="clear" w:fill="4472C4"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="band1Horz"><w:tcPr>' +
  '<w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr>' +
  '</w:style></w:styles>';

const cascade = () => buildStyleCascadeTable(part(TABLE_GRID, '/word/styles.xml').root);

function table(tblPr: string, rows = 4, columns = 2): OoxmlElement {
  const cells = Array.from(
    { length: columns },
    (_, index) =>
      `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>` +
      `<w:p><w:r><w:t>c${index}</w:t></w:r></w:p></w:tc>`
  ).join('');
  const body =
    `<w:tbl><w:tblPr>${tblPr}</w:tblPr>` +
    Array.from({ length: rows }, () => `<w:tr>${cells}</w:tr>`).join('') +
    '</w:tbl>';
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const found = document.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  return found as OoxmlElement;
}

describe('a table style supplies borders the document never states', () => {
  test('without the cascade a Table Grid table has no borders at all', () => {
    const structure = readTableStructure(table('<w:tblStyle w:val="TableGrid"/>'), 468, 0)!;
    expect(structure.tableBorders.top.state).toBe('omitted');
    expect(structure.tableBorders.insideH.state).toBe('omitted');
  });

  test('with the cascade the style’s grid resolves', () => {
    const structure = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/>'),
      468,
      0,
      cascade()
    )!;
    expect(structure.tableBorders.top).toMatchObject({ state: 'edge', style: 'single' });
    expect(structure.tableBorders.insideH).toMatchObject({ state: 'edge', style: 'single' });
    expect(structure.tableBorders.insideV).toMatchObject({ state: 'edge', style: 'single' });
  });

  test('the table’s own tblPr overrides the style, including an explicit none', () => {
    const structure = readTableStructure(
      table(
        '<w:tblStyle w:val="TableGrid"/>' + '<w:tblBorders><w:insideH w:val="none"/></w:tblBorders>'
      ),
      468,
      0,
      cascade()
    )!;
    // The style's outer grid survives; the row rules the document turned off do not.
    expect(structure.tableBorders.top.state).toBe('edge');
    expect(structure.tableBorders.insideH.state).toBe('none');
  });

  test('cell margins come from the style when the table states none', () => {
    const structure = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/>'),
      468,
      0,
      cascade()
    )!;
    expect(structure.defaultMargins.left).toBe(6);
  });

  test('an unknown style id is not an error, it simply contributes nothing', () => {
    const structure = readTableStructure(
      table('<w:tblStyle w:val="NoSuchStyle"/>'),
      468,
      0,
      cascade()
    )!;
    expect(structure.tableBorders.top.state).toBe('omitted');
  });
});

describe('w:tblLook decides which conditional formats are live', () => {
  const shadingOf = (structure: ReturnType<typeof readTableStructure>) =>
    structure!.rows.map((row) => row.cells.map((cell) => cell.shading));

  test('firstRow shading applies only when the look enables it', () => {
    // `w:val` alone is the legacy bitmask (ECMA-376 Part 1 §17.4.55): 0000 turns the header row off.
    const off = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/><w:tblLook w:val="0000"/>'),
      468,
      0,
      cascade()
    );
    expect(shadingOf(off)[0]![0]).not.toBe('4472C4');

    const on = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/><w:tblLook w:firstRow="1" w:noHBand="1"/>'),
      468,
      0,
      cascade()
    );
    expect(shadingOf(on)[0]![0]).toBe('4472C4');
    expect(shadingOf(on)[1]![0]).toBeUndefined();
  });

  test('a table with no w:tblLook takes the 04A0 look: header row and row banding', () => {
    const structure = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/>'),
      468,
      0,
      cascade()
    );
    expect(shadingOf(structure).map((row) => row[0])).toEqual([
      '4472C4',
      'D9E2F3',
      undefined,
      'D9E2F3',
    ]);
  });

  test('row banding shades alternate body rows, skipping the header', () => {
    const structure = readTableStructure(
      table(
        '<w:tblStyle w:val="TableGrid"/><w:tblLook w:firstRow="1" w:lastRow="0" w:noHBand="0"/>'
      ),
      468,
      0,
      cascade()
    );
    const shading = shadingOf(structure).map((row) => row[0]);
    // Header, then band1 / band2 / band1 over the body rows.
    expect(shading).toEqual(['4472C4', 'D9E2F3', undefined, 'D9E2F3']);
  });

  test('a named attribute the look leaves out reads as on, and w:val is then ignored', () => {
    // `w:noHBand` is missing, so it is on and nothing bands, whatever 0000 says.
    const structure = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/><w:tblLook w:val="0000" w:firstRow="1"/>'),
      468,
      0,
      cascade()
    );
    expect(shadingOf(structure).map((row) => row[0])).toEqual([
      '4472C4',
      undefined,
      undefined,
      undefined,
    ]);
  });

  test('the legacy w:val bitmask is read when the attributes are absent', () => {
    // 0x0020 firstRow + 0x0200 no row banding.
    const structure = readTableStructure(
      table('<w:tblStyle w:val="TableGrid"/><w:tblLook w:val="0220"/>'),
      468,
      0,
      cascade()
    );
    const shading = shadingOf(structure).map((row) => row[0]);
    expect(shading).toEqual(['4472C4', undefined, undefined, undefined]);
  });

  test('a cell’s own shading beats the conditional format', () => {
    const document = part(
      `<w:document xmlns:w="${W}"><w:body><w:tbl>` +
        '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblLook w:firstRow="1"/></w:tblPr>' +
        '<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="FF0000"/></w:tcPr>' +
        '<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr>' +
        '</w:tbl></w:body></w:document>',
      '/word/document.xml'
    );
    const node = document.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child) => child.kind === 'table') as OoxmlElement;
    const structure = readTableStructure(node, 468, 0, cascade())!;
    expect(structure.rows[0]!.cells[0]!.shading).toBe('FF0000');
  });

  test('a w:cnfStyle is a record of the producer, not a condition', () => {
    // 17.4.7: the row claims to be the header row, but the look turns the header row off.
    const document = part(
      `<w:document xmlns:w="${W}"><w:body><w:tbl>` +
        '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblLook w:val="0200"/></w:tblPr>' +
        '<w:tr><w:trPr><w:cnfStyle w:val="100000000000"/></w:trPr>' +
        '<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr>' +
        '</w:tbl></w:body></w:document>',
      '/word/document.xml'
    );
    const node = document.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child) => child.kind === 'table') as OoxmlElement;
    const structure = readTableStructure(node, 468, 0, cascade())!;
    expect(structure.rows[0]!.cells[0]!.shading).toBeUndefined();
  });
});

describe('the header row condition covers the repeating header block', () => {
  const firstColumnShading = (tblLook: string, repeating: readonly number[]) => {
    const rows = Array.from({ length: 5 }, (_, index) => {
      const trPr = repeating.includes(index) ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
      return `<w:tr>${trPr}<w:tc><w:p><w:r><w:t>r${index}</w:t></w:r></w:p></w:tc></w:tr>`;
    }).join('');
    const document = part(
      `<w:document xmlns:w="${W}"><w:body><w:tbl>` +
        `<w:tblPr><w:tblStyle w:val="TableGrid"/>${tblLook}</w:tblPr>${rows}` +
        '</w:tbl></w:body></w:document>',
      '/word/document.xml'
    );
    const node = document.root.children
      .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
      .find((child) => child.kind === 'table') as OoxmlElement;
    return readTableStructure(node, 468, 0, cascade())!.rows.map((row) => row.cells[0]!.shading);
  };
  const ON = '<w:tblLook w:firstRow="1" w:lastRow="0" w:noHBand="0" w:noVBand="1"/>';
  const OFF = '<w:tblLook w:firstRow="0" w:lastRow="0" w:noHBand="0" w:noVBand="1"/>';

  test('every repeating row after row 0 takes the header row format', () => {
    expect(firstColumnShading(ON, [0, 1])).toEqual([
      '4472C4',
      '4472C4',
      'D9E2F3',
      undefined,
      'D9E2F3',
    ]);
  });

  test('the block runs from row 0 even when only a later row repeats', () => {
    expect(firstColumnShading(ON, [1])).toEqual([
      '4472C4',
      '4472C4',
      'D9E2F3',
      undefined,
      'D9E2F3',
    ]);
  });

  test('a gap ends the block', () => {
    expect(firstColumnShading(ON, [0, 2])).toEqual([
      '4472C4',
      'D9E2F3',
      undefined,
      'D9E2F3',
      undefined,
    ]);
  });

  test('with the header row off, repeating rows from row 0 still take no band', () => {
    expect(firstColumnShading(OFF, [0, 1])).toEqual([
      undefined,
      undefined,
      'D9E2F3',
      undefined,
      'D9E2F3',
    ]);
    // A repeating row that does not start at row 0 forms no block.
    expect(firstColumnShading(OFF, [1])).toEqual([
      'D9E2F3',
      undefined,
      'D9E2F3',
      undefined,
      'D9E2F3',
    ]);
  });
});
