// How tracked changes group into review items: inserted or deleted cells by column, a move
// destination with no source as an insertion, and paragraph property changes across cells.
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
let next = 100;
const ann = (author = 'Ann', date = '2026-01-01T00:00:00Z') =>
  `w:id="${next++}" w:author="${author}" w:date="${date}"`;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (content: string, marker = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/>${marker}</w:tcPr>${content}</w:tc>`;
const table = (rows: readonly string[], columns: number) =>
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>' +
  '<w:gridCol w:w="1500"/>'.repeat(columns) +
  `</w:tblGrid>${rows.map((row) => `<w:tr>${row}</w:tr>`).join('')}</w:tbl>`;
const inserted = (text: string, author?: string, date?: string) =>
  cell(p(text), `<w:cellIns ${ann(author, date)}/>`);
const deleted = (text: string) => cell(p(text), `<w:cellDel ${ann()}/>`);

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const count = (body: string) => revisionItemsOf(load(p('Before') + body + p('After'))).length;

test('inserted cells in one column of adjacent rows are one change', () => {
  expect(count(table([cell(p('a1')) + inserted('a2'), cell(p('b1')) + inserted('b2')], 2))).toBe(1);
  // Three rows, and different dates by one author, stay one change.
  expect(
    count(
      table(
        [
          cell(p('a1')) + inserted('a2'),
          cell(p('b1')) + inserted('b2', 'Ann', '2026-03-01T00:00:00Z'),
          cell(p('c1')) + inserted('c2'),
        ],
        2
      )
    )
  ).toBe(1);
  expect(count(table([cell(p('a1')) + deleted('a2'), cell(p('b1')) + deleted('b2')], 2))).toBe(1);
});

test('inserted cells side by side, apart, or by different authors stay separate', () => {
  expect(count(table([cell(p('a1')) + inserted('a2') + inserted('a3')], 3))).toBe(2);
  expect(
    count(
      table(
        [
          cell(p('a1')) + inserted('a2') + inserted('a3'),
          cell(p('b1')) + inserted('b2') + inserted('b3'),
        ],
        3
      )
    )
  ).toBe(2);
  expect(
    count(
      table(
        [
          cell(p('a1')) + inserted('a2'),
          cell(p('m1')) + cell(p('m2')),
          cell(p('b1')) + inserted('b2'),
        ],
        2
      )
    )
  ).toBe(2);
  expect(
    count(table([cell(p('a1')) + inserted('a2'), cell(p('b1')) + inserted('b2', 'Bob')], 2))
  ).toBe(2);
});

/** A paragraph holding a move destination with no source, with a moved mark when asked. */
const moved = (text: string, mark: 'moved' | 'inserted' | '' = '', rangeOverMark = false) => {
  const range = next++;
  const rPr =
    mark === 'moved'
      ? `<w:rPr><w:moveTo ${ann()}/></w:rPr>`
      : mark === 'inserted'
        ? `<w:rPr><w:ins ${ann()}/></w:rPr>`
        : '';
  const end = `<w:moveToRangeEnd w:id="${range}"/>`;
  return (
    `<w:p><w:pPr>${rPr}</w:pPr><w:moveToRangeStart w:id="${range}" w:author="Ann" w:name="m1"/>` +
    `<w:moveTo ${ann()}><w:r><w:t>${text}</w:t></w:r></w:moveTo>${rangeOverMark ? '' : end}</w:p>` +
    (rangeOverMark ? end : '')
  );
};

test('a moved mark lists with the moved text beside it when the move has no source', () => {
  // The range and the text are two entries; the mark joins the text.
  expect(count(moved('Moved'))).toBe(2);
  expect(count(moved('Moved', 'moved'))).toBe(2);
  expect(count(moved('Moved', 'inserted'))).toBe(2);
  // A range that covers the mark: the moved text and the mark are the move's two entries.
  expect(count(moved('Moved', 'moved', true))).toBe(2);
});

test('a moved text with no source lists with the inserted row that holds it', () => {
  const row =
    `<w:trPr><w:ins ${ann()}/></w:trPr>` +
    cell(
      `<w:p><w:pPr><w:rPr><w:ins ${ann()}/></w:rPr></w:pPr><w:ins ${ann()}><w:r><w:t>New</w:t></w:r></w:ins></w:p>`
    ) +
    cell(moved('Moved', 'inserted'));
  expect(count(table([cell(p('a1')) + cell(p('a2')), row], 2))).toBe(2);
});

function decide(part: OoxmlPart, action: 'accept' | 'reject'): string {
  let current = part;
  for (const op of planRevisionBatch(part, action).ops) {
    const result = applyTreeOp(current, op);
    if (!result.ok) throw Error(result.reason);
    current = result.part;
  }
  return serializeOoxmlPart(current);
}
const paragraphs = (xml: string) =>
  [...xml.matchAll(/<w:p\b[^>]*>(.*?)<\/w:p>/gs)].map((match) =>
    [...match[1]!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join('')
  );

test('rejecting a moved mark outside its move range removes the mark and keeps the text', () => {
  expect(
    paragraphs(decide(load(p('Before') + moved('Moved', 'moved') + p('After')), 'reject'))
  ).toEqual(['Before', 'MovedAfter']);
  // A range that stays open over the mark keeps the mark, as the text.
  expect(
    paragraphs(decide(load(p('Before') + moved('Moved', 'moved', true) + p('After')), 'reject'))
  ).toEqual(['Before', 'Moved', 'After']);
});

const pPr = (text: string, current: string, old: string) =>
  `<w:p><w:pPr>${current}<w:pPrChange ${ann()}><w:pPr>${old}</w:pPr></w:pPrChange></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;
const center = '<w:jc w:val="center"/>';
const left = '<w:jc w:val="left"/>';
const indent = '<w:ind w:left="400"/>';

test('the same paragraph property change continues into the next cell of the row', () => {
  expect(count(table([cell(pPr('One', center, left)) + cell(pPr('Two', center, left))], 2))).toBe(
    1
  );
  expect(count(table([cell(pPr('One', center, left)) + cell(pPr('Two', indent, ''))], 2))).toBe(2);
  // Into the first cell of a table right after the paragraph, but not into the next row.
  expect(
    count(pPr('One', center, left) + table([cell(pPr('Two', center, left)) + cell(p('z'))], 2))
  ).toBe(1);
  expect(count(table([cell(pPr('One', center, left)), cell(pPr('Two', center, left))], 1))).toBe(2);
});

test('a moved mark of an empty paragraph inside a move range stays on reject', () => {
  // The range opens before an empty paragraph and closes after it: its mark is in the range.
  const range = next++;
  const body =
    p('Before') +
    `<w:p><w:moveToRangeStart w:id="${range}" w:author="Ann" w:name="m2"/>` +
    `<w:moveTo ${ann()}><w:r><w:t>One</w:t></w:r></w:moveTo></w:p>` +
    `<w:p><w:pPr><w:rPr><w:moveTo ${ann()}/></w:rPr></w:pPr></w:p>` +
    `<w:p><w:moveTo ${ann()}><w:r><w:t>Two</w:t></w:r></w:moveTo></w:p>` +
    `<w:moveToRangeEnd w:id="${range}"/>` +
    p('After');
  expect(paragraphs(decide(load(body), 'reject'))).toEqual(['Before', 'One', '', 'Two', 'After']);
});

test('one decision on a column of inserted cells decides every cell in it', () => {
  const part = load(
    p('Before') +
      table([cell(p('a1')) + inserted('a2'), cell(p('b1')) + inserted('b2')], 2) +
      p('After')
  );
  const [item] = revisionItemsOf(part);
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(item!)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  let current = part;
  for (const op of plan.ops) {
    const result = applyTreeOp(current, op);
    if (!result.ok) throw Error(result.reason);
    current = result.part;
  }
  const xml = serializeOoxmlPart(current);
  expect(xml).not.toContain('a2');
  expect(xml).not.toContain('b2');
  expect(revisionItemsOf(current)).toEqual([]);
});

test('one decision on a paragraph property change across two cells decides both', () => {
  const part = load(table([cell(pPr('One', center, left)) + cell(pPr('Two', center, left))], 2));
  const [item] = revisionItemsOf(part);
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(item!)], undefined, {
    explicit: true,
  });
  expect(plan.result.skipped).toEqual([]);
  let current = part;
  for (const op of plan.ops) {
    const result = applyTreeOp(current, op);
    if (!result.ok) throw Error(result.reason);
    current = result.part;
  }
  expect(serializeOoxmlPart(current)).not.toContain('center');
  expect(revisionItemsOf(current)).toEqual([]);
});
