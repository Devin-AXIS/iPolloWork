// Table-level shading (`w:tblPr/w:shd`) shows only in the cell-spacing gaps. Measured on
// reference renderings in compatibility modes 14 and 15: an unshaded cell of a shaded table
// shows what lies behind the table, with or without spacing; the gaps take the table's fill,
// the closing gap below the last row and at each page break included; a cell's own fill
// paints over it; and a row's `w:tblPrEx` fill replaces the table's around that row.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { tableSpacingShadingRegions } from '../table-spacing-shading.ts';
import type { TableFragmentRecord, TableRowFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const shd = (fill: string) => `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
const NIL = '<w:shd w:val="nil"/>';
const SPACING = '<w:tblCellSpacing w:w="100" w:type="dxa"/>';
const STYLES =
  `<w:style w:type="table" w:styleId="Green"><w:name w:val="Green"/>` +
  `<w:tblPr>${shd('C6EFCE')}</w:tblPr></w:style>`;

function read(name: string, xml: string) {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const cell = (text: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${tcPr}</w:tcPr>` +
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

function layoutTable(options: {
  readonly tblPr?: string;
  readonly style?: string;
  readonly rows?: readonly string[];
  readonly pageHeight?: number;
}): TableFragmentRecord[] {
  const rows = options.rows ?? [`<w:tr>${cell('a')}${cell('b')}</w:tr>`];
  const style = options.style ? `<w:tblStyle w:val="${options.style}"/>` : '';
  const document = read(
    '/word/document.xml',
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${style}` +
      `<w:tblW w:w="4000" w:type="dxa"/>${options.tblPr ?? ''}</w:tblPr><w:tblGrid>` +
      `<w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>${rows.join('')}</w:tbl>` +
      `<w:p/></w:body></w:document>`
  );
  const layout = layoutSemanticDocument(document, 0, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: buildStyleCascadeTable(
      read('/word/styles.xml', `<w:styles xmlns:w="${W}">${STYLES}</w:styles>`).root
    ),
    geometry: {
      width: 400,
      height: options.pageHeight ?? 400,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
  return layout.pages.flatMap((page) =>
    page.fragments.filter((fragment): fragment is TableFragmentRecord => fragment.kind === 'table')
  );
}

const fills = (rows: readonly TableRowFragmentRecord[]) =>
  rows.map((row) => row.spacingShading?.fill);

test('without cell spacing the table fill shows nowhere; a cell keeps its own', () => {
  const [table] = layoutTable({
    tblPr: shd('D9E2F3'),
    rows: [`<w:tr>${cell('table')}${cell('own', shd('FFE699'))}</w:tr>`],
  });
  expect(table!.rows[0]!.cells.map((c) => c.shading)).toEqual([undefined, 'FFE699']);
  expect(fills(table!.rows)).toEqual([undefined]);
  expect(tableSpacingShadingRegions(table!)).toEqual([]);
});

test('with cell spacing every row shows the table fill in its gaps, cells excluded', () => {
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('a')}${cell('b', shd('FFE699'))}</w:tr>`,
      `<w:tr>${cell('c')}${cell('d')}</w:tr>`,
    ],
  });
  expect(table!.rows[0]!.cells.map((c) => c.shading)).toEqual([undefined, 'FFE699']);
  expect(fills(table!.rows)).toEqual(['D9E2F3', 'D9E2F3']);
  // 100 twips of spacing is a 10pt gap; the table closes it below the last row, inside its box.
  const lastRow = table!.rows[1]!.box;
  expect(table!.box.y + table!.box.height).toBeCloseTo(lastRow.y + lastRow.height + 10, 6);
  // Rows of one fill and width share one band, so no seam shows where they meet.
  const regions = tableSpacingShadingRegions(table!);
  expect(regions).toHaveLength(1);
  const [band] = regions;
  expect(band!.box.y).toBe(table!.rows[0]!.box.y);
  expect(band!.box.y + band!.box.height).toBeCloseTo(table!.box.y + table!.box.height, 6);
  expect(band!.holes).toEqual(table!.rows.flatMap((row) => row.cells.map((c) => c.box)));
});

test('a row of another fill starts a band of its own', () => {
  const exception = '<w:tblPrEx><w:shd w:val="clear" w:color="auto" w:fill="FFC000"/></w:tblPrEx>';
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('a')}${cell('b')}</w:tr>`,
      `<w:tr>${exception}${cell('c')}${cell('d')}</w:tr>`,
      `<w:tr>${cell('e')}${cell('f')}</w:tr>`,
    ],
  });
  const regions = tableSpacingShadingRegions(table!);
  expect(regions.map((region) => region.fill)).toEqual(['D9E2F3', 'FFC000', 'D9E2F3']);
  for (const [index, region] of regions.entries())
    expect(region.box.y).toBe(table!.rows[index]!.box.y);
});

test('the cascade: style, then the table, then the row exception', () => {
  const cases: readonly [string, string, readonly (string | undefined)[]][] = [
    ['style alone', SPACING, ['C6EFCE']],
    ['the table over the style', SPACING + shd('D9E2F3'), ['D9E2F3']],
    ['nil leaves the style', SPACING + NIL, ['C6EFCE']],
    ['auto clears the style', SPACING + shd('auto'), [undefined]],
  ];
  for (const [label, tblPr, expected] of cases) {
    const [table] = layoutTable({ tblPr, style: 'Green' });
    expect([label, ...fills(table!.rows)]).toEqual([label, ...expected]);
  }
  const exception = (inner: string) =>
    `<w:tr><w:tblPrEx>${inner}</w:tblPrEx>${cell('r')}${cell('r')}</w:tr>`;
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('r')}${cell('r')}</w:tr>`,
      exception(shd('FF9999')),
      exception(NIL),
      exception(shd('auto')),
    ],
  });
  expect(fills(table!.rows)).toEqual(['D9E2F3', 'FF9999', 'D9E2F3', undefined]);
});

