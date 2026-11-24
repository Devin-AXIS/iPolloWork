import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { applyTreeOp, type TreeDocOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession, layoutSemanticDocument, linesOf } from '../index.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import type { TableFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (content: string, properties = '') =>
  `<w:tr><w:trPr>${properties}</w:trPr><w:tc>${content}</w:tc></w:tr>`;
const table = (rows: string) => `<w:tbl><w:tblPr><w:tblW w:w="1800" w:type="dxa"/>
  <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
  </w:tblPr><w:tblGrid><w:gridCol w:w="1800"/></w:tblGrid>${rows}</w:tbl>`;
const options = {
  geometry: { width: 120, height: 60, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  measurer: {
    measure: (text: string) => text.length * 4,
    lineMetrics: () => ({ height: 10, baseline: 8 }),
  },
};
function source(inner: string, outerProperties = '') {
  const xml = `<w:document xmlns:w="${W}"><w:body>${p('prefix 0')}${p('prefix 1')}${p('prefix 2')}
    ${table(row(inner, outerProperties))}${p('after')}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const ordinary = () => table(Array.from({ length: 5 }, (_, i) => row(p(`inner ${i}`))).join(''));

test('nested rows fill the remaining band and resume without duplicates or changed source', () => {
  const part = source(ordinary());
  const original = serializeOoxmlPart(part);
  const layout = layoutSemanticDocument(part, 0, options);
  expect(layout.pages).toHaveLength(2);
  const nested = layout.pages.flatMap((page) =>
    page.fragments.flatMap((block) =>
      block.kind === 'table'
        ? block.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              cell.blocks.filter((child): child is TableFragmentRecord => child.kind === 'table')
            )
          )
        : []
    )
  );
  expect(nested.map((t) => t.rows.length)).toEqual([3, 2]);
  expect(nested.map((t) => t.fragmentIndex)).toEqual([0, 1]);
  expect(new Set(nested.map((t) => t.id)).size).toBe(2);
  expect(nested.flatMap((t) => t.rows.map((row) => row.rowIndex))).toEqual([0, 1, 2, 3, 4]);
  expect(nested.map((t) => [t.box.y, t.box.height])).toEqual([
    [30, 30],
    [0, 20],
  ]);
  const lines = linesOf(layout);
  expect(lines.map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'prefix 0',
    'prefix 1',
    'prefix 2',
    'inner 0',
    'inner 1',
    'inner 2',
    'inner 3',
    'inner 4',
    'after',
  ]);
  expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
  expect(serializeOoxmlPart(part)).toBe(original);
  const session = createLayoutSession();
  for (let revision = 0; revision < 2; revision++)
    expect(layoutSemanticDocument(part, revision, { ...options, session }).pages).toEqual(
      layout.pages
    );
});

test('an atomic outer row still carries its nested table whole', () => {
  const layout = layoutSemanticDocument(source(ordinary(), '<w:cantSplit/>'), 0, options);
  expect(layout.pages).toHaveLength(2);
  expect(layout.pages[0]!.fragments.every((block) => block.kind !== 'table')).toBe(true);
});

test('a nested row that cannot start here moves whole before its later rows continue', () => {
  const inner = table(row(p('a') + p('b') + p('c') + p('d'), '<w:cantSplit/>') + row(p('e')));
  const layout = layoutSemanticDocument(source(inner), 0, options);
  expect(layout.pages[0]!.fragments.every((block) => block.kind !== 'table')).toBe(true);
  expect(linesOf(layout).map((line) => line.spans.map((span) => span.text).join(''))).toEqual([
    'prefix 0',
    'prefix 1',
    'prefix 2',
    'a',
    'b',
    'c',
    'd',
    'e',
    'after',
  ]);
});

test('nested repeated-header tables retain their atomic fallback', () => {
  const inner = table(row(p('head'), '<w:tblHeader/>') + row(p('a')) + row(p('b')) + row(p('c')));
  const layout = layoutSemanticDocument(source(inner), 0, options);
  expect(layout.pages[0]!.fragments.every((block) => block.kind !== 'table')).toBe(true);
  expect(
    linesOf(layout).filter((line) => line.spans.some((span) => span.text === 'head'))
  ).toHaveLength(1);
});

const texts = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  linesOf(layout).map((line) => line.spans.map((span) => span.text).join(''));
const many = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => p(`${prefix}${i}`)).join('');
const nestedFragments = (layout: ReturnType<typeof layoutSemanticDocument>) =>
  layout.pages.flatMap((page) =>
    page.fragments.flatMap((block) =>
      block.kind === 'table'
        ? block.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              cell.blocks.filter((child): child is TableFragmentRecord => child.kind === 'table')
            )
          )
        : []
    )
  );

test('a nested row taller than the page splits inside its cell where it starts', () => {
  const part = source(table(row(p('first')) + row(many('x', 9)) + row(p('last'))));
  const layout = layoutSemanticDocument(part, 0, options);
  expect(texts(layout)).toEqual([
    'prefix 0',
    'prefix 1',
    'prefix 2',
    'first',
    ...Array.from({ length: 9 }, (_, i) => `x${i}`),
    'last',
    'after',
  ]);
  const nested = nestedFragments(layout);
  // The tall row starts below `first` on page 1 and continues on the next page.
  expect(nested[0]!.rows.map((row) => [row.rowIndex, row.hasContinuation === true])).toEqual([
    [0, false],
    [1, true],
  ]);
  expect(nested[1]!.rows[0]!.rowIndex).toBe(1);
  for (const page of layout.pages)
    for (const block of page.fragments)
      expect(block.box.y + block.box.height).toBeLessThanOrEqual(60.001);
  const session = createLayoutSession();
  for (let revision = 0; revision < 2; revision++)
    expect(layoutSemanticDocument(part, revision, { ...options, session }).pages).toEqual(
      layout.pages
    );
});

test('a nested header table taller than a fresh page splits instead of failing', () => {
  const inner = table(row(p('head'), '<w:tblHeader/>') + row(many('y', 8)));
  const xml = `<w:document xmlns:w="${W}"><w:body>${table(row(inner))}</w:body></w:document>`;
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  const layout = layoutSemanticDocument(result.part, 0, options);
  expect(texts(layout)).toEqual(['head', ...Array.from({ length: 8 }, (_, i) => `y${i}`), '']);
  expect(layout.pages).toHaveLength(2);
});

const mergeCell = (content: string, merge = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/>${merge}</w:tcPr>${content}</w:tc>`;
/** Two rows whose first cells merge vertically under `head`. */
const mergedPair = (head: string, first: string, second: string) =>
  `<w:tr>${mergeCell(p(head), '<w:vMerge w:val="restart"/>')}${mergeCell(p(first))}</w:tr>` +
  `<w:tr>${mergeCell('<w:p/>', '<w:vMerge/>')}${mergeCell(p(second))}</w:tr>`;
const mergedTable = (rows: string) => `<w:tbl><w:tblPr><w:tblW w:w="1800" w:type="dxa"/>
  <w:tblCellMar>${['top', 'bottom', 'left', 'right'].map((side) => `<w:${side} w:w="0" w:type="dxa"/>`).join('')}</w:tblCellMar>
  </w:tblPr><w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="900"/></w:tblGrid>${rows}</w:tbl>`;
const merged = () => mergedTable(mergedPair('m', 'a0', 'a1') + mergedPair('n', 'a2', 'a3'));

test('a nested table with vertical merges breaks between the rows of a merge', () => {
  // The nested table breaks where the band ends, here between the head row of the second
  // merge and the row that continues it. It does not move the table whole.
  const part = source(merged());
  const layout = layoutSemanticDocument(part, 0, options);
  expect(layout.pages).toHaveLength(2);
  expect(texts(layout)).toEqual([
    'prefix 0',
    'prefix 1',
    'prefix 2',
    'm',
    'a0',
    'a1',
    'n',
    'a2',
    'a3',
    'after',
  ]);
  const nested = nestedFragments(layout);
  expect(nested.map((t) => t.rows.map((row) => row.rowIndex))).toEqual([[0, 1, 2], [3]]);
  expect(nested.map((t) => [t.box.y, t.box.height])).toEqual([
    [30, 30],
    [0, 10],
  ]);
  // The head keeps its text on the first page. The merged cell continues on the next page
  // as an empty cell that paints like the merge.
  const head = nested[0]!.rows[2]!.cells[0]!;
  expect([head.rowSpan, head.box.height]).toEqual([1, 10]);
  const carried = nested[1]!.rows[0]!.cells[0]!;
  expect(carried.blocks).toEqual([]);
  expect([carried.vMergeContinue, carried.paintInert === true, carried.box.height]).toEqual([
    false,
    false,
    10,
  ]);
  // The first merge fits the band, so it stays one cell over both of its rows.
  expect(nested[0]!.rows[0]!.cells[0]!.rowSpan).toBe(2);
  for (const page of layout.pages)
    for (const block of page.fragments)
      expect(block.box.y + block.box.height).toBeLessThanOrEqual(60.001);
  const session = createLayoutSession();
  for (let revision = 0; revision < 2; revision++)
    expect(layoutSemanticDocument(part, revision, { ...options, session }).pages).toEqual(
      layout.pages
    );
});

test('edits move the break inside a nested merge as a fresh layout does', () => {
  let part = source(merged());
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  const first = layoutSemanticDocument(part, 0, { ...options, session, cache });
  const prefix = first.pages[0]!.fragments[0]!;
  const head = nestedFragments(first)[0]!.rows[2]!.cells[0]!.blocks[0]!;
  if (prefix.kind !== 'paragraph' || head.kind !== 'paragraph')
    throw new Error('expected paragraphs');
  // The first paragraph grows to two lines, then to three, and then shrinks back to one.
  // Then the head of the second merge grows taller than its own row. That edit checks only
  // that the edited layout equals a fresh one.
  const edits: TreeDocOp[] = [
    { op: 'insertText', paragraphId: prefix.paragraphId, offset: 8, text: 'x'.repeat(25) },
    { op: 'insertText', paragraphId: prefix.paragraphId, offset: 33, text: 'x'.repeat(5) },
    { op: 'deleteText', paragraphId: prefix.paragraphId, start: 8, end: 38 },
    { op: 'insertText', paragraphId: head.paragraphId, offset: 1, text: ' nnnnnnnnnnn' },
  ];
  const breaks: number[][][] = [];
  for (const [index, op] of edits.entries()) {
    const edit = applyTreeOp(part, op);
    if (!edit.ok) throw new Error(edit.reason);
    part = edit.part;
    const warm = layoutSemanticDocument(part, index + 1, { ...options, session, cache });
    const cold = readOoxmlPart(serializeOoxmlPart(part), {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!cold.ok) throw new Error(cold.reason);
    expect(warm.pages).toEqual(layoutSemanticDocument(cold.part, 0, options).pages);
    breaks.push(nestedFragments(warm).map((t) => t.rows.map((row) => row.rowIndex)));
  }
  expect(breaks.slice(0, 3)).toEqual([
    [
      [0, 1],
      [2, 3],
    ],
    [[0], [1, 2, 3]],
    [[0, 1, 2], [3]],
  ]);
});

/** A plain row, then a merge whose head holds three lines over two one-line rows. */
const tallMerge = (rule: string) => {
  const tr = (cells: string) => `<w:tr><w:trPr>${rule}</w:trPr>${cells}</w:tr>`;
  return mergedTable(
    tr(mergeCell(p('r0')) + mergeCell(p('s0'))) +
      tr(
        mergeCell(p('m1') + p('m2') + p('m3'), '<w:vMerge w:val="restart"/>') + mergeCell(p('s1'))
      ) +
      tr(mergeCell('<w:p/>', '<w:vMerge/>') + mergeCell(p('s2')))
  );
};

for (const [name, rule] of [
  ['auto', ''],
  ['exact', '<w:trHeight w:val="240" w:hRule="exact"/>'],
] as const) {
  test(`a merge whose text outgrows its head row moves whole (${name} rows)`, () => {
    const part = source(tallMerge(rule));
    const layout = layoutSemanticDocument(part, 0, options);
    const nested = nestedFragments(layout);
    // The merge starts the next page; none of its text is lost or split from its rows.
    expect(nested.map((t) => t.rows.map((row) => row.rowIndex))).toEqual([[0], [1, 2]]);
    expect(texts(layout)).toEqual(
      expect.arrayContaining(['r0', 's0', 'm1', 'm2', 'm3', 's1', 's2'])
    );
    expect(nested[1]!.rows[0]!.cells[0]!.rowSpan).toBe(2);
    const session = createLayoutSession();
    for (let revision = 0; revision < 2; revision++)
      expect(layoutSemanticDocument(part, revision, { ...options, session }).pages).toEqual(
        layout.pages
      );
  });
}
