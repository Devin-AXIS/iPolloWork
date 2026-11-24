// REF text with hyphen elements (issue #1071).
//
// A REF result is read as one string: a non-breaking hyphen is U+2011 and an optional hyphen
// shows nothing. The cached result and the bookmarked text use the same rule, so a cache can
// match its source, and deleted content joins neither.

import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  type OoxmlElement,
} from '../../store/package/ooxml-tree.ts';
import { bookmarkRangeText, fldSimpleCachedText } from '../field-ref-text.ts';
import { createScanBudget } from '../field-instruction.ts';

function paragraph(xml: string): OoxmlElement {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body>${xml}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const body = read.part.root.children[0] as OoxmlElement;
  return body.children[0] as OoxmlElement;
}

test('a simple REF cache and its bookmark read hyphens the same way', () => {
  const p = paragraph(
    '<w:p><w:bookmarkStart w:id="1" w:name="bm"/><w:r><w:t>co</w:t><w:noBreakHyphen/>' +
      '<w:t>op rate</w:t><w:softHyphen/><w:t>s</w:t></w:r><w:bookmarkEnd w:id="1"/>' +
      '<w:fldSimple w:instr=" REF bm "><w:r><w:t>co</w:t><w:noBreakHyphen/><w:t>op rate</w:t>' +
      '<w:softHyphen/><w:t>s</w:t></w:r></w:fldSimple></w:p>'
  );
  const simple = p.children.find(
    (child) => child.kind !== 'textValue' && child.localName === 'fldSimple'
  ) as OoxmlElement;
  expect(bookmarkRangeText(p, 'bm')).toBe('co‑op rates');
  expect(fldSimpleCachedText(simple, createScanBudget())).toBe('co‑op rates');
});

test('deleted hyphens do not join bookmarked text', () => {
  const p = paragraph(
    '<w:p><w:bookmarkStart w:id="1" w:name="bm"/><w:del w:id="2" w:author="A"><w:r>' +
      '<w:delText>co</w:delText><w:noBreakHyphen/><w:delText>op</w:delText></w:r></w:del>' +
      '<w:r><w:t>new</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
  );
  expect(bookmarkRangeText(p, 'bm')).toBe('new');
});

test('bookmark markers inside a deletion still bound the text', () => {
  const endInside = paragraph(
    '<w:p><w:bookmarkStart w:id="1" w:name="bm"/><w:r><w:t>keep</w:t></w:r><w:del w:id="2" ' +
      'w:author="A"><w:r><w:delText>x</w:delText></w:r><w:bookmarkEnd w:id="1"/></w:del><w:r>' +
      '<w:t> tail</w:t></w:r></w:p>'
  );
  expect(bookmarkRangeText(endInside, 'bm')).toBe('keep');
  const startInside = paragraph(
    '<w:p><w:del w:id="2" w:author="A"><w:bookmarkStart w:id="1" w:name="bm"/><w:r>' +
      '<w:delText>x</w:delText></w:r></w:del><w:r><w:t>live</w:t></w:r><w:bookmarkEnd w:id="1"/>' +
      '<w:r><w:t> tail</w:t></w:r></w:p>'
  );
  expect(bookmarkRangeText(startInside, 'bm')).toBe('live');
});
