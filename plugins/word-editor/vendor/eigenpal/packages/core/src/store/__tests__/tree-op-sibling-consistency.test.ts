// What Word keeps in step when an edit lands.
//
// Every case here is one edit that writes one place in the tree and must NOT leave a sibling
// place stale or deleted: a `w:pPr` rewrite that erases the section mark it cannot express, a
// run property write that erases the character style beside it, a join that drops the section
// boundary carried by the mark it removes.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  validateOoxmlPart,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { applyTreeOp, type TreeDocOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  expect(validateOoxmlPart(result.part).ok).toBe(true);
  return result.part;
}

function xmlOf(part: OoxmlPart): string {
  const result = serializeOoxmlPart(part);
  if (typeof result !== 'string') throw new Error('serialize did not produce XML');
  return result;
}

/** Every `w:pPr` a paragraph carries, as serialized markup — a paragraph may only have one. */
function propertyContainers(part: OoxmlPart, paragraphId: string): number {
  const walk = (node: OoxmlNode): number => {
    if (node.kind === 'textValue') return 0;
    if (node.id === paragraphId) {
      return node.children.filter(
        (child) => child.kind !== 'textValue' && child.localName === 'pPr'
      ).length;
    }
    let found = 0;
    for (const child of node.children) found += walk(child);
    return found;
  };
  return walk(part.root);
}

const SECTION = '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>';

