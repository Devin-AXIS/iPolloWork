import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  serializeOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  validateTreeOp,
  type OoxmlPart,
} from '../index.ts';
import { planRevisionAuthorChange } from '../store/revision-author-change.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DATE = 'w:date="2026-01-01T00:00:00Z"';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const ins = (id: number, author: string, text = `Added${id}`, date = DATE) =>
  `<w:ins w:id="${id}" w:author="${author}" ${date}>${run(text)}</w:ins>`;
const del = (id: number, author: string, text = `Removed${id}`) =>
  `<w:del w:id="${id}" w:author="${author}" ${DATE}><w:r><w:delText>${text}</w:delText></w:r></w:del>`;

function load(body: string): OoxmlPart {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

function apply(part: OoxmlPart, ops: ReturnType<typeof planRevisionAuthorChange>['ops']) {
  let current = part;
  for (const op of ops) {
    expect(validateTreeOp(current, op)).toBeNull();
    const applied = applyTreeOp(current, op);
    if (!applied.ok) throw new Error(applied.reason);
    current = applied.part;
  }
  return current;
}

const authors = (part: OoxmlPart) => revisionItemsOf(part).map((item) => item.author);

test('selected changes take the new author and keep their dates and decisions', () => {
  const part = load(`<w:p>${ins(1, 'AI')}${del(2, 'AI')}</w:p><w:p>${ins(3, 'Ada')}</w:p>`);
  const keys = revisionItemsOf(part)
    .filter((item) => item.author === 'AI' && item.revisionKind === 'insert')
    .map(reviewItemKey);
  const plan = planRevisionAuthorChange(part, { author: 'Grace' }, keys);
  const after = apply(part, plan.ops);

  expect(authors(after)).toEqual(['Grace', 'AI', 'Ada']);
  expect(plan.result.skipped).toEqual([]);
  // Before commit the entry still has its old key; against the result it has the new one.
  expect(plan.result.updated[0]!.key).toBe(keys[0]);
  const [updated] = plan.finish(after).updated;
  expect(updated).toMatchObject({ previousKey: keys[0], previousAuthor: 'AI', author: 'Grace' });
  expect(updated!.key).toBe(reviewItemKey(revisionItemsOf(after)[0]!));
  expect(serializeOoxmlPart(after)).toContain(`<w:ins w:author="Grace" ${DATE} w:id="1">`);
  // Still pending: accepting it afterward resolves the reattributed change.
  const accept = planRevisionBatch(after, 'accept', [updated!.key]);
  expect(accept.result.resolved).toHaveLength(1);
});

test('omitted keys select every change, and a date replaces or adds w:date', () => {
  const part = load(
    `<w:p>${ins(1, 'AI', 'a', '')}${ins(2, 'AI')}</w:p><w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="3" w:author="AI"><w:rPr/></w:rPrChange></w:rPr><w:t>b</w:t></w:r></w:p>`
  );
  const date = '2026-10-08T12:00:00Z';
  const plan = planRevisionAuthorChange(part, { author: 'Ada', date });
  const xml = serializeOoxmlPart(apply(part, plan.ops));
  expect(plan.result.updated).toHaveLength(revisionItemsOf(part).length);
  expect(xml).not.toContain('AI');
  expect(xml.match(/w:date="2026-10-08T12:00:00Z"/g)).toHaveLength(3);
});

test('stale and unsupported keys are reported, not applied', () => {
  const part = load(
    `<w:p>${ins(1, 'AI')}</w:p><w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:tblGridChange w:id="9"><w:tblGrid/></w:tblGridChange></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`
  );
  const grid = revisionItemsOf(part).find((item) => item.formattingKind === 'tblGridChange')!;
  const plan = planRevisionAuthorChange(part, { author: 'Ada' }, [
    'stale',
    reviewItemKey(grid),
    'stale',
  ]);
  expect(plan.ops).toEqual([]);
  expect(plan.result.skipped.map((entry) => entry.reason)).toEqual([
    'unknown-revision',
    'unsupported-revision',
  ]);
  expect(planRevisionAuthorChange(part, { author: 'Ada' }, []).result).toEqual({
    updated: [],
    skipped: [],
  });
});

test('a move keeps its halves and range starts attributed together', () => {
  const a = `w:author="AI" ${DATE}`;
  const part = load(
    `<w:p><w:moveFromRangeStart w:id="1" w:name="m" ${a}/><w:moveFrom w:id="2" ${a}>${run('x')}</w:moveFrom><w:moveFromRangeEnd w:id="1"/></w:p>` +
      `<w:p><w:moveToRangeStart w:id="3" w:name="m" ${a}/><w:moveTo w:id="4" ${a}>${run('x')}</w:moveTo><w:moveToRangeEnd w:id="3"/></w:p>`
  );
  const plan = planRevisionAuthorChange(part, { author: 'Ada' });
  const xml = serializeOoxmlPart(apply(part, plan.ops));
  expect(xml).not.toContain('AI');
  expect(xml.match(/w:author="Ada"/g)).toHaveLength(4);
  // Only one half selected: the range starts keep the author of the half left behind.
  const half = revisionItemsOf(part).filter((item) => item.revisionKind === 'moveFrom');
  const partial = planRevisionAuthorChange(part, { author: 'Ada' }, half.map(reviewItemKey));
  expect(serializeOoxmlPart(apply(part, partial.ops)).match(/w:author="Ada"/g)).toHaveLength(1);
});

test('a change that would take another change’s identity gets fresh ids', () => {
  // Two authors' insertions that share an id and date. One author for both would merge them.
  const part = load(`<w:p>${ins(5, 'AI', 'one')}</w:p><w:p>${ins(5, 'Ada', 'two')}</w:p>`);
  const ai = revisionItemsOf(part).filter((item) => item.author === 'AI');
  const plan = planRevisionAuthorChange(part, { author: 'Ada' }, ai.map(reviewItemKey));
  const after = apply(part, plan.ops);
  const items = revisionItemsOf(after);
  expect(items).toHaveLength(2);
  expect(items.map((item) => item.author)).toEqual(['Ada', 'Ada']);
  expect(new Set(items.map(reviewItemKey)).size).toBe(2);
  expect(serializeOoxmlPart(after)).toContain(`<w:ins w:author="Ada" ${DATE} w:id="6">`);
  // Both selected together: still two decisions.
  const both = planRevisionAuthorChange(part, { author: 'Grace' });
  expect(revisionItemsOf(apply(part, both.ops))).toHaveLength(2);
});

test('the op refuses invalid attributions and elements that are not revisions', () => {
  const part = load(`<w:p>${ins(1, 'AI')}</w:p>`);
  const [op] = planRevisionAuthorChange(part, { author: 'Ada' }).ops;
  const site = op!.op === 'setRevisionAttribution' ? op!.sites[0]! : null;
  const reject = (patch: object) =>
    applyTreeOp(part, { ...op!, ...patch } as typeof op & object).ok;
  expect(reject({ revision: { author: ' ' } })).toBe(false);
  expect(reject({ revision: { author: 'Ada', date: 'yesterday' } })).toBe(false);
  expect(reject({ sites: [] })).toBe(false);
  expect(reject({ sites: [{ ...site, renumber: '' }] })).toBe(false);
  expect(reject({ sites: [{ nodeId: part.root.id }] })).toBe(false);
  expect(() => planRevisionAuthorChange(part, { author: 'Ada', date: 'later' })).toThrow();
});

test('structural changes that would share a card are renumbered', () => {
  // Row cards carry no element name, so an insertion and a deletion row can collide.
  const row = (kind: 'ins' | 'del', author: string) =>
    `<w:tr><w:trPr><w:${kind} w:id="5" w:author="${author}" ${DATE}/></w:trPr><w:tc><w:p/></w:tc></w:tr>`;
  const part = load(`<w:tbl>${row('ins', 'Q')}${row('del', 'P')}</w:tbl>`);
  const p = revisionItemsOf(part).filter((item) => item.author === 'P');
  const plan = planRevisionAuthorChange(part, { author: 'Q' }, p.map(reviewItemKey));
  const after = apply(part, plan.ops);
  expect(revisionItemsOf(after).map((item) => item.author)).toEqual(['Q', 'Q']);
});

test('a change in one note does not join a matching change in another note', () => {
  const read = readOoxmlPart(
    `<w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:id="1"><w:p>${ins(10, 'P')}</w:p></w:footnote>` +
      `<w:footnote w:id="2"><w:p>${ins(10, 'Q')}</w:p></w:footnote></w:footnotes>`,
    { name: '/word/footnotes.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const part = read.part;
  const note = part.root.kind === 'textValue' ? undefined : part.root.children[0];
  const plan = planRevisionAuthorChange(part, { author: 'Q' }, undefined, note);
  const after = apply(part, plan.ops);
  expect(revisionItemsOf(after)).toHaveLength(2);
});

test('planning many changes stays linear', () => {
  const body = Array.from({ length: 2000 }, (_, index) => `<w:p>${ins(index, 'AI')}</w:p>`);
  const part = load(body.join(''));
  const started = performance.now();
  const plan = planRevisionAuthorChange(part, { author: 'Ada' });
  const elapsed = performance.now() - started;
  expect(plan.result.updated).toHaveLength(2000);
  // Quadratic validation took about 16 s here; the deferred preview takes well under 1 s.
  expect(elapsed).toBeLessThan(5000);
});
