import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  serializeOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const ins = (id: number, author = 'Ada', content = run(`Added${id}`)) =>
  `<w:ins w:id="${id}" w:author="${author}">${content}</w:ins>`;
const unsupported =
  '<w:tbl><w:tblPr><w:ins w:id="20" w:author="Grace"/></w:tblPr><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>';
function load(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: selected sites, duplicate and stale keys, and unsupported records`, () => {
    const part = load(`<w:p>${ins(1)}</w:p><w:p>${ins(1, 'Grace')}</w:p>${unsupported}`);
    const key = reviewItemKey(revisionItemsOf(part)[0]!);
    const plan = planRevisionBatch(part, action, [key, key, 'stale']);
    expect(plan.ops).toHaveLength(1);
    expect(plan.result.resolved).toHaveLength(1);
    expect(plan.result.skipped).toEqual([{ key: 'stale', reason: 'unknown-revision' }]);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
    expect(serializeOoxmlPart(applied.part)).toContain('w:author="Grace"');
    const all = planRevisionBatch(part, action);
    expect(all.result.resolved).toHaveLength(2);
    expect(all.result.skipped[0]?.reason).toBe('unsupported-revision');
  });
  test(`${action}: an excluded nested revision resolves only when the decision keeps it`, () => {
    const part = load(`<w:p>${ins(1, 'Ada', ins(2, 'Grace'))}</w:p><w:p>${ins(3)}</w:p>`);
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    if (action === 'accept') {
      // Accepting Ada's insertion keeps Grace's insertion inside it pending.
      expect(plan.result.resolved).toHaveLength(2);
      expect(plan.result.skipped).toEqual([]);
      expect(revisionItemsOf(applied.part).map((item) => item.author)).toEqual(['Grace']);
    } else {
      // Rejecting it would remove Grace's insertion, which the selection excludes.
      expect(plan.result.resolved).toHaveLength(1);
      expect(plan.result.skipped[0]?.reason).toBe('incomplete-group');
      expect(revisionItemsOf(applied.part)).toHaveLength(2);
      expect(serializeOoxmlPart(applied.part).match(/<w:p>.*?<\/w:p>/)?.[0]).toBe(
        serializeOoxmlPart(part).match(/<w:p>.*?<\/w:p>/)?.[0]
      );
    }
  });
  test(`${action}: unsupported descendants remain intact with their containing insertion`, () => {
    const content = '<w:r><w:rPr><w:ins w:id="2" w:author="Grace"/></w:rPr><w:t>keep</w:t></w:r>';
    const part = load(`<w:p>${ins(1, 'Ada', content)}</w:p><w:p>${ins(3)}</w:p>`);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.resolved).toHaveLength(1);
    expect(plan.result.skipped).toHaveLength(2);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part).match(/<w:p>.*?<\/w:p>/)?.[0]).toBe(
      serializeOoxmlPart(part).match(/<w:p>.*?<\/w:p>/)?.[0]
    );
  });
  test(`${action}: row markers resolve with and without matching cell markers`, () => {
    const row = (id: number, complete: boolean) =>
      `<w:tr><w:trPr>${ins(id, 'Ada', '')}</w:trPr><w:tc>${complete ? `<w:tcPr><w:cellIns w:id="${id}" w:author="Ada"/></w:tcPr>` : ''}<w:p>${run(`row${id}`)}</w:p></w:tc></w:tr>`;
    const part = load(`<w:p>${ins(1)}</w:p><w:tbl>${row(2, true)}${row(3, false)}</w:tbl>`);
    const plan = planRevisionBatch(part, action);
    expect(plan.result.resolved).toHaveLength(3);
    expect(plan.result.skipped).toHaveLength(0);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part)).toHaveLength(0);
    expect(serializeOoxmlPart(applied.part).includes('row3')).toBe(action === 'accept');
    expect(serializeOoxmlPart(applied.part).includes('row2')).toBe(action === 'accept');
  });
  test(`${action}: empty and all-unsupported selections create no operations`, () => {
    const part = load(unsupported);
    expect(planRevisionBatch(part, action, []).ops).toEqual([]);
    expect(planRevisionBatch(part, action).ops).toEqual([]);
    expect(planRevisionBatch(load('<w:p/>'), action).result).toEqual({
      resolved: [],
      skipped: [],
      remaining: 0,
    });
  });
  // Accepting an insertion keeps the locked content; rejecting it would remove it.
  test(`${action}: a content lock keeps only decisions that change what the control holds`, () => {
    const part = load(
      `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p>${ins(1)}</w:p></w:sdtContent></w:sdt>`
    );
    const plan = planRevisionBatch(part, action);
    if (action === 'accept') {
      expect(plan.result.skipped).toEqual([]);
      expect(applyTreeOp(part, plan.ops[0]!)).toMatchObject({ ok: true });
    } else {
      expect(plan.ops).toEqual([]);
      expect(plan.result.skipped).toMatchObject([
        { reason: 'unsupported-revision', detail: 'locked-content' },
      ]);
    }
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: a named move pair is skipped unless both decisions are selected`, () => {
    const half = (kind: 'moveFrom' | 'moveTo', id: number, author: string) =>
      `<w:p><w:${kind}RangeStart w:id="${id}" w:name="move"/><w:${kind} w:id="${id}" w:author="${author}">${run('moved')}</w:${kind}><w:${kind}RangeEnd w:id="${id}"/></w:p>`;
    const part = load(half('moveFrom', 1, 'Ada') + half('moveTo', 2, 'Grace'));
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const selected = planRevisionBatch(part, action, keys);
    expect(selected.ops).toEqual([]);
    expect(selected.result.skipped[0]?.reason).toBe('incomplete-group');
    const all = planRevisionBatch(part, action);
    expect(all.result.resolved).toHaveLength(2);
    const applied = applyTreeOp(part, all.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part)).toEqual([]);
    expect(serializeOoxmlPart(applied.part).match(/moved/g)).toHaveLength(1);
  });
  test(`${action}: selecting replacement halves leaves same-address formatting pending`, () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange></w:rPr><w:t>Base</w:t></w:r><w:del w:id="1" w:author="Ada"><w:r><w:delText>Old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Ada"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
    );
    const keys = revisionItemsOf(part)
      .filter((item) => item.revisionKind === 'insert' || item.revisionKind === 'delete')
      .map(reviewItemKey);
    const batch = planRevisionBatch(part, action, keys);
    expect(batch.result.resolved).toHaveLength(2);
    const applied = applyTreeOp(part, batch.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part).map((item) => item.revisionKind)).toEqual(['format']);
    expect(serializeOoxmlPart(applied.part)).toContain(action === 'accept' ? 'New' : 'Old');
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: a removed paragraph mark cannot consume an excluded paragraph property change`, () => {
    const mark = action === 'accept' ? 'del' : 'ins';
    const part = load(
      `<w:p><w:pPr><w:rPr><w:${mark} w:id="1" w:author="Ada"/></w:rPr><w:pPrChange w:id="2" w:author="Grace"><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrChange></w:pPr>${run('first')}</w:p><w:p>${run('next')}</w:p><w:p>${ins(3)}</w:p>`
    );
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.result.resolved).toHaveLength(1);
    expect(plan.result.skipped).toHaveLength(1);
    expect(plan.result.skipped[0]?.reason).toBe('incomplete-group');
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part)).toContain('w:author="Grace"');
    expect(serializeOoxmlPart(applied.part).match(/<w:p>.*?<\/w:p>/)?.[0]).toBe(
      serializeOoxmlPart(part).match(/<w:p>.*?<\/w:p>/)?.[0]
    );
    const all = planRevisionBatch(part, action);
    expect(all.result.skipped).toEqual([]);
    const resolved = applyTreeOp(part, all.ops[0]!);
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(revisionItemsOf(resolved.part)).toEqual([]);
  });
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: merging a paragraph preserves unsupported numbering revisions`, () => {
    const mark = action === 'accept' ? 'del' : 'ins';
    const part = load(
      `<w:p><w:pPr><w:numPr><w:ins w:id="2" w:author="Grace"/></w:numPr><w:rPr><w:${mark} w:id="1" w:author="Ada"/></w:rPr></w:pPr>${run('first')}</w:p><w:p>${run('next')}</w:p><w:p>${ins(3)}</w:p>`
    );
    const plan = planRevisionBatch(part, action);
    expect(plan.result.resolved).toHaveLength(1);
    expect(plan.result.skipped).toHaveLength(2);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(serializeOoxmlPart(applied.part).match(/<w:p>.*?<\/w:p>/)?.[0]).toBe(
      serializeOoxmlPart(part).match(/<w:p>.*?<\/w:p>/)?.[0]
    );
  });
}

test('reject skips a formatting revision without restorable properties', () => {
  const part = load(
    `<w:p><w:pPr><w:pPrChange w:id="2" w:author="Grace"/></w:pPr>${run('keep')}</w:p><w:p>${ins(3)}</w:p>`
  );
  const plan = planRevisionBatch(part, 'reject');
  expect(plan.result.resolved).toHaveLength(1);
  expect(plan.result.skipped[0]?.reason).toBe('unsupported-revision');
  const applied = applyTreeOp(part, plan.ops[0]!);
  if (!applied.ok) throw new Error(applied.reason);
  expect(revisionItemsOf(applied.part)).toHaveLength(1);
  expect(serializeOoxmlPart(applied.part)).toContain('w:author="Grace"');
});
