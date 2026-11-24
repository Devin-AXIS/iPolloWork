import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  revisionItemsOf,
  reviewItemKey,
  serializeOoxmlPart,
} from '../index.ts';
import { planRevisionBatch } from '../store/revision-batch.ts';

const FIRST = '2026-03-01T10:00:00Z';
const LATER = '2026-05-01T10:00:00Z';
let nextId = 1;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (author: string, date: string, text: string) =>
  `<w:ins w:id="${nextId++}" w:author="${author}" w:date="${date}">${run(text)}</w:ins>`;
const del = (author: string, date: string, text: string) =>
  `<w:del w:id="${nextId++}" w:author="${author}" w:date="${date}"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const mark = (kind: 'ins' | 'del', author: string, date: string) =>
  `<w:rPr><w:${kind} w:id="${nextId++}" w:author="${author}" w:date="${date}"/></w:rPr>`;
const paragraph = (body: string, properties = '') =>
  `<w:p><w:pPr>${properties}</w:pPr>${body}</w:p>`;
const alignment = (author: string, date: string, value: string) =>
  `<w:jc w:val="${value}"/><w:pPrChange w:id="${nextId++}" w:author="${author}" w:date="${date}"><w:pPr/></w:pPrChange>`;

function part(...paragraphs: string[]) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

describe('edits joined through a tracked paragraph mark', () => {
  test('one decision for text, mark and the next leading insertion months apart', () => {
    const items = revisionItemsOf(
      part(
        paragraph(run('one ') + ins('Ada', FIRST, 'two'), mark('ins', 'Ada', FIRST)),
        paragraph(ins('Ada', LATER, 'three') + run(' four'))
      )
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ revisionKind: 'insert', text: 'two\nthree' });
  });

  test('one decision when the text before the mark has another date', () => {
    const items = revisionItemsOf(
      part(
        paragraph(run('one ') + ins('Ada', LATER, 'two'), mark('ins', 'Ada', FIRST)),
        paragraph(run('x'))
      )
    );
    expect(items.map((item) => item.revisionKind)).toEqual(['insert']);
  });

  test('one decision for a deleted mark and the next leading deletion months apart', () => {
    const items = revisionItemsOf(
      part(
        paragraph(run('one ') + del('Ada', FIRST, 'two'), mark('del', 'Ada', FIRST)),
        paragraph(del('Ada', LATER, 'three') + run(' four'))
      )
    );
    expect(items.map((item) => item.revisionKind)).toEqual(['delete']);
  });

  test('another author still separates the edits', () => {
    const items = revisionItemsOf(
      part(
        paragraph(run('one ') + ins('Ada', FIRST, 'two'), mark('ins', 'Ada', FIRST)),
        paragraph(ins('Grace', FIRST, 'three') + run(' four'))
      )
    );
    expect(items.map((item) => item.author)).toEqual(['Ada', 'Grace']);
  });

  test('an untracked mark still separates the edits', () => {
    const items = revisionItemsOf(
      part(paragraph(run('one ') + ins('Ada', FIRST, 'two')), paragraph(ins('Ada', FIRST, 'three')))
    );
    expect(items).toHaveLength(2);
  });
});

describe('paragraph-property changes on consecutive paragraphs', () => {
  test('one decision for the same change by one author, whatever the dates', () => {
    const items = revisionItemsOf(
      part(
        paragraph(run('one'), alignment('Ada', FIRST, 'center')),
        paragraph(run('two'), alignment('Ada', LATER, 'center')),
        paragraph(run('three'), alignment('Ada', FIRST, 'center'))
      )
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ revisionKind: 'format', formattingKind: 'pPrChange' });
    expect(items[0]!.ranges).toHaveLength(3);
    expect(items[0]!.addresses).toHaveLength(3);
  });

  for (const [name, second] of [
    ['another author', paragraph(run('two'), alignment('Grace', FIRST, 'center'))],
    ['another value', paragraph(run('two'), alignment('Ada', FIRST, 'right'))],
  ] as const) {
    test(`${name} keeps two decisions`, () => {
      const items = revisionItemsOf(
        part(paragraph(run('one'), alignment('Ada', FIRST, 'center')), second)
      );
      expect(items).toHaveLength(2);
    });
  }

  test('a paragraph between them keeps two decisions', () => {
    const items = revisionItemsOf(
      part(
        paragraph(run('one'), alignment('Ada', FIRST, 'center')),
        paragraph(run('between')),
        paragraph(run('two'), alignment('Ada', FIRST, 'center'))
      )
    );
    expect(items).toHaveLength(2);
  });

  for (const action of ['accept', 'reject'] as const) {
    test(`${action} of the joined decision resolves every paragraph`, () => {
      const source = part(
        paragraph(run('one'), alignment('Ada', FIRST, 'center')),
        paragraph(run('two'), alignment('Ada', LATER, 'center'))
      );
      const [item] = revisionItemsOf(source);
      const plan = planRevisionBatch(source, action, [reviewItemKey(item!)]);
      expect(plan.result.resolved).toHaveLength(1);
      expect(plan.ops).toHaveLength(1);
      const applied = applyTreeOp(source, plan.ops[0]!);
      if (!applied.ok) throw new Error(applied.reason);
      const xml = serializeOoxmlPart(applied.part);
      expect(xml).not.toContain('pPrChange');
      expect(xml.split('w:val="center"').length - 1).toBe(action === 'accept' ? 2 : 0);
    });
  }
});
