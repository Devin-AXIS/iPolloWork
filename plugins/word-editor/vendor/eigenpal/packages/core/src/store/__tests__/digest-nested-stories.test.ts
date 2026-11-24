// The save/reopen semantic digest (D9 oracle 2) must see the WHOLE story.
//
// `digestPart` walked only the body's direct `w:p` children, so every paragraph inside a
// table cell or a block content control was outside the oracle entirely: a round trip that
// emptied a cell, or dropped a content control's text, produced ZERO reported differences.
// The fingerprint oracle cannot cover for that — it compares a tree against its own reopen,
// so a serializer that loses the same content on every pass fingerprints equal.
//
// These tests pin the oracle's REACH: text, properties and generic structure inside tables
// (including nested tables) and block SDTs are compared like body-level paragraphs.

import { describe, expect, test } from 'bun:test';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { replaceChildren } from '../package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

const CELL_TEXT = 'cell text that must be seen';
const CONTROL_TEXT = 'content control text that must be seen';
const NESTED_TEXT = 'nested cell text';

const DOCUMENT =
  `<w:document xmlns:w="${W}"><w:body>` +
  '<w:p><w:r><w:t>body paragraph</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc>' +
  `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
  `<w:bookmarkStart w:id="1" w:name="inCell"/>` +
  `<w:r><w:rPr><w:b/></w:rPr><w:t>${CELL_TEXT}</w:t></w:r>` +
  `<w:bookmarkEnd w:id="1"/></w:p>` +
  '<w:tbl><w:tr><w:tc>' +
  `<w:p><w:r><w:t>${NESTED_TEXT}</w:t></w:r></w:p>` +
  '</w:tc></w:tr></w:tbl>' +
  '</w:tc></w:tr></w:tbl>' +
  '<w:sdt><w:sdtPr><w:alias w:val="Name"/></w:sdtPr><w:sdtContent>' +
  `<w:p><w:r><w:t>${CONTROL_TEXT}</w:t></w:r></w:p>` +
  '</w:sdtContent></w:sdt>' +
  '</w:body></w:document>';

function loadPart(xml: string): OoxmlPart {
  const read = readOoxmlPart(xml, { name: '/word/document.xml', contentType: MAIN_CONTENT_TYPE });
  if (!read.ok) throw new Error(`read failed: ${read.reason}`);
  return read.part;
}

function find(part: OoxmlPart, predicate: (node: OoxmlNode) => boolean): OoxmlNode {
  const visit = (node: OoxmlNode): OoxmlNode | null => {
    if (predicate(node)) return node;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return null;
  };
  const found = visit(part.root);
  if (!found) throw new Error('node not found');
  return found;
}

/** The `w:r` holding a given text, so a test can strip exactly that content. */
function runHolding(part: OoxmlPart, text: string): OoxmlNode {
  return find(
    part,
    (node) =>
      node.kind === 'run' &&
      node.children.some(
        (child) =>
          child.kind !== 'textValue' &&
          child.localName === 't' &&
          child.children.some((grand) => grand.kind === 'textValue' && grand.value === text)
      )
  );
}

function withoutRun(part: OoxmlPart, text: string): OoxmlPart {
  const stripped = replaceChildren(part, runHolding(part, text).id, []);
  if (!stripped.ok) throw new Error(JSON.stringify(stripped.issues));
  return stripped.part;
}

describe('the semantic digest reaches nested stories', () => {
  test('text lost inside a table cell is REPORTED', () => {
    const part = loadPart(DOCUMENT);
    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([withoutRun(part, CELL_TEXT)])
    );
    expect(differences.some((difference) => difference.path.includes('text'))).toBe(true);
  });

  test('text lost inside a NESTED table cell is REPORTED', () => {
    const part = loadPart(DOCUMENT);
    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([withoutRun(part, NESTED_TEXT)])
    );
    expect(differences.some((difference) => difference.path.includes('text'))).toBe(true);
  });

  test('text lost inside a block content control is REPORTED', () => {
    const part = loadPart(DOCUMENT);
    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([withoutRun(part, CONTROL_TEXT)])
    );
    expect(differences.some((difference) => difference.path.includes('text'))).toBe(true);
  });

  test('a paragraph property lost inside a table cell is REPORTED', () => {
    const part = loadPart(DOCUMENT);
    const alignment = find(
      part,
      (node) => node.kind !== 'textValue' && node.localName === 'jc' && node.namespaceUri === W
    );
    const stripped = replaceChildren(
      part,
      find(part, (node) => node.kind === 'paragraphProperties' && node.children.includes(alignment))
        .id,
      []
    );
    if (!stripped.ok) throw new Error(JSON.stringify(stripped.issues));
    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([stripped.part])
    );
    expect(differences.some((difference) => difference.path.includes('paragraphProperties'))).toBe(
      true
    );
  });

  test('a generic marker lost inside a table cell is REPORTED', () => {
    const part = loadPart(DOCUMENT);
    const bookmark = find(
      part,
      (node) => node.kind !== 'textValue' && node.localName === 'bookmarkStart'
    );
    const parent = find(
      part,
      (node) => node.kind === 'paragraph' && node.children.some((child) => child.id === bookmark.id)
    );
    if (parent.kind === 'textValue') throw new Error('unreachable');
    const stripped = replaceChildren(
      part,
      parent.id,
      parent.children.filter((child) => child.id !== bookmark.id)
    );
    if (!stripped.ok) throw new Error(JSON.stringify(stripped.issues));
    const differences = diffSemanticDigests(
      semanticDigest([part]),
      semanticDigest([stripped.part])
    );
    expect(differences.some((difference) => difference.path.includes('genericStructure'))).toBe(
      true
    );
  });

  test('an intact save/reopen of the same document still reports nothing', () => {
    const part = loadPart(DOCUMENT);
    const reopened = loadPart(serializeOoxmlPart(part));
    expect(diffSemanticDigests(semanticDigest([part]), semanticDigest([reopened]))).toEqual([]);
  });

  test('every paragraph of the story is digested, in document order', () => {
    const digest = semanticDigest([loadPart(DOCUMENT)]);
    const texts = digest.stories[0]!.paragraphs.map((paragraph) => paragraph.text);
    expect(texts).toEqual(['body paragraph', CELL_TEXT, NESTED_TEXT, CONTROL_TEXT]);
  });
});
