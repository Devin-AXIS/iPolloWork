import { expect, test } from 'bun:test';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { ADA, paragraphId, part, xml } from './tracked-edit-fixture.ts';

const MATH_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const equation = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
const display = `<m:oMathPara>${equation}</m:oMathPara>`;

for (const [name, atom] of [
  ['an inline equation', equation],
  ['a display equation', display],
] as const) {
  test(`a tracked deletion over ${name} strikes it whole; accept removes it, reject restores it`, () => {
    const before = part(`<w:p ${MATH_NS}>${run('a')}${atom}${run('b')}</w:p>`);
    const id = paragraphId(before);
    const store = new TreeDocumentStore(before);
    const outcome = store.transact((tx) => {
      tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 3, revision: ADA });
    });
    expect(outcome.ok).toBe(true);
    const saved = xml(store.part);
    // One proposal holds the struck text and the equation.
    expect(saved.match(/<w:del /g)).toHaveLength(1);
    const struck = saved.slice(saved.indexOf('<w:del '), saved.lastIndexOf('</w:del>'));
    expect(struck).toContain(atom);
    const revisionId = /<w:del [^>]*w:id="(\d+)"/.exec(saved)![1]!;
    const revision = { id: revisionId, author: ADA.author, date: ADA.date };

    const accepted = new TreeDocumentStore(store.part);
    accepted.transact((tx) => tx.apply({ op: 'acceptRevision', revision }));
    expect(xml(accepted.part)).not.toContain('oMath');

    const rejected = new TreeDocumentStore(store.part);
    rejected.transact((tx) => tx.apply({ op: 'rejectRevision', revision }));
    expect(xml(rejected.part)).toContain(atom);
    expect(xml(rejected.part)).not.toContain('<w:del');
  });
}

test('a tracked deletion beside an equation still strikes its text', () => {
  const before = part(`<w:p ${MATH_NS}>${run('ab')}${equation}${run('cd')}</w:p>`);
  const id = paragraphId(before);
  const store = new TreeDocumentStore(before);
  const outcome = store.transact((tx) => {
    tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 2, revision: ADA });
    tx.apply({ op: 'deleteText', paragraphId: id, start: 3, end: 5, revision: ADA });
  });
  expect(outcome.ok).toBe(true);
  const saved = xml(store.part);
  expect(saved).toContain('<w:delText>ab</w:delText>');
  expect(saved).toContain('<w:delText>cd</w:delText>');
  expect(saved).toContain('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
});

test("an equation inside the author's own pending insertion is removed outright", () => {
  const insertion = `<w:ins w:id="7" w:author="${ADA.author}" w:date="${ADA.date}">${run('b')}${equation}</w:ins>`;
  const before = part(`<w:p ${MATH_NS}>${run('a')}${insertion}${run('c')}</w:p>`);
  const id = paragraphId(before);
  const store = new TreeDocumentStore(before);
  const outcome = store.transact((tx) => {
    tx.apply({ op: 'deleteText', paragraphId: id, start: 1, end: 3, revision: ADA });
  });
  expect(outcome.ok).toBe(true);
  const saved = xml(store.part);
  expect(saved).not.toContain('oMath');
  expect(saved).not.toContain('<w:del ');
});

test('a tracked deletion over an equation that is already deleted commits', () => {
  const deletion = `<w:del w:id="7" w:author="Grace Hopper" w:date="${ADA.date}">${equation}</w:del>`;
  const before = part(`<w:p ${MATH_NS}>${run('a')}${deletion}${run('b')}</w:p>`);
  const id = paragraphId(before);
  const store = new TreeDocumentStore(before);
  const outcome = store.transact((tx) => {
    tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 3, revision: ADA });
  });
  expect(outcome.ok).toBe(true);
  const saved = xml(store.part);
  expect(saved).toContain('<w:delText>a</w:delText>');
  expect(saved).toContain('<w:delText>b</w:delText>');
  expect(saved).toContain(`w:id="7">${equation}</w:del>`);
});

test('an untracked deletion over an equation still removes it', () => {
  const before = part(`<w:p ${MATH_NS}>${run('a')}${equation}${run('b')}</w:p>`);
  const id = paragraphId(before);
  const store = new TreeDocumentStore(before);
  const outcome = store.transact((tx) => {
    tx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 3 });
  });
  expect(outcome.ok).toBe(true);
  expect(xml(store.part)).not.toContain('oMath');
});
