// Column widths of a spaced table whose outer rules differ from side to side. Expected numbers
// follow the measured rule: the first column holds its left rule band less the inside rule,
// the last its right rule band less the inside rule, the columns fit the width with those
// parts, and the rest of the frame, half the left band less half the right one, lies outside
// a stated absolute width.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { fitColumnsAboveMinimums, fitColumnsHoldingFrame } from '../table-column-fit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PAGE_WIDTH = 400;

const rule = (side: string, size: number) =>
  `<w:${side} w:val="single" w:sz="${size}" w:space="0" w:color="000000"/>`;
/** Outer rules in eighths of a point; 0.5pt top, bottom and inside rules. */
const borders = (left: number, right: number) =>
  `<w:tblBorders>${rule('top', 4)}${rule('left', left)}${rule('bottom', 4)}${rule('right', right)}` +
  `${rule('insideH', 4)}${rule('insideV', 4)}</w:tblBorders>`;
const NO_MARGINS =
  '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
const FIXED = '<w:tblLayout w:type="fixed"/>';
const cell = (twips: number, trPr = '') =>
  `${trPr}<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc>`;

/** The first table fragment of a one-table document on a 400pt page without margins. */
function layoutTable(
  grid: readonly number[],
  tblPr: string,
  rows: readonly string[] = [`<w:tr>${grid.map((twips) => cell(twips)).join('')}</w:tr>`],
  compatibilityMode = 15
): TableFragmentRecord {
  const cols = grid.map((twips) => `<w:gridCol w:w="${twips}"/>`).join('');
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tblPr}</w:tblPr>` +
      `<w:tblGrid>${cols}</w:tblGrid>${rows.join('')}</w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: {
      width: PAGE_WIDTH,
      height: 400,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    compatibilityMode,
  });
  return layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
}

const widths = (table: TableFragmentRecord, rowIndex = 0) =>
  table.rows[rowIndex]!.cells.map((c) => c.box.width);
const lefts = (table: TableFragmentRecord, rowIndex = 0) =>
  table.rows[rowIndex]!.cells.map((c) => c.box.x - table.box.x);

const tblPr = (width: string, left: number, right: number, extra = '') =>
  `${width}<w:tblCellSpacing w:w="100" w:type="dxa"/>${borders(left, right)}${extra}${NO_MARGINS}`;
const dxa = (twips: number) => `<w:tblW w:w="${twips}" w:type="dxa"/>`;

test('outer columns hold their own frame part while the columns fit the width', () => {
  // 6pt left rule, 0.5pt right and inside rules: the first column holds 5.5pt, the last none.
  // The columns fit 260pt with those parts above a 5.5pt minimum, then give the part back.
  const cells = fitColumnsHoldingFrame([50, 100, 150], 254.5, [0, 0, 0], {
    leadPt: 5.5,
    trailPt: 0,
    outsidePt: 2.75,
    rightBandPt: 0.5,
  });
  const columns = fitColumnsAboveMinimums([50, 100, 150], 260, [5.5, 0, 0]);
  expect(cells[0]).toBeCloseTo(columns[0]! - 5.5, 6);
  expect(cells[1]).toBeCloseTo(columns[1]!, 6);
  expect(cells[2]).toBeCloseTo(columns[2]!, 6);
  expect(cells[0]).toBeCloseTo(38.46, 2);
  expect(cells[1]).toBeCloseTo(86.42, 2);
  expect(cells[2]).toBeCloseTo(129.63, 2);
  // Without parts the columns fit as they are.
  expect(fitColumnsHoldingFrame([50, 150], 150, [0, 0], undefined)).toEqual(
    fitColumnsAboveMinimums([50, 150], 150, [0, 0])
  );
});

test('a thick left rule narrows the first cell and widens the table by half the difference', () => {
  const table = layoutTable([1000, 2000, 3000], tblPr(dxa(6000), 48, 4, FIXED));
  const [a, b, c] = widths(table);
  expect(a).toBeCloseTo(38.46, 2);
  expect(b).toBeCloseTo(86.42, 2);
  expect(c).toBeCloseTo(129.63, 2);
  // 300pt plus half of 6pt less half of 0.5pt.
  expect(table.box.width).toBeCloseTo(302.75, 6);
  // The insets keep their measured places: 2s + 1.5 × 6 - 0.5 from the left edge.
  expect(lefts(table)[0]).toBeCloseTo(18.5, 6);
});

