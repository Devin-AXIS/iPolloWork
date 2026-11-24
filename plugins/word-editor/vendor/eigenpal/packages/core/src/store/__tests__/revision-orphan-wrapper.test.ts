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
const source = reviewTableGroupingCases.find((c) => c.name === 'move-range-wrapper-destination')!;
const load = (body = source.body) => {
  const r = readOoxmlPart(
    reviewTableGroupingParts({ name: source.name, body })['word/document.xml']!,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!r.ok) throw Error(r.reason);
  return r.part;
};
for (const action of ['accept', 'reject'] as const)
  for (const target of ['moveTo', 'insert', 'all'] as const) {
    test(`${action} orphan wrapper ${target}: native remaining decisions and text`, () => {
      let part = load();
      const items = revisionItemsOf(part);
      expect(items.map((i) => i.revisionKind)).toEqual(['moveTo', 'insert']);
      expect(items.every((i) => i.text === 'Destination')).toBe(true);
      const keys =
        target === 'all'
          ? undefined
          : [reviewItemKey(items.find((i) => i.revisionKind === target)!)];
      const plan = planRevisionBatch(part, action, keys);
      expect(plan.result.skipped).toEqual([]);
      for (const op of plan.ops) {
        const r = applyTreeOp(part, op);
        if (!r.ok) throw Error(r.reason);
        part = r.part;
      }
      const xml = serializeOoxmlPart(part);
      const insertionAccepted = target === 'insert' && action === 'accept';
      expect(revisionItemsOf(part).map((i) => i.revisionKind)).toEqual(
        insertionAccepted ? ['moveTo'] : []
      );
      expect(plan.result.remaining).toBe(insertionAccepted ? 1 : 0);
      expect(plan.result.resolved).toHaveLength(insertionAccepted ? 1 : 2);
      expect(xml.includes('>Destination<')).toBe(!(target === 'insert' && action === 'reject'));
      expect(xml.includes('<w:moveToRangeStart')).toBe(insertionAccepted);
      expect(xml).not.toMatch(/<w:moveTo\b/);
    });
  }
