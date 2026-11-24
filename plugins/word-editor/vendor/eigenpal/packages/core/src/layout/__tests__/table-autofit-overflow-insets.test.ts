// An autofit table whose column minimums do not fit its room keeps every cell's horizontal
// margins whole and narrows only the content, by one factor for every column. One
// unbreakable word therefore squeezes the short columns by the same factor as its own, not
// down to hairlines. The widths below were measured on reference renderings: a 468pt text
// column, 5.4pt cell margins, and a monospaced face 6pt wide per character. The fixed
// measurer gives the same 6pt per character to the 11pt runs here.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LETTER =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const MARGINS =
  '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>';

const NO_INDENT = '<w:tblInd w:w="0" w:type="dxa"/>';
const STATED = `<w:tblW w:w="9000" w:type="dxa"/>${NO_INDENT}`;

function word(length: number, seed: number): string {
  let text = '';
  for (let index = 0; index < length; index++)
    text += String.fromCharCode(97 + ((seed * 7 + index) % 26));
  return text;
}

interface TableOptions {
  /**
   * `w:tblW` and `w:tblInd`, or nothing for an automatic width. The stated indent puts a legacy
   * table's content edge on the text edge, as a table style would.
   */
  readonly tblPr?: string;
  /** Whether each cell states a 1800-twip preferred width. */
  readonly cellWidths?: boolean;
  /** Cell text; defaults to one word of each length. */
  readonly texts?: readonly string[];
}

function layOut(lengths: readonly number[], mode: number | undefined, options: TableOptions = {}) {
  const { tblPr = STATED, cellWidths = true } = options;
  const texts = options.texts ?? lengths.map((length, index) => word(length, index));
  const cells = texts
    .map(
      (text) =>
        `<w:tc>${cellWidths ? '<w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>' : ''}` +
        `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`
    )
    .join('');
  const grid = texts.map(() => '<w:gridCol w:w="1800"/>').join('');
  const xml =
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>${tblPr}${MARGINS}</w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl><w:p/>${LETTER}</w:body></w:document>`;
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, {
    measurer: createFixedMeasurer(6, 12),
    ...(mode === undefined ? {} : { compatibilityMode: mode }),
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const edges = table.columnEdges;
  return {
    x: table.box.x,
    width: table.box.width,
    columns: edges.slice(1).map((edge, index) => edge - edges[index]!),
  };
}

/**
 * Each column within 1.2pt of the reference. The reference snaps every rule to a 0.24pt grid
 * and rounds each width it settles, which moved single columns by up to 1.14pt.
 */
function expectWidths(actual: readonly number[], measured: readonly number[]): void {
  expect(actual).toHaveLength(measured.length);
  for (const [index, width] of measured.entries())
    expect(Math.abs(actual[index]! - width)).toBeLessThan(1.2);
}

test('one unbreakable word squeezes the other columns alike, not to hairlines', () => {
  const { columns } = layOut([5, 8, 4, 6, 1000], 15);
  expectWidths(columns, [18, 22.56, 16.56, 19.44, 390.96]);
  // Each short column keeps its margins and a share of its word.
  for (const width of columns.slice(0, 4)) expect(width).toBeGreaterThan(15);
});

test('overflowing minimums keep their margins and narrow their content by one factor', () => {
  expectWidths(layOut([5, 10, 20, 40, 80], 15).columns, [24.24, 37.44, 64.08, 117.6, 224.16]);
  expectWidths(layOut([5, 80], 15).columns, [36.96, 430.56]);
});

test('the same holds for columns that no cell gives a preferred width', () => {
  const columns = layOut([5, 10, 20, 40, 80], 15, { tblPr: '', cellWidths: false }).columns;
  expectWidths(columns, [24.24, 37.44, 64.08, 117.6, 224.16]);
});

test('content past the widest page counts as the widest page', () => {
  // Two words of 1800pt and 6000pt both narrow as if 1584pt wide, so they share alike.
  const { columns } = layOut([5, 8, 4, 300, 1000], undefined);
  expectWidths(columns, [14.88, 17.04, 13.92, 216.48, 216.72]);
});

test('a legacy table overflows into the text column plus its outer cell margins', () => {
  const stated = layOut([5, 8, 4, 6, 1000], undefined);
  expect(stated.x).toBeCloseTo(-5.4, 1);
  expect(stated.width).toBeCloseTo(478.8, 1);
  expectWidths(stated.columns, [18.48, 22.56, 16.8, 19.68, 401.52]);
  const automatic = layOut([5, 8, 4, 6, 1000], undefined, {
    tblPr: NO_INDENT,
    cellWidths: false,
  });
  expect(automatic.width).toBeCloseTo(478.8, 1);
  expectWidths(automatic.columns, [18.48, 22.56, 16.8, 19.68, 401.52]);
});

test('a legacy table measures that room from its indent', () => {
  const indent = (twips: number) =>
    `<w:tblW w:w="9000" w:type="dxa"/><w:tblInd w:w="${twips}" w:type="dxa"/>`;
  const into = layOut([5, 8, 4, 6, 1000], undefined, { tblPr: indent(-108) });
  expect(into.x).toBeCloseTo(-10.8, 1);
  expect(into.width).toBeCloseTo(484.2, 1);
  const away = layOut([5, 8, 4, 6, 1000], undefined, { tblPr: indent(360) });
  expect(away.x).toBeCloseTo(12.6, 1);
  expect(away.width).toBeCloseTo(460.8, 1);
});

test('a legacy automatic-width table that wraps also reaches past the text column', () => {
  const sentence = (seed: number) =>
    Array.from({ length: 30 }, (_, index) => word(6, seed + index)).join(' ');
  const texts = [0, 1, 2, 3, 4].map(sentence);
  const automatic = { cellWidths: false, texts };
  const { width, columns } = layOut([], undefined, { ...automatic, tblPr: NO_INDENT });
  expect(width).toBeCloseTo(478.8, 1);
  expectWidths(columns, [95.76, 95.76, 95.76, 95.76, 95.76]);
  // A positive indent takes its room away, as it does for an absolute width.
  const indented = layOut([], undefined, {
    ...automatic,
    tblPr: '<w:tblInd w:w="360" w:type="dxa"/>',
  });
  expect(indented.x).toBeCloseTo(12.6, 1);
  expect(indented.width).toBeCloseTo(460.8, 1);
});

test('the reported table keeps more than a character in each short column', () => {
  // No styles part and no stated cell margins: five 1800-twip columns, the last one holding
  // a 1001-character word with no break opportunity.
  const cell = (text: string) =>
    '<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr>' +
    `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const texts = ['Penguin', 'Hat size', 'Mood', 'Snacks', 'blorptastic'.repeat(91)];
  const xml =
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>` +
    `</w:tblPr><w:tblGrid>${'<w:gridCol w:w="1800"/>'.repeat(5)}</w:tblGrid>` +
    `<w:tr>${texts.map(cell).join('')}</w:tr></w:tbl><w:p/>${LETTER}</w:body></w:document>`;
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 0, { measurer: createFixedMeasurer(6, 12) });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const edges = table.columnEdges;
  const columns = edges.slice(1).map((edge, index) => edge - edges[index]!);
  // Each short column is wider than one 6pt character; the long word takes the rest.
  for (const width of columns.slice(0, 4)) expect(width).toBeGreaterThan(6);
  expect(columns[4]).toBeGreaterThan(420);
});
