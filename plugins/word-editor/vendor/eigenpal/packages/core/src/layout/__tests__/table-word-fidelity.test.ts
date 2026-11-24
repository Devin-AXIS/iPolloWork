// Word-fidelity divergences in the table path: conditional-format precedence, the
// `w:tblLook` encodings, grid-column (not cell-index) structural conditions, an explicit
// `w:val="nil"` against an inherited interior rule, border conflict weight, and the two
// unbounded file-derived numbers in table geometry.
//
// Clause numbers are cited where the behaviour is spec-driven. Border conflict resolution
// is Word-matching only: ECMA-376 §17.4.39 (`w:tblBorders`) and §17.4.66 (`w:tcBorders`)
// describe the elements and say nothing about which of two adjacent cells wins.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
} from '../../store/package/ooxml-tree.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { MAX_TABLE_COLUMNS, readTableStructure } from '../semantic-table.ts';
import {
  borderWeight,
  resolveBorderConflict,
  resolveTableCellBorderGrid,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderSide,
} from '../table-borders.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout, TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/**
 * One style carrying a distinct mark for every conditional format we need to tell apart:
 * shading where a single winner is the question, a left border where two conditions must
 * BOTH survive.
 */
const CONDITIONAL_STYLE =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="table" w:styleId="Marked"><w:name w:val="Marked"/>' +
  '<w:tblStylePr w:type="firstRow"><w:tcPr><w:shd w:val="clear" w:fill="4472C4"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="lastRow"><w:tcPr><w:shd w:val="clear" w:fill="222222"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:fill="D9E2F3"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="band2Horz"><w:tcPr><w:shd w:val="clear" w:fill="EEEEEE"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="band1Vert"><w:tcPr><w:shd w:val="clear" w:fill="AAAAAA"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="band2Vert"><w:tcPr><w:shd w:val="clear" w:fill="BBBBBB"/></w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="firstCol"><w:tcPr>' +
  '<w:tcBorders><w:left w:val="single" w:sz="24" w:color="FF0000"/></w:tcBorders>' +
  '</w:tcPr></w:tblStylePr>' +
  '<w:tblStylePr w:type="lastCol"><w:tcPr>' +
  '<w:tcBorders><w:right w:val="single" w:sz="24" w:color="00FF00"/></w:tcBorders>' +
  '</w:tcPr></w:tblStylePr>' +
  '</w:style></w:styles>';

const cascade = () => buildStyleCascadeTable(part(CONDITIONAL_STYLE, '/word/styles.xml').root);

function tableNode(bodyXml: string): OoxmlElement {
  const document = part(
    `<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`,
    '/word/document.xml'
  );
  const found = document.root.children
    .flatMap((child) => (child.kind === 'textValue' ? [] : child.children))
    .find((child) => child.kind === 'table');
  if (!found) throw new Error('no table');
  return found as OoxmlElement;
}

const cell = (tcPr = '') => `<w:tc>${tcPr}<w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>`;

function structureOf(bodyXml: string) {
  return readTableStructure(tableNode(bodyXml), 468, 0, cascade())!;
}

const shadingGrid = (structure: ReturnType<typeof structureOf>) =>
  structure.rows.map((row) => row.cells.map((c) => c.shading));

