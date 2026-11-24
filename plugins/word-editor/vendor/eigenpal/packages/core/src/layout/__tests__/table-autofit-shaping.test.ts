import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { TableFragmentRecord, TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixed = createFixedMeasurer(6, 12);

await initializeHarfBuzz();
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;
const snapshot = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2000000,
  resources: [{ request, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
});
const font = snapshot.resolve(request);
if (font instanceof FontResolutionError) throw font;
const shaped = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => font,
  fallback: fixed,
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});

const ARABIC = 'مرحبابالعالمالعربيالجميل';
const run = (text: string, rtl = false) =>
  `<w:r>${rtl ? '<w:rPr><w:rtl/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

function tableOf(middle: string, middleTwips: number, extra = '') {
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>${extra}<w:tblCellMar>` +
    '<w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="${middleTwips}"/><w:gridCol w:w="${6000 - middleTwips}"/></w:tblGrid><w:tr>` +
    `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${middleTwips}" w:type="dxa"/></w:tcPr><w:p>${middle}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="${6000 - middleTwips}" w:type="dxa"/></w:tcPr><w:p>${run('cd')}</w:p></w:tc>` +
    '</w:tr></w:tbl>'
  );
}

function middle(body: string, measurer: TextMeasurer, compatibilityMode?: number) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 1, {
    measurer,
    ...(compatibilityMode ? { compatibilityMode } : {}),
    geometry: { width: 450, height: 600, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
  const table = result.pages[0]!.fragments.find(
    (fragment): fragment is TableFragmentRecord => fragment.kind === 'table'
  )!;
  return table.rows[0]!.cells.map((cell) => ({
    width: cell.box.width,
    lines: cell.blocks.flatMap((block) => (block.kind === 'paragraph' ? block.lines : [])),
  }));
}

for (const rtl of [false, true]) {
  test(`a shaped ${rtl ? 'right-to-left ' : ''}Arabic word is measured as it paints`, () => {
    // Its painted width in a column far wider than it needs.
    const roomy = middle(tableOf(run(ARABIC, rtl), 5000), shaped)[1]!;
    const painted = roomy.lines[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
    // A column a little wider than that keeps its authored width.
    const twips = Math.ceil((painted + 2) * 20);
    const fits = middle(tableOf(run(ARABIC, rtl), twips), shaped)[1]!;
    expect(fits.width).toBeCloseTo(twips / 20, 6);
    expect(fits.lines).toHaveLength(1);
    // A narrower one widens to the painted width, not the unshaped one.
    const narrow = middle(tableOf(run(ARABIC, rtl), Math.floor(painted * 10)), shaped)[1]!;
    expect(narrow.width).toBeCloseTo(painted, 1);
    expect(narrow.lines).toHaveLength(1);
  });
}

test('a hanging indent starts the first word left of the indent', () => {
  const hanging = `<w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr>${run('ABCDEFGHIJ')}`;
  // The first word starts at 0, so the column holds just the word; the 36 pt indent is not added.
  const cell = middle(tableOf(hanging, 600), fixed)[1]!;
  const word = cell.lines[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
  expect(cell.lines).toHaveLength(1);
  expect(cell.width).toBeCloseTo(word, 6);
});

test('a right-to-left hanging indent starts the first word at the leading edge too', () => {
  const hanging =
    '<w:pPr><w:bidi/><w:ind w:start="720" w:hanging="720"/></w:pPr>' + run('ABCDEFGHIJ');
  const cell = middle(tableOf(hanging, 600), fixed)[1]!;
  const word = cell.lines[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
  expect(cell.lines).toHaveLength(1);
  expect(cell.width).toBeCloseTo(word, 6);
});

test('an empty indented paragraph keeps its indent as a minimum', () => {
  const empty = '<w:pPr><w:ind w:left="1440"/></w:pPr>';
  expect(middle(tableOf(empty, 400), fixed)[1]!.width).toBeCloseTo(72, 6);
});

test('an empty paragraph with a hanging indent reserves only its first line', () => {
  const empty = '<w:pPr><w:ind w:left="1440" w:hanging="1440"/></w:pPr>';
  expect(middle(tableOf(empty, 400), fixed)[1]!.width).toBeCloseTo(20, 6);
});

test('an indented full-width percentage table never narrows when a column widens', () => {
  const indented = (word: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblInd w:w="720" w:type="dxa"/>' +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr><w:p>${run(word)}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const total = (word: string) =>
    middle(indented(word), fixed).reduce((sum, cell) => sum + cell.width, 0);
  expect(total('A'.repeat(45))).toBeGreaterThanOrEqual(total('ab') - 1e-6);
});

test('a full-width legacy percentage table keeps its width when a column widens', () => {
  const legacy = (word: string) =>
    '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/>' +
    '<w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/>' +
    '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="4716"/><w:gridCol w:w="4716"/></w:tblGrid><w:tr>' +
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr><w:p>${run('ab')}</w:p></w:tc>` +
    `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="pct"/></w:tcPr><w:p>${run(word)}</w:p></w:tc>` +
    '</w:tr></w:tbl>';
  const total = (word: string) =>
    middle(legacy(word), fixed, 11).reduce((sum, cell) => sum + cell.width, 0);
  expect(total('A'.repeat(50))).toBeCloseTo(total('ab'), 6);
});
