import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const word = 'ABCDEFGHIJKLMN';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

function layout(
  content: string,
  properties = '',
  alignment = 'left',
  table = false,
  session?: ReturnType<typeof createLayoutSession>
) {
  const paragraph =
    `<w:p><w:pPr><w:tabs><w:tab w:val="${alignment}" w:pos="240"/>` +
    '<w:tab w:val="left" w:pos="480"/></w:tabs>' +
    `${properties}</w:pPr>${content}</w:p>`;
  const body = table
    ? '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar>' +
      '<w:top w:w="0"/><w:bottom w:w="0"/><w:left w:w="0"/><w:right w:w="0"/>' +
      '</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>' +
      '<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>' +
      paragraph +
      '</w:tc></w:tr></w:tbl>'
    : paragraph;
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 12),
    styleCascade: elevenPointDefaults(),
    session,
    geometry: { width: 60, height: 200, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  });
}

const texts = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) => line.spans.map((span) => span.text).join(''));

test('an oversized word uses the line after its leading tab', () => {
  const result = layout(`<w:r><w:tab/></w:r>${run(word)}`);
  expect(texts(result)).toEqual(['\tABCDEFGH', 'IJKLMN']);
  const first = linesOf(result)[0]!;
  expect(first.spans[1]!.box.x).toBe(12);
  expect(first.range).toMatchObject({ start: 0, end: 9 });
  expect(linesOf(result)[1]!.range).toMatchObject({ start: 9, end: 15 });
});

test('source run boundaries do not add a tab-only line', () => {
  for (let cut = 1; cut < word.length; cut += 1) {
    expect(
      texts(layout(`<w:r><w:tab/></w:r>${run(word.slice(0, cut))}${run(word.slice(cut))}`))
    ).toEqual(['\tABCDEFGH', 'IJKLMN']);
  }
});

test('multiple leading tabs retain their advances and source ranges', () => {
  expect(texts(layout(`<w:r><w:tab/><w:tab/></w:r>${run(word)}`))).toEqual([
    '\t\tABCDEF',
    'GHIJKLMN',
  ]);
});

test('the leading tab also narrows a word that fits a fresh full line', () => {
  expect(texts(layout(`<w:r><w:tab/></w:r>${run('ABCDEFGHI')}`))).toEqual(['\tABCDEFGH', 'I']);
});

test('visible text before the tab retains ordinary overflow behavior', () => {
  expect(texts(layout(`${run('A')}<w:r><w:tab/></w:r>${run(word)}`))).toEqual([
    'A\t',
    'ABCDEFGHIJ',
    'KLMN',
  ]);
});

test('right-aligned tabs retain their segment placement', () => {
  const result = layout(`<w:r><w:tab/></w:r>${run(word)}`, '', 'right');
  expect(texts(result).join('')).toBe(`\t${word}`);
  expect(linesOf(result).length).toBeLessThanOrEqual(3);
});

test('a table cell does not gain a tab-only line', () => {
  const result = layout(`<w:r><w:tab/></w:r>${run(word)}`, '', 'left', true);
  expect(texts(result)).toEqual(['\tABCDEFGH', 'IJKLMN', '']);
  const table = result.pages[0]!.fragments[0]!;
  expect(table.kind).toBe('table');
  if (table.kind === 'table') expect(table.rows[0]!.box.height).toBe(24);
});

test('warm layout follows tab and text changes', () => {
  const session = createLayoutSession();
  for (const text of [word, 'ABC', word]) {
    const content = `<w:r><w:tab/></w:r>${run(text)}`;
    const warm = layout(content, '', 'left', true, session);
    expect(warm.pages).toEqual(layout(content, '', 'left', true).pages);
  }
});

test('a tab that leaves no room still makes bounded progress', () => {
  const result = layout(`<w:r><w:tab/><w:tab/><w:tab/></w:r>${run(word)}`);
  expect(texts(result).join('')).toBe(`\t\t\t${word}`);
  expect(linesOf(result).length).toBeLessThanOrEqual(4);
});
