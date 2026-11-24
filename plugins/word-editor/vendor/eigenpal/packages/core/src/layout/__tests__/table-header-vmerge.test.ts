// Vertical merges inside the leading `w:tblHeader` rows.
//
// Three header rows: column 0 and column 2 merge all three, and column 1 holds one line per
// row. The merged heads used to size header row 0 on their own, so row 0 took the whole merged
// height and rows 1 and 2 were added below it. The group is now planned like body merges, at
// the place each occurrence of the group is laid out, initial and repeated alike.
//
// Every line is 14pt, with no borders and no vertical cell margins, so each expected height is
// a line count.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type {
  PageGeometry,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
} from '../semantic-records.ts';
import {
  layoutUnderFloat,
  layoutWithoutFloat,
  loadBody,
  squareWrapZone,
} from './float-over-table-harness.ts';

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
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/><w:vAlign w:val="center"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';
const HEADER = '<w:tblHeader/><w:cantSplit/>';
const tblPr = (extra = '') =>
  `<w:tblPr>${extra}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>` +
  '<w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/><w:gridCol w:w="1800"/></w:tblGrid>';
const tr = (cells: string, trPr = '') => `<w:tr><w:trPr>${trPr}</w:trPr>${cells}</w:tr>`;

interface HeaderShape {
  /** Lines in the column-0 merged head. */
  readonly headLines?: number;
  /** Extra `w:trPr` content on every header row, e.g. an exact height. */
  readonly headerTrPr?: string;
  /** Body rows after the header, one line each. */
  readonly bodyRows?: number;
  /** Continue the column-0 merge into the first body row. */
  readonly mergeIntoBody?: boolean;
  readonly tblPrExtra?: string;
}

