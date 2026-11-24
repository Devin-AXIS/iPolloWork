import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { fitColumnsAboveMinimums } from '../table-column-fit.ts';

// Column widths measured in reference renders of the same tables (modes 11, 14 and 15).
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const dxa = (twips: number) => `<w:tcW w:w="${twips}" w:type="dxa"/>`;
const cell = (width = '') =>
  `<w:tc><w:tcPr>${width}</w:tcPr><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc>`;
const skip = (twips: number) =>
  `<w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="${twips}" w:type="dxa"/></w:trPr>`;

/** Cell boxes `[x, width]` of each row of one table, in points, in a 432pt text column. */
function rows(grid: number[], tblPr: string, trs: string, mode = 15): number[][][] {
  const cols = grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tblPr}</w:tblPr>` +
      `<w:tblGrid>${cols}</w:tblGrid>${trs}</w:tbl><w:p/><w:sectPr>` +
      '<w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: mode,
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows.map((row) =>
    row.cells.map((c) => [Math.round(c.box.x * 100) / 100, Math.round(c.box.width * 100) / 100])
  );
}

const widths = (table: number[][][]) => table.map((row) => row.map(([, width]) => width));

test('a stated width stretches a narrower grid, autofit and fixed', () => {
  const tblW = '<w:tblW w:w="8640" w:type="dxa"/>';
  for (const layout of ['', '<w:tblLayout w:type="fixed"/>']) {
    expect(widths(rows([1684], tblW + layout, `<w:tr>${cell()}</w:tr>`))).toEqual([[432]]);
    const two = rows(
      [1684, 1684],
      tblW + layout,
      `<w:tr>${cell(dxa(1684))}${cell(dxa(1684))}</w:tr>`
    );
    expect(widths(two)).toEqual([[216, 216]]);
  }
});

test('a cell width replaces the grid width of its column', () => {
  const pair = `<w:tr>${cell(dxa(1684))}${cell(dxa(1684))}</w:tr>`;
  for (const tblPr of [
    '<w:tblW w:w="0" w:type="auto"/>',
    '<w:tblW w:w="3368" w:type="dxa"/>',
    '<w:tblW w:w="3368" w:type="dxa"/><w:tblLayout w:type="fixed"/>',
  ]) {
    expect(widths(rows([1000, 2368], tblPr, pair))).toEqual([[84.2, 84.2]]);
  }
});

test('a fixed table narrower than its grid takes from each column above its margins', () => {
  const tblPr =
    '<w:tblW w:w="3000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
  const [[a, b]] = widths(
    rows([1000, 3000], tblPr, `<w:tr>${cell(dxa(1000))}${cell(dxa(3000))}</w:tr>`)
  );
  // Not 37.5/112.5: each column keeps its 10.8pt of cell margins.
  expect(a).toBeCloseTo(39.01, 1);
  expect(b).toBeCloseTo(110.99, 1);
});

test('columns give way above their minimums and grow in proportion', () => {
  expect(fitColumnsAboveMinimums([50, 150], 150, [10.8, 10.8])).toEqual([
    50 - (50 * 39.2) / 178.4,
    150 - (50 * 139.2) / 178.4,
  ]);
  expect(fitColumnsAboveMinimums([50, 150], 300, [10.8, 10.8])).toEqual([75, 225]);
  // Past every minimum, the minimums scale down together.
  expect(fitColumnsAboveMinimums([50, 150], 10, [10, 10])).toEqual([5, 5]);
});

test('a spaced cell next to skipped grid columns sits the spacing further in', () => {
  const tblPr = '<w:tblW w:w="4000" w:type="dxa"/><w:tblCellSpacing w:w="100" w:type="dxa"/>';
  const [full, skipped] = rows(
    [2000, 2000],
    tblPr,
    `<w:tr>${cell(dxa(2000))}${cell(dxa(2000))}</w:tr><w:tr>${skip(2000)}${cell(dxa(2000))}</w:tr>` +
      `<w:tr>${cell(dxa(2000))}</w:tr>`
  ).map((row) => row);
  const short = rows(
    [2000, 2000],
    tblPr,
    `<w:tr>${cell(dxa(2000))}${cell(dxa(2000))}</w:tr><w:tr>${cell(dxa(2000))}</w:tr>`
  )[1]!;
  expect(skipped![0]![0]).toBeCloseTo(full![1]![0]! + 5, 5);
  expect(skipped![0]![1]).toBeCloseTo(full![1]![1]! - 5, 5);
  // A row that ends early gives up the spacing after its last cell.
  expect(short[0]![0]).toBeCloseTo(full![0]![0]!, 5);
  expect(short[0]![1]).toBeCloseTo(full![0]![1]! - 5, 5);
});

test('equal outer rules on equal columns leave each cell the same frame part', () => {
  const thick = ['top', 'left', 'bottom', 'right']
    .map((side) => `<w:${side} w:val="single" w:sz="48" w:space="0" w:color="000000"/>`)
    .join('');
  const tblPr =
    '<w:tblW w:w="4800" w:type="dxa"/><w:tblCellSpacing w:w="20" w:type="dxa"/>' +
    `<w:tblBorders>${thick}</w:tblBorders>`;
  const long = `<w:tc><w:tcPr>${dxa(2400)}</w:tcPr><w:p><w:r><w:t>wwwwww</w:t></w:r></w:p></w:tc>`;
  const [[a, b]] = widths(rows([2400, 2400], tblPr, `<w:tr>${long}${cell(dxa(2400))}</w:tr>`));
  // Each outer column holds its 6pt rule; only the 6pt of spacing gives way above minimums.
  expect(a! + b!).toBeCloseTo(222, 5);
  expect(a! - b!).toBeLessThan(6);
  expect(a!).toBeGreaterThan(b!);
});

test('a reversed row finds its skipped columns by grid position', () => {
  const tblPr =
    '<w:tblW w:w="4800" w:type="dxa"/><w:bidiVisual/><w:tblCellSpacing w:w="100" w:type="dxa"/>';
  const [[first, second]] = rows(
    [2400, 2400],
    tblPr,
    `<w:tr>${cell(dxa(2400))}${cell(dxa(2400))}</w:tr>`
  );
  expect(first![1]).toBeCloseTo(105, 5);
  expect(second![1]).toBeCloseTo(105, 5);
});

test('a spaced table without a width keeps its cell widths and grows by its gaps', () => {
  const tblPr = '<w:tblCellSpacing w:w="100" w:type="dxa"/><w:tblLayout w:type="fixed"/>';
  const trs = `<w:tr>${cell(dxa(1000))}${cell(dxa(2000))}${cell(dxa(1000))}</w:tr>`;
  expect(widths(rows([1000, 2000, 1000], tblPr, trs))).toEqual([[50, 100, 50]]);
});

test('skipped leading columns place a table that states no indent', () => {
  const trs = `<w:tr>${skip(1684)}${cell(dxa(1868))}</w:tr><w:tr>${skip(1684)}${cell(dxa(1868))}</w:tr>`;
  const [[first]] = rows([1684, 1868], '<w:tblW w:w="0" w:type="auto"/>', trs);
  expect(first![0]).toBeCloseTo(84.2, 5);
  expect(first![1]).toBeCloseTo(93.4, 5);
  const [[indented]] = rows(
    [1684, 1868],
    '<w:tblW w:w="0" w:type="auto"/><w:tblInd w:w="0" w:type="dxa"/>',
    trs
  );
  expect(indented![0]).toBeCloseTo(0, 5);
});

const word = (text: string, width = '') =>
  `<w:tc><w:tcPr>${width}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const spanning = (twips: number, span: number) =>
  `<w:tc><w:tcPr>${dxa(twips)}<w:gridSpan w:val="${span}"/></w:tcPr><w:p/></w:tc>`;

