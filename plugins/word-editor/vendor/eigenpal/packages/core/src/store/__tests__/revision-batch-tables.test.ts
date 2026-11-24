import { expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = '<w:p><w:ins w:author="Ada" w:id="3"><w:r><w:t>Added</w:t></w:r></w:ins></w:p>';
function load(rowProperties: string, cellProperties = '', content = text) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tr><w:trPr>${rowProperties}</w:trPr><w:tc><w:tcPr>${cellProperties}</w:tcPr>${content}</w:tc></w:tr></w:tbl><w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return read.part;
}

for (const action of ['accept', 'reject'] as const) {
  for (const [name, row, cell] of [
    ['row-only marker', '<w:ins w:author="Grace" w:id="1"/>', ''],
    ['cell-only marker', '', '<w:cellIns w:author="Grace" w:id="1"/>'],
    ['row formatting', '<w:trPrChange w:author="Grace" w:id="1"><w:trPr/></w:trPrChange>', ''],
  ] as const) {
    test(`${action}: ${name} resolves with its text revisions`, () => {
      const part = load(row, cell);
      const batch = planRevisionBatch(part, action);
      expect(batch.result.resolved).toHaveLength(name === 'row-only marker' ? 1 : 2);
      expect(batch.result.skipped).toHaveLength(0);
      const applied = applyTreeOp(part, batch.ops[0]!);
      if (!applied.ok) throw new Error(applied.reason);
      expect(revisionItemsOf(applied.part)).toHaveLength(batch.result.remaining);
      const xml = serializeOoxmlPart(applied.part);
      expect(xml).not.toContain(row || cell);
      expect(xml.includes('Added')).toBe(action === 'accept');
    });
  }

  const retained = action === 'accept' ? 'ins' : 'del';
  const removed = action === 'accept' ? 'del' : 'ins';
  for (const [kind, removes] of [
    [retained, false],
    [removed, true],
  ] as const) {
    test(`${action}: ${removes ? 'removed' : 'retained'} row with an excluded text revision`, () => {
      const part = load(
        `<w:${kind} w:author="Grace" w:id="1"/>`,
        `<w:cell${kind === 'ins' ? 'Ins' : 'Del'} w:author="Grace" w:id="1"/>`
      );
      const keys = revisionItemsOf(part)
        .filter((item) => item.author === 'Grace')
        .map(reviewItemKey);
      const batch = planRevisionBatch(part, action, keys);
      expect(batch.result.resolved).toHaveLength(removes ? 0 : 1);
      if (removes) {
        expect(batch.ops).toEqual([]);
        expect(batch.result.skipped[0]?.reason).toBe('incomplete-group');
      } else {
        const applied = applyTreeOp(part, batch.ops[0]!);
        if (!applied.ok) throw new Error(applied.reason);
        expect(revisionItemsOf(applied.part)).toHaveLength(1);
        expect(serializeOoxmlPart(applied.part)).toContain(text);
      }
      const all = planRevisionBatch(part, action);
      const applied = applyTreeOp(part, all.ops[0]!);
      if (!applied.ok) throw new Error(applied.reason);
      expect(revisionItemsOf(applied.part)).toHaveLength(0);
      expect(serializeOoxmlPart(applied.part).includes('<w:tbl>')).toBe(!removes);
    });

    test(`${action}: ${removes ? 'removed' : 'retained'} row with malformed cell merge`, () => {
      const formatting = '<w:cellMerge w:author="Grace" w:id="2" w:vMerge="invalid"/>';
      const part = load(
        `<w:${kind} w:author="Grace" w:id="1"/>`,
        `<w:cell${kind === 'ins' ? 'Ins' : 'Del'} w:author="Grace" w:id="1"/>${formatting}`
      );
      const batch = planRevisionBatch(part, action);
      expect(batch.result.resolved).toHaveLength(removes ? 0 : 2);
      expect(batch.result.skipped).toHaveLength(removes ? 3 : 1);
      if (removes) expect(batch.ops).toEqual([]);
      else {
        const applied = applyTreeOp(part, batch.ops[0]!);
        if (!applied.ok) throw new Error(applied.reason);
        expect(revisionItemsOf(applied.part)).toHaveLength(batch.result.remaining);
        expect(serializeOoxmlPart(applied.part)).toContain(formatting);
      }
    });
  }
}

for (const action of ['accept', 'reject'] as const) {
  test(`${action}: an excluded destructive row decision does not block selected text`, () => {
    const kind = action === 'accept' ? 'del' : 'ins';
    const part = load(
      `<w:${kind} w:author="Grace" w:id="1"/>`,
      `<w:cell${kind === 'ins' ? 'Ins' : 'Del'} w:author="Grace" w:id="1"/>`
    );
    const keys = revisionItemsOf(part)
      .filter((item) => item.author === 'Ada')
      .map(reviewItemKey);
    const plan = planRevisionBatch(part, action, keys);
    expect(plan.result.resolved).toHaveLength(1);
    const applied = applyTreeOp(part, plan.ops[0]!);
    if (!applied.ok) throw new Error(applied.reason);
    expect(revisionItemsOf(applied.part)).toHaveLength(plan.result.remaining);
    expect(serializeOoxmlPart(applied.part)).toContain(`w:cell${kind === 'ins' ? 'Ins' : 'Del'}`);
  });
}
