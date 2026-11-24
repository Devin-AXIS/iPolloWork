// Row placement from a row's table property exception, `w:tblPrEx` (17.4.61).
//
// In the legacy modes a row's own `w:jc` (17.4.28) places it: a centred row centres its outer
// edges, and a trailing-aligned row ends past the text edge by its first cell's leading margin
// (`w:tblCellMar`, 17.4.42, or `w:tcMar`, 17.4.43). A table aligned to the trailing edge places
// every row that way. Leading-aligned rows share the origin of the first of them. Mode 15
// aligns the whole table by the first row's alignment and ignores later rows'. The first
// row's `w:tblInd` (17.4.50) indents the whole table in every mode.
//
// Fixture: a 150pt one-column table with 15pt left and right cell margins in a 468pt text
// column (72pt page margins), so a centred row starts 159pt in.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MARGIN = 72;
const TEXT_WIDTH = 468;
const margins = (sides: Record<string, number>, tag = 'tblCellMar') =>
  `<w:${tag}>${Object.entries(sides)
    .map(([side, twips]) => `<w:${side} w:w="${twips}" w:type="dxa"/>`)
    .join('')}</w:${tag}>`;
// 15pt on each side.
const TABLE_MARGINS = margins({ left: 300, right: 300 });
const SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
const BORDERS = `<w:tblBorders>${SIDES.map(
  (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`
).join('')}</w:tblBorders>`;

function row(options: { exception?: string; tcPr?: string } = {}) {
  return (
    `<w:tr>${options.exception ? `<w:tblPrEx>${options.exception}</w:tblPrEx>` : ''}` +
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${options.tcPr ?? ''}</w:tcPr>` +
    '<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr>'
  );
}

/** Each row's outer left edge, from the left text edge (fragment boxes are content-relative). */
function rowLefts(rows: string, tableProperties = TABLE_MARGINS, mode = 14): number[] {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/>` +
      // A stated indent makes a leading-aligned table align its content edge.
      `${tableProperties.includes('tblInd') ? '' : '<w:tblInd w:w="0" w:type="dxa"/>'}` +
      `${BORDERS}${tableProperties}</w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const laid = layoutSemanticDocument(read.part, 0, {
    compatibilityMode: mode,
    measurer: createFixedMeasurer(5, 12),
    geometry: {
      width: TEXT_WIDTH + 2 * MARGIN,
      height: 792,
      margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
    },
  });
  const table = laid.pages[0]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
  return table.rows.map((r) => Math.round(r.cells[0]!.box.x * 100) / 100);
}

const CENTER = '<w:jc w:val="center"/>';
const RIGHT = '<w:jc w:val="right"/>';
const LEFT = '<w:jc w:val="left"/>';
// A trailing-aligned row whose first cell leading margin is 15pt ends 15pt past the text edge.
const TRAILING_AT_15 = TEXT_WIDTH - 150 + 15;

describe('row alignment exceptions in the legacy modes', () => {
  test('a centred row centres its outer edges, whatever its margins', () => {
    for (const mode of [11, 12, 14]) {
      expect(rowLefts(row() + row({ exception: CENTER }) + row(), TABLE_MARGINS, mode)).toEqual([
        -15, 159, -15,
      ]);
    }
    const zeroLeft = CENTER + margins({ left: 0 });
    expect(rowLefts(row() + row({ exception: zeroLeft }))).toEqual([-15, 159]);
    // The table's indent does not move a centred row.
    const indented = TABLE_MARGINS + '<w:tblInd w:w="720" w:type="dxa"/>';
    expect(rowLefts(row() + row({ exception: CENTER }), indented)).toEqual([21, 159]);
  });

  test("a trailing-aligned row ends past the text edge by its first cell's leading margin", () => {
    expect(rowLefts(row() + row({ exception: RIGHT }))).toEqual([-15, TRAILING_AT_15]);
    const zeroLeft = RIGHT + margins({ left: 0 });
    expect(rowLefts(row() + row({ exception: zeroLeft }))).toEqual([-15, TRAILING_AT_15 - 15]);
  });

  test('a leading-aligned row in a centred table takes the leading origin', () => {
    const centred = TABLE_MARGINS + CENTER;
    expect(rowLefts(row() + row({ exception: LEFT }), centred)).toEqual([159, -15]);
  });

  test("the first row's alignment places only that row", () => {
    expect(rowLefts(row({ exception: RIGHT }) + row() + row())).toEqual([TRAILING_AT_15, -15, -15]);
    const centred = TABLE_MARGINS + CENTER;
    expect(rowLefts(row({ exception: LEFT }) + row(), centred)).toEqual([-15, 159]);
  });

  test('mode 15 keeps every row on the grid', () => {
    for (const exception of [CENTER, RIGHT]) {
      // The outer edge of the 0.5pt side rule meets the text edge.
      expect(rowLefts(row() + row({ exception }), TABLE_MARGINS, 15)).toEqual([0.25, 0.25]);
    }
  });
});

