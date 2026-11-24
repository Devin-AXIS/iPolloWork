import { expect, test } from 'bun:test';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { ADA, apply, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const insert = (id: string, revision?: typeof ADA) =>
  ({
    op: 'insertInlineContentControl',
    paragraphId: id,
    offset: 2,
    tag: 'acme:ref?id=1',
    text: 'REF',
    ...(revision ? { revision } : {}),
  }) as const;

test('a tracked inline control is written whole inside one w:ins', () => {
  const before = part(`<w:p>${run('abcd')}</w:p>`);
  const after = apply(before, insert(paragraphId(before), ADA));
  const saved = xml(after);
  expect(saved).toMatch(
    /<w:ins w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z" w:id="\d+"><w:sdt>.*<w:t>REF<\/w:t>.*<\/w:sdt><\/w:ins>/
  );
  expect(saved.indexOf('ab')).toBeLessThan(saved.indexOf('<w:ins'));
  expect(saved.indexOf('cd')).toBeGreaterThan(saved.indexOf('</w:ins>'));
});

test('rejecting the insertion removes the control; accepting keeps it untracked', () => {
  const before = part(`<w:p>${run('abcd')}</w:p>`);
  const inserted = apply(before, insert(paragraphId(before), ADA));
  const id = /<w:ins [^>]*w:id="(\d+)"/.exec(xml(inserted))![1]!;
  const revision = { id, author: ADA.author, date: ADA.date };

  const rejected = apply(inserted, { op: 'rejectRevision', revision });
  expect(contentControlsIn(rejected.root)).toHaveLength(0);
  expect(xml(rejected)).not.toContain('<w:ins');

  const accepted = apply(inserted, { op: 'acceptRevision', revision });
  expect(contentControlsIn(accepted.root)).toHaveLength(1);
  expect(xml(accepted)).not.toContain('<w:ins');
});

test('an untracked insert still writes no revision', () => {
  const before = part(`<w:p>${run('abcd')}</w:p>`);
  expect(xml(apply(before, insert(paragraphId(before))))).not.toContain('<w:ins');
});

test('an invalid revision attribution is refused', () => {
  const before = part(`<w:p>${run('abcd')}</w:p>`);
  const result = applyTreeOp(before, insert(paragraphId(before), { author: '', date: ADA.date }));
  expect(result).toMatchObject({ ok: false, reason: 'invalid-property-value' });
});
