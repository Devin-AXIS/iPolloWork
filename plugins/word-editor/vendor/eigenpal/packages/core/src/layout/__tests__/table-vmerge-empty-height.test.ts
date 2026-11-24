import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { FIXED_MEASURER_LINE_HEIGHT } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

// These fixtures author no styles, so the end-of-cell mark resolves to the default face.
const MARK_LINE_PT = (FIXED_MEASURER_LINE_HEIGHT * DEFAULT_RUN_STYLE.fontSizePt) / 11;
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (merge: string, text: string, properties = '') =>
  `<w:tc><w:tcPr><w:vMerge ${merge}/>${properties}</w:tcPr>${p(text)}</w:tc>`;
function table(rowProperties = '', content = p('Head'), continuation = cell('', 'Ignored')) {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl>
    <w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
    <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${content}</w:tc></w:tr>
    <w:tr>${rowProperties}${continuation}</w:tr>
    <w:tr><w:tc>${p('After')}</w:tc></w:tr>
    </w:tbl>${p('Closing')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  expect(layout.pages).toHaveLength(1);
  const table = layout.pages[0]!.fragments.find(
    (f): f is TableFragmentRecord => f.kind === 'table'
  )!;
  expect(table.rows).toHaveLength(3);
  const head = table.rows[0]!.cells[0]!;
  expect(head.rowSpan).toBe(2);
  for (const block of head.blocks)
    expect(block.box.y + block.box.height).toBeLessThanOrEqual(
      head.box.y + head.box.height + 0.001
    );
  expect(table.rows[1]!.cells[0]!.blocks).toEqual([]);
  return table;
}

// A row where EVERY cell continues a merge has no cell left to size it, and the reference
// then sizes it from the end-of-cell paragraph. Captured control, row-2 content between the
// painted rules: a bare `w:p` inheriting a 6pt `w:after` measures 21.60 against a 15.60
// line. Collapsing the row to nothing lost 22.4pt on `empty-table-row-vmerge.docx`.
test('a continuation-only row reserves its own end-of-cell paragraph', () => {
  const result = table();
  expect(result.rows[1]!.box.height).toBeCloseTo(MARK_LINE_PT, 6);
  expect(result.rows[2]!.box.y).toBeCloseTo(result.rows[1]!.box.y + MARK_LINE_PT, 6);
});

test('a continuation-only row adds the paragraph spacing around that line', () => {
  const spaced = '<w:p><w:pPr><w:spacing w:before="120" w:after="240"/></w:pPr></w:p>';
  const result = table('', p('Head'), `<w:tc><w:tcPr><w:vMerge /></w:tcPr>${spaced}</w:tc>`);
  expect(result.rows[1]!.box.height).toBeCloseTo(MARK_LINE_PT + 6 + 12, 6);
});

// The other half of the rule, and the half with the corpus behind it: a continuation beside
// an ordinary cell sizes nothing. The captured control puts 18pt of `w:after` on a
// continuation next to a plain one-line cell and the reference row is the plain cell's line.
test('a continuation beside an ordinary cell leaves the row to that cell', () => {
  const spaced = '<w:p><w:pPr><w:spacing w:before="240" w:after="360"/></w:pPr></w:p>';
  const source = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl>
    <w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
    <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p('Head')}</w:tc><w:tc>${p('Plain')}</w:tc></w:tr>
    <w:tr><w:tc><w:tcPr><w:vMerge /></w:tcPr>${spaced}</w:tc><w:tc>${p('Plain 2')}</w:tc></w:tr>
    </w:tbl>${p('Closing')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const layout = layoutSemanticDocument(source.part, 0, { measurer: createFixedMeasurer() });
  const rows = layout.pages[0]!.fragments.find(
    (f): f is TableFragmentRecord => f.kind === 'table'
  )!.rows;
  expect(rows[1]!.box.height).toBeCloseTo(rows[0]!.box.height, 6);
});

test('a continuation cell measures its mark, never the content it does not paint', () => {
  const long = Array.from({ length: 4 }, (_, i) => p(`Continuation line ${i}`)).join('');
  const result = table('', p('Head'), `<w:tc><w:tcPr><w:vMerge /></w:tcPr>${long}</w:tc>`);
  expect(result.rows[1]!.box.height).toBeCloseTo(MARK_LINE_PT, 6);
  expect(result.rows[1]!.cells[0]!.blocks).toEqual([]);
});

// `w:hideMark` excludes the end-of-cell glyph from row height (17.4.25), so it keeps its
// engine-wide meaning here. NOT reference-confirmed: the captured control gives a
// continuation-only row with `w:hideMark` 23.52pt, which is neither zero nor any line the
// rule derives, and no corpus document sets `w:hideMark` on a continuation. This asserts
// what the engine does, not what the reference does.
test('w:hideMark keeps a continuation-only row at no height', () => {
  const result = table('', p('Head'), cell('', 'Ignored', '<w:hideMark/>'));
  expect(result.rows[1]!.box.height).toBe(0);
  expect(result.rows[2]!.box.y).toBe(result.rows[1]!.box.y);
});

for (const rule of ['atLeast', 'exact']) {
  test(`a continuation-only row preserves its ${rule} authored height`, () => {
    const result = table(`<w:trPr><w:trHeight w:val="720" w:hRule="${rule}"/></w:trPr>`);
    expect(result.rows[1]!.box.height).toBe(36);
  });
}

test('a continuation-only row still carries the merged content height', () => {
  const result = table('', Array.from({ length: 6 }, (_, i) => p(`Line ${i}`)).join(''));
  expect(result.rows[1]!.box.height).toBeGreaterThan(0);
  expect(result.rows[0]!.cells[0]!.blocks).toHaveLength(6);
});
