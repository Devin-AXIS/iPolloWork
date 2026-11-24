// Where a paragraph's ZERO-LENGTH children land when the paragraph is split.
//
// A hyperlink, a comment range marker, a bookmark marker and a run holding only a picture
// contribute no text offsets, but every one of them has a POSITION in the paragraph. Sending
// them all to the head — the old rule — moved hyperlinks backwards out of the sentence they
// belonged to, left comment ranges as empty pairs around the wrong half, and shortened
// bookmarks to the first half of what they marked. The fixture paragraphs here are the ones
// that showed it.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import {
  readOoxmlPart,
  validateOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/tree-ops.ts';

const FIXTURE = `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Read once: the package is a zip of trees, and every test here reads the same document.
let cached: OoxmlPart | null = null;
function document(): OoxmlPart {
  if (cached) return cached;
  const result = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!result.ok) throw new Error(`package read failed: ${result.reason}`);
  const part = result.package.parts.get('/word/document.xml');
  if (!part) throw new Error('fixture has no /word/document.xml');
  cached = part;
  return part;
}

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

function nodeById(part: OoxmlPart, id: string): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.id === id) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error(`node ${id} not found`);
  return found;
}

/** The paragraph produced by splitting `paragraphId`, in document order. */
function halves(part: OoxmlPart, paragraphId: string, offset: number): [OoxmlNode, OoxmlNode] {
  const result = applyTreeOp(part, { op: 'splitParagraph', paragraphId, offset });
  if (!result.ok) throw new Error(result.reason);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  const tailId = result.effect.split?.tail;
  if (!tailId) throw new Error('split reported no tail');
  return [nodeById(result.part, paragraphId), nodeById(result.part, tailId)];
}

/** A paragraph's children as `name` or `name#idAttribute`, so order is readable in a failure. */
function shapeOf(paragraph: OoxmlNode): string[] {
  if (paragraph.kind === 'textValue') return [];
  return paragraph.children
    .filter((child) => child.kind !== 'textValue' && child.localName !== 'pPr')
    .map((child) => {
      if (child.kind === 'textValue') return '';
      const inner = child.children.find(
        (grand) => grand.kind !== 'textValue' && grand.localName === 'commentReference'
      );
      if (inner) return 'commentReference';
      const id = child.attributes.find((attribute) => attribute.localName === 'id');
      // A hyperlink's `r:id` is a relationship, not an identity — the marker ids are what
      // pair a range start with its end.
      const paired = id && child.localName !== 'hyperlink' ? `#${id.value}` : '';
      return `${child.localName}${paired}`;
    });
}

function textOf(paragraph: OoxmlNode): string {
  let text = '';
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      text += node.value;
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(paragraph);
  return text;
}

describe('a split places zero-length content by its position (comprehensive fixture)', () => {
  const LINKS = '/word/document.xml#0.0.122';
  const COMMENTED = '/word/document.xml#0.0.110';

  test('the fixture paragraphs are the ones under test (guards the premise)', () => {
    // The link text is ADDRESSABLE: a `w:hyperlink` is a run container, so its runs take
    // paragraph offsets like any other. While it was an opaque child this read
    // "Visit  or ." — the sentence with its two links deleted out of it.
    expect(paragraphTextOf(document(), LINKS)).toBe('Visit Example.com or Anthropic’s website.');
    expect(shapeOf(nodeById(document(), LINKS))).toEqual(['r', 'hyperlink', 'r', 'hyperlink', 'r']);
    expect(shapeOf(nodeById(document(), COMMENTED))).toEqual([
      'r',
      'commentRangeStart#0',
      'r',
      'commentRangeEnd#0',
      'commentReference',
      'r',
      'commentRangeStart#1',
      'r',
      'commentRangeEnd#1',
      'commentReference',
      'r',
    ]);
  });

  test('hyperlinks stay in the sentence they belong to', () => {
    // `Visit [Example.com] or [Anthropic's website].` — Enter after `Vi`. Both links sit
    // after the caret, so both move down with the rest of the sentence.
    const [head, tail] = halves(document(), LINKS, 2);
    expect(textOf(head)).toBe('Vi');
    expect(shapeOf(head)).toEqual(['r']);
    expect(shapeOf(tail)).toEqual(['r', 'hyperlink', 'r', 'hyperlink', 'r']);
    expect(textOf(tail)).toBe('sit Example.com or Anthropic’s website.');
  });

  test('a comment range keeps its text between its markers', () => {
    // Enter inside comment 0's annotated run: the range now spans the break, which is what
    // Word writes — the start marker stays with the head, the end marker travels with the
    // rest of the annotated text.
    const [head, tail] = halves(document(), COMMENTED, 40);
    expect(shapeOf(head)).toEqual(['r', 'commentRangeStart#0', 'r']);
    expect(shapeOf(tail)).toEqual([
      'r',
      'commentRangeEnd#0',
      'commentReference',
      'r',
      'commentRangeStart#1',
      'r',
      'commentRangeEnd#1',
      'commentReference',
      'r',
    ]);
    // Comment 1 was untouched by the split and stays whole, reference after its range.
    expect(textOf(head)).toBe('This paragraph contains text with a QA r');
    expect(textOf(tail).startsWith('eview comment')).toBe(true);
  });

  test('a many-way split places the markers piece by piece', () => {
    const result = applyTreeOp(document(), {
      op: 'splitParagraphMany',
      paragraphId: COMMENTED,
      offsets: [40, 90],
    });
    if (!result.ok) throw new Error(result.reason);
    expect(validateOoxmlPart(result.part).ok).toBe(true);
    const [first, second] = result.effect.splits!.map((entry) => entry.tail);
    expect(shapeOf(nodeById(result.part, COMMENTED))).toEqual(['r', 'commentRangeStart#0', 'r']);
    expect(shapeOf(nodeById(result.part, first!))).toEqual([
      'r',
      'commentRangeEnd#0',
      'commentReference',
      'r',
      'commentRangeStart#1',
      'r',
    ]);
    expect(shapeOf(nodeById(result.part, second!))).toEqual([
      'r',
      'commentRangeEnd#1',
      'commentReference',
      'r',
    ]);
  });
});

