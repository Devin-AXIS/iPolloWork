import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  planRevisionBatch,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from './fixtures/review-table-grouping-cases.ts';
const load = (name: string) => {
  const fixture = reviewTableGroupingCases.find((c) => c.name === name)!;
  const r = readOoxmlPart(reviewTableGroupingParts(fixture)['word/document.xml']!, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!r.ok) throw Error(r.reason);
  return r.part;
};
for (const [name, action] of [
  ['nested-plain-ins', 'reject'],
  ['nested-plain-del', 'accept'],
  ['nested-opposite-row-ins', 'reject'],
  ['nested-opposite-row-del', 'accept'],
] as const) {
  test(`${action} ${name}: preserve Word's nested table and pending outer row`, () => {
    let part = load(name);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toHaveLength(1);
    expect(plan.result.skipped[0]!.reason).toBe('retained-structure');
    expect(plan.result.remaining).toBe(1);
    for (const op of plan.ops) {
      const r = applyTreeOp(part, op);
      if (!r.ok) throw Error(r.reason);
      part = r.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(1);
    const xml = serializeOoxmlPart(part);
    expect(xml.match(/<w:tbl\b/g)).toHaveLength(2);
    expect(xml.match(/<w:tr\b/g)).toHaveLength(2);
    expect(xml).not.toContain('>Outer<');
    expect(xml).not.toContain('>Neighbour<');
    expect(xml).toContain(name.includes('plain') ? '>Existing A<' : '>Nested A<');
    const retry = planRevisionBatch(part, action);
    expect(retry.ops).toEqual([]);
    expect(retry.result).toMatchObject({ resolved: [], remaining: 1 });
    expect(retry.result.skipped).toHaveLength(1);
    const other = planRevisionBatch(part, action === 'accept' ? 'reject' : 'accept');
    expect(other.result.skipped).toEqual([]);
    for (const op of other.ops) {
      const r = applyTreeOp(part, op);
      if (!r.ok) throw Error(r.reason);
      part = r.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(0);
    expect(serializeOoxmlPart(part).match(/<w:tbl\b/g)).toHaveLength(2);
  });
  test(`${action} ${name}: direct core resolution also preserves the nested table`, () => {
    const result = applyTreeOp(load(name), {
      op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
    });
    if (!result.ok) throw Error(result.reason);
    expect(revisionItemsOf(result.part)).toHaveLength(1);
    expect(serializeOoxmlPart(result.part).match(/<w:tbl\b/g)).toHaveLength(2);
  });
}

test('custom XML cell wrappers retain an existing nested table', () => {
  const fixture = reviewTableGroupingCases.find((c) => c.name === 'nested-plain-ins')!;
  let xml = reviewTableGroupingParts(fixture)['word/document.xml']!;
  xml = xml.replace('</w:trPr><w:tc>', '</w:trPr><w:customXml w:element="cells"><w:tc>');
  const end = xml.lastIndexOf('</w:tr>');
  xml = xml.slice(0, end) + '</w:customXml>' + xml.slice(end);
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  let part = read.part;
  const plan = planRevisionBatch(part, 'reject');
  expect(plan.result.remaining).toBe(1);
  expect(plan.result.skipped[0]?.reason).toBe('retained-structure');
  for (const op of plan.ops) {
    const next = applyTreeOp(part, op);
    if (!next.ok) throw Error(next.reason);
    part = next.part;
  }
  expect(serializeOoxmlPart(part).match(/<w:tbl\b/g)).toHaveLength(2);
});

for (const kind of ['ins', 'del'] as const) {
  test(`nested ${kind}: a removed ancestor completes its retained inner row decision`, () => {
    let part = load(`nested-deep-${kind}`);
    const inner = revisionItemsOf(part).find(
      (item) => item.revisionKind === 'structural' && item.text.includes('Middle')
    )!;
    const first = planRevisionBatch(part, kind === 'ins' ? 'accept' : 'reject', [
      reviewItemKey(inner),
    ]);
    for (const op of first.ops) {
      const next = applyTreeOp(part, op);
      if (!next.ok) throw Error(next.reason);
      part = next.part;
    }
    const plan = planRevisionBatch(part, kind === 'ins' ? 'reject' : 'accept');
    expect(plan.result.skipped).toEqual([]);
    expect(plan.result.remaining).toBe(0);
    for (const op of plan.ops) {
      const next = applyTreeOp(part, op);
      if (!next.ok) throw Error(next.reason);
      part = next.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(0);
  });
}
