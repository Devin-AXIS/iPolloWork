import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { layoutSemanticDocument, linesOf } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
function layout(rowProperties = '', header = false, extraCell = '', compatibilityMode?: number) {
  const row = (content: string, properties = '') =>
    `<w:tr><w:trPr>${properties}</w:trPr><w:tc>${content}</w:tc>${properties.includes('tblHeader') ? '' : extraCell}</w:tr>`;
  const xml = `<w:document xmlns:w="${W}"><w:body>${paragraph('prefix 1')}${paragraph('prefix 2')}${paragraph('prefix 3')}
    <w:tbl><w:tblPr><w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
    ${header ? row(paragraph('header'), '<w:tblHeader/>') : ''}
    ${row(Array.from({ length: 5 }, (_, i) => paragraph(`cell ${i}`)).join(''), rowProperties)}
    </w:tbl></w:body></w:document>`;
  const parsed = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  const before = serializeOoxmlPart(parsed.part);
  const result = layoutSemanticDocument(parsed.part, 0, {
    geometry: { width: 120, height: 70, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    measurer: {
      measure: (text) => text.length * 4,
      lineMetrics: () => ({ height: 10, baseline: 8 }),
    },
    compatibilityMode,
  });
  expect(serializeOoxmlPart(parsed.part)).toBe(before);
  return result;
}

for (const properties of [
  '',
  '<w:cantSplit w:val="0"/>',
  '<w:trHeight w:val="800" w:hRule="atLeast"/>',
]) {
  test(`splittable rows use the remaining page band (${properties || 'default'})`, () => {
    const result = layout(properties);
    expect(result.pages).toHaveLength(2);
    const first = result.pages[0]!.fragments.find((f) => f.kind === 'table');
    expect(first?.kind).toBe('table');
    if (first?.kind !== 'table') throw new Error('missing first fragment');
    expect(first.box.y).toBe(30);
    expect(first.box.height).toBe(40);
    expect(linesOf(result).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
      'prefix 1',
      'prefix 2',
      'prefix 3',
      'cell 0',
      'cell 1',
      'cell 2',
      'cell 3',
      'cell 4',
      '',
    ]);
  });
}

for (const properties of [
  '<w:cantSplit/>',
  '<w:trHeight w:val="1000" w:hRule="exact"/>',
  // A minimum must fit the remaining band before the row starts.
  '<w:trHeight w:val="1000" w:hRule="atLeast"/>',
]) {
  test(`atomic rows and rows whose minimum does not fit move (${properties})`, () => {
    const result = layout(properties);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]!.fragments.some((f) => f.kind === 'table')).toBe(false);
  });
}

test('a partially placed row resumes below a repeated header', () => {
  const result = layout('', true);
  expect(result.pages).toHaveLength(2);
  const rows = result.pages.map((page) =>
    page.fragments.flatMap((f) => (f.kind === 'table' ? f.rows : []))
  );
  expect(rows[0]).toHaveLength(2);
  expect(rows[1]).toHaveLength(2);
  expect(rows[1]![0]!.isHeaderRepeat).toBe(true);
  expect(rows[1]![1]!.isContinuation).toBe(true);
  expect(
    linesOf(result)
      .map((line) => line.spans.map((span) => span.text).join(''))
      .filter((text) => text.startsWith('cell'))
  ).toEqual(['cell 0', 'cell 1', 'cell 2', 'cell 3', 'cell 4']);
});

test('a row moves when the remaining band cannot start every cell', () => {
  const result = layout(
    '',
    false,
    '<w:tc><w:p><w:pPr><w:spacing w:line="900" w:lineRule="exact"/></w:pPr><w:r><w:t>Tall</w:t></w:r></w:p></w:tc>'
  );
  expect(result.pages).toHaveLength(2);
  expect(result.pages[0]!.fragments.some((f) => f.kind === 'table')).toBe(false);
  expect(linesOf(result).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'prefix 1',
    'prefix 2',
    'prefix 3',
    'cell 0',
    'cell 1',
    'cell 2',
    'cell 3',
    'cell 4',
    'Tall',
    '',
  ]);
});

const tallCell =
  '<w:tc><w:p><w:pPr><w:spacing w:line="1300" w:lineRule="exact"/></w:pPr><w:r><w:t>Tall</w:t></w:r></w:p></w:tc>';

test('a repeated header is omitted when it prevents one cell from starting', () => {
  const result = layout('', true, tallCell, 15);
  // Pages through the table; the empty paragraph the body reads after it may take one more.
  expect(
    result.pages.findLastIndex((page) => page.fragments.some((f) => f.kind === 'table')) + 1
  ).toBe(2);
  const rows = result.pages[1]!.fragments.flatMap((f) => (f.kind === 'table' ? f.rows : []));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.isHeaderRepeat).not.toBe(true);
  expect(rows[0]!.cells.every((cell) => cell.blocks.length > 0)).toBe(true);
});

test('before mode 15, a repeated header stays when it prevents one cell from starting', () => {
  const result = layout('', true, tallCell, 14);
  expect(
    result.pages.findLastIndex((page) => page.fragments.some((f) => f.kind === 'table')) + 1
  ).toBe(2);
  const rows = result.pages[1]!.fragments.flatMap((f) => (f.kind === 'table' ? f.rows : []));
  expect(rows.map((row) => row.isHeaderRepeat === true)).toEqual([true, false]);
  // The whole row sits below the 10pt repeat: its 65pt line ends past the 70pt page.
  expect(rows[1]!.hasContinuation).toBeFalsy();
  expect(rows[1]!.box.y + rows[1]!.box.height).toBeGreaterThan(70);
});