describe('a split places zero-length content by its position', () => {
  const BOOKMARKED =
    '<w:p><w:bookmarkStart w:id="7" w:name="intro"/><w:r><w:t>alpha beta</w:t></w:r>' +
    '<w:bookmarkEnd w:id="7"/></w:p>';

  test('a bookmark that spans the paragraph still spans both halves', () => {
    const part = load(BOOKMARKED);
    const [id] = [nodeById(part, '/word/document.xml#0.0.0').id];
    const [head, tail] = halves(part, id, 5);
    expect(shapeOf(head)).toEqual(['bookmarkStart#7', 'r']);
    expect(shapeOf(tail)).toEqual(['r', 'bookmarkEnd#7']);
  });

  test('a range that ENDS at the caret stays closed around the head', () => {
    const part = load(
      '<w:p><w:bookmarkStart w:id="7" w:name="intro"/><w:r><w:t>alpha</w:t></w:r>' +
        '<w:bookmarkEnd w:id="7"/><w:r><w:t> beta</w:t></w:r></w:p>'
    );
    const [head, tail] = halves(part, nodeById(part, '/word/document.xml#0.0.0').id, 5);
    // The end marker sits exactly ON the split. Sending it down with the tail would leave
    // the head holding an unterminated range.
    expect(shapeOf(head)).toEqual(['bookmarkStart#7', 'r', 'bookmarkEnd#7']);
    expect(shapeOf(tail)).toEqual(['r']);
  });

  test('a bookmark that STARTS at the caret keeps its start in the head', () => {
    // A bookmark's markers stay in the first paragraph: the bookmark then covers the new
    // paragraph mark and all of the text it covered before.
    const part = load(
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:bookmarkStart w:id="7" w:name="rest"/>' +
        '<w:r><w:t> beta</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>'
    );
    const [head, tail] = halves(part, nodeById(part, '/word/document.xml#0.0.0').id, 5);
    expect(shapeOf(head)).toEqual(['r', 'bookmarkStart#7']);
    expect(shapeOf(tail)).toEqual(['r', 'bookmarkEnd#7']);
  });

  test('a comment range that STARTS at the caret opens in the tail', () => {
    const part = load(
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:commentRangeStart w:id="7"/>' +
        '<w:r><w:t> beta</w:t></w:r><w:commentRangeEnd w:id="7"/></w:p>'
    );
    const [head, tail] = halves(part, nodeById(part, '/word/document.xml#0.0.0').id, 5);
    expect(shapeOf(head)).toEqual(['r']);
    expect(shapeOf(tail)).toEqual(['commentRangeStart#7', 'r', 'commentRangeEnd#7']);
  });

  test('a join keeps every marker in order (the mirror case, already right)', () => {
    const part = load(
      '<w:p><w:r><w:t>alpha</w:t></w:r><w:bookmarkStart w:id="7" w:name="span"/>' +
        '<w:r><w:t> beta</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>gamma</w:t></w:r><w:bookmarkEnd w:id="7"/></w:p>'
    );
    const first = nodeById(part, '/word/document.xml#0.0.0').id;
    const second = nodeById(part, '/word/document.xml#0.0.1').id;
    const joined = apply(part, { op: 'joinParagraphs', firstId: first, secondId: second });
    // A join appends the second paragraph's children in order, so a range that opened in
    // the first and closed in the second still encloses exactly the text it did.
    expect(shapeOf(nodeById(joined, first))).toEqual([
      'r',
      'bookmarkStart#7',
      'r',
      'r',
      'bookmarkEnd#7',
    ]);
  });

  test('a picture stays where it was drawn when the split is after it', () => {
    const part = load(
      '<w:p><w:r><w:t>abc</w:t></w:r><w:r><w:drawing/></w:r><w:r><w:t>def</w:t></w:r></w:p>'
    );
    // A run holding only a picture measures zero characters. Enter at the END of the
    // paragraph must leave every one of them behind, not carry the picture to a new
    // paragraph the user meant to be empty.
    const [head, tail] = halves(part, nodeById(part, '/word/document.xml#0.0.0').id, 6);
    expect(shapeOf(head)).toEqual(['r', 'r', 'r']);
    expect(shapeOf(tail)).toEqual([]);
  });
});