describe('a paragraph property write keeps what it cannot express', () => {
  test('centring the last paragraph of a section keeps the section', () => {
    const part = load(
      `<w:p><w:pPr><w:pStyle w:val="Body"/>${SECTION}</w:pPr><w:r><w:t>End</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>Next section</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [
        { localName: 'pStyle', attributes: { val: 'Body' } },
        { localName: 'jc', attributes: { val: 'center' } },
      ],
    });
    const xml = xmlOf(next);
    expect(xml).toContain('<w:jc w:val="center"/>');
    // The section break is not formatting: it is where the section ENDS (17.6.17), and no
    // paragraph-property op can say it. Losing it merges landscape pages into the next
    // section's portrait ones.
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toContain('<w:sectPr>');
  });

  test('centring keeps the paragraph mark a whole-paragraph format wrote', () => {
    const part = load(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' +
        '<w:rPr><w:sz w:val="40"/></w:rPr></w:pPr><w:r><w:t>Item</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [{ localName: 'numPr' }, { localName: 'jc', attributes: { val: 'center' } }],
    });
    const xml = xmlOf(next);
    // The mark is what the list marker inherits its face from, so dropping it shrinks the
    // bullet back beside text that stayed large.
    expect(xml).toContain('<w:rPr><w:sz w:val="40"/></w:rPr>');
    expect(xml).toContain('<w:numId w:val="3"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  test('a rewritten w:pPr emits CT_PPr order, whatever order the op names', () => {
    const part = load('<w:p><w:r><w:t>Text</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      // Toolbar order: centre first, then indent. `w:ind` precedes `w:jc` in CT_PPr
      // (17.3.1.26), and Word refuses to open a `w:pPr` whose children are out of sequence.
      properties: [
        { localName: 'jc', attributes: { val: 'center' } },
        { localName: 'ind', attributes: { left: '720' } },
      ],
    });
    expect(xmlOf(next)).toContain('<w:pPr><w:ind w:left="720"/><w:jc w:val="center"/></w:pPr>');
  });

  test('clearing the properties an op can express still leaves the section mark', () => {
    const part = load(
      `<w:p><w:pPr><w:jc w:val="center"/>${SECTION}</w:pPr><w:r><w:t>End</w:t></w:r></w:p>`
    );
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'setParagraphProperties', paragraphId: id!, properties: [] });
    const xml = xmlOf(next);
    expect(xml).not.toContain('<w:jc');
    expect(xml).toContain('<w:sectPr>');
  });
});

describe('a run property write keeps what it cannot express', () => {
  test('bold does not delete the character style or the language', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:i/><w:lang w:val="fr-FR"/></w:rPr>' +
        '<w:t>Bonjour</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setRunProperties',
      paragraphId: id!,
      start: 0,
      end: 7,
      properties: [{ localName: 'i' }, { localName: 'b' }],
    });
    const xml = xmlOf(next);
    // `w:rStyle` is a character style — Word never drops one because Bold was pressed.
    expect(xml).toContain('<w:rStyle w:val="Emphasis"/>');
    expect(xml).toContain('<w:lang w:val="fr-FR"/>');
    expect(xml).toContain('<w:b/>');
    // The new `w:b` lands at its CT_RPr position (17.3.2.28), not at the end of the list.
    expect(xml).toContain('<w:rPr><w:rStyle w:val="Emphasis"/><w:b/><w:i/><w:lang w:val="fr-FR"/>');
  });

  test('the paragraph mark keeps its character style through a mark write', () => {
    const part = load(
      '<w:p><w:pPr><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr></w:pPr>' +
        '<w:r><w:t>Item</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setParagraphMarkProperties',
      paragraphId: id!,
      properties: [{ localName: 'sz', attributes: { val: '40' } }],
    });
    expect(xmlOf(next)).toContain('<w:rPr><w:rStyle w:val="Emphasis"/><w:sz w:val="40"/></w:rPr>');
  });
});

describe('the structural edits carry the properties they already carried', () => {
  // Regression cover for behavior that was already right — these are the sibling places a
  // split, a paste split and a deletion could plausibly leave stale, and none of them do.
  test('a split gives the tail the mark, the numbering and the run formatting', () => {
    const part = load(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' +
        '<w:rPr><w:sz w:val="40"/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>Item</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 2 });
    const [head, tail] = paragraphIds(next);
    for (const half of [head!, tail!]) {
      expect(serializeParagraph(next, half)).toContain('<w:numId w:val="3"/>');
      expect(serializeParagraph(next, half)).toContain('<w:sz w:val="40"/>');
      expect(serializeParagraph(next, half)).toContain('<w:b/>');
    }
  });

  test('a split leaves ONE section mark, on the half that now ends the section', () => {
    const part = load(
      `<w:p><w:pPr><w:jc w:val="center"/>${SECTION}</w:pPr><w:r><w:t>Item</w:t></w:r></w:p>`
    );
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 2 });
    const [head, tail] = paragraphIds(next);
    expect(serializeParagraph(next, head!)).toContain('<w:jc w:val="center"/>');
    expect(serializeParagraph(next, head!)).not.toContain('<w:sectPr>');
    expect(serializeParagraph(next, tail!)).toContain('<w:sectPr>');
  });

  test('a many-way split gives EVERY produced paragraph the source properties', () => {
    const part = load(
      `<w:p><w:pPr><w:jc w:val="center"/>${SECTION}</w:pPr>` +
        '<w:r><w:t>one two three</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraphMany', paragraphId: id!, offsets: [3, 7] });
    const ids = paragraphIds(next);
    expect(ids).toHaveLength(3);
    for (const each of ids)
      expect(serializeParagraph(next, each)).toContain('<w:jc w:val="center"/>');
    expect(serializeParagraph(next, ids[0]!)).not.toContain('<w:sectPr>');
    expect(serializeParagraph(next, ids[1]!)).not.toContain('<w:sectPr>');
    expect(serializeParagraph(next, ids[2]!)).toContain('<w:sectPr>');
  });

  test('deleting the last character of a list item leaves it a list item', () => {
    const part = load(
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' +
        '<w:rPr><w:sz w:val="40"/></w:rPr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'
    );
    const [id] = paragraphIds(part);
    const xml = xmlOf(apply(part, { op: 'deleteText', paragraphId: id!, start: 0, end: 1 }));
    expect(xml).toContain('<w:numId w:val="3"/>');
    expect(xml).toContain('<w:sz w:val="40"/>');
  });

  test('a break inserted mid-run keeps the run formatting on both sides', () => {
    const part = load('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Hello</w:t></w:r></w:p>');
    const [id] = paragraphIds(part);
    const xml = xmlOf(apply(part, { op: 'insertPageBreak', paragraphId: id!, offset: 2 }));
    // One run, so the break and the text after it are still inside the bold formatting.
    expect(xml).toContain(
      '<w:r><w:rPr><w:b/></w:rPr><w:t>He</w:t><w:br w:type="page"/><w:t>llo</w:t></w:r>'
    );
  });
});

describe('a join keeps the section boundary the deleted mark carried', () => {
  test('joining into the last paragraph of a section keeps the section', () => {
    const part = load(
      '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
        `<w:p><w:pPr>${SECTION}</w:pPr><w:r><w:t>Two</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>Three</w:t></w:r></w:p>'
    );
    const ids = paragraphIds(part);
    const next = apply(part, { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[1]! });
    const xml = xmlOf(next);
    // A join deletes the FIRST paragraph's mark; the mark that survives is the second's, and
    // the section ends on it. Dropping it swallowed the whole section into the next one.
    expect(xml).toContain('w:orient="landscape"');
    expect(propertyContainers(next, ids[0]!)).toBe(1);
    expect(xml).toContain('<w:t>One</w:t>');
    expect(xml).toContain('<w:t>Two</w:t>');
  });

  test('the survivor keeps its own formatting and gains only the section mark', () => {
    const part = load(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>' +
        `<w:p><w:pPr><w:jc w:val="right"/>${SECTION}</w:pPr><w:r><w:t>Two</w:t></w:r></w:p>`
    );
    const ids = paragraphIds(part);
    const xml = xmlOf(apply(part, { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[1]! }));
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).not.toContain('<w:jc w:val="right"/>');
    expect(xml).toContain('<w:sectPr>');
  });
});