test('a span wider than the cells its rows state widens the last column it spans', () => {
  const trs = `<w:tr>${spanning(8000, 3)}</w:tr><w:tr>${cell(dxa(2000)).repeat(3)}</w:tr>`;
  const grid = [2000, 2000, 2000];
  expect(widths(rows(grid, '<w:tblW w:w="8000" w:type="dxa"/>', trs))[1]).toEqual([100, 100, 200]);
  // Under a narrower width the columns then give way above their 6.45pt content minimums.
  const [a, b, c] = widths(rows(grid, '<w:tblW w:w="6000" w:type="dxa"/>', trs))[1]!;
  expect(a).toBeCloseTo(100 - (100 * (100 - 6.4545)) / (400 - 3 * 6.4545), 1);
  expect(b).toBeCloseTo(a!, 5);
  expect(c).toBeCloseTo(200 - (100 * (200 - 6.4545)) / (400 - 3 * 6.4545), 1);
});

test('columns content widens past a stretching width keep the widths their cells state', () => {
  // 400pt of cells stretch to a 500pt width past the 432pt text column, and a 491.9pt word
  // widens the table past that width. Measured past the text column: the columns only a
  // span covers keep their stated 200pt instead of the stretched 250pt.
  const end = '<w:trPr><w:gridAfter w:val="1"/><w:wAfter w:w="2000" w:type="dxa"/></w:trPr>';
  const row = `<w:tr>${end}${word('w'.repeat(90), dxa(4000))}${spanning(4000, 2)}</w:tr>`;
  const grid = [4000, 2000, 2000, 2000];
  const [[a, b]] = widths(rows(grid, '<w:tblW w:w="10000" w:type="dxa"/>', row + row));
  expect(a).toBeCloseTo(491.91, 1);
  expect(b).toBeCloseTo(200, 5);
});

