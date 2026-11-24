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

// Word single-entry accept/reject results, captured on 2026-09-18: either row
// decision leaves one entry and the shared grid history. Check both orders and
// mixed decisions so rejecting one group cannot consume the other's snapshot.
for (const name of ['format-grid-with-gap', 'format-grid-row-authors']) {
  for (const first of [0, 1]) {
    for (const actions of [
      ['accept', 'accept'],
      ['accept', 'reject'],
      ['reject', 'accept'],
      ['reject', 'reject'],
    ] as const) {
      test(`${name}: resolve ${first} first, ${actions.join('/')}`, () => {
        const fixture = reviewTableGroupingCases.find((entry) => entry.name === name)!;
        const parsed = readOoxmlPart(reviewTableGroupingParts(fixture)['word/document.xml']!, {
          name: '/word/document.xml',
          contentType: 'application/xml',
        });
        if (!parsed.ok) throw new Error(parsed.reason);
        let part = parsed.part;
        expect(revisionItemsOf(part)).toHaveLength(2);
        for (const [step, action] of actions.entries()) {
          const items = revisionItemsOf(part);
          const selected = items[step === 0 ? first : 0]!;
          const plan = planRevisionBatch(part, action, [reviewItemKey(selected)]);
          expect(plan.result.skipped).toEqual([]);
          expect(plan.result.remaining).toBe(1 - step);
          for (const op of plan.ops) {
            const result = applyTreeOp(part, op);
            if (!result.ok) throw new Error(result.reason);
            part = result.part;
          }
          expect(revisionItemsOf(part)).toHaveLength(1 - step);
          const xml = serializeOoxmlPart(part);
          expect(xml.includes('<w:tblGridChange')).toBe(step === 0);
          if (step === 0) expect(xml).toContain('<w:trPrChange');
          else {
            expect(xml).not.toMatch(/<w:\w+Change\b/);
            const heights = [...xml.matchAll(/<w:trHeight\b/g)];
            expect(heights).toHaveLength(actions.filter((value) => value === 'accept').length);
          }
          for (const text of name === 'format-grid-with-gap'
            ? ['First A', 'First B', 'Last A', 'Last B']
            : ['First A', 'First B', 'Second A', 'Second B'])
            expect(xml).toContain(text);
        }
      });
    }
  }
}

function load(body: string) {
  const parsed = readOoxmlPart(
    reviewTableGroupingParts({ name: 'grid-safety', body })['word/document.xml']!,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const source = reviewTableGroupingCases.find(
  (entry) => entry.name === 'format-grid-with-gap'
)!.body;
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: an unsupported row cannot make a standalone grid falsely report resolved`, () => {
    const index = source.lastIndexOf('<w:trPrChange');
    const body = source.slice(0, index) + source.slice(index).replace(' w:author="Ada"', '');
    expect(body).not.toBe(source);
    let part = load(body);
    expect(revisionItemsOf(part)).toHaveLength(3);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toHaveLength(1);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(plan.result.remaining);
    expect(revisionItemsOf(part)).toHaveLength(1);
    expect(serializeOoxmlPart(part)).not.toContain('<w:tblGridChange');
  });
  test(`${action}: a row identity spanning tables keeps grid history independently addressable`, () => {
    const row = source.match(/<w:tr>.*?<\/w:tr>/)![0];
    let part = load(source + `<w:tbl>${row}</w:tbl>`);
    const items = revisionItemsOf(part);
    expect(items).toHaveLength(3);
    const singleRow = items.find(
      (item) => item.formattingKind === 'trPrChange' && item.ranges.length === 1
    )!;
    expect(singleRow).toBeDefined();
    const plan = planRevisionBatch(part, action, [reviewItemKey(singleRow)]);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const result = applyTreeOp(part, op);
      if (!result.ok) throw new Error(result.reason);
      part = result.part;
    }
    expect(revisionItemsOf(part)).toHaveLength(2);
    expect(revisionItemsOf(part)).toHaveLength(plan.result.remaining);
    expect(serializeOoxmlPart(part)).toContain('<w:tblGridChange');
  });
}

test('a rejection with a non-restorable row history keeps the shared grid pending', () => {
  const body = source.replace(/(<w:trPrChange[^>]*>)[^]*?(<\/w:trPrChange>)/, '$1$2');
  expect(body).not.toBe(source);
  let part = load(body);
  const plan = planRevisionBatch(part, 'reject');
  expect(plan.result.skipped).toHaveLength(1);
  expect(plan.result.resolved).toHaveLength(1);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw new Error(result.reason);
    part = result.part;
  }
  expect(revisionItemsOf(part)).toHaveLength(plan.result.remaining);
  expect(serializeOoxmlPart(part)).toContain('<w:tblGridChange');
});
test('partial row deletion reports the queue after adjacent formatting groups coalesce', () => {
  const row = (id: number) =>
    `<w:tr><w:trPr><w:trHeight w:val="600"/><w:trPrChange w:id="${id}" w:author="Ada"><w:trPr/></w:trPrChange></w:trPr><w:tc><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:tc></w:tr>`;
  const middle =
    '<w:tr><w:trPr><w:del w:id="2" w:author="Bob"/></w:trPr><w:tc><w:p/></w:tc></w:tr>';
  let part = load(`<w:tbl>${row(1)}${middle}${row(3)}</w:tbl>`);
  const before = revisionItemsOf(part);
  expect(before).toHaveLength(3);
  const rowDecision = before.find((item) => item.revisionKind === 'structural')!;
  const plan = planRevisionBatch(part, 'accept', [reviewItemKey(rowDecision)]);
  expect(plan.result.remaining).toBe(1);
  for (const op of plan.ops) {
    const result = applyTreeOp(part, op);
    if (!result.ok) throw new Error(result.reason);
    part = result.part;
  }
  expect(revisionItemsOf(part)).toHaveLength(1);
});
