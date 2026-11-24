import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  serializeOoxmlPart,
} from '../index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';
const source = reviewTableGroupingCases.find((c) => c.name === 'format-grid-only')!;
const load = (body = source.body) => {
  const r = readOoxmlPart(
    reviewTableGroupingParts({ name: source.name, body })['word/document.xml']!,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!r.ok) throw Error(r.reason);
  return r.part;
};
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: unbound grid history is metadata, current widths survive`, () => {
    const part = load();
    expect(revisionItemsOf(part)).toHaveLength(0);
    expect(planRevisionBatch(part, action, []).ops).toHaveLength(0);
    const plan = planRevisionBatch(part, action);
    expect(plan.result).toEqual({ resolved: [], skipped: [], remaining: 0 });
    expect(plan.ops).toHaveLength(1);
    const result = applyTreeOp(part, {
      op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
    });
    if (!result.ok) throw Error(result.reason);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).not.toContain('tblGridChange');
    expect([...xml.matchAll(/<w:gridCol[^>]*w:w="(\d+)"/g)].map((m) => m[1])).toEqual([
      '2000',
      '2000',
    ]);
  });
}
for (const [name, change] of [
  [
    'unknown grid column property',
    (s: string) => s.replace('<w:gridCol ', '<w:gridCol w:unknown="keep" '),
  ],
  ['different grid shape', (s: string) => s.replace('<w:gridCol w:w="1800"/>', '')],
  [
    'another row decision',
    (s: string) => s.replace('<w:tr>', '<w:tr><w:trPr><w:ins w:id="999" w:author="Ada"/></w:trPr>'),
  ],
] as const)
  test(`${name} remains visible`, () => {
    const body = change(source.body);
    expect(body).not.toBe(source.body);
    expect(revisionItemsOf(load(body)).length).toBeGreaterThan(0);
  });
test('pretty-printed grid history has the same metadata semantics', () => {
  expect(revisionItemsOf(load(source.body.replaceAll('><', '>\n<')))).toHaveLength(0);
});
