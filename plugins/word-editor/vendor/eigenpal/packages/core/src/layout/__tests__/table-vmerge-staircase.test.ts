// Vertical merges that partly overlap: a staircase.
//
// Column 0 merges rows 0-1 and column 1 merges rows 1-2, so the second merge starts inside
// the first one and ends after it. The first merge used to be declined for that shape, so its
// head sized row 0 on its own: row 0 took the whole merged height and every later row started
// that far down. The merges are now decided together, top to bottom: each one puts what its
// rows do not give it on its own last row, and a later merge sees those rows at their grown
// height. An `hRule="exact"` last row takes nothing, and the merged content is clipped there.
//
// Every line is 14pt, with no borders and no vertical cell margins, so each expected height
// is a line count.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LINE_PT = 14;

function loadPart(bodyXml: string): OoxmlPart {
  const xml = `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(`part read failed: ${result.reason}`);
  return result.part;
}

/** An 11pt run, which the fixed measurer lays out as one 14pt line. */
const p = (text: string) =>
  `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => p(`${prefix}${index}`)).join('');
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';
const TABLE_PR =
  '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>';
/** A row with a minimum height of `lineCount` lines, or `exact` at that height. */
const tr = (cells: string, lineCount = 2, rule = 'atLeast') =>
  `<w:tr><w:trPr><w:trHeight w:val="${lineCount * LINE_PT * 20}" w:hRule="${rule}"/></w:trPr>` +
  `${cells}</w:tr>`;
const ONE = p('');
const UNMERGED = (text: string) => tc(p(text));

/**
 * Column 0 merges rows 0-1 (`first` lines), column 1 merges rows 1-2 (`second` lines), and
 * column 2 holds one line per row. Every row is at least two lines tall.
 */
function staircase(first: number, second: number, rules = ['atLeast', 'atLeast', 'atLeast']) {
  return (
    `<w:tbl>${TABLE_PR}` +
    tr(`${tc(lines('A', first), RESTART)}${UNMERGED('b0')}${UNMERGED('c0')}`, 2, rules[0]) +
    tr(`${tc(ONE, CONTINUE)}${tc(lines('B', second), RESTART)}${UNMERGED('c1')}`, 2, rules[1]) +
    tr(`${UNMERGED('a2')}${tc(ONE, CONTINUE)}${UNMERGED('c2')}`, 2, rules[2]) +
    '</w:tbl>'
  );
}

const pageOf = (contentHeightPt: number): PageGeometry => ({
  width: 320,
  height: contentHeightPt + 20,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
});

const layoutOn = (bodyXml: string, contentHeightPt = 400): SemanticLayout =>
  layoutSemanticDocument(loadPart(bodyXml), 0, {
    measurer: createFixedMeasurer(),
    geometry: pageOf(contentHeightPt),
  });

function tablesOn(layout: SemanticLayout, pageIndex: number): TableFragmentRecord[] {
  return (layout.pages[pageIndex]?.fragments ?? []).filter(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  );
}

/** Row heights in lines, so a failure reads as the line counts the comments state. */
const rowLines = (table: TableFragmentRecord): number[] =>
  table.rows.map((row) => Math.round((row.box.height / LINE_PT) * 1000) / 1000);

function contentBottomOf(cell: TableCellFragmentRecord): number {
  let bottom = Number.NEGATIVE_INFINITY;
  for (const block of cell.blocks) bottom = Math.max(bottom, block.box.y + block.box.height);
  return bottom;
}

/** Every painted cell keeps its content in its own box, and every box in its table. */
function expectContentInsideItsTable(table: TableFragmentRecord): void {
  const tableBottom = table.box.y + table.box.height;
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.blocks.length === 0) continue;
      const cellBottom = cell.box.y + cell.box.height;
      expect(contentBottomOf(cell)).toBeLessThanOrEqual(cellBottom + 0.001);
      expect(cellBottom).toBeLessThanOrEqual(tableBottom + 0.001);
    }
  }
}

