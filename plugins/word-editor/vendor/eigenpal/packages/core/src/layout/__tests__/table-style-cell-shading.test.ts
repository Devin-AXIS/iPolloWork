// A table style's own `w:tcPr/w:shd` fills every cell of a table that uses it. Measured on
// reference renderings: a first-row condition's fill wins over the whole table's, a cell's own
// fill wins over both, a derived style's fill wins over its base's (and a derived style with
// none inherits it), the whole-table fill applies whatever `w:tblLook` says, and a cell's own
// `auto` fill clears the style's colour while `w:val="nil"` leaves it showing. A first-row
// condition follows the same rule over the whole-table fill.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const shd = (fill: string, val = 'clear') =>
  `<w:shd w:val="${val}" w:color="auto" w:fill="${fill}"/>`;
const tcPr = (inner: string) => `<w:tcPr>${inner}</w:tcPr>`;
const FIRST_ROW_ON =
  '<w:tblLook w:val="0020" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" ' +
  'w:noHBand="1" w:noVBand="1"/>';
const FIRST_ROW_OFF = FIRST_ROW_ON.replace('w:firstRow="1"', 'w:firstRow="0"').replace(
  '0020',
  '0000'
);

function read(name: string, xml: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** The fills of a 2x2 table under style `styleId`, row by row. */
function fills(
  styles: string,
  styleId: string,
  look = '',
  /** Each cell's own `w:shd`, by row and column. */
  direct: Readonly<Record<string, string>> = {}
): (string | undefined)[][] {
  const cell = (key: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${direct[key] ?? ''}</w:tcPr>` +
    `<w:p><w:r><w:t>${key}</w:t></w:r></w:p></w:tc>`;
  const rows = ['0', '1'].map((r) => `<w:tr>${cell(`${r}0`)}${cell(`${r}1`)}</w:tr>`).join('');
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="${styleId}"/>` +
      `<w:tblW w:w="4000" w:type="dxa"/>${look}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/>` +
      `<w:gridCol w:w="2000"/></w:tblGrid>${rows}</w:tbl><w:p/></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: buildStyleCascadeTable(
      read('/word/styles.xml', `<w:styles xmlns:w="${W}">${styles}</w:styles>`).root
    ),
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows.map((row) => row.cells.map((cellRecord) => cellRecord.shading));
}

const style = (id: string, body: string, basedOn = '') =>
  `<w:style w:type="table" w:styleId="${id}"><w:name w:val="${id}"/>` +
  `${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''}${body}</w:style>`;

const SHADED = style(
  'Shaded',
  tcPr(shd('FFFF00')) + `<w:tblStylePr w:type="firstRow">${tcPr(shd('0000FF'))}</w:tblStylePr>`
);

test('the whole-table fill shades every cell, under the first row and a cell of its own', () => {
  expect(fills(SHADED, 'Shaded', FIRST_ROW_ON, { '11': shd('00FF00') })).toEqual([
    ['0000FF', '0000FF'],
    ['FFFF00', '00FF00'],
  ]);
});

test('the whole-table fill applies when the look turns the first row off', () => {
  expect(fills(SHADED, 'Shaded', FIRST_ROW_OFF)).toEqual([
    ['FFFF00', 'FFFF00'],
    ['FFFF00', 'FFFF00'],
  ]);
});

test('a derived style fills over its base, and one with no fill inherits it', () => {
  const base = style('Base', tcPr(shd('FFFF00')));
  expect(fills(base + style('Derived', tcPr(shd('FF0000')), 'Base'), 'Derived')[1]).toEqual([
    'FF0000',
    'FF0000',
  ]);
  expect(fills(base + style('Derived', '', 'Base'), 'Derived')[1]).toEqual(['FFFF00', 'FFFF00']);
});

test('a cell of its own with an auto fill clears the colour, and nil leaves it', () => {
  const plain = style('Shaded', tcPr(shd('FFFF00')));
  expect(fills(plain, 'Shaded', '', { '00': shd('auto'), '11': shd('auto', 'nil') })).toEqual([
    [undefined, 'FFFF00'],
    ['FFFF00', 'FFFF00'],
  ]);
});

test('a condition with an auto fill clears the whole-table colour, and nil leaves it', () => {
  const condition = (fill: string) =>
    style(
      'Shaded',
      tcPr(shd('FFFF00')) + `<w:tblStylePr w:type="firstRow">${tcPr(fill)}</w:tblStylePr>`
    );
  expect(fills(condition(shd('auto')), 'Shaded', FIRST_ROW_ON)[0]).toEqual([undefined, undefined]);
  expect(fills(condition(shd('auto', 'nil')), 'Shaded', FIRST_ROW_ON)[0]).toEqual([
    'FFFF00',
    'FFFF00',
  ]);
});

test('a wholeTable condition paints no fill, alone or over the style of its own', () => {
  const whole = `<w:tblStylePr w:type="wholeTable">${tcPr(shd('FFFF00'))}</w:tblStylePr>`;
  expect(fills(style('Shaded', whole), 'Shaded')).toEqual([
    [undefined, undefined],
    [undefined, undefined],
  ]);
  expect(fills(style('Shaded', tcPr(shd('FF0000')) + whole), 'Shaded')[1]).toEqual([
    'FF0000',
    'FF0000',
  ]);
});

test('a pattern in the style and in a cell mixes its colour into its fill', () => {
  const pattern = (val: string, color: string) =>
    `<w:shd w:val="${val}" w:color="${color}" w:fill="FFFFFF"/>`;
  expect(
    fills(style('Shaded', tcPr(pattern('pct50', 'FF0000'))), 'Shaded', '', {
      '11': pattern('pct25', '0000FF'),
    })
  ).toEqual([
    ['FF7F7F', 'FF7F7F'],
    ['FF7F7F', 'BFBFFF'],
  ]);
});
