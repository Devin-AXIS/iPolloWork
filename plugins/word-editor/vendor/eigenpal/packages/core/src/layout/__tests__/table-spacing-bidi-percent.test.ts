// Width and placement of right-to-left spaced tables with uneven outer rules: percentage widths
// in modes 14 and 15, and tables aligned to the visual left edge. The expected numbers follow
// the measured rules on a 400pt page without margins. A layout box leaves out the visual right
// rule (`w:left`), which draws outward.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PAGE_WIDTH = 400;

const rule = (side: string, size: number) =>
  `<w:${side} w:val="single" w:sz="${size}" w:space="0" w:color="000000"/>`;
/** Outer rules in eighths of a point; 0.5pt top, bottom and inside rules. */
const borders = (left: number, right: number) =>
  `<w:tblBorders>${rule('top', 4)}${rule('left', left)}${rule('bottom', 4)}${rule('right', right)}` +
  `${rule('insideH', 4)}${rule('insideV', 4)}</w:tblBorders>`;
const margins = (left: number, right = left) =>
  `<w:tblCellMar><w:left w:w="${left}" w:type="dxa"/><w:right w:w="${right}" w:type="dxa"/></w:tblCellMar>`;
const cell = (twips: number) =>
  `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc>`;

interface Case {
  readonly left: number;
  readonly right: number;
  readonly width?: string;
  readonly jc?: 'center' | 'right';
  readonly spacingTwips?: number;
  readonly marginTwips?: number;
  /** Uneven `w:left` and `w:right` table cell margins, in twips. */
  readonly sideMarginsTwips?: readonly [number, number];
}

/** The table fragment of a one-table right-to-left document on a 400pt page. */
function layoutBidi(options: Case, compatibilityMode: number): TableFragmentRecord {
  const tblPr =
    '<w:bidiVisual/>' +
    (options.width ?? '<w:tblW w:w="2500" w:type="pct"/>') +
    (options.jc ? `<w:jc w:val="${options.jc}"/>` : '') +
    `<w:tblCellSpacing w:w="${options.spacingTwips ?? 100}" w:type="dxa"/>` +
    borders(options.left, options.right) +
    margins(...(options.sideMarginsTwips ?? [options.marginTwips ?? 0]));
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tblPr}</w:tblPr>` +
      '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
      `<w:tr>${cell(2000)}${cell(2000)}</w:tr></w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const layout = layoutSemanticDocument(parsed.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    geometry: { width: PAGE_WIDTH, height: 400, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    compatibilityMode,
  });
  return layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
}

const rightEdge = (table: TableFragmentRecord) => table.box.x + table.box.width;

test('mode 15 puts the visual right rule of a right-to-left percentage table on the edge', () => {
  // 50% of the page less the 3.25pt mean side rule, plus that rule: a 201.625pt outer extent.
  for (const [left, right, rulePt] of [
    [48, 4, 6],
    [4, 48, 0.5],
  ] as const) {
    const table = layoutBidi({ left, right }, 15);
    expect(table.box.width).toBeCloseTo(201.625 - rulePt, 6);
    // The rule's outer edge meets the edge: the box ends the rule's width inside it.
    expect(rightEdge(table)).toBeCloseTo(PAGE_WIDTH - rulePt, 6);
  }
});

test('legacy modes widen a right-to-left spaced percentage and centre its right rule', () => {
  // 50% of 400pt + 2 x 5pt spacing + two 0.5pt margins + 1pt, plus half the 6.5pt of rules.
  const table = layoutBidi({ left: 48, right: 4 }, 14);
  expect(table.box.width).toBeCloseTo(209.25 - 6, 6);
  expect(rightEdge(table)).toBeCloseTo(PAGE_WIDTH - 3, 6);
  // Wider spacing and cell margins widen it too: 50% of (400 + 30 + 10.8 + 1), plus 0.5pt.
  const roomy = layoutBidi({ left: 4, right: 4, spacingTwips: 300, marginTwips: 108 }, 14);
  expect(roomy.box.width).toBeCloseTo(220.9, 6);
  // In mode 15 the same table keeps the mode-15 width: 50% of (400 - 0.5) + 0.5.
  expect(
    layoutBidi({ left: 4, right: 4, spacingTwips: 300, marginTwips: 108 }, 15).box.width
  ).toBeCloseTo(200.25 - 0.5, 6);
});

test('a centred right-to-left percentage table moves by half its right rule and a quarter of its left', () => {
  const table = layoutBidi({ left: 48, right: 4, jc: 'center' }, 15);
  expect(table.box.x).toBeCloseTo((PAGE_WIDTH - 195.625) / 2 - 3 - 0.125, 6);
  // Legacy modes centre the rules' centres: a quarter of both rules.
  const legacy = layoutBidi({ left: 48, right: 4, jc: 'center' }, 14);
  expect(legacy.box.x).toBeCloseTo((PAGE_WIDTH - 203.25) / 2 - 1.625, 6);
});

test('a right-to-left table on the visual left edge centres its left rule there', () => {
  // `w:right` is the visual left rule: 6pt, centred on the edge in mode 15, any width type.
  for (const width of [
    '<w:tblW w:w="2500" w:type="pct"/>',
    '<w:tblW w:w="4000" w:type="dxa"/>',
    '<w:tblW w:w="0" w:type="auto"/>',
  ]) {
    expect(layoutBidi({ left: 4, right: 48, jc: 'right', width }, 15).box.x).toBeCloseTo(-3, 6);
    expect(layoutBidi({ left: 48, right: 4, jc: 'right', width }, 15).box.x).toBeCloseTo(-0.25, 6);
    // Legacy modes move it a further spacing gap, cell margin and half a point outward.
    expect(layoutBidi({ left: 4, right: 48, jc: 'right', width }, 14).box.x).toBeCloseTo(-9, 6);
    expect(
      layoutBidi({ left: 4, right: 48, jc: 'right', width, marginTwips: 108 }, 14).box.x
    ).toBeCloseTo(-3 - (5 + 5.4 + 0.5), 6);
    expect(
      layoutBidi({ left: 4, right: 48, jc: 'right', width, spacingTwips: 300 }, 14).box.x
    ).toBeCloseTo(-3 - (15 + 0.5 + 0.5), 6);
  }
});

test('the first cell w:left margin moves a right-to-left table on the visual left edge', () => {
  // Measured with 0 and 10.8pt on either side: only `w:left` moves the table.
  const at = (sideMarginsTwips: readonly [number, number]) =>
    layoutBidi({ left: 4, right: 48, jc: 'right', sideMarginsTwips }, 14).box.x;
  expect(at([216, 0])).toBeCloseTo(-3 - (5 + 10.8 + 0.5), 6);
  expect(at([0, 216])).toBeCloseTo(-3 - (5 + 0.5 + 0.5), 6);
});
