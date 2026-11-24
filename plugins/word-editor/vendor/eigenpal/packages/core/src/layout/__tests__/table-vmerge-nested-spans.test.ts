// A vertical merge that CONTAINS another merge in a different column.
//
// Column 0 merges rows 0-5 and column 1 merges rows 2-3, inside it. The outer merge used to
// be declined for having another head below its own head row, so its head sized row 0 on its
// own: row 0 took the whole merged height and every later row started that far down. The two
// merges are now planned together, inner first, so each row keeps the height of its own
// cells and the outer merge takes only what its rows do not already give it.
//
// Every row here is one 14pt line with no borders and no vertical cell margins, so each
// expected height is a line count.

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
const CANT_SPLIT = '<w:trPr><w:cantSplit/></w:trPr>';
const TABLE_PR =
  '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>';
const tr = (cells: string) => `<w:tr>${CANT_SPLIT}${cells}</w:tr>`;

/**
 * Column 0 merges rows 0-5 (`outerLines` lines), column 1 merges rows 2-3 (`innerLines`
 * lines), and column 2 holds one line per row.
 */
function nestedTable(outerLines: number, innerLines: number): string {
  return (
    `<w:tbl>${TABLE_PR}` +
    tr(`${tc(lines('M', outerLines), RESTART)}${tc(p('b0'))}${tc(p('c0'))}`) +
    tr(`${tc(p(''), CONTINUE)}${tc(p('b1'))}${tc(p('c1'))}`) +
    tr(`${tc(p(''), CONTINUE)}${tc(lines('I', innerLines), RESTART)}${tc(p('c2'))}`) +
    tr(`${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}${tc(p('c3'))}`) +
    tr(`${tc(p(''), CONTINUE)}${tc(p('b4'))}${tc(p('c4'))}`) +
    tr(`${tc(p(''), CONTINUE)}${tc(p('b5'))}${tc(p('c5'))}`) +
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

const rowHeights = (table: TableFragmentRecord): number[] =>
  table.rows.map((row) => row.box.height);

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

describe('a merge that contains another merge in a different column', () => {
  test('rows the rows can hold keep their own height', () => {
    const layout = layoutOn(`${p('Lead')}${nestedTable(6, 2)}${p('Tail')}`);
    expect(layout.pages).toHaveLength(1);
    const table = tablesOn(layout, 0)[0]!;
    expect(rowHeights(table)).toEqual([14, 14, 14, 14, 14, 14]);
    expect(table.box.height).toBe(6 * LINE_PT);
    const outer = table.rows[0]!.cells[0]!;
    const inner = table.rows[2]!.cells[1]!;
    expect(outer.rowSpan).toBe(6);
    expect(outer.box.height).toBe(6 * LINE_PT);
    expect(inner.rowSpan).toBe(2);
    expect(inner.box.y).toBe(table.rows[2]!.box.y);
    expect(inner.box.height).toBe(2 * LINE_PT);
    expectContentInsideItsTable(table);
  });

  test('each merge puts its own surplus on its own last row', () => {
    // The inner merge needs 3 lines over 2 rows, so row 3 grows by one line. The outer
    // merge then needs 8 lines over rows that give 7, so row 5 grows by one line.
    const layout = layoutOn(`${p('Lead')}${nestedTable(8, 3)}${p('Tail')}`);
    const table = tablesOn(layout, 0)[0]!;
    expect(rowHeights(table)).toEqual([14, 14, 14, 28, 14, 28]);
    expect(table.rows[0]!.cells[0]!.box.height).toBe(8 * LINE_PT);
    expect(table.rows[2]!.cells[1]!.box.height).toBe(3 * LINE_PT);
    expectContentInsideItsTable(table);
  });

  test('a page that holds the planned rows keeps the table on it', () => {
    // One lead line and six table rows fill the content box exactly. The outer head sizing
    // row 0 alone asked for eleven lines, which moved rows onto a second page.
    const layout = layoutOn(`${p('Lead')}${nestedTable(6, 2)}${p('Tail')}`, 7 * LINE_PT);
    const table = tablesOn(layout, 0)[0]!;
    expect(rowHeights(table)).toEqual([14, 14, 14, 14, 14, 14]);
    expect(tablesOn(layout, 1)).toHaveLength(0);
    expect(layout.pages).toHaveLength(2);
    expectContentInsideItsTable(table);
  });

  test('a page one point short of the planned rows keeps every line inside the table', () => {
    // The joint span no longer fits from its head row, so it is not admitted there. The
    // table still paints every merged line inside a cell on every page.
    const layout = layoutOn(`${p('Lead')}${nestedTable(6, 2)}${p('Tail')}`, 7 * LINE_PT - 1);
    for (const pageIndex of layout.pages.keys()) {
      for (const table of tablesOn(layout, pageIndex)) {
        expectContentInsideItsTable(table);
        expect(table.box.y + table.box.height).toBeLessThanOrEqual(7 * LINE_PT - 1 + 0.001);
      }
    }
  });

  test('a merge that only partly overlaps the outer one is planned with it', () => {
    // Column 1 merges rows 2-6, past the outer merge's last row. The two are decided
    // together, so the outer head no longer sizes its own row.
    const partial =
      `<w:tbl>${TABLE_PR}` +
      tr(`${tc(lines('M', 6), RESTART)}${tc(p('b0'))}${tc(p('c0'))}`) +
      tr(`${tc(p(''), CONTINUE)}${tc(p('b1'))}${tc(p('c1'))}`) +
      tr(`${tc(p(''), CONTINUE)}${tc(lines('I', 2), RESTART)}${tc(p('c2'))}`) +
      tr(`${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}${tc(p('c3'))}`) +
      tr(`${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}${tc(p('c4'))}`) +
      tr(`${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}${tc(p('c5'))}`) +
      tr(`${tc(p('a6'))}${tc(p(''), CONTINUE)}${tc(p('c6'))}`) +
      '</w:tbl>';
    const table = tablesOn(layoutOn(`${p('Lead')}${partial}`), 0)[0]!;
    expect(rowHeights(table)).toEqual(Array.from({ length: 7 }, () => LINE_PT));
    expectContentInsideItsTable(table);
  });

  test('a table placed in one pass inside a cell plans the same rows', () => {
    const host =
      `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr>` +
      '<w:tblGrid><w:gridCol w:w="5800"/></w:tblGrid>' +
      `<w:tr>${tc(nestedTable(6, 2) + p(''))}</w:tr></w:tbl>`;
    const outer = tablesOn(layoutOn(host), 0)[0]!;
    const nested = outer.rows[0]!.cells[0]!.blocks.find(
      (block): block is TableFragmentRecord => block.kind === 'table'
    )!;
    expect(rowHeights(nested)).toEqual([14, 14, 14, 14, 14, 14]);
    expect(nested.rows[0]!.cells[0]!.box.height).toBe(6 * LINE_PT);
    expectContentInsideItsTable(nested);
  });
});