describe('B3 — conditional formats apply in Word’s precedence, not bit order', () => {
  // ECMA-376 Part 1 §17.7.6: a table style's conditional formats are layered whole table < row bands <
  // column bands < first/last column < first/last row < corners.
  const ALL_ON =
    '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" ' +
    'w:noHBand="0" w:noVBand="0"/>';

  test('the header row beats the row band, and both columns rules still apply', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>${ALL_ON}</w:tblPr>` +
        `<w:tr>${cell()}${cell()}</w:tr><w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    const first = structure.rows[0]!.cells[0]!;
    expect(first.shading).toBe('4472C4');
    expect(first.borders.left).toMatchObject({ state: 'edge', color: 'FF0000' });
  });

  test('a column band paints over a row band where the two cross', () => {
    const structure = structureOf(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>${ALL_ON}</w:tblPr>` +
        `<w:tr>${cell()}${cell()}${cell()}</w:tr><w:tr>${cell()}${cell()}${cell()}</w:tr></w:tbl>`
    );
    // Row 1 is the first row band; column 1 is the first column band after the first column.
    expect(structure.rows[1]!.cells[1]!.shading).toBe('AAAAAA');
    expect(structure.rows[1]!.cells[2]!.shading).toBe('BBBBBB');
  });

  test('a stated w:cnfStyle adds no condition the look does not derive', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/><w:tblLook w:val="0600"/></w:tblPr>' +
        // firstRow (bit 0) and band1Horz (bit 6) stated on a row whose look has neither.
        `<w:tr><w:trPr><w:cnfStyle w:val="100000100000"/></w:trPr>${cell()}</w:tr>` +
        '</w:tbl>'
    );
    expect(structure.rows[0]!.cells[0]!.shading).toBeUndefined();
  });
});

describe('B13 — a missing w:tblLook is the same statement as an empty one', () => {
  // ECMA-376 Part 1 §17.4.55: with neither the named attributes nor `w:val`, the look is 04A0 — header row,
  // first column and row banding. `noHBand`/`noVBand` are negative flags.
  const rows = (count: number) =>
    Array.from({ length: count }, () => `<w:tr>${cell()}</w:tr>`).join('');

  test('absent and empty w:tblLook resolve identically to 04A0', () => {
    const absent = structureOf(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/></w:tblPr>${rows(3)}</w:tbl>`
    );
    const empty = structureOf(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/><w:tblLook/></w:tblPr>${rows(3)}</w:tbl>`
    );
    const legacy = structureOf(
      `<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/><w:tblLook w:val="04A0"/></w:tblPr>${rows(3)}</w:tbl>`
    );
    expect(shadingGrid(absent)).toEqual(shadingGrid(empty));
    expect(shadingGrid(absent)).toEqual(shadingGrid(legacy));
    expect(shadingGrid(absent).map((row) => row[0])).toEqual(['4472C4', 'D9E2F3', 'EEEEEE']);
  });

  test('named attributes the look leaves out read as on', () => {
    // firstRow and lastRow are missing, so both apply; noHBand turns row banding off.
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        `<w:tblLook w:noHBand="1" w:noVBand="1"/></w:tblPr>${rows(3)}</w:tbl>`
    );
    expect(shadingGrid(structure).map((row) => row[0])).toEqual(['4472C4', undefined, '222222']);
  });
});

describe('B14 — structural conditions key on the grid column, not the cell index', () => {
  const grid = (count: number) =>
    `<w:tblGrid>${'<w:gridCol w:w="1200"/>'.repeat(count)}</w:tblGrid>`;

  test('w:gridBefore moves the first cell off column 0, so firstCol does not apply', () => {
    // 17.4.14: `w:gridBefore` counts grid columns skipped before the row's first cell.
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        '<w:tblLook w:firstColumn="1" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
        grid(3) +
        `<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>${cell()}${cell()}</w:tr>` +
        `<w:tr>${cell()}${cell()}${cell()}</w:tr>` +
        '</w:tbl>'
    );
    // Row 2 starts at column 0 and keeps the firstCol rule; row 1 does not.
    expect(structure.rows[0]!.cells[0]!.borders.left.state).toBe('omitted');
    expect(structure.rows[1]!.cells[0]!.borders.left).toMatchObject({ state: 'edge' });
  });

  test('vertical banding follows the grid column across a gridSpan', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        '<w:tblLook w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" ' +
        'w:noHBand="1" w:noVBand="0"/></w:tblPr>' +
        grid(4) +
        '<w:tr>' +
        cell('<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>') +
        cell() +
        cell() +
        '</w:tr></w:tbl>'
    );
    // Grid columns 0-1, 2, 3 → odd, odd, even vertical bands.
    expect(shadingGrid(structure)[0]).toEqual(['AAAAAA', 'AAAAAA', 'BBBBBB']);
  });

  test('lastCol lands on the cell that reaches the last grid column', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        '<w:tblLook w:lastColumn="1" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
        grid(3) +
        `<w:tr>${cell()}${cell('<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>')}</w:tr>` +
        `<w:tr>${cell()}${cell()}<w:tc><w:tcPr/><w:p/></w:tc></w:tr>` +
        '</w:tbl>'
    );
    expect(structure.rows[0]!.cells[1]!.borders.right).toMatchObject({ state: 'edge' });
    expect(structure.rows[0]!.cells[0]!.borders.right.state).toBe('omitted');
  });

  test('w:gridAfter keeps lastCol off a row that stops short of the last column', () => {
    // 17.4.13: `w:gridAfter` counts grid columns after the row's last cell.
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        '<w:tblLook w:lastColumn="1" w:noHBand="1" w:noVBand="1"/></w:tblPr>' +
        grid(3) +
        `<w:tr><w:trPr><w:gridAfter w:val="1"/></w:trPr>${cell()}${cell()}</w:tr>` +
        '</w:tbl>'
    );
    expect(structure.rows[0]!.cells[1]!.borders.right.state).toBe('omitted');
  });

  test('a one-row table takes the header row, not the last row', () => {
    // The only row is the header block; a row in the block is never the last row.
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        `<w:tblLook w:firstRow="1" w:lastRow="1"/></w:tblPr><w:tr>${cell()}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.shading).toBe('4472C4');
  });

  test('a repeating last row takes the last row format only when the header row is off', () => {
    // 17.4.49 `w:tblHeader` on every row puts every row in the header block.
    const rows = Array.from(
      { length: 3 },
      () => `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell()}</w:tr>`
    ).join('');
    const lastRowOf = (look: string) =>
      structureOf(`<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>${look}</w:tblPr>${rows}</w:tbl>`)
        .rows[2]!.cells[0]!.shading;
    expect(lastRowOf('<w:tblLook w:firstRow="0" w:lastRow="1" w:noHBand="1"/>')).toBe('222222');
    expect(lastRowOf('<w:tblLook w:firstRow="1" w:lastRow="1" w:noHBand="1"/>')).toBe('4472C4');
  });

  test('a one-row table takes the last row when the header row is off', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr><w:tblStyle w:val="Marked"/>' +
        `<w:tblLook w:firstRow="0" w:lastRow="1"/></w:tblPr><w:tr>${cell()}</w:tr></w:tbl>`
    );
    expect(structure.rows[0]!.cells[0]!.shading).toBe('222222');
  });
});

