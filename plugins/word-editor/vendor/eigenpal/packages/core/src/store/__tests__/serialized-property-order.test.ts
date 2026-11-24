// Paragraph and run property containers hold their children in schema order.
//
// `CT_PPr` is a strict sequence, and consumers refuse a file with an out-of-order `w:pPr`.
// `CT_RPr` fixes only its revision marks and `w:rPrChange`, and takes the same canonical order. A file authored out of order opens in schema order, so the tree, the
// shared state, and the fingerprint all hold the order a save writes. Two collaborators who
// each add a property to one paragraph at once can still merge into a `w:pPr` whose children
// sit in the order the shared list holds them: `w:ind` from one before `w:pStyle` from the
// other. Every replica shows that order, so the tree keeps it, and the save writes the schema
// order. Neither step moves a child the schema does not model.

import { expect, test } from 'bun:test';
import { canonicalOoxmlFingerprint } from '../package/ooxml-serialize.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { CT_RPR_SEQUENCE } from '../package/ooxml-property-order.ts';
import { schemaInsertIndex } from '../store/tree-op-properties.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function read(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function opened(body: string): OoxmlPart {
  return read(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
  );
}

const saved = (body: string): string => serializeOoxmlPart(opened(body));

/** The first element named `localName` below `node`, in document order. */
function find(node: OoxmlElement, localName: string): OoxmlElement {
  const search = (at: OoxmlNode): OoxmlElement | null => {
    if (at.kind === 'textValue') return null;
    if (at !== node && at.localName === localName) return at;
    for (const child of at.children) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  const found = search(node);
  if (!found) throw new Error(`no ${localName}`);
  return found;
}

const names = (element: OoxmlElement): string[] =>
  element.children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.localName]));

/** `part` with the children of its first `localName` element reversed, as a merge can leave them. */
function reversed(part: OoxmlPart, localName: string): OoxmlPart {
  const target = find(part.root, localName);
  const swap = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (node === target) return { ...node, children: [...node.children].reverse() };
    return { ...node, children: node.children.map(swap) };
  };
  return { ...part, root: swap(part.root) as OoxmlElement };
}

test('an out-of-order file opens with paragraph and run properties in schema order', () => {
  const part = opened(
    '<w:p><w:pPr><w:ind w:left="720"/><w:jc w:val="center"/><w:pStyle w:val="Heading1"/>' +
      '<w:rPr><w:sz w:val="20"/><w:b/></w:rPr></w:pPr>' +
      '<w:r><w:rPr><w:color w:val="FF0000"/><w:i/><w:rStyle w:val="Strong"/></w:rPr>' +
      '<w:t>x</w:t></w:r></w:p>'
  );
  expect(names(find(part.root, 'pPr'))).toEqual(['pStyle', 'ind', 'jc', 'rPr']);
  const xml = serializeOoxmlPart(part);
  expect(xml).toContain(
    '<w:pPr><w:pStyle w:val="Heading1"/><w:ind w:left="720"/><w:jc w:val="center"/>' +
      '<w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:pPr>'
  );
  expect(xml).toContain('<w:rPr><w:rStyle w:val="Strong"/><w:i/><w:color w:val="FF0000"/></w:rPr>');
  expect(canonicalOoxmlFingerprint(read(xml))).toBe(canonicalOoxmlFingerprint(part));
});

test('the properties a change records open in schema order too', () => {
  const part = opened(
    '<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="1" w:author="A">' +
      '<w:pPr><w:ind w:left="720"/><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange></w:pPr>' +
      '<w:r><w:t>x</w:t></w:r></w:p>'
  );
  expect(names(find(find(part.root, 'pPrChange'), 'pPr'))).toEqual(['pStyle', 'ind']);
});

test('properties outside a typed run open in the order they save', () => {
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const part = read(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p><m:oMath><m:r><m:ctrlPr>` +
      '<w:ins w:id="1" w:author="A"><w:rPr><w:sz w:val="20"/><w:b/></w:rPr></w:ins>' +
      '</m:ctrlPr><m:t>x</m:t></m:r></m:oMath></w:p>' +
      '<w:p><w:hyperlink><w:rPr><w:sz w:val="20"/><w:b/></w:rPr></w:hyperlink></w:p>' +
      '</w:body></w:document>'
  );
  expect(names(find(find(part.root, 'ins'), 'rPr'))).toEqual(['b', 'sz']);
  expect(names(find(find(part.root, 'hyperlink'), 'rPr'))).toEqual(['b', 'sz']);
  const xml = serializeOoxmlPart(part);
  expect(canonicalOoxmlFingerprint(read(xml))).toBe(canonicalOoxmlFingerprint(part));
});

test('paragraph mark run properties keep revision marks first and the change last', () => {
  const part = opened(
    '<w:p><w:pPr><w:rPr><w:rPrChange w:id="2" w:author="A"><w:rPr/></w:rPrChange><w:b/>' +
      '<w:ins w:id="1" w:author="A"/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
  );
  expect(names(find(find(part.root, 'pPr'), 'rPr'))).toEqual(['ins', 'b', 'rPrChange']);
});

test('a tree a merge left out of order saves in schema order', () => {
  const part = reversed(
    opened('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:ind w:left="720"/></w:pPr></w:p>'),
    'pPr'
  );
  expect(names(find(part.root, 'pPr'))).toEqual(['ind', 'pStyle']);
  expect(serializeOoxmlPart(part)).toContain(
    '<w:pPr><w:pStyle w:val="Heading1"/><w:ind w:left="720"/></w:pPr>'
  );
});

test('a child the schema does not model keeps its slot', () => {
  const xml = saved(
    '<w:p><w:r><w:rPr><w:sz w:val="20"/><w14:glow w14:rad="10"/><w:b/></w:rPr>' +
      '<w:t>x</w:t></w:r></w:p>'
  );
  expect(xml).toContain('<w:rPr><w:b/><w14:glow w14:rad="10"/><w:sz w:val="20"/></w:rPr>');
});

test('an ordered container saves as authored', () => {
  const body =
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:after="0"/><w:ind w:left="720"/>' +
    '</w:pPr><w:r><w:t>x</w:t></w:r></w:p>';
  expect(saved(body)).toContain(body);
});

test('an extension that shares a modelled name keeps its slot', () => {
  const xml = saved(
    '<w:p><w:r><w:rPr><w:sz w:val="20"/><w14:shadow w14:blurRad="10"/><w:b/></w:rPr>' +
      '<w:t>x</w:t></w:r></w:p>'
  );
  expect(xml).toContain('<w:rPr><w:b/><w14:shadow w14:blurRad="10"/><w:sz w:val="20"/></w:rPr>');
});

test('an inserted property does not rank an extension by its local name', () => {
  const rPr = find(
    opened(
      '<w:p><w:r><w:rPr><w:b/><w14:shadow w14:blurRad="10"/><w:sz w:val="20"/></w:rPr>' +
        '<w:t>x</w:t></w:r></w:p>'
    ).root,
    'rPr'
  );
  // `w:i` follows `w:b` and precedes `w:sz`; `w14:shadow` is not the `w:shadow` slot.
  expect(schemaInsertIndex(rPr.children, CT_RPR_SEQUENCE, 'i')).toBe(2);
});
