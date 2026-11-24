import { expect, test } from 'bun:test';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import { ADA, apply, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const pill = (lock: string) =>
  `<w:sdt><w:sdtPr><w:tag w:val="acme:ref"/><w:lock w:val="${lock}"/></w:sdtPr>` +
  `<w:sdtContent>${run('REF')}</w:sdtContent></w:sdt>`;
// "ab" [2,5) "REF" "cd"
const line = (lock: string) => `<w:p>${run('ab')}${pill(lock)}${run('cd')}</w:p>`;

test('a tracked deletion over a whole contentLocked control strikes the control whole', () => {
  const before = part(line('contentLocked'));
  const after = apply(before, {
    op: 'deleteText',
    paragraphId: paragraphId(before),
    start: 1,
    end: 6,
    revision: ADA,
  });
  const saved = xml(after);
  // One proposal: the struck text around the control and the control itself, in one `w:del`.
  expect(saved).toMatch(
    /<w:del [^>]*>.*<w:sdt>.*<w:delText>REF<\/w:delText>.*<\/w:sdt>.*<\/w:del>/
  );
  expect(saved.match(/<w:del /g)).toHaveLength(1);
  const id = /<w:del [^>]*w:id="(\d+)"/.exec(saved)![1]!;
  const revision = { id, author: ADA.author, date: ADA.date };
  expect(contentControlsIn(apply(after, { op: 'acceptRevision', revision }).root)).toHaveLength(0);
  const rejected = xml(apply(after, { op: 'rejectRevision', revision }));
  const texts = [...rejected.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  expect(texts.join('')).toBe('abREFcd');
  expect(rejected).toContain('<w:lock w:val="contentLocked"/>');
  expect(rejected).not.toContain('<w:del');
});

test('a tracked deletion of exactly the control strikes it whole', () => {
  const before = part(line('contentLocked'));
  const after = apply(before, {
    op: 'deleteText',
    paragraphId: paragraphId(before),
    start: 2,
    end: 5,
    revision: ADA,
  });
  expect(xml(after)).toMatch(
    /<w:del [^>]*><w:sdt>.*<w:delText>REF<\/w:delText>.*<\/w:sdt><\/w:del>/
  );
});

test('a tracked deletion inside a contentLocked control is still refused', () => {
  const before = part(line('contentLocked'));
  const result = applyTreeOp(before, {
    op: 'deleteText',
    paragraphId: paragraphId(before),
    start: 3,
    end: 6,
    revision: ADA,
  });
  expect(result).toMatchObject({ ok: false, reason: 'locked' });
});

test('a tracked deletion over a whole sdtContentLocked control is still refused', () => {
  const before = part(line('sdtContentLocked'));
  const result = applyTreeOp(before, {
    op: 'deleteText',
    paragraphId: paragraphId(before),
    start: 1,
    end: 6,
    revision: ADA,
  });
  expect(result).toMatchObject({ ok: false, reason: 'locked' });
});