describe('rows of a trailing-aligned legacy table', () => {
  const trailing = TABLE_MARGINS + RIGHT;

  test('each row ends past the text edge by its own leading margin', () => {
    expect(rowLefts(row() + row({ exception: margins({ left: 0 }) }) + row(), trailing)).toEqual([
      TRAILING_AT_15,
      TRAILING_AT_15 - 15,
      TRAILING_AT_15,
    ]);
    expect(rowLefts(row({ exception: margins({ left: 100 }) }) + row(), trailing)).toEqual([
      TRAILING_AT_15 - 10,
      TRAILING_AT_15,
    ]);
    expect(rowLefts(row({ tcPr: margins({ left: 0 }, 'tcMar') }) + row(), trailing)).toEqual([
      TRAILING_AT_15 - 15,
      TRAILING_AT_15,
    ]);
  });

  test('trailing margins do not place a row', () => {
    expect(rowLefts(row({ exception: margins({ right: 0 }) }) + row(), trailing)).toEqual([
      TRAILING_AT_15,
      TRAILING_AT_15,
    ]);
    expect(rowLefts(row() + row({ tcPr: margins({ right: 0 }, 'tcMar') }), trailing)).toEqual([
      TRAILING_AT_15,
      TRAILING_AT_15,
    ]);
    // Table margins of 15pt on the left and none on the right.
    const leftOnly = margins({ left: 300, right: 0 }) + RIGHT;
    expect(rowLefts(row() + row(), leftOnly)).toEqual([TRAILING_AT_15, TRAILING_AT_15]);
    const rightOnly = margins({ left: 0, right: 300 }) + RIGHT;
    expect(rowLefts(row() + row(), rightOnly)).toEqual([TEXT_WIDTH - 150, TEXT_WIDTH - 150]);
  });
});

describe('rows of a leading-aligned legacy table', () => {
  test("the first row's leading margin sets the origin of every row", () => {
    const zeroLeft = margins({ left: 0 });
    // Content narrower than half the 0.5pt rule starts at the rule's inner half.
    expect(rowLefts(row({ exception: zeroLeft }) + row() + row())).toEqual([-0.25, -0.25, -0.25]);
    expect(rowLefts(row({ tcPr: margins({ left: 0 }, 'tcMar') }) + row())).toEqual([-0.25, -0.25]);
  });

  test('a later row with other margins keeps the origin', () => {
    const exception = margins({ left: 100, right: 0 });
    expect(rowLefts(row() + row({ exception }) + row())).toEqual([-15, -15, -15]);
    expect(rowLefts(row() + row({ tcPr: margins({ left: 0 }, 'tcMar') }))).toEqual([-15, -15]);
  });

  test('width, indent and layout exceptions leave the row in place', () => {
    for (const exception of [
      '<w:tblInd w:w="720" w:type="dxa"/>',
      '<w:tblW w:w="6000" w:type="dxa"/>',
      '<w:tblLayout w:type="fixed"/>',
    ]) {
      expect(rowLefts(row() + row({ exception }) + row())).toEqual([-15, -15, -15]);
    }
  });
});

describe("the first row's table property exception", () => {
  test('aligns the whole table in mode 15', () => {
    const right = TEXT_WIDTH - 150 - 0.25;
    expect(rowLefts(row({ exception: RIGHT }) + row(), TABLE_MARGINS, 15)).toEqual([right, right]);
    expect(rowLefts(row({ exception: CENTER }) + row(), TABLE_MARGINS + RIGHT, 15)).toEqual([
      159, 159,
    ]);
  });

  test('indents the whole table in every mode', () => {
    const indent = '<w:tblInd w:w="720" w:type="dxa"/>';
    expect(rowLefts(row({ exception: indent }) + row())).toEqual([21, 21]);
    expect(rowLefts(row({ exception: indent }) + row(), TABLE_MARGINS, 15)).toEqual([36.25, 36.25]);
  });
});