test('a file-supplied fill that is not hex never reaches a row', () => {
  const [table] = layoutTable({
    tblPr: SPACING + '<w:shd w:val="clear" w:fill="red;background:url(x)"/>',
  });
  expect(fills(table!.rows)).toEqual([undefined]);
});

test('a cell merged down stays a hole in the rows it crosses', () => {
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('m', '<w:vMerge w:val="restart"/>')}${cell('b')}</w:tr>`,
      `<w:tr>${cell('', '<w:vMerge/>')}${cell('d')}</w:tr>`,
    ],
  });
  const head = table!.rows[0]!.cells[0]!.box;
  const [band] = tableSpacingShadingRegions(table!);
  const second = table!.rows[1]!.box;
  // The head cell's part in the first row and in the second, and each row's own cell.
  expect(band!.holes).toContainEqual({
    x: head.x,
    y: second.y,
    width: head.width,
    height: head.y + head.height - second.y,
  });
  expect(band!.holes).toContainEqual(table!.rows[1]!.cells[1]!.box);
  expect(band!.holes).toHaveLength(4);
});

test('each part of a row split across pages closes with the gap the row closes with', () => {
  const tall = Array.from({ length: 12 }, (_, i) => `<w:p><w:r><w:t>line ${i}</w:t></w:r></w:p>`);
  const fragments = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${tall.join('')}</w:tc>${cell('b')}</w:tr>`,
    ],
    pageHeight: 100,
  });
  expect(fragments.length).toBeGreaterThan(1);
  const heights = fragments.map((fragment) => {
    const [region] = tableSpacingShadingRegions(fragment);
    return region!.box.height - fragment.rows[0]!.box.height;
  });
  // The table's last row: every part keeps the full 10pt gap below it, the page holding it.
  for (const extra of heights) expect(extra).toBeCloseTo(10, 6);
  for (const fragment of fragments)
    expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(100 + 1e-6);
});

test('a row band covers its own cells only, not columns skipped by gridBefore', () => {
  const [table] = layoutTable({
    tblPr: SPACING + shd('D9E2F3'),
    rows: [
      `<w:tr>${cell('a')}${cell('b')}</w:tr>`,
      `<w:tr><w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="2000" w:type="dxa"/></w:trPr>${cell('c')}</w:tr>`,
    ],
  });
  const [full, short] = tableSpacingShadingRegions(table!);
  expect(full!.box).toEqual(table!.rows[0]!.box);
  const own = table!.rows[1]!.cells[0]!.box;
  // The band starts one gap before the row's only cell and ends at the table edge.
  expect(short!.box.x).toBeCloseTo(own.x - 10, 6);
  expect(short!.box.x + short!.box.width).toBeCloseTo(
    table!.rows[1]!.box.x + table!.rows[1]!.box.width,
    6
  );
});

test('the closing gap never paints past the room below the last row', () => {
  const [first] = layoutTable({ tblPr: SPACING + shd('D9E2F3') });
  const rowBottom = first!.rows[0]!.box.y + first!.rows[0]!.box.height;
  // A page that ends 4pt below the row leaves 4pt of the 10pt closing gap.
  const [table] = layoutTable({ tblPr: SPACING + shd('D9E2F3'), pageHeight: rowBottom + 4 });
  const [region] = tableSpacingShadingRegions(table!);
  expect(region!.box.y + region!.box.height).toBeCloseTo(rowBottom + 4, 6);
});

test('a cell overlapping one merged down from above never turns back into fill', () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const cellAt = (id: string, b: ReturnType<typeof box>) =>
    ({
      id,
      box: b,
      gridColumn: 0,
      gridSpan: 1,
      vMergeContinue: false,
      rowSpan: 1,
      blocks: [],
    }) as never;
  const shaded = { fill: 'D9E2F3', gapPt: 10 };
  const rows = [
    // A defective layout: the merged cell of the first row reaches into a cell of the second.
    {
      ...{ id: 'r0', rowIndex: 0, isHeaderRow: false, isHeaderRepeat: false },
      spacingShading: shaded,
      box: box(0, 0, 100, 30),
      cells: [cellAt('m', box(10, 10, 50, 60))],
    },
    {
      ...{ id: 'r1', rowIndex: 1, isHeaderRow: false, isHeaderRepeat: false },
      spacingShading: shaded,
      box: box(0, 30, 100, 40),
      cells: [cellAt('b', box(40, 40, 50, 20))],
    },
  ] as TableRowFragmentRecord[];
  const [, second] = tableSpacingShadingRegions({ rows, box: box(0, 0, 100, 70) });
  // The second band starts one gap before its own cell, so the merged hole is cut there.
  expect(second!.holes).toEqual([box(30, 30, 30, 40)]);
});

