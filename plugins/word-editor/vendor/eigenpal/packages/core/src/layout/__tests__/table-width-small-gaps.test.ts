import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { BlockFragmentRecord, TableFragmentRecord } from '../semantic-records.ts';
import { readTableStructure, tableOriginX } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CONTENT_PT = 300;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const RULES =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0"/>`)
    .join('') +
  '</w:tblBorders>';

interface Shape {
  /** The `w:tblW` element, or nothing. */
  readonly width?: string;
  readonly extra?: string;
  readonly grid?: readonly number[];
  readonly texts?: readonly string[];
  readonly margin?: number;
  readonly rules?: boolean;
}

function table({
  width = '',
  extra = '',
  grid = [2000, 3000],
  texts = ['a', 'b'],
  margin = 108,
  rules = false,
}: Shape = {}) {
  return (
    `<w:tbl><w:tblPr>${width}${extra}${rules ? RULES : ''}<w:tblCellMar>` +
    `<w:left w:w="${margin}" w:type="dxa"/><w:right w:w="${margin}" w:type="dxa"/>` +
    '</w:tblCellMar></w:tblPr><w:tblGrid>' +
    grid.map((twips) => `<w:gridCol w:w="${twips}"/>`).join('') +
    '</w:tblGrid><w:tr>' +
    grid
      .map(
        (twips, index) =>
          `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/></w:tcPr>` +
          `<w:p>${run(texts[index] ?? '')}</w:p></w:tc>`
      )
      .join('') +
    '</w:tr></w:tbl>'
  );
}

function bodyOf(xml: string): OoxmlElement {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part.root as OoxmlElement;
}

function tableNode(xml: string): OoxmlElement {
  const body = bodyOf(xml).children.find((child) => child.kind !== 'textValue') as OoxmlElement;
  return body.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'tbl'
  ) as OoxmlElement;
}

const isTable = (block: BlockFragmentRecord): block is TableFragmentRecord =>
  block.kind === 'table';

function cellWidths(xml: string, compatibilityMode: number | undefined) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${xml}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode,
    geometry: { width: CONTENT_PT, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  const fragment = result.pages[0]!.fragments.find(isTable)!;
  return fragment.rows[0]!.cells.map((cell) => cell.box.width);
}

function structure(xml: string, mode: number | undefined, depth = 0, textBox = false) {
  const read = readTableStructure(
    tableNode(xml),
    CONTENT_PT,
    depth,
    undefined,
    'all-markup',
    undefined,
    mode,
    undefined,
    textBox
  );
  if (!read) throw new Error('no table');
  const width = read.columnWidthsPt.reduce((sum, column) => sum + column, 0);
  return { read, width, x: tableOriginX(read, CONTENT_PT) };
}

describe('autofit columns settle from their preferred widths', () => {
  const texts = ['aaaa', 'bbbbbbbbbb'];
  // Columns far narrower than their words settle at their minimums.
  const minimums = (mode: number | undefined) =>
    cellWidths(table({ grid: [20, 20], texts, margin: 0 }), mode);
  // Every compatibility mode, and a file without one, shares the rule.
  const modes = [undefined, 11, 12, 14, 15];
  const bySlack = (mode: number | undefined, xml: string) => {
    const [low, high] = minimums(mode);
    const slack = 200 - low! + (300 - high!);
    const [first, second] = cellWidths(xml, mode);
    // 200 + 300 preferred in 300pt: the 200pt excess splits by each column's slack.
    expect(first).toBeCloseTo(200 - (200 * (200 - low!)) / slack, 6);
    expect(second).toBeCloseTo(300 - (200 * (300 - high!)) / slack, 6);
  };

  test('columns wider than the room give way by what they hold above their minimums', () => {
    const xml = table({ grid: [4000, 6000], texts, margin: 0 });
    for (const mode of modes) bySlack(mode, xml);
  });

  test('a percentage share narrower than the preferred widths takes back the same slack', () => {
    // No column is narrower than its minimum here; the share still shrinks by slack.
    const xml = table({
      width: '<w:tblW w:w="5000" w:type="pct"/>',
      grid: [4000, 6000],
      texts,
      margin: 0,
    });
    for (const mode of modes) bySlack(mode, xml);
  });

  test('minimums wider than the room keep their proportions at the room', () => {
    const xml = table({ grid: [4000, 6000], texts: ['a'.repeat(40), 'b'.repeat(20)], margin: 0 });
    const [first, second] = cellWidths(xml, 14);
    expect(first! + second!).toBeCloseTo(CONTENT_PT, 6);
    expect(first! / second!).toBeCloseTo(2, 1);
  });

  test('fixed tables and tables with spanning cells keep the proportional geometry', () => {
    const fixed = table({
      grid: [4000, 6000],
      texts,
      margin: 0,
      extra: '<w:tblLayout w:type="fixed"/>',
    });
    expect(cellWidths(fixed, 14)).toEqual([200, 300]);
    const cell = (twips: number, text: string, span = '') =>
      `<w:tc><w:tcPr><w:tcW w:w="${twips}" w:type="dxa"/>${span}</w:tcPr><w:p>${run(text)}</w:p></w:tc>`;
    const spanned =
      '<w:tbl><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="6000"/></w:tblGrid>' +
      `<w:tr>${cell(10000, 'c', '<w:gridSpan w:val="2"/>')}</w:tr>` +
      `<w:tr>${cell(4000, texts[0]!)}${cell(6000, texts[1]!)}</w:tr></w:tbl>`;
    expect(structure(spanned, 14).read.columnWidthsPt).toEqual([120, 180]);
  });

  test('a percentage table widens a column to its minimum before it stretches', () => {
    const xml = table({
      width: '<w:tblW w:w="2500" w:type="pct"/>',
      grid: [400, 1600],
      texts,
      margin: 0,
    });
    const [low] = minimums(15);
    expect(low).toBeGreaterThan(20);
    const [first, second] = cellWidths(xml, 15);
    // The minimum and 80pt grow to the 150pt share in proportion to their widths.
    expect(first).toBeCloseTo((low! * 150) / (low! + 80), 6);
    expect(second).toBeCloseTo((80 * 150) / (low! + 80), 6);
  });
});