test('a thick right rule narrows the last cell and the table loses half the difference', () => {
  const table = layoutTable([1000, 2000, 3000], tblPr(dxa(6000), 4, 48, FIXED));
  const [a, b, c] = widths(table);
  // Columns fit 260pt with 5.5pt held by the last column.
  const columns = fitColumnsAboveMinimums([50, 100, 150], 260, [0, 0, 5.5]);
  expect(a).toBeCloseTo(columns[0]!, 6);
  expect(b).toBeCloseTo(columns[1]!, 6);
  expect(c).toBeCloseTo(columns[2]! - 5.5, 6);
  expect(table.box.width).toBeCloseTo(297.25, 6);
});

test('equal thick rules stay with the outer cells instead of every column', () => {
  const table = layoutTable([1000, 2000, 3000], tblPr(dxa(6000), 48, 48, FIXED));
  const [a, b, c] = widths(table);
  const columns = fitColumnsAboveMinimums([50, 100, 150], 260, [5.5, 0, 5.5]);
  expect(a).toBeCloseTo(columns[0]! - 5.5, 6);
  expect(b).toBeCloseTo(columns[1]!, 6);
  expect(c).toBeCloseTo(columns[2]! - 5.5, 6);
  expect(table.box.width).toBeCloseTo(300, 6);
});

test('a stated width that stretches the grid grows each column with its part', () => {
  const table = layoutTable([2000, 2000], tblPr(dxa(5000), 48, 4, FIXED));
  const [a, b] = widths(table);
  expect(a).toBeCloseTo(104.5, 6);
  expect(b).toBeCloseTo(110, 6);
});

test('without a table width the first cell gives its stated width the frame part', () => {
  const table = layoutTable([2000, 2000], tblPr('<w:tblW w:w="0" w:type="auto"/>', 48, 4, FIXED));
  const [a, b] = widths(table);
  expect(a).toBeCloseTo(94.5, 6);
  expect(b).toBeCloseTo(100, 6);
});

const PCT = '<w:tblW w:w="2500" w:type="pct"/>';
const jc = (value: string) => `<w:jc w:val="${value}"/>`;

test('a percentage width is the outer extent of the frame, right rule included', () => {
  const thickLeft = layoutTable([2000, 2000], tblPr(PCT, 48, 4, FIXED));
  const thickRight = layoutTable([2000, 2000], tblPr(PCT, 4, 48, FIXED));
  // 50% of the page less the 3.25pt mean side rule, plus that rule: 201.625pt. The right rule
  // draws outward from the box.
  expect(thickLeft.box.width).toBeCloseTo(201.625 - 0.5, 6);
  expect(thickRight.box.width).toBeCloseTo(201.625 - 6, 6);
  // The first column still holds its part: it gives way above that part, not in proportion.
  const [a, b] = widths(thickLeft);
  expect(b! - a!).toBeGreaterThan(4);
  expect(b! - a!).toBeLessThan(5.5);
});

test('legacy modes widen a spaced percentage by its frame and move it out by half the left rule', () => {
  for (const [left, right, x, box] of [
    // 50% of 400pt + 4 x 5pt spacing + two 0.5pt margins + 6.5pt of rules, plus half the rules.
    [48, 4, -3, 217 - 0.5],
    [4, 48, -0.25, 217 - 6],
  ] as const) {
    const table = layoutTable([2000, 2000], tblPr(PCT, left, right, FIXED), undefined, 14);
    expect(table.box.x).toBeCloseTo(x, 6);
    expect(table.box.width).toBeCloseTo(box, 6);
  }
  // A stated indent aligns the first cell's content with the text edge instead, as an
  // absolute width does.
  const indented = (width: string) =>
    layoutTable(
      [2000, 2000],
      `${width}<w:tblCellSpacing w:w="100" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>` +
        `${borders(48, 4)}${FIXED}${NO_MARGINS}`,
      undefined,
      14
    ).rows[0]!.cells[0]!.box.x;
  expect(indented(PCT)).toBeCloseTo(indented(dxa(4000)), 6);
  expect(indented(PCT)).toBeLessThan(1);
});

test('a legacy spaced percentage reads the margins of its outer cells and may overhang the text', () => {
  const margins =
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';
  const withMargins = layoutTable(
    [2000, 2000],
    `${PCT}<w:tblCellSpacing w:w="100" w:type="dxa"/>${borders(4, 48)}${FIXED}${margins}`,
    undefined,
    14
  );
  // 50% of (400 + 20 + 5.4 + 5.4 + 6.5) + 3.25, less the 6pt right rule.
  expect(withMargins.box.width).toBeCloseTo(218.65 + 3.25 - 6, 6);
  // Equal 0.5pt rules at 100%: 400 + 20 + 1 + 1 + 0.5pt wide, the frame centred on the page.
  const full = layoutTable(
    [2000, 2000],
    tblPr('<w:tblW w:w="5000" w:type="pct"/>' + jc('center'), 4, 4, FIXED),
    undefined,
    14
  );
  expect(full.box.width).toBeCloseTo(422.5 - 0.5, 6);
  // The rule centres sit 0.25pt inside the box on the left and 0.25pt past it on the right.
  expect(full.box.x + 0.25 + full.box.width / 2).toBeCloseTo(PAGE_WIDTH / 2, 6);
  expect(full.box.x).toBeLessThan(-10);
});

