// `w:tblCellSpacing` (17.4.45) separates rows as it separates columns: twice the spacing lies
// above each row's cells and below the last row. An `atLeast` minimum sizes the cell, below
// the gap; an exact row below the first counts its height from the middle of the gap.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '../index.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const spacingEl = (twips: number) => `<w:tblCellSpacing w:w="${twips}" w:type="dxa"/>`;

function layout(options: {
  readonly tableSpacing?: number;
  readonly rowSpacing?: number;
  readonly height?: string;
}): SemanticLayout {
  const rowProperties =
    (options.rowSpacing === undefined ? '' : spacingEl(options.rowSpacing)) +
    (options.height ?? '');
  const rows = Array.from(
    { length: 3 },
    (_, index) =>
      `<w:tr><w:trPr>${rowProperties}</w:trPr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${p(`row${index}`)}</w:tc></w:tr>`
  ).join('');
  const margins = ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:w="0" w:type="dxa"/>`)
    .join('');
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>` +
    (options.tableSpacing === undefined ? '' : spacingEl(options.tableSpacing)) +
    `<w:tblCellMar>${margins}</w:tblCellMar><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${rows}</w:tbl>`;
  const xml = `<w:document xmlns:w="${W}"><w:body>${p('before')}${table}${p('after')}</w:body></w:document>`;
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(5, 12),
    geometry: { width: 400, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
  });
}

/** Distances between the tops of consecutive lines: before, row0..row2, after. */
function pitches(result: SemanticLayout): number[] {
  const tops = linesOf(result).map((line) => line.box.y);
  return tops.slice(1).map((top, index) => top - tops[index]!);
}

test('twice the spacing separates rows, and the table edges from the first and last rows', () => {
  const plain = pitches(layout({}));
  // 60 twips is 3pt of spacing, so a 6pt gap around every row.
  const spaced = pitches(layout({ tableSpacing: 60 }));
  expect(spaced).toHaveLength(4);
  spaced.forEach((pitch, index) => expect(pitch).toBeCloseTo(plain[index]! + 6, 6));
});

test('the gap lies above each cell box, not inside it', () => {
  const result = layout({ tableSpacing: 60 });
  const table = result.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  for (const row of table.rows) {
    const cell = row.cells[0]!;
    expect(cell.box.y - row.box.y).toBeCloseTo(6, 6);
    expect(cell.box.y + cell.box.height).toBeCloseTo(row.box.y + row.box.height, 6);
    expect(cell.blocks[0]!.box.y).toBeCloseTo(cell.box.y, 6);
  }
});

test('the same spacing on every row acts as the table spacing', () => {
  expect(pitches(layout({ rowSpacing: 60 }))).toEqual(pitches(layout({ tableSpacing: 60 })));
});

test('an atLeast minimum sizes the cell below the gap; an exact row counts from mid-gap', () => {
  const atLeast = '<w:trHeight w:val="400" w:hRule="atLeast"/>';
  for (const pitch of pitches(layout({ tableSpacing: 60, height: atLeast })).slice(1, 3))
    expect(pitch).toBeCloseTo(26, 6);
  // The first exact row keeps its height. Below it an exact height starts in the middle of the
  // gap above the cells, so the row takes its height plus the 3pt spacing.
  const exact = '<w:trHeight w:val="400" w:hRule="exact"/>';
  const [first, second] = pitches(layout({ tableSpacing: 60, height: exact })).slice(1, 3);
  expect(first).toBeCloseTo(20, 6);
  expect(second).toBeCloseTo(23, 6);
});
