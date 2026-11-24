// A table alignment change applies to the rows that hold row or cell history. It is one entry
// with that history, it stays pending when a cell decision takes the history from its row, and
// rejecting it keeps the current alignment in the other rows.
import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  reviewItemKey,
  revisionItemsOf,
  serializeOoxmlPart,
  type OoxmlPart,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const width = (twips: number) => `<w:tcW w:w="${twips}" w:type="dxa"/>`;
const snapshot = (id: number, author = 'Ann') =>
  `<w:tcPrChange w:id="${id}" w:author="${author}"><w:tcPr>${width(3000)}</w:tcPr></w:tcPrChange>`;
const cell = (text: string, history = '') =>
  `<w:tc><w:tcPr>${width(3000)}${history}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const insertedCell =
  `<w:tc><w:tcPr>${width(1500)}<w:cellIns w:id="4" w:author="Ann"/>` +
  `<w:tcPrChange w:id="5" w:author="Ann"><w:tcPr>${width(3000)}</w:tcPr></w:tcPrChange></w:tcPr>` +
  '<w:p><w:pPr><w:rPr><w:ins w:id="6" w:author="Ann"/></w:rPr></w:pPr>' +
  '<w:ins w:id="7" w:author="Ann"><w:r><w:t>c</w:t></w:r></w:ins></w:p></w:tc>';

function load(rows: readonly string[], grid = ''): OoxmlPart {
  const columns = '<w:gridCol w:w="3000"/>'.repeat(3);
  const body =
    '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:jc w:val="center"/>' +
    '<w:tblLayout w:type="fixed"/><w:tblPrChange w:id="1" w:author="Cy"><w:tblPr>' +
    '<w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr></w:tblPrChange>' +
    `</w:tblPr><w:tblGrid>${columns}${grid && `<w:tblGridChange w:id="2"><w:tblGrid>${columns}</w:tblGrid></w:tblGridChange>`}</w:tblGrid>` +
    rows.map((row) => `<w:tr>${row}</w:tr>`).join('') +
    '</w:tbl><w:p/>';
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

function decide(part: OoxmlPart, action: 'accept' | 'reject', keys?: string[]): OoxmlPart {
  const plan = planRevisionBatch(part, action, keys, undefined, { explicit: keys !== undefined });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw Error(result.reason);
    part = result.part;
  }
  return part;
}

/** The table's own alignment, then each row as `exception/row` alignment. */
function alignments(part: OoxmlPart): string[] {
  const xml = serializeOoxmlPart(part);
  const tblPr = xml.match(/<w:tblPr>(.*?)<\/w:tblPr>/s)![1]!;
  const own = /<w:jc w:val="(\w+)"/.exec(tblPr.replace(/<w:tblPrChange.*<\/w:tblPrChange>/s, ''));
  return [
    own?.[1] ?? '-',
    ...[...xml.matchAll(/<w:tr>(.*?)<\/w:tr>/gs)].map(([, row]) => {
      const exception = /<w:tblPrEx><w:jc w:val="(\w+)"\/><\/w:tblPrEx>/.exec(row!)?.[1];
      const own = /<w:trPr>(?:(?!<\/w:trPr>).)*?<w:jc w:val="(\w+)"/s.exec(row!)?.[1];
      return `${exception ?? '-'}/${own ?? '-'}`;
    }),
  ];
}

const card = (part: OoxmlPart, kind: string) =>
  revisionItemsOf(part).find((item) => item.revisionKind === kind)!;

test('an alignment beside only an unchanged grid snapshot is no pending change', () => {
  const part = load([cell('a') + cell('b'), cell('x') + cell('y')], 'grid');
  expect(revisionItemsOf(part)).toEqual([]);
  expect(alignments(decide(part, 'reject'))).toEqual(['center', '-/-', '-/-']);
});

test('the alignment and cell history are one card named after the cell history', () => {
  const part = load([cell('a', snapshot(3, 'Bob')) + cell('b'), cell('x') + cell('y')]);
  expect(revisionItemsOf(part).map((item) => [item.author, item.formattingKind])).toEqual([
    ['Bob', 'tblPrChange'],
  ]);
});

for (const [name, rows, expected] of [
  [
    'the first row',
    [cell('a', snapshot(3)) + cell('b'), cell('x') + cell('y')],
    ['-', '-/-', 'center/center'],
  ],
  [
    'the second row',
    [cell('a') + cell('b'), cell('x', snapshot(3)) + cell('y')],
    ['center', '-/-', 'left/-'],
  ],
  ['every row', [cell('a', snapshot(3)) + cell('b'), cell('x', snapshot(8))], ['-', '-/-', '-/-']],
] as const)
  test(`rejecting the alignment with history in ${name} keeps it in the other rows`, () => {
    const part = load(rows);
    expect(alignments(decide(part, 'reject', [reviewItemKey(card(part, 'format'))]))).toEqual([
      ...expected,
    ]);
    expect(alignments(decide(part, 'reject'))).toEqual([...expected]);
  });

const withInsertedCell = () =>
  load([cell('a') + cell('b') + insertedCell, cell('x') + cell('y') + cell('z')]);

test('the inserted cell and its text are cards of their own beside the alignment', () => {
  const part = withInsertedCell();
  expect(revisionItemsOf(part).map((item) => [item.revisionKind, item.formattingKind])).toEqual([
    ['format', 'tblPrChange'],
    ['structural', undefined],
    ['insert', undefined],
  ]);
});

test('rejecting the inserted cell first keeps the alignment pending for its row', () => {
  let part = withInsertedCell();
  const alignment = reviewItemKey(card(part, 'format'));
  part = decide(part, 'reject', [reviewItemKey(card(part, 'structural'))]);
  expect(serializeOoxmlPart(part)).not.toContain('>c<');
  expect(revisionItemsOf(part).map(reviewItemKey)).toEqual([alignment]);
  expect(serializeOoxmlPart(part)).toMatch(/<w:trPrChange w:author="Ann" w:id="\d+"><w:trPr\/>/);
  const ordered = alignments(decide(part, 'reject', [alignment]));
  expect(ordered).toEqual(['-', '-/-', 'center/center']);
  expect(alignments(decide(withInsertedCell(), 'reject'))).toEqual(ordered);
});

test('accepting the inserted cell first keeps its width change with the alignment', () => {
  let part = withInsertedCell();
  const alignment = reviewItemKey(card(part, 'format'));
  part = decide(part, 'accept', [reviewItemKey(card(part, 'structural'))]);
  expect(revisionItemsOf(part).map(reviewItemKey)).toContain(alignment);
  expect(serializeOoxmlPart(part)).toContain('<w:tcPrChange w:author="Ann" w:id="5">');
  expect(alignments(decide(part, 'reject', [alignment]))).toEqual(['-', '-/-', 'center/center']);
});

test('rejecting the alignment first keeps the inserted cell pending', () => {
  let part = withInsertedCell();
  part = decide(part, 'reject', [reviewItemKey(card(part, 'format'))]);
  expect(serializeOoxmlPart(part)).toContain('>c<');
  expect(revisionItemsOf(part).map((item) => item.revisionKind)).toEqual(['structural', 'insert']);
  expect(alignments(part)).toEqual(['-', '-/-', 'center/center']);
});

test('rejecting the alignment adds it to a row exception that is already there', () => {
  const exception =
    '<w:tblPrEx><w:tblCellSpacing w:w="20" w:type="dxa"/>' +
    '<w:tblPrExChange w:id="9" w:author="Ann"><w:tblPrEx/></w:tblPrExChange></w:tblPrEx>';
  const part = load([cell('a') + cell('b'), exception + cell('x') + cell('y')]);
  const xml = serializeOoxmlPart(decide(part, 'reject'));
  const second = [...xml.matchAll(/<w:tr>(.*?)<\/w:tr>/gs)][1]![1]!;
  expect(second.match(/<w:tblPrEx>/g)).toHaveLength(1);
  expect(second).toContain('<w:tblPrEx><w:jc w:val="left"/>');
});