test('equal 0.5pt rules move a spaced table by half or a whole rule', () => {
  const at = (align: string, mode: number) =>
    layoutTable([2000, 2000], tblPr(dxa(4000) + jc(align), 4, 4, FIXED), undefined, mode).box;
  // Mode 15: the frame, right rule included, is centred or ends at the margin.
  expect(at('center', 15).x).toBeCloseTo((PAGE_WIDTH - at('center', 15).width) / 2 - 0.25, 6);
  expect(at('right', 15).x + at('right', 15).width).toBeCloseTo(PAGE_WIDTH - 0.5, 6);
  // Legacy: the rules' centres are centred.
  expect(at('center', 14).x).toBeCloseTo((PAGE_WIDTH - at('center', 14).width) / 2 - 0.25, 6);
  // A mode outside both classes takes the mode-15 geometry, as its percentage width does.
  expect(at('right', 0).x).toBeCloseTo(at('right', 15).x, 6);
});

test('mode 15 aligns the outer edges of the frame rules', () => {
  for (const width of [PCT, dxa(4000)]) {
    for (const [left, right] of [
      [48, 4],
      [4, 48],
    ] as const) {
      const rightPt = right / 8;
      const centred = layoutTable([2000, 2000], tblPr(width + jc('center'), left, right, FIXED));
      // The box leaves out the right rule, which draws outward; the whole frame is centred.
      expect(centred.box.x + (centred.box.width + rightPt) / 2).toBeCloseTo(PAGE_WIDTH / 2, 6);
      const trailing = layoutTable([2000, 2000], tblPr(width + jc('right'), left, right, FIXED));
      expect(trailing.box.x + trailing.box.width + rightPt).toBeCloseTo(PAGE_WIDTH, 6);
    }
  }
  // A centred right-to-left table also moves by a quarter of its visual left rule, `w:right`.
  const bidi = layoutTable(
    [2000, 2000],
    '<w:bidiVisual/>' + tblPr(dxa(4000) + jc('center'), 4, 48, FIXED)
  );
  expect(bidi.box.x + (bidi.box.width + 0.5) / 2).toBeCloseTo(PAGE_WIDTH / 2 - 6 / 4, 6);
});

test("legacy modes centre the rules' centres and end trailing content past the edge by the parts' difference", () => {
  for (const [left, right] of [
    [48, 4],
    [4, 48],
  ] as const) {
    const [leftPt, rightPt] = [left / 8, right / 8];
    const centred = layoutTable(
      [2000, 2000],
      tblPr(dxa(4000) + jc('center'), left, right, FIXED),
      undefined,
      14
    );
    const centres = [centred.box.x + leftPt / 2, centred.box.x + centred.box.width + rightPt / 2];
    expect((centres[0]! + centres[1]!) / 2).toBeCloseTo(PAGE_WIDTH / 2, 6);
    for (const width of [PCT, dxa(4000)]) {
      const trailing = layoutTable(
        [2000, 2000],
        tblPr(width + jc('right'), left, right, FIXED),
        undefined,
        14
      );
      const last = trailing.rows[0]!.cells[1]!.box;
      // The first column's part less the last column's, past the 0.5pt inside rule.
      expect(last.x + last.width).toBeCloseTo(PAGE_WIDTH + 0.5 + (leftPt - rightPt), 6);
    }
  }
});

test('a row after skipped leading columns moves its first cell in by the left part too', () => {
  const skip = '<w:trPr><w:gridBefore w:val="1"/><w:wBefore w:w="1000" w:type="dxa"/></w:trPr>';
  const table = layoutTable([1000, 2000, 3000], tblPr(dxa(6000), 48, 4, FIXED), [
    `<w:tr>${cell(1000)}${cell(2000)}${cell(3000)}</w:tr>`,
    `<w:tr>${skip}${cell(2000)}${cell(3000)}</w:tr>`,
  ]);
  const full = table.rows[0]!.cells[1]!.box;
  const skipped = table.rows[1]!.cells[0]!.box;
  // The spacing (5pt) and the first column's 5.5pt part.
  expect(skipped.x - full.x).toBeCloseTo(10.5, 6);
  expect(full.x + full.width - (skipped.x + skipped.width)).toBeCloseTo(0, 6);
});

