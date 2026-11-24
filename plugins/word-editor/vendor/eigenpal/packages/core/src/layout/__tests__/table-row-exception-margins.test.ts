// A row's `w:tblPrEx/w:tblCellMar` (17.4.60, 17.4.42) replaces the table's cell margins for
// that row's cells, side by side; a cell's own `w:tcMar` (17.4.43) still wins over it.
//
// A table with 10pt top and bottom margins whose body rows zero them through the exception
// lays those rows out without the padding: an `atLeast` minimum is not padded by margins the
// row does not have, and a row without a height is as tall as its line.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { readTableStructure } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// An 11pt run, so the fixed measurer gives a 12pt line.
const LINE = 12;
const SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
const margins = (sides: Record<string, number>, tag = 'tblCellMar') =>
  `<w:${tag}>${Object.entries(sides)
    .map(([side, twips]) => `<w:${side} w:w="${twips}" w:type="dxa"/>`)
    .join('')}</w:${tag}>`;
// 10pt top and bottom, 15pt left and right.
const TABLE_MARGINS = margins({ top: 200, left: 300, bottom: 200, right: 300 });

function row(options: { exception?: string; height?: string; tcPr?: string } = {}) {
  return (
    `<w:tr>${options.exception ? `<w:tblPrEx>${options.exception}</w:tblPrEx>` : ''}` +
    `${options.height ? `<w:trPr>${options.height}</w:trPr>` : ''}` +
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${options.tcPr ?? ''}</w:tcPr>` +
    '<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>x</w:t></w:r></w:p></w:tc></w:tr>'
  );
}

function documentPart(rows: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/>` +
      `<w:tblBorders>${SIDES.map((side) => `<w:${side} w:val="nil"/>`).join('')}</w:tblBorders>` +
      `${TABLE_MARGINS}</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>` +
      `${rows}</w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function rowHeights(rows: string): number[] {
  const laid = layoutSemanticDocument(documentPart(rows), 0, {
    measurer: createFixedMeasurer(5, LINE),
  });
  const table = laid.pages[0]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
  return table.rows.map((r) => Math.round(r.box.height * 100) / 100);
}

function cellMargins(rows: string) {
  const body = documentPart(rows).root.children.find((n) => n.kind === 'body') as OoxmlElement;
  const table = body.children.find((n) => n.kind === 'table') as OoxmlElement;
  return readTableStructure(table, 300, 0, undefined, 'proposed')!.rows.map(
    (r) => r.cells[0]!.margins
  );
}

const ZERO_VERTICAL = margins({ top: 0, bottom: 0 });
const AT_LEAST = '<w:trHeight w:val="850" w:hRule="atLeast"/>';
const EXACT = '<w:trHeight w:val="850" w:hRule="exact"/>';

describe('row cell-margin exceptions', () => {
  test('an atLeast minimum is not padded by margins the exception removes', () => {
    const [plain, excepted] = rowHeights(
      row({ height: AT_LEAST }) + row({ exception: ZERO_VERTICAL, height: AT_LEAST })
    );
    expect(plain).toBe(42.5 + 20);
    expect(excepted).toBe(42.5);
  });

  test('a row without a height is as tall as its line plus the remaining margins', () => {
    expect(rowHeights(row() + row({ exception: ZERO_VERTICAL }) + row())).toEqual([
      LINE + 20,
      LINE,
      LINE + 20,
    ]);
    expect(rowHeights(row({ exception: margins({ top: 400 }) }))).toEqual([LINE + 20 + 10]);
  });

  test('an exact row keeps its height', () => {
    expect(rowHeights(row({ exception: ZERO_VERTICAL, height: EXACT }))).toEqual([42.5]);
  });

  test('sides the exception leaves out keep the table margin', () => {
    const [plain, excepted] = cellMargins(row() + row({ exception: margins({ left: 0 }) }));
    expect(plain).toEqual({ top: 10, right: 15, bottom: 10, left: 15 });
    expect(excepted).toEqual({ top: 10, right: 15, bottom: 10, left: 0 });
  });

  test("a cell's own margins win over the row exception", () => {
    const tcPr = margins({ top: 100, bottom: 100 }, 'tcMar');
    expect(rowHeights(row({ exception: ZERO_VERTICAL, height: AT_LEAST, tcPr }))).toEqual([
      42.5 + 10,
    ]);
    const topOnly = margins({ top: 100 }, 'tcMar');
    expect(rowHeights(row({ exception: ZERO_VERTICAL, tcPr: topOnly }))).toEqual([LINE + 5]);
  });
});
