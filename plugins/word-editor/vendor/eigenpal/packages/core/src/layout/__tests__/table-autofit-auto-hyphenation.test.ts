// With `w:autoHyphenation` in compatibility mode 15, a long word is hyphenated inside its
// autofit column. The column keeps its preferred width and does not take room from the other
// columns. Legacy modes keep the word whole and widen its column. The table below
// states 25, 100, 205 and 138pt columns in a 468pt text column. The fixed measurer gives 6pt
// to each character, so the 60-letter word needs 360pt when it stays whole.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { hyphenationPoints, withHyphenationPoints } from '../auto-hyphenation.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const LETTER =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
const GRID = [500, 2000, 4100, 2760];
const LONG_WORD = 'abcdefghij'.repeat(6);
const STATED_WIDTHS = [25, 100, 205, 138];

function part(xml: string, name: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function settings(children: string) {
  return part(`<w:settings xmlns:w="${W}">${children}</w:settings>`, '/word/settings.xml');
}

function columnWidths(
  settingsChildren: string | null,
  longText = LONG_WORD,
  longCellParagraphProperties = '',
  compatibilityMode: number | null = 15
): number[] {
  const texts = ['1', 'Fields', longText, 'Short note'];
  const cells = texts
    .map((text, index) => {
      const pPr = index === 2 ? longCellParagraphProperties : '';
      return (
        `<w:tc><w:tcPr><w:tcW w:w="${GRID[index]}" w:type="dxa"/></w:tcPr>` +
        `<w:p>${pPr}${text.startsWith('<') ? text : `<w:r><w:t>${text}</w:t></w:r>`}</w:p></w:tc>`
      );
    })
    .join('');
  const xml =
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tblPr>` +
    '<w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>' +
    `</w:tblPr><w:tblGrid>${GRID.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    `<w:tr>${cells}</w:tr></w:tbl><w:p/>${LETTER}</w:body></w:document>`;
  const settingsRoot = settingsChildren === null ? null : settings(settingsChildren).root;
  const layout = layoutSemanticDocument(part(xml, '/word/document.xml'), 0, {
    measurer: createFixedMeasurer(6, 12),
    compatibilityMode: compatibilityMode ?? undefined,
    styleCascade: buildStyleCascadeTable(null, undefined, settingsRoot),
  });
  const table = layout.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  const edges = table.columnEdges;
  return edges.slice(1).map((edge, index) => edge - edges[index]!);
}

function expectStatedWidths(columns: readonly number[]): void {
  expect(columns).toHaveLength(STATED_WIDTHS.length);
  for (const [index, width] of STATED_WIDTHS.entries())
    expect(columns[index]!).toBeCloseTo(width, 1);
}

test('automatic hyphenation keeps a long word inside its preferred column', () => {
  expectStatedWidths(columnWidths('<w:autoHyphenation/>'));
  expectStatedWidths(columnWidths('<w:autoHyphenation w:val="true"/>'));
});

test('without automatic hyphenation a long word widens its column', () => {
  expect(columnWidths(null)[2]!).toBeGreaterThan(360);
  expect(columnWidths('<w:autoHyphenation w:val="0"/>')[2]!).toBeGreaterThan(360);
});

test('a paragraph that suppresses automatic hyphens keeps its long word whole', () => {
  const columns = columnWidths(
    '<w:autoHyphenation/>',
    LONG_WORD,
    '<w:pPr><w:suppressAutoHyphens/></w:pPr>'
  );
  expect(columns[2]!).toBeGreaterThan(360);
});

test('automatic hyphenation does not break a run of digits', () => {
  expect(columnWidths('<w:autoHyphenation/>', '1234567890'.repeat(6))[2]!).toBeGreaterThan(360);
});

const cutsOf = (text: string, boundaries: number[], keepCapitals = false) => {
  const points = hyphenationPoints(text, keepCapitals);
  const { cuts, hyphens } = withHyphenationPoints(boundaries, points);
  return { cuts, hyphens: [...hyphens] };
};

test('hyphenation points fall between syllables and keep the existing breaks', () => {
  expect(cutsOf('custom', [6])).toEqual({ cuts: [3, 6], hyphens: [3] });
  expect(cutsOf('character', [9])).toEqual({ cuts: [3, 6, 9], hyphens: [3, 6] });
  expect(cutsOf('молоко', [6])).toEqual({ cuts: [2, 6], hyphens: [2] });
  // One vowel group, or too few letters at either end, keeps a word whole.
  expect(cutsOf('Fields', [6])).toEqual({ cuts: [6], hyphens: [] });
  expect(cutsOf('table', [5])).toEqual({ cuts: [5], hyphens: [] });
  expect(cutsOf('ab cd', [3, 5])).toEqual({ cuts: [3, 5], hyphens: [] });
  expect(cutsOf('a1b', [3])).toEqual({ cuts: [3], hyphens: [] });
  expect(cutsOf('שלוםשלום', [8])).toEqual({ cuts: [8], hyphens: [] });
});

test('legacy compatibility modes keep a long word whole under automatic hyphenation', () => {
  // A document with no compatibility mode opens in a legacy mode.
  for (const mode of [11, 12, 14, null])
    expect(columnWidths('<w:autoHyphenation/>', LONG_WORD, '', mode)[2]!).toBeGreaterThan(360);
  expectStatedWidths(columnWidths('<w:autoHyphenation/>', LONG_WORD, '', 16));
});

test('doNotHyphenateCaps keeps a word in capitals whole but not a capitalized word', () => {
  const settings = '<w:autoHyphenation/><w:doNotHyphenateCaps/>';
  expect(columnWidths(settings, LONG_WORD.toUpperCase())[2]!).toBeGreaterThan(360);
  expectStatedWidths(columnWidths(settings, 'A' + LONG_WORD.slice(1)));
  expectStatedWidths(
    columnWidths(settings + '<w:doNotHyphenateCaps w:val="0"/>', 'ABC'.repeat(20))
  );
  expectStatedWidths(columnWidths('<w:autoHyphenation/>', LONG_WORD.toUpperCase()));
});

test('doNotHyphenateCaps keeps words in caps and small caps runs whole', () => {
  for (const tag of ['caps', 'smallCaps']) {
    const run = `<w:r><w:rPr><w:${tag}/></w:rPr><w:t>${LONG_WORD}</w:t></w:r>`;
    expect(columnWidths('<w:autoHyphenation/><w:doNotHyphenateCaps/>', run)[2]!).toBeGreaterThan(
      360
    );
    expectStatedWidths(columnWidths('<w:autoHyphenation/>', run));
  }
});

test('a word that mixes letters and digits still hyphenates', () => {
  const mixed = 'abcdefghij1'.repeat(5);
  expectStatedWidths(columnWidths('<w:autoHyphenation/><w:doNotHyphenateCaps/>', mixed));
});

test('capital words keep their letters together and other words still take points', () => {
  expect(cutsOf('CUSTOM custom', [7, 13], true)).toEqual({ cuts: [7, 10, 13], hyphens: [10] });
  expect(cutsOf('Custom', [6], true)).toEqual({ cuts: [3, 6], hyphens: [3] });
  expect(cutsOf('CUSTOM', [6])).toEqual({ cuts: [3, 6], hyphens: [3] });
});

test('a word split across differently formatted runs keeps its hyphenation points', () => {
  const runs = (LONG_WORD.match(/.{1,4}/g) ?? [])
    .map(
      (text, index) => `<w:r>${index % 2 ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>`
    )
    .join('');
  expectStatedWidths(columnWidths('<w:autoHyphenation/>', runs));
});

test('decomposed accents stay with their letter and keep the word whole around them', () => {
  const points = hyphenationPoints('de\u0301veloppement');
  expect(points.length).toBeGreaterThan(0);
  for (const point of points) expect('de\u0301veloppement'[point]).not.toBe('\u0301');
  expect(hyphenationPoints('de\u0301veloppement')[0]).toBe(3);
});
