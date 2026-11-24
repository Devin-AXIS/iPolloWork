// A row's `w:tblPrEx` borders replace the table's own for that row's cells (17.4.61).
//
// A footer table in a gridded style can clear its borders on one row only: the first row's
// cells state `nil`, and the next row carries a `w:tblPrEx` whose `w:tblBorders` are all
// `none`. Neither row paints a rule. Sides the exception does not state keep the table's.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const single = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
const none = (side: string) => `<w:${side} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`;
const SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
const cell = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

function layout(rows: string, tblPrExtra = '') {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tblPrExtra}` +
      `<w:tblBorders>${SIDES.map(single).join('')}</w:tblBorders></w:tblPr>` +
      '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
      `${rows}</w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const laid = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(5, 12) });
  return laid.pages[0]!.fragments.find((f): f is TableFragmentRecord => f.kind === 'table')!;
}

/** The sides each cell paints, per row. */
const painted = (table: TableFragmentRecord) =>
  table.rows.map((row) =>
    row.cells.map((c) =>
      (['top', 'left', 'bottom', 'right'] as const).filter(
        (side) => c.borders?.[side] !== undefined
      )
    )
  );

describe('row border exceptions', () => {
  test('a row whose exception clears every border paints no rule', () => {
    const nil =
      '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>';
    const exception = `<w:tblPrEx><w:tblBorders>${SIDES.map(none).join('')}</w:tblBorders></w:tblPrEx>`;
    const table = layout(
      `<w:tr>${cell('a', nil)}${cell('b', nil)}</w:tr>` +
        `<w:tr>${exception}${cell('c')}${cell('d')}</w:tr>`
    );
    expect(painted(table)).toEqual([
      [[], []],
      [[], []],
    ]);
  });

  test('sides the exception leaves out keep the table rule', () => {
    const exception = `<w:tblPrEx><w:tblBorders>${none('insideV')}</w:tblBorders></w:tblPrEx>`;
    const table = layout(
      `<w:tr>${cell('a')}${cell('b')}</w:tr><w:tr>${exception}${cell('c')}${cell('d')}</w:tr>`
    );
    const [first, second] = painted(table);
    // Each shared edge paints once, from the cell above or before it. The first row keeps
    // its interior vertical rule; the exception row loses only that one.
    expect(first![0]).toContain('right');
    expect(second).toEqual([
      ['left', 'bottom'],
      ['bottom', 'right'],
    ]);
  });

  test('a right-to-left table mirrors the exception sides', () => {
    const exception = `<w:tblPrEx><w:tblBorders>${none('left')}</w:tblBorders></w:tblPrEx>`;
    const table = layout(`<w:tr>${exception}${cell('a')}${cell('b')}</w:tr>`, '<w:bidiVisual/>');
    // The logical left edge is the physical right edge of the visually last cell.
    const [row] = painted(table);
    const physicalRight = row!.find((sides) => !sides.includes('right'));
    expect(physicalRight).toBeDefined();
    expect(row!.flat()).toContain('left');
  });

  test('cell spacing reads the exception too', () => {
    const exception = `<w:tblPrEx><w:tblBorders>${SIDES.map(none).join('')}</w:tblBorders></w:tblPrEx>`;
    const table = layout(
      `<w:tr>${exception}${cell('a')}${cell('b')}</w:tr>`,
      '<w:tblCellSpacing w:w="40" w:type="dxa"/>'
    );
    expect(painted(table)).toEqual([[[], []]]);
  });
});