// A cell's nil clears its OWN side only. The neighbour that inherits the interior rule keeps
// it: a column whose cells state `w:left w:val="nil"` beside a column that inherits
// `insideV` still shows the rule between them in the reference rendering.
describe('B11 — an explicit w:val="nil" clears only its own side of an interior rule', () => {
  const omitted: TableBorderSide = { state: 'omitted' };
  const none: TableBorderSide = { state: 'none' };
  const edge = (widthPt: number, color: string | null = null): TableBorderSide => ({
    state: 'edge',
    style: 'single',
    color,
    widthPt,
  });
  const box = (partial: Partial<CellBorderBox>): CellBorderBox => ({
    top: omitted,
    left: omitted,
    bottom: omitted,
    right: omitted,
    ...partial,
  });
  const tableWithInside: TableBorderBox = {
    top: omitted,
    left: omitted,
    bottom: omitted,
    right: omitted,
    insideH: edge(0.5),
    insideV: edge(0.5),
  };
  const gridCell = (borders: CellBorderBox, gridColumn = 0) => ({
    gridColumn,
    gridSpan: 1,
    vMergeContinue: false,
    borders,
    mergeRowSpan: 1,
  });

  test('nil on one cell keeps the insideH rule the neighbour inherits', () => {
    const resolved = resolveTableCellBorderGrid(
      [[gridCell(box({ bottom: none }))], [gridCell(box({}))]],
      tableWithInside,
      1
    );
    expect(resolved[0]![0]!.bottom).toMatchObject({ style: 'single', widthPt: 0.5 });
  });

  test('nil on one cell keeps the insideV rule the neighbour inherits', () => {
    const resolved = resolveTableCellBorderGrid(
      [[gridCell(box({ right: none })), gridCell(box({}), 1)]],
      tableWithInside,
      2
    );
    expect(resolved[0]![0]!.right).toMatchObject({ style: 'single', widthPt: 0.5 });
  });

  test('nil on both sides of a shared edge clears the inherited rule', () => {
    const resolved = resolveTableCellBorderGrid(
      [[gridCell(box({ right: none })), gridCell(box({ left: none }), 1)]],
      tableWithInside,
      2
    );
    expect(resolved[0]![0]!.right).toBeUndefined();
    expect(resolved[0]![1]!.left).toBeUndefined();
  });

  test('a neighbour that authors its own edge still wins over the nil', () => {
    const resolved = resolveTableCellBorderGrid(
      [[gridCell(box({ bottom: none }))], [gridCell(box({ top: edge(1, '123456') }))]],
      tableWithInside,
      1
    );
    expect(resolved[0]![0]!.bottom).toEqual({ style: 'single', color: '123456', widthPt: 1 });
  });
});