test('a positioned spaced table holds its closing gap, so its last band fills it', () => {
  const position =
    '<w:tblpPr w:vertAnchor="page" w:horzAnchor="page" w:tblpX="1440" w:tblpY="2880"/>';
  const [table] = layoutTable({ tblPr: position + SPACING + shd('D9E2F3') });
  const last = table!.rows.at(-1)!.box;
  expect(table!.box.y + table!.box.height).toBeCloseTo(last.y + last.height + 10, 6);
  const [region] = tableSpacingShadingRegions(table!);
  expect(region!.box.y + region!.box.height).toBeCloseTo(last.y + last.height + 10, 6);
});

test("the last row's own fill shades the closing gap, and a cleared one leaves it blank", () => {
  // Measured: the closing gap below the table belongs to the last row's band.
  const lastRow = (fill: string) =>
    `<w:tr><w:tblPrEx>${shd(fill)}</w:tblPrEx>${cell('c')}${cell('d')}</w:tr>`;
  const first = `<w:tr>${cell('a')}${cell('b')}</w:tr>`;
  const shaded = layoutTable({ tblPr: SPACING + shd('D9E2F3'), rows: [first, lastRow('FFC000')] });
  const regions = tableSpacingShadingRegions(shaded[0]!);
  expect(regions.map((region) => region.fill)).toEqual(['D9E2F3', 'FFC000']);
  const box = shaded[0]!.box;
  expect(regions[1]!.box.y + regions[1]!.box.height).toBeCloseTo(box.y + box.height, 6);
  const cleared = layoutTable({ tblPr: SPACING + shd('D9E2F3'), rows: [first, lastRow('auto')] });
  expect(tableSpacingShadingRegions(cleared[0]!).map((region) => region.fill)).toEqual(['D9E2F3']);
});

test('a bottom-aligned positioned spaced table puts its closing gap, not its last row, on the margin', () => {
  // Measured: the outer box, gap included, ends on the bottom margin.
  const position = '<w:tblpPr w:vertAnchor="margin" w:horzAnchor="margin" w:tblpYSpec="bottom"/>';
  const [table] = layoutTable({ tblPr: position + SPACING + shd('D9E2F3') });
  const last = table!.rows.at(-1)!.box;
  expect(table!.box.y + table!.box.height).toBeCloseTo(400, 6);
  expect(last.y + last.height).toBeCloseTo(390, 6);
});

test('a nested spaced table broken between rows closes each page with the gap too', () => {
  const inner = (rows: number) =>
    '<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/>' +
    SPACING +
    shd('D9E2F3') +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' +
    Array.from({ length: rows }, (_, i) => `<w:tr>${cell(`n${i}`)}</w:tr>`).join('') +
    '</w:tbl><w:p/>';
  const outer = `<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr>${inner(12)}</w:tc></w:tr>`;
  const fragments = layoutTable({ rows: [outer], pageHeight: 150 });
  const nested = fragments.flatMap((fragment) =>
    fragment.rows.flatMap((row) =>
      row.cells.flatMap((c) =>
        c.blocks.filter((block): block is TableFragmentRecord => block.kind === 'table')
      )
    )
  );
  expect(nested.length).toBeGreaterThan(1);
  for (const fragment of nested) {
    const last = fragment.rows.at(-1)!.box;
    const extra = fragment.box.y + fragment.box.height - (last.y + last.height);
    expect(extra).toBeGreaterThan(0);
    const band = tableSpacingShadingRegions(fragment).at(-1)!;
    expect(band.box.y + band.box.height).toBeCloseTo(fragment.box.y + fragment.box.height, 6);
  }
});

test('a table broken between rows closes each page with the spacing, and its end with the gap', () => {
  const rows = Array.from(
    { length: 12 },
    (_, i) => `<w:tr>${cell(`r${i}`)}${cell(`r${i}`)}</w:tr>`
  );
  const fragments = layoutTable({ tblPr: SPACING + shd('D9E2F3'), rows, pageHeight: 150 });
  expect(fragments.length).toBeGreaterThan(1);
  for (const fragment of fragments) {
    const last = fragment.rows.at(-1)!.box;
    const extra = fragment.box.y + fragment.box.height - (last.y + last.height);
    // With no frame, a page break leaves the 5pt spacing; the table's end the 10pt gap. A row
    // that ends a page keeps that room, so the page always holds it.
    expect(extra).toBeCloseTo(fragment === fragments.at(-1) ? 10 : 5, 6);
    expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(150 + 1e-6);
    const band = tableSpacingShadingRegions(fragment).at(-1)!;
    expect(band.box.y + band.box.height).toBeCloseTo(fragment.box.y + fragment.box.height, 6);
  }
});
