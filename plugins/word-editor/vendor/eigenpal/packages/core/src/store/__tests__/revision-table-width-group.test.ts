import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  revisionItemsOf,
  planRevisionBatch,
  applyTreeOp,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { reviewTableGroupingCases } from './fixtures/review-table-grouping-cases.ts';
import { wordCreatedTableWidth } from './fixtures/word-created-table-width.ts';
const load = (body = wordCreatedTableWidth) => {
  const r = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!r.ok) throw Error(r.reason);
  return r.part;
};
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: Word-created nested width edit is one table decision`, () => {
    let part = load();
    const items = revisionItemsOf(part);
    // Word's Reviewing Pane shows one Formatted Table entry (2026-09-18).
    expect(items).toHaveLength(1);
    const batch = planRevisionBatch(part, action, [reviewItemKey(items[0]!)]);
    expect(batch.result.skipped).toEqual([]);
    for (const op of batch.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(0);
    const xml = serializeOoxmlPart(part);
    expect(xml).not.toMatch(/<w:\w+Change\b/);
    // Native saved accept/reject outputs: 1600/2000, other cell widths unchanged.
    expect([...xml.matchAll(/<w:tcW[^>]*w:w="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([
      2000,
      action === 'accept' ? 1600 : 2000,
      2000,
      2000,
      2000,
      2000,
      2000,
      2000,
    ]);
  });
}

test('a meaningful table snapshot stays independent of the cell-width decision', () => {
  const body = wordCreatedTableWidth.replace(
    /(<w:tblPrChange[^>]*><w:tblPr><w:tblW w:w=")4000/,
    '$13000'
  );
  expect(body).not.toBe(wordCreatedTableWidth);
  expect(revisionItemsOf(load(body))).toHaveLength(2);
});
test('an unchanged table snapshot from another author stays independent', () => {
  const body = wordCreatedTableWidth.replace(/(<w:tblPrChange[^>]*w:author=")Ada/, '$1Grace');
  expect(body).not.toBe(wordCreatedTableWidth);
  expect(revisionItemsOf(load(body))).toHaveLength(2);
});

test('a table snapshot spanning separate row groups remains independently addressable', () => {
  const source = reviewTableGroupingCases.find(
    (entry) => entry.name === 'format-grid-with-gap'
  )!.body;
  const body = source.replace(
    '</w:tblPr>',
    '<w:tblPrChange w:id="99" w:author="Ada"><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr></w:tblPrChange></w:tblPr>'
  );
  expect(revisionItemsOf(load(body))).toHaveLength(3);
});

test('a standalone table snapshot without the shared-grid bundle stays independent', () => {
  const body = wordCreatedTableWidth.replace(/<w:tblGridChange\b[^>]*>.*?<\/w:tblGridChange>/, '');
  expect(body).not.toBe(wordCreatedTableWidth);
  expect(revisionItemsOf(load(body))).toHaveLength(2);
});