test('a right-to-left table gives its first column the right part and ends its rule at the edge', () => {
  const bidi = '<w:bidiVisual/>';
  for (const [mode, shift] of [
    [15, 6],
    [12, 3],
  ] as const) {
    const table = layoutTable(
      [1000, 2000, 3000],
      bidi + tblPr(dxa(6000), 48, 4, FIXED),
      undefined,
      mode
    );
    // Cells keep document order; the first, 50pt column sits on the right, by the `w:left` rule.
    const [a, b, c] = widths(table);
    expect(lefts(table)[0]).toBeGreaterThan(lefts(table)[2]!);
    expect(a).toBeCloseTo(38.46, 2);
    expect(b).toBeCloseTo(86.42, 2);
    expect(c).toBeCloseTo(129.63, 2);
    // The frame's right edge sits the rule, or half of it in older modes, inside the margin.
    expect(table.box.x + table.box.width).toBeCloseTo(PAGE_WIDTH - shift, 6);
  }
});

test('mode 14 places a right-to-left spaced table as the legacy modes do', () => {
  const props = '<w:bidiVisual/>' + tblPr(dxa(4000), 48, 4, FIXED);
  const table = layoutTable([2000, 2000], props, undefined, 14);
  expect(table.box.x + table.box.width).toBeCloseTo(PAGE_WIDTH - 3, 6);
});

test("a first row's own side borders leave the column widths of the table alone", () => {
  const exception = `<w:tblPrEx><w:tblBorders>${rule('left', 48)}${rule('right', 4)}</w:tblBorders></w:tblPrEx>`;
  const plainRow = `<w:tr>${cell(2000)}${cell(2000)}</w:tr>`;
  const props = tblPr(dxa(4000), 4, 4, FIXED);
  const plain = layoutTable([2000, 2000], props, [plainRow, plainRow]);
  const excepted = layoutTable([2000, 2000], props, [
    `<w:tr>${exception}${cell(2000)}${cell(2000)}</w:tr>`,
    plainRow,
  ]);
  const [a, b] = widths(excepted, 1);
  expect(a).toBeCloseTo(widths(plain, 1)[0]!, 6);
  expect(b).toBeCloseTo(widths(plain, 1)[1]!, 6);
});

test('a column narrower than its frame part keeps a sliver of a cell', () => {
  // With a stated width the neighbour gives the sliver up; without one the table grows.
  const stated = widths(layoutTable([100, 2000], tblPr(dxa(2100), 48, 4, FIXED)));
  expect(stated[0]).toBeCloseTo(1, 6);
  expect(stated[1]).toBeCloseTo(105 - 30 - 5.5 - 1, 6);
  const auto = widths(
    layoutTable([100, 2000], tblPr('<w:tblW w:w="0" w:type="auto"/>', 48, 4, FIXED))
  );
  expect(auto[0]).toBeCloseTo(1, 6);
  expect(auto[1]).toBeCloseTo(100, 6);
});

test('without outer rules the outer columns give back the inside rule they do not draw', () => {
  const none = `<w:tblBorders>${rule('insideH', 4)}${rule('insideV', 4)}</w:tblBorders>`;
  const props = `${dxa(6000)}<w:tblCellSpacing w:w="100" w:type="dxa"/>${none}${FIXED}${NO_MARGINS}`;
  const table = layoutTable([1000, 2000, 3000], props);
  const [a, b, c] = widths(table);
  // Each outer column holds -0.5pt: the columns fit 260pt, then give the 0.5pt back as cells.
  const columns = fitColumnsAboveMinimums([50, 100, 150], 260, [0, 0, 0]);
  expect(a).toBeCloseTo(columns[0]! + 0.5, 6);
  expect(b).toBeCloseTo(columns[1]!, 6);
  expect(c).toBeCloseTo(columns[2]! + 0.5, 6);
  expect(table.box.width).toBeCloseTo(300, 6);
});

test('a row that skips trailing columns moves its last cell in by the right part too', () => {
  const skip = '<w:trPr><w:gridAfter w:val="1"/><w:wAfter w:w="3000" w:type="dxa"/></w:trPr>';
  const table = layoutTable([1000, 2000, 3000], tblPr(dxa(6000), 4, 48, FIXED), [
    `<w:tr>${cell(1000)}${cell(2000)}${cell(3000)}</w:tr>`,
    `<w:tr>${skip}${cell(1000)}${cell(2000)}</w:tr>`,
  ]);
  const full = table.rows[0]!.cells[1]!.box;
  const short = table.rows[1]!.cells[1]!.box;
  expect(short.x).toBeCloseTo(full.x, 6);
  // The spacing (5pt) and the last column's 5.5pt part.
  expect(full.x + full.width - (short.x + short.width)).toBeCloseTo(10.5, 6);
});