describe('a merge that starts inside another merge and ends after it', () => {
  test('the first merge grows its own last row, not its head row', () => {
    // Six lines over rows of two and two: the four-line surplus goes to row 1.
    const table = tablesOn(layoutOn(staircase(6, 1)), 0)[0]!;
    expect(rowLines(table)).toEqual([2, 4, 2]);
    expect(table.rows[0]!.cells[0]!.rowSpan).toBe(2);
    expectContentInsideItsTable(table);
  });

  test('the second merge sees the first surplus in the row they share', () => {
    // Row 1 is four lines for the first merge. The second merge needs nine lines and rows 1
    // and 2 give it six, so row 2 takes three more.
    const table = tablesOn(layoutOn(staircase(6, 9)), 0)[0]!;
    expect(rowLines(table)).toEqual([2, 4, 5]);
    expectContentInsideItsTable(table);
  });

  test('a second merge its rows already hold adds nothing', () => {
    const table = tablesOn(layoutOn(staircase(8, 3)), 0)[0]!;
    expect(rowLines(table)).toEqual([2, 6, 2]);
    expectContentInsideItsTable(table);
  });

  test('a short first merge leaves the second one to size its own last row', () => {
    const table = tablesOn(layoutOn(staircase(1, 7)), 0)[0]!;
    expect(rowLines(table)).toEqual([2, 2, 5]);
    expectContentInsideItsTable(table);
  });

  test('an exact last row takes no surplus, and the merged content is clipped there', () => {
    const table = tablesOn(layoutOn(staircase(6, 1, ['atLeast', 'exact', 'atLeast'])), 0)[0]!;
    // Row 0 keeps its minimum; the surplus does not move up to it.
    expect(rowLines(table)).toEqual([2, 2, 2]);
    const head = table.rows[0]!.cells[0]!;
    expect(head.box.height).toBe(4 * LINE_PT);
    // The span holds four of the six lines.
    expect(head.blocks).toHaveLength(4);
    expect(contentBottomOf(head)).toBeLessThanOrEqual(head.box.y + head.box.height + 0.001);
    // The clipped head owes nothing: the rest is not carried to another page.
    expect(layoutOn(staircase(6, 1, ['atLeast', 'exact', 'atLeast'])).pages).toHaveLength(1);
  });

  test('two merges over the same rows and a fixed last row keep every row compact', () => {
    // Both merges cover rows 0-2, and row 2 is exact. The first merge is taller than the
    // rows and is clipped; the second fits. Neither one sizes the head row.
    const body =
      `<w:tbl>${TABLE_PR}` +
      tr(`${tc(lines('A', 9), RESTART)}${tc(lines('B', 4), RESTART)}${UNMERGED('c0')}`) +
      tr(`${tc(ONE, CONTINUE)}${tc(ONE, CONTINUE)}${UNMERGED('c1')}`) +
      tr(`${tc(ONE, CONTINUE)}${tc(ONE, CONTINUE)}${UNMERGED('c2')}`, 2, 'exact') +
      '</w:tbl>';
    const table = tablesOn(layoutOn(body), 0)[0]!;
    expect(rowLines(table)).toEqual([2, 2, 2]);
    const [tall, short] = table.rows[0]!.cells;
    expect(tall!.blocks).toHaveLength(6);
    expect(short!.blocks).toHaveLength(4);
    expectContentInsideItsTable(table);
  });

  test('a three-step staircase resolves each merge in turn', () => {
    // Column 0 merges rows 0-1 and rows 2-3, column 1 merges rows 1-2. Each merge holds six
    // lines over rows of two.
    const body =
      `<w:tbl>${TABLE_PR}` +
      tr(`${tc(lines('A', 6), RESTART)}${UNMERGED('b0')}${UNMERGED('c0')}`) +
      tr(`${tc(ONE, CONTINUE)}${tc(lines('B', 6), RESTART)}${UNMERGED('c1')}`) +
      tr(`${tc(lines('E', 6), RESTART)}${tc(ONE, CONTINUE)}${UNMERGED('c2')}`) +
      tr(`${tc(ONE, CONTINUE)}${UNMERGED('b3')}${UNMERGED('c3')}`) +
      '</w:tbl>';
    const table = tablesOn(layoutOn(body), 0)[0]!;
    // Row 1 grows to four lines; rows 1-2 then hold the second merge; row 3 takes four.
    expect(rowLines(table)).toEqual([2, 4, 2, 4]);
    expectContentInsideItsTable(table);
  });

  test('a page that holds the planned rows keeps the table on it', () => {
    // A lead line and the 2 + 4 + 5 planned lines fill the content box exactly. Sizing row 0
    // to the first merge's whole content, as before, does not fit.
    const layout = layoutOn(`${p('Lead')}${staircase(6, 9)}`, 12 * LINE_PT);
    // The table stays on the first page; the empty paragraph the body reads after it, which
    // the full page cannot hold, starts the second.
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[1]!.fragments.map((fragment) => fragment.kind)).toEqual(['paragraph']);
    expect(rowLines(tablesOn(layout, 0)[0]!)).toEqual([2, 4, 5]);
  });

  test('a page shorter than the planned rows keeps every line inside the table', () => {
    const layout = layoutOn(`${p('Lead')}${staircase(6, 9)}`, 12 * LINE_PT - 1);
    for (const pageIndex of layout.pages.keys()) {
      for (const table of tablesOn(layout, pageIndex)) expectContentInsideItsTable(table);
    }
  });
});