function headerTable({
  headLines = 3,
  headerTrPr = '',
  bodyRows = 2,
  mergeIntoBody = false,
  tblPrExtra = '',
}: HeaderShape = {}): string {
  const header = HEADER + headerTrPr;
  const body = Array.from({ length: bodyRows }, (_, index) =>
    tr(
      `${index === 0 && mergeIntoBody ? tc(p(''), CONTINUE) : tc(p(`a${index}`))}` +
        `${tc(p(`b${index}`))}${tc(p(`c${index}`))}`
    )
  ).join('');
  return (
    `<w:tbl>${tblPr(tblPrExtra)}` +
    tr(`${tc(lines('M', headLines), RESTART)}${tc(p('H0'))}${tc(p('Label'), RESTART)}`, header) +
    tr(`${tc(p(''), CONTINUE)}${tc(p('H1'))}${tc(p(''), CONTINUE)}`, header) +
    tr(`${tc(p(''), CONTINUE)}${tc(p('H2'))}${tc(p(''), CONTINUE)}`, header) +
    body +
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

function paintedText(layout: SemanticLayout): string {
  return layout.pages
    .flatMap((page) => page.fragments)
    .filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
    .flatMap((table) => table.rows)
    .flatMap((row) => row.cells)
    .flatMap((cell) => cell.blocks)
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((textLine) => textLine.spans)
    .map((span) => span.text)
    .join(' ');
}

describe('a vertical merge inside the header rows', () => {
  test('each header row keeps the height of its own cells', () => {
    const table = tablesOn(layoutOn(`${p('Lead')}${headerTable()}`), 0)[0]!;
    expect(rowHeights(table)).toEqual([14, 14, 14, 14, 14]);
    const head = table.rows[0]!.cells[0]!;
    expect(head.rowSpan).toBe(3);
    expect(head.box.height).toBe(3 * LINE_PT);
    // The one-line centered label sits in the middle of its merged cell.
    const label = table.rows[0]!.cells[2]!;
    expect(label.rowSpan).toBe(3);
    expect(label.blocks[0]!.box.y).toBe(label.box.y + LINE_PT);
    // The first body row starts where the planned header ends.
    expect(table.rows[3]!.box.y).toBe(table.box.y + 3 * LINE_PT);
    expectContentInsideItsTable(table);
  });

  test('a merged head taller than the header rows grows the last header row', () => {
    const table = tablesOn(layoutOn(`${p('Lead')}${headerTable({ headLines: 4 })}`), 0)[0]!;
    expect(rowHeights(table)).toEqual([14, 14, 28, 14, 14]);
    expect(table.rows[0]!.cells[0]!.box.height).toBe(4 * LINE_PT);
    expectContentInsideItsTable(table);
  });

  test('each repeated header copy is planned the same way', () => {
    // Ten lines per page: the lead line, three header rows and six body rows fill page 1.
    const layout = layoutOn(`${p('Lead')}${headerTable({ bodyRows: 12 })}`, 10 * LINE_PT);
    const first = tablesOn(layout, 0)[0]!;
    expect(rowHeights(first)).toEqual(Array.from({ length: 9 }, () => 14));
    const repeat = tablesOn(layout, 1)[0]!;
    expect(repeat.rows.slice(0, 3).every((row) => row.isHeaderRepeat === true)).toBe(true);
    expect(rowHeights(repeat)).toEqual(Array.from({ length: 9 }, () => 14));
    expect(repeat.rows[0]!.cells[0]!.rowSpan).toBe(3);
    expect(repeat.rows[0]!.cells[0]!.box.height).toBe(3 * LINE_PT);
    expect(repeat.rows[3]!.cells[0]!.blocks[0]?.kind).toBe('paragraph');
    for (const pageIndex of layout.pages.keys()) {
      for (const table of tablesOn(layout, pageIndex)) expectContentInsideItsTable(table);
    }
  });

  test('a merge that goes on into the body keeps sizing its own header row', () => {
    // The chain crosses the header/body boundary, so its head is never detached from the
    // header group: it sizes header row 0 exactly as before.
    const table = tablesOn(
      layoutOn(`${p('Lead')}${headerTable({ headLines: 5, mergeIntoBody: true })}`),
      0
    )[0]!;
    expect(table.rows[0]!.box.height).toBe(5 * LINE_PT);
    expectContentInsideItsTable(table);
  });

  test('exact header rows hold a merged head that fits them', () => {
    const exact = '<w:trHeight w:val="280" w:hRule="exact"/>';
    const table = tablesOn(
      layoutOn(`${p('Lead')}${headerTable({ headLines: 3, headerTrPr: exact })}`),
      0
    )[0]!;
    expect(rowHeights(table).slice(0, 3)).toEqual([14, 14, 14]);
    expect(table.rows[0]!.cells[0]!.box.height).toBe(3 * LINE_PT);
    expect(paintedText(layoutOn(headerTable({ headLines: 3, headerTrPr: exact })))).toContain('M2');
  });

  test('exact header rows too short for a merged head clip it in its own row', () => {
    // The one span shape the planner declines: its head keeps sizing its exact row.
    const exact = '<w:trHeight w:val="280" w:hRule="exact"/>';
    const table = tablesOn(
      layoutOn(`${p('Lead')}${headerTable({ headLines: 5, headerTrPr: exact })}`),
      0
    )[0]!;
    expect(rowHeights(table).slice(0, 3)).toEqual([14, 14, 14]);
  });

  test('a header group that fits only when planned stays a repeated header', () => {
    // Planned, the group is 5 lines on a 6-line page; unplanned it asked for 12 lines and
    // degraded into ordinary rows with no repeat.
    const layout = layoutOn(headerTable({ headLines: 5, bodyRows: 4 }), 6 * LINE_PT);
    expect(rowHeights(tablesOn(layout, 0)[0]!).slice(0, 3)).toEqual([14, 14, 42]);
    const repeat = tablesOn(layout, 1)[0]!;
    expect(repeat.rows[0]!.isHeaderRepeat).toBe(true);
    expect(rowHeights(repeat).slice(0, 3)).toEqual([14, 14, 42]);
  });

  test('a header group taller than a page still degrades into ordinary rows', () => {
    const layout = layoutOn(headerTable({ headLines: 9, bodyRows: 4 }), 6 * LINE_PT);
    const repeats = layout.pages
      .flatMap((_, pageIndex) => tablesOn(layout, pageIndex))
      .flatMap((table) => table.rows)
      .filter((row) => row.isHeaderRepeat === true);
    expect(repeats).toHaveLength(0);
    const painted = paintedText(layout);
    for (let index = 0; index < 9; index += 1) expect(painted).toContain(`M${index}`);
  });

  test('a merge nested in a header merge is sized with it', () => {
    // Column 0 merges header rows 0-2 and column 1 merges rows 1-2 inside it: one joint plan.
    const header = HEADER;
    const nested =
      `<w:tbl>${tblPr()}` +
      tr(`${tc(lines('M', 3), RESTART)}${tc(p('H0'))}${tc(p('c0'))}`, header) +
      tr(`${tc(p(''), CONTINUE)}${tc(lines('N', 3), RESTART)}${tc(p('c1'))}`, header) +
      tr(`${tc(p(''), CONTINUE)}${tc(p(''), CONTINUE)}${tc(p('c2'))}`, header) +
      tr(`${tc(p('a0'))}${tc(p('b0'))}${tc(p('c3'))}`) +
      '</w:tbl>';
    const table = tablesOn(layoutOn(`${p('Lead')}${nested}`), 0)[0]!;
    // The nested head needs three lines over two rows, so row 2 grows by one line; the outer
    // head then fits the four lines the rows give.
    expect(rowHeights(table)).toEqual([14, 14, 28, 14]);
    expect(table.rows[1]!.cells[1]!.box.height).toBe(3 * LINE_PT);
    expectContentInsideItsTable(table);
  });

  test('a body merge right below a merged header is admitted from the planned header', () => {
    const table =
      `<w:tbl>${tblPr()}` +
      tr(`${tc(lines('M', 3), RESTART)}${tc(p('H0'))}${tc(p('c0'))}`, HEADER) +
      tr(`${tc(p(''), CONTINUE)}${tc(p('H1'))}${tc(p('c1'))}`, HEADER) +
      tr(`${tc(p('a0'))}${tc(lines('B', 2), RESTART)}${tc(p('c2'))}`) +
      tr(`${tc(p('a1'))}${tc(p(''), CONTINUE)}${tc(p('c3'))}`) +
      '</w:tbl>';
    // Header 3 lines, body merge 2 lines: the table fills a 6-line page after the lead line.
    const layout = layoutOn(`${p('Lead')}${table}`, 6 * LINE_PT);
    const placed = tablesOn(layout, 0)[0]!;
    expect(rowHeights(placed)).toEqual([14, 28, 14, 14]);
    expect(placed.rows[2]!.cells[1]!.rowSpan).toBe(2);
    expect(tablesOn(layout, 1)).toHaveLength(0);
    expectContentInsideItsTable(placed);
  });

  test('a positioned table places its planned header at its own y', () => {
    const positioned =
      '<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="400" w:tblpY="1200"/>';
    const layout = layoutOn(`${p('Lead')}${headerTable({ tblPrExtra: positioned })}`);
    const table = tablesOn(layout, 0)[0]!;
    expect(rowHeights(table)).toEqual([14, 14, 14, 14, 14]);
    expect(table.rows[0]!.box.y).toBe(table.box.y);
    expect(table.rows[3]!.box.y).toBe(table.box.y + 3 * LINE_PT);
    expectContentInsideItsTable(table);
  });
});

describe('a merged header head under a wrap band', () => {
  const ROOMY: PageGeometry = {
    width: 300,
    height: 400,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const HEAD_TEXT = 'h0 h1 h2 h3 h4 h5 h6 h7 h8 h9';
  const body = (): string => {
    const header = '<w:trPr><w:tblHeader/></w:trPr>';
    return (
      `<w:p><w:r><w:t>F0</w:t></w:r></w:p><w:tbl>` +
      '<w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:type="dxa" w:w="108"/>' +
      '<w:right w:type="dxa" w:w="108"/></w:tblCellMar></w:tblPr>' +
      `<w:tr>${header}${tc(`<w:p><w:r><w:t>${HEAD_TEXT}</w:t></w:r></w:p>`, RESTART)}${tc('<w:p><w:r><w:t>s0</w:t></w:r></w:p>')}</w:tr>` +
      `<w:tr>${header}${tc('<w:p/>', CONTINUE)}${tc('<w:p><w:r><w:t>s1</w:t></w:r></w:p>')}</w:tr>` +
      `<w:tr>${tc('<w:p><w:r><w:t>a2</w:t></w:r></w:p>')}${tc('<w:p><w:r><w:t>b2</w:t></w:r></w:p>')}</w:tr>` +
      '</w:tbl>'
    );
  };

  for (const [top, height] of [
    [0, 45],
    [20, 30],
  ] as const) {
    test(`a band at y=${top} for ${height}pt keeps every word inside the table`, () => {
      const part = loadBody(body());
      const first = layoutWithoutFloat(part, ROOMY).pages[0]!.fragments[0]!;
      if (first.kind !== 'paragraph') throw new Error('expected a leading paragraph');
      // A text frame's band: cell text still wraps beside it. A picture's or a floating
      // table's band would move the rows below it instead (`table-float-collision.ts`).
      const band = {
        ...squareWrapZone({
          anchorParagraphId: first.paragraphId,
          top,
          height,
          left: 0,
          width: 100,
          contentWidth: 280,
        }),
        sourceKind: 'frame' as const,
      };
      const zones = new Map([[0, [band]]]);
      const layout = layoutUnderFloat(part, zones, ROOMY);
      const table = tablesOn(layout, 0)[0]!;
      // The band wraps the head to four lines where two fit without it. The head is measured
      // where it sits, so the header rows take that surplus and the body row follows them.
      const head = table.rows[0]!.cells[0]!;
      const headBlock = head.blocks[0]!;
      expect(headBlock.kind === 'paragraph' ? headBlock.lines.length : 0).toBe(4);
      expect(table.rows[0]!.box.height + table.rows[1]!.box.height).toBeCloseTo(head.box.height, 3);
      expect(table.rows[0]!.box.height).toBeLessThan(head.box.height / 2);
      expect(table.rows[2]!.box.y).toBeCloseTo(head.box.y + head.box.height, 3);
      expectContentInsideItsTable(table);
      const painted = paintedText(layout);
      for (const word of HEAD_TEXT.split(' ')) expect(painted).toContain(word);
    });
  }
});