describe('ops write the ONE w:pPr a paragraph already has', () => {
  // Word writes the paragraph mark before `w:sectPr` (CT_PPr, 17.3.1.26). That shape used
  // to demote `w:pPr` to a generic node on read; the shape rule now matches the schema, so
  // it reads TYPED. Either way every op has to write THAT element: minting a second
  // `w:pPr` produces a `w:p` Word refuses to open, so these stay kind-agnostic.
  const DEMOTED =
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr>' +
    `<w:rPr><w:sz w:val="40"/></w:rPr>${SECTION}</w:pPr>` +
    '<w:r><w:t>Item</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p>';

  test('a mark before a section mark reads as typed paragraph properties', () => {
    const part = load(DEMOTED);
    const [id] = paragraphIds(part);
    const paragraph = paragraphNode(part, id!);
    expect(paragraph.children[0]!.kind).toBe('paragraphProperties');
  });

  test('setParagraphProperties writes the container instead of minting a second', () => {
    const part = load(DEMOTED);
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setParagraphProperties',
      paragraphId: id!,
      properties: [{ localName: 'numPr' }, { localName: 'jc', attributes: { val: 'center' } }],
    });
    expect(propertyContainers(next, id!)).toBe(1);
    expect(xmlOf(next)).toContain('<w:numId w:val="3"/>');
    expect(xmlOf(next)).toContain('<w:sectPr>');
  });

  test('setParagraphMarkProperties writes the container instead of minting a second', () => {
    const part = load(DEMOTED);
    const [id] = paragraphIds(part);
    const next = apply(part, {
      op: 'setParagraphMarkProperties',
      paragraphId: id!,
      properties: [{ localName: 'sz', attributes: { val: '52' } }],
    });
    expect(propertyContainers(next, id!)).toBe(1);
    expect(xmlOf(next)).toContain('<w:sz w:val="52"/>');
  });

  test('setSectionMark sees the section the paragraph already ends', () => {
    const part = load(DEMOTED);
    const [id] = paragraphIds(part);
    const result = applyTreeOp(part, { op: 'setSectionMark', paragraphId: id! });
    // One paragraph cannot end two sections, and it already ends one.
    expect(result.ok).toBe(false);
  });

  test('a list op reaches the numbering', () => {
    const part = load(DEMOTED);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'setListLevel', paragraphId: id!, level: 1 });
    expect(xmlOf(next)).toContain('<w:ilvl w:val="1"/>');
    const cleared = apply(part, { op: 'setListNumbering', paragraphId: id!, numId: null });
    expect(xmlOf(cleared)).not.toContain('numPr');
  });

  test('a split gives the tail the properties and leaves the section on it', () => {
    const part = load(DEMOTED);
    const [id] = paragraphIds(part);
    const next = apply(part, { op: 'splitParagraph', paragraphId: id!, offset: 2 });
    const [head, tail] = paragraphIds(next);
    expect(head).toBe(id!);
    // Enter inside a list item makes ANOTHER list item; the section mark stays on the last
    // paragraph of the section, which is now the tail.
    expect(serializeParagraph(next, tail!)).toContain('<w:numId w:val="3"/>');
    expect(serializeParagraph(next, tail!)).toContain('<w:sectPr>');
    expect(serializeParagraph(next, head!)).not.toContain('<w:sectPr>');
  });
});

function paragraphNode(
  part: OoxmlPart,
  paragraphId: string
): Extract<OoxmlNode, { kind: 'paragraph' }> {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.id === paragraphId) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found || found.kind !== 'paragraph') throw new Error('paragraph not found');
  return found;
}

/** One paragraph's markup, so a per-half assertion cannot be satisfied by the other half. */
function serializeParagraph(part: OoxmlPart, paragraphId: string): string {
  const paragraph = paragraphNode(part, paragraphId);
  const single = { ...part, root: paragraph } as OoxmlPart;
  const result = serializeOoxmlPart(single);
  if (typeof result !== 'string') throw new Error('serialize did not produce XML');
  return result;
}