describe('B8 — border conflict uses Word weighted widths, then style precedence', () => {
  // Not a conformance rule: ECMA-376 Part 1 §17.4.39 and §17.4.66 specify no conflict algorithm.
  const edge = (
    style: 'single' | 'dashed' | 'dotted' | 'double',
    widthPt: number,
    color: string | null = null
  ): TableBorderSide => ({ state: 'edge', style, color, widthPt });

  test('a wide dashed rule retains weight one and loses to a quarter-point single', () => {
    expect(borderWeight(edge('dashed', 6))).toBeLessThan(borderWeight(edge('single', 0.25)));
    const winner = resolveBorderConflict(edge('dashed', 6, 'CC3333'), edge('single', 0.25));
    expect(winner).toMatchObject({ style: 'single', widthPt: 0.25 });
  });

  test('a half-point double outweighs a 1pt single', () => {
    const winner = resolveBorderConflict(edge('double', 0.5), edge('single', 1));
    expect(winner).toMatchObject({ style: 'double', widthPt: 0.5 });
  });

  test('style ranks the tie only at equal width', () => {
    const winner = resolveBorderConflict(edge('dashed', 1, 'CC3333'), edge('dotted', 1, '000000'));
    expect(winner).toMatchObject({ style: 'dashed' });
  });
});

describe('C1 — w:gridCol/@w:w is bounded like every sibling geometry read', () => {
  test('a hostile column width clamps instead of propagating into every box', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="999999999"/><w:gridCol w:w="1200"/>' +
        `</w:tblGrid><w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    expect(structure.columnWidthsPt[0]!).toBeLessThanOrEqual(31_680 / 20);
    expect(structure.columnWidthsPt[1]!).toBe(60);
  });

  test('a non-integer width is rejected the way w:tcMar rejects one', () => {
    const structure = structureOf(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1e12"/><w:gridCol w:w="-500"/>' +
        `</w:tblGrid><w:tr>${cell()}${cell()}</w:tr></w:tbl>`
    );
    // Both fall back to the even split over the declared column count.
    expect(structure.columnWidthsPt).toEqual([234, 234]);
  });
});

describe('C2 — a row’s total gridSpan is bounded, not just each cell’s', () => {
  test('thousands of maximum-span cells stay inside the grid ceiling', () => {
    const wide = cell('<w:tcPr><w:gridSpan w:val="1024"/></w:tcPr>').repeat(600);
    const xml = `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr/><w:tr>${wide}</w:tr></w:tbl></w:body></w:document>`;
    const documentPart = part(xml, '/word/document.xml');
    const started = performance.now();
    const result: SemanticLayout = layoutSemanticDocument(documentPart, 0, {
      measurer: createFixedMeasurer(),
    });
    expect(performance.now() - started).toBeLessThan(5000);
    const table = result.pages
      .flatMap((page) => page.fragments)
      .find((fragment): fragment is TableFragmentRecord => fragment.kind === 'table');
    expect(table).toBeDefined();
    for (const laidOut of table!.rows[0]!.cells) {
      expect(laidOut.gridColumn).toBeLessThan(MAX_TABLE_COLUMNS);
      expect(laidOut.gridColumn + laidOut.gridSpan).toBeLessThanOrEqual(MAX_TABLE_COLUMNS);
    }
  });
});