for (const action of ['accept', 'reject'] as const) {
  for (const target of ['moveTo', 'insert'] as const)
    test(`${action} orphan ${target} cannot consume a shared insertion identity partially`, () => {
      const wrapper = source.body.match(/<w:moveTo\b.*?<\/w:moveTo>/)![0];
      const part = load(source.body + `<w:p>${wrapper}</w:p>`);
      const move = revisionItemsOf(part).find(
        (i) => i.revisionKind === target && i.ranges[0]?.start.paragraphId.includes('#')
      )!;
      const plan = planRevisionBatch(part, action, [reviewItemKey(move)]);
      expect(plan.ops).toEqual([]);
      expect(plan.result.skipped.some((s) => s.reason === 'incomplete-group')).toBe(true);
    });
  test(`${action} orphan move respects a containing lock`, () => {
    const part = load(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${source.body}</w:sdtContent></w:sdt>`
    );
    const plan = planRevisionBatch(part, action);
    expect(plan.ops).toEqual([]);
    expect(plan.result.skipped.every((entry) => entry.detail === 'locked-content')).toBe(true);
  });
}
test('rejecting a pretty-printed orphan insertion consumes its empty move metadata', () => {
  let part = load(source.body.replaceAll('><', '>\n<'));
  const insertion = revisionItemsOf(part).find((i) => i.revisionKind === 'insert')!;
  const plan = planRevisionBatch(part, 'reject', [reviewItemKey(insertion)]);
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const r = applyTreeOp(part, op);
    if (!r.ok) throw Error(r.reason);
    part = r.part;
  }
  expect(revisionItemsOf(part)).toHaveLength(0);
  expect(serializeOoxmlPart(part)).not.toContain('>Destination<');
});

for (const action of ['accept', 'reject'] as const)
  test(`${action} all keeps an orphan destination's mark that has its own w:id`, () => {
    const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="2026-07-07T20:18:00Z"`;
    // The range end follows the paragraph, and the mark's w:id differs from the wrapper's.
    const body =
      `<w:p><w:pPr><w:rPr><w:moveTo ${stamp(10)}/></w:rPr></w:pPr>` +
      `<w:moveToRangeStart ${stamp(11)} w:name="move1"/>` +
      `<w:moveTo ${stamp(12)}><w:r><w:t>Moved</w:t></w:r></w:moveTo></w:p>` +
      `<w:moveToRangeEnd w:id="11"/><w:p><w:r><w:t>Next</w:t></w:r></w:p>`;
    let part = load(body);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const r = applyTreeOp(part, op);
      if (!r.ok) throw Error(r.reason);
      part = r.part;
    }
    const xml = serializeOoxmlPart(part);
    // The destination text and its paragraph mark both stay: two paragraphs remain.
    expect(xml).toMatch(/>Moved<\/w:t><\/w:r><\/w:p>.*<w:p[ >].*>Next</);
    expect(xml).not.toMatch(/<w:moveTo\b/);
  });

for (const kind of ['moveTo', 'paragraphMark'] as const)
  test(`rejecting the ${kind} card of an orphan destination decides its text and mark`, () => {
    const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="2026-07-07T20:18:00Z"`;
    let part = load(
      `<w:p><w:pPr><w:rPr><w:moveTo ${stamp(10)}/></w:rPr></w:pPr>` +
        `<w:moveToRangeStart ${stamp(11)} w:name="move1"/>` +
        `<w:moveTo ${stamp(12)}><w:r><w:t>Moved</w:t></w:r></w:moveTo></w:p>` +
        `<w:moveToRangeEnd w:id="11"/><w:p><w:r><w:t>Next</w:t></w:r></w:p>`
    );
    const card = revisionItemsOf(part).find((item) => item.revisionKind === kind)!;
    const plan = planRevisionBatch(part, 'reject', [reviewItemKey(card)], undefined, {
      explicit: true,
    });
    expect(plan.result.skipped).toEqual([]);
    for (const op of plan.ops) {
      const r = applyTreeOp(part, op);
      if (!r.ok) throw Error(r.reason);
      part = r.part;
    }
    expect(revisionItemsOf(part)).toEqual([]);
    expect(serializeOoxmlPart(part)).toMatch(/>Moved<\/w:t><\/w:r><\/w:p>.*<w:p[ >].*>Next</);
  });

test("a decision on one author's orphan destination leaves another author's in the paragraph", () => {
  const range = (name: string, id: number, author: string, text: string) =>
    `<w:moveToRangeStart w:id="${id}" w:name="${name}" w:author="${author}" w:date="2026-07-07T20:18:00Z"/>` +
    `<w:moveTo w:id="${id + 1}" w:author="${author}" w:date="2026-07-07T20:18:00Z"><w:r><w:t>${text}</w:t></w:r></w:moveTo>` +
    `<w:moveToRangeEnd w:id="${id}"/>`;
  const part = load(
    `<w:p><w:pPr><w:rPr><w:moveTo w:id="50" w:author="Ada" w:date="2026-07-07T20:18:00Z"/></w:rPr></w:pPr>` +
      `${range('a', 1, 'Ada', 'AAA')}<w:r><w:t>mid</w:t></w:r>${range('b', 10, 'Bob', 'BBB')}</w:p>` +
      '<w:p><w:r><w:t>x</w:t></w:r></w:p>'
  );
  const bob = revisionItemsOf(part).find((item) => item.author === 'Bob')!;
  for (const action of ['accept', 'reject'] as const) {
    const plan = planRevisionBatch(part, action, [reviewItemKey(bob)], undefined, {
      explicit: true,
    });
    expect(plan.result.resolved.every((entry) => entry.author === 'Bob')).toBe(true);
    const r = applyTreeOp(part, plan.ops[0]!);
    if (!r.ok) throw Error(r.reason);
    expect(revisionItemsOf(r.part).filter((item) => item.author === 'Ada').length).toBe(
      revisionItemsOf(part).filter((item) => item.author === 'Ada').length
    );
  }
});

// The range closes inside the hyperlink, before the paragraph ends, so the moved mark is not
// part of the move: it is its own card, and rejecting it removes the mark as an inserted one.
test('an orphan destination inside a hyperlink resolves with its paragraph mark', () => {
  const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="2026-07-07T20:18:00Z"`;
  let part = load(
    `<w:p><w:pPr><w:rPr><w:moveTo ${stamp(10)}/></w:rPr></w:pPr><w:hyperlink w:anchor="x">` +
      `<w:moveToRangeStart ${stamp(11)} w:name="move1"/>` +
      `<w:moveTo ${stamp(12)}><w:r><w:t>Moved</w:t></w:r></w:moveTo>` +
      `<w:moveToRangeEnd w:id="11"/></w:hyperlink></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>`
  );
  // The range markers inside the hyperlink are a read-only card of their own; the text and the
  // mark are not.
  const keys = revisionItemsOf(part)
    .filter((item) => !item.readOnly)
    .map(reviewItemKey);
  expect(keys).toHaveLength(2);
  const plan = planRevisionBatch(part, 'reject', keys, undefined, { explicit: true });
  expect(plan.result.skipped).toEqual([]);
  for (const op of plan.ops) {
    const r = applyTreeOp(part, op);
    if (!r.ok) throw Error(r.reason);
    part = r.part;
  }
  expect(revisionItemsOf(part).every((item) => item.readOnly)).toBe(true);
  expect(serializeOoxmlPart(part)).toMatch(/>Moved<.*>Next</);
  expect(serializeOoxmlPart(part)).not.toMatch(/>Moved<.*<\/w:p><w:p[ >].*>Next</);
});