describe('legacy percentage reference box', () => {
  const indent = '<w:tblInd w:w="0" w:type="dxa"/>';

  test('a percentage past its range keeps the content-aligned reference box', () => {
    const { read, x } = structure(
      table({ width: '<w:tblW w:w="700%" w:type="pct"/>', extra: indent }),
      14
    );
    expect(read.legacyContentAlignment).toBe(true);
    expect(x).toBeCloseTo(-5.4, 6);
  });

  test('a zero cell margin reaches to the inner half of a single outer rule', () => {
    const { read, width, x } = structure(
      table({ width: '<w:tblW w:w="5000" w:type="pct"/>', extra: indent, margin: 0, rules: true }),
      14
    );
    expect(read.legacyContentAlignment).toBe(true);
    expect(width).toBeCloseTo(CONTENT_PT + 0.5, 6);
    expect(x).toBeCloseTo(-0.25, 6);
    // The same table in mode 15 keeps its ordinary geometry.
    expect(
      structure(table({ width: '<w:tblW w:w="5000" w:type="pct"/>', margin: 0, rules: true }), 15)
        .read.legacyContentAlignment
    ).toBeUndefined();
  });

  test('a table without a width reaches to the inner half of a single outer rule too', () => {
    const { read, width, x } = structure(
      table({ grid: [4000, 6000], extra: indent, margin: 0, rules: true }),
      14
    );
    expect(read.legacyContentAlignment).toBe(true);
    expect(width).toBeCloseTo(CONTENT_PT + 0.5, 6);
    expect(x).toBeCloseTo(-0.25, 6);
  });

  test('a text-box table takes 0.75pt more and puts its outer trailing edge on the text edge', () => {
    const xml = table({
      width: '<w:tblW w:w="5000" w:type="pct"/>',
      extra: '<w:jc w:val="right"/>',
    });
    const boxed = structure(xml, 14, 0, true);
    expect(boxed.width).toBeCloseTo(CONTENT_PT + 10.8 + 0.75, 6);
    expect(boxed.x).toBeCloseTo(CONTENT_PT - boxed.width, 6);
    // In the body, the trailing content edge meets the text edge.
    const body = structure(xml, 14);
    expect(body.width).toBeCloseTo(CONTENT_PT + 10.8, 6);
    expect(body.x).toBeCloseTo(-5.4, 6);
  });

  test('a nested table without a width fits its cell plus its outer margins', () => {
    const xml = table({ grid: [4000, 6000], texts: ['a', 'b'] });
    expect(structure(xml, 14, 1).width).toBeCloseTo(CONTENT_PT + 10.8, 6);
    expect(structure(xml, 15, 1).width).toBeCloseTo(CONTENT_PT, 6);
  });
});

// Mode-15 reference renderings of right-to-left percentage tables with 0.5 to 3pt rules
// mirror the left-to-right shared grid lines, then move half a rule toward the visual left:
// a leading grid ends one rule short of the right edge, a centred one sits half a rule left
// of centre, and a trailing one starts on the left edge.
test('a mode-15 right-to-left table moves half its outer rule toward its visual left', () => {
  const xml = table({
    width: '<w:tblW w:w="5000" w:type="pct"/>',
    extra: '<w:bidiVisual/>',
    rules: true,
  });
  const modern = structure(xml, 15);
  expect(modern.read.outerRuleOffsetPt).toBe(-0.5);
  expect(modern.width).toBeCloseTo(CONTENT_PT - 0.5, 6);
  expect(modern.x).toBeCloseTo(CONTENT_PT - modern.width - 0.5, 6);
  expect(structure(xml, 14).read.outerRuleOffsetPt).toBeUndefined();
  const aligned = (jc: string) =>
    structure(
      table({
        width: '<w:tblW w:w="2500" w:type="pct"/>',
        extra: `<w:bidiVisual/><w:jc w:val="${jc}"/>`,
        rules: true,
      }),
      15
    );
  const centered = aligned('center');
  expect(centered.x).toBeCloseTo((CONTENT_PT - centered.width) / 2 - 0.25, 6);
  const leading = aligned('left');
  expect(leading.x).toBeCloseTo(CONTENT_PT - leading.width - 0.5, 6);
  expect(aligned('right').x).toBeCloseTo(0, 6);
});
