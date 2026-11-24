// An empty `w:t` is one element whether the tree holds it with an empty value or with none.
//
// An edit can leave a text element with an empty value, which serializes as `<w:t></w:t>`,
// while a reader of the same element, and every collaboration peer, holds no value and writes
// `<w:t/>`. The two must read, lay out, and save as one document, or the lexical form would
// be a difference between replicas.

import { expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  paragraphTextOf,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../../layout/semantic-layout.ts';
import { linesOf } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const BODY =
  `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>ab</w:t></w:r>` +
  '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t/></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t>cd</w:t></w:r></w:p></w:body></w:document>';

/** The same part, with the empty `w:t` holding an empty value, as an edit can leave it. */
function withEmptyValue(part: OoxmlPart): OoxmlPart {
  const fill = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node.localName === 't' && node.children.length === 0) {
      return {
        ...node,
        children: [{ id: `${node.id}.v`, kind: 'textValue', value: '' }],
      } as OoxmlNode;
    }
    return { ...node, children: node.children.map(fill) } as OoxmlNode;
  };
  return { ...part, root: fill(part.root) as OoxmlPart['root'] };
}

function paragraphOf(part: OoxmlPart): OoxmlParagraphNode {
  const body = part.root.children[0]!;
  if (body.kind === 'textValue') throw new Error('no body');
  return body.children[0] as OoxmlParagraphNode;
}

const shownText = (part: OoxmlPart): string =>
  linesOf(layoutSemanticDocument(part, 1, { measurer: createFixedMeasurer(6, 14) }))
    .map((line) => line.spans.map((span) => span.text).join(''))
    .join('|');

test('an empty text element reads, lays out, and saves alike in both forms', () => {
  const none = load(BODY);
  const empty = withEmptyValue(none);
  expect(serializeOoxmlPart(empty)).toContain('<w:t></w:t>');
  expect(serializeOoxmlPart(none)).toContain('<w:t/>');

  const textOf = (part: OoxmlPart) => paragraphTextOf(part, paragraphOf(part).id);
  expect(textOf(empty)).toBe('abcd');
  expect(textOf(none)).toBe('abcd');
  expect(shownText(empty)).toBe(shownText(none));

  // Saved and opened again, the two are the same document in the same form. (The live
  // fingerprint names the empty value, so it is compared after the round trip.)
  const reopened = [empty, none].map((part) => load(serializeOoxmlPart(part)));
  expect(serializeOoxmlPart(reopened[0]!)).toBe(serializeOoxmlPart(reopened[1]!));
  expect(canonicalOoxmlFingerprint(reopened[0]!)).toBe(canonicalOoxmlFingerprint(none));
});