/** The nested table's box `[x, width]`, then its cell boxes, in the first outer cell. */
function nestedRows(inner: string, mode: number): number[][][] {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/>` +
      `</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr>${dxa(3000)}` +
      `</w:tcPr>${inner}<w:p/></w:tc></w:tr></w:tbl><w:p/><w:sectPr>` +
      '<w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    compatibilityMode: mode,
  });
  const outer = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const table = outer.rows[0]!.cells[0]!.blocks.find(
    (block): block is TableFragmentRecord => block.kind === 'table'
  )!;
  return [
    [[table.box.x, table.box.width]],
    ...table.rows.map((row) =>
      row.cells.map((c) => [Math.round(c.box.x * 100) / 100, Math.round(c.box.width * 100) / 100])
    ),
  ];
}

test('a nested autofit table refits its stated widths above content minimums in mode 15 only', () => {
  const inner =
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>' +
    '<w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr>${word('w'.repeat(10), dxa(3000))}${cell(dxa(3000))}</w:tr></w:tbl>`;
  const [, [modern0, modern1]] = nestedRows(inner, 15).map((row) => row.map(([, w]) => w));
  expect(modern0! - modern1!).toBeGreaterThan(20);
  // Measured in mode 0: the legacy nested table keeps its stated proportions.
  const [, [legacy0, legacy1]] = nestedRows(inner, 12).map((row) => row.map(([, w]) => w));
  expect(legacy0).toBeCloseTo(legacy1!, 5);
});

test('skipped leading columns do not move a nested table', () => {
  const inner = (grid: string, trPr: string) =>
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}` +
    `<w:gridCol w:w="1000"/></w:tblGrid><w:tr>${trPr}${cell(dxa(1000))}</w:tr></w:tbl>`;
  const [[plain]] = nestedRows(inner('', ''), 15);
  const [[skipped]] = nestedRows(inner('<w:gridCol w:w="1000"/>', skip(1000)), 15);
  expect(skipped![0]).toBeCloseTo(plain![0]!, 5);
});

const indented = (text: string, width: string) =>
  `<w:tc><w:tcPr>${width}</w:tcPr><w:p><w:pPr><w:ind w:firstLine="360"/></w:pPr>` +
  (text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : '') +
  '</w:p></w:tc>';

const empty = (width: string) => `<w:tc><w:tcPr>${width}</w:tcPr><w:p/></w:tc>`;
const MARGINS =
  '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';

test('the first-line indent of an empty paragraph does not widen its column', () => {
  // Measured in modes 0, 14 and 15: the 105-twip column takes its cell margins, not the indent.
  const grid = [2000, 942, 1466, 105, 117, 105];
  const first = [cell(dxa(2000)), empty(dxa(942)), cell(dxa(1466)), indented('', dxa(105))];
  const trs =
    `<w:tr>${first.join('')}${empty(dxa(117))}${empty(dxa(105))}</w:tr>` +
    `<w:tr>${grid.map((w) => empty(dxa(w))).join('')}</w:tr>`;
  for (const mode of [0, 14, 15]) {
    const [[, , , narrow]] = widths(
      rows(grid, `<w:tblW w:w="4735" w:type="dxa"/>${MARGINS}`, trs, mode)
    );
    expect(narrow).toBeLessThan(11.1);
  }
});

test('only a column that widens itself keeps the first-line indent after leading spaces', () => {
  // Measured in mode 15 in a table wider than its text column: the 942-twip column widens to
  // the word plus the indent; the 1466-twip column holding the same text does not.
  const text = '  6,746,091';
  const [[, wide, kept]] = widths(
    rows(
      [6400, 1599, 1466],
      `<w:tblW w:w="8808" w:type="dxa"/>${MARGINS}`,
      `<w:tr>${cell(dxa(6400))}${indented(text, dxa(942))}${indented(text, dxa(1466))}</w:tr>`
    )
  );
  const withIndent = (9 * 60) / 11 + 18 + 10.8;
  expect(wide).toBeCloseTo(withIndent, 1);
  // The other column may give way down to the word without the indent.
  expect(kept).toBeLessThan(withIndent - 5);
  expect(kept).toBeGreaterThanOrEqual((9 * 60) / 11 + 10.8);
});

test('a stretching width stretches each column from its stated width or its minimum', () => {
  // Measured in modes 14 and 15 (563.15pt table, 942-twip column holding "6,746,091"): the
  // column takes its share of the stretch from its minimum, not just its minimum.
  const grid = [3686, 1599, 1466, 1466];
  const stretch = (text: string, mode: number) =>
    widths(
      rows(
        grid,
        `<w:tblW w:w="11263" w:type="dxa"/>${MARGINS}`,
        `<w:tr>${cell(dxa(3686))}${indented(text, dxa(942))}${cell(dxa(1466))}${cell(dxa(1466))}</w:tr>`,
        mode
      )
    )[0]!;
  const word = (9 * 60) / 11 + 10.8;
  const share = (minimum: number) => (minimum * 563.15) / (184.3 + minimum + 2 * 73.3);
  // Mode 15 counts the first-line indent unless spaces open the paragraph; mode 14 never does.
  expect(stretch('6,746,091 ', 15)[1]).toBeCloseTo(share(word + 18), 1);
  expect(stretch('  6,746,091 ', 15)[1]).toBeCloseTo(share(word), 1);
  expect(stretch('6,746,091 ', 14)[1]).toBeCloseTo(share(word), 1);
});
