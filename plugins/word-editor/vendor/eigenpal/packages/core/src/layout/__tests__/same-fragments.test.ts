// Convergence compares fragment CONTENT: equal records built twice match, and any difference
// anywhere in a published field, however deep, does not.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { sameFragments } from '../semantic-fragment-signature.ts';
import type { BlockFragmentRecord, ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function fragments(): readonly BlockFragmentRecord[] {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:r><w:t>First paragraph with a few words in it.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Second one.</w:t></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 1, { measurer: createFixedMeasurer() }).pages[0]!
    .fragments;
}

/** A deep copy: equal content, no shared records. */
function rebuilt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('fragments built again with equal content match', () => {
  const left = fragments();
  expect(sameFragments(left, rebuilt(left))).toBe(true);
});

test('a change deep inside a line does not match', () => {
  const left = fragments();
  const right = rebuilt(left) as ParagraphFragmentRecord[];
  const span = right[1]!.lines[0]!.spans[0]! as { text: string };
  span.text = `${span.text}!`;
  expect(sameFragments(left, right)).toBe(false);
});

test('a moved box does not match', () => {
  const left = fragments();
  const right = rebuilt(left) as ParagraphFragmentRecord[];
  (right[0]!.box as { y: number }).y += 1;
  expect(sameFragments(left, right)).toBe(false);
});
