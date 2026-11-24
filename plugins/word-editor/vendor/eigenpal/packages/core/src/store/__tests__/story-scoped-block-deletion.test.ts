// Block removal inside a story that is not the part's body: a footnote, an endnote, a comment,
// or a text box.
//
// A notes part holds one story per note, and a comments part one per comment. Removing a
// paragraph from one of them must keep the caret in that story, and must refuse only when that
// story would be left without a paragraph. Other notes, comments, or body paragraphs do not count.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { applyTreeOp } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';

const P = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const REF_P = (text: string): string =>
  `<w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p>`;

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const footnotes = (...notes: string[]): OoxmlPart =>
  read(
    `<w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      notes.map((body, index) => `<w:footnote w:id="${index + 1}">${body}</w:footnote>`).join('') +
      `</w:footnotes>`,
    '/word/footnotes.xml'
  );

/** The text of each paragraph, keyed by id, in document order. */
function paragraphs(part: OoxmlPart): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') out.push({ id: node.id, text: textOf(node).trim() });
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return out;
}

function firstOfKind(part: OoxmlPart, kind: OoxmlNode['kind']): string {
  const walk = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === kind) return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error(`no ${kind} in part`);
  return found;
}

const idOf = (part: OoxmlPart, text: string): string => {
  // The last match is the innermost: a paragraph that holds a text box reads the box's text too.
  const found = paragraphs(part).findLast((paragraph) => paragraph.text === text);
  if (!found) throw new Error(`no paragraph "${text}"`);
  return found.id;
};

function remove(part: OoxmlPart, text: string) {
  return applyTreeOp(part, { op: 'deleteBlock', blockId: idOf(part, text) });
}

describe('deleteBlock in a footnote or endnote', () => {
  test('removes the second paragraph of a note and keeps the caret in that note', () => {
    const part = footnotes(REF_P('one') + P('two'), P('other note'));
    const result = remove(part, 'two');
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphs(result.part).map((paragraph) => paragraph.text)).toEqual([
      '',
      'one',
      'other note',
    ]);
    // The end of the paragraph before: the reference mark and " one".
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'one'), offset: 5 });
  });

  test('removes the first paragraph and its reference mark, and the caret moves to the next', () => {
    const part = footnotes(REF_P('one') + P('two') + P('three'));
    const result = remove(part, 'one');
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphs(result.part).map((paragraph) => paragraph.text)).toEqual([
      '',
      'two',
      'three',
    ]);
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'two'), offset: 0 });
  });

  test('the caret never leaves the note for a neighboring note', () => {
    // The previous paragraph in the part is the end of the first note. The caret must stay
    // in the second note and take its next paragraph.
    const part = footnotes(P('first note'), P('a') + P('b'));
    const result = remove(part, 'a');
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'b'), offset: 0 });
  });

  test('refuses the only paragraph of a note, although other notes keep theirs', () => {
    const part = footnotes(REF_P('only'), P('other note'));
    const result = remove(part, 'only');
    expect(result).toMatchObject({ ok: false, reason: 'block-required' });
  });

  test('refuses the paragraph of a separator note', () => {
    const part = footnotes(P('note'));
    const separator = paragraphs(part)[0]!.id;
    expect(applyTreeOp(part, { op: 'deleteBlock', blockId: separator })).toMatchObject({
      ok: false,
      reason: 'block-required',
    });
  });

  test('removes a table from a note when a paragraph remains in it', () => {
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>${P('cell')}</w:tc></w:tr></w:tbl>`;
    const part = footnotes(REF_P('lead') + table + P('tail'));
    const tableId = firstOfKind(part, 'table');
    const result = applyTreeOp(part, { op: 'deleteBlock', blockId: tableId });
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphs(result.part).map((paragraph) => paragraph.text)).toEqual([
      '',
      'lead',
      'tail',
    ]);
    // The start of the paragraph after the removed block.
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'tail'), offset: 0 });
  });

  test('works the same way in an endnote', () => {
    const part = read(
      `<w:endnotes xmlns:w="${W}"><w:endnote w:id="1">${P('one')}${P('two')}</w:endnote>` +
        `<w:endnote w:id="2">${P('solo')}</w:endnote></w:endnotes>`,
      '/word/endnotes.xml'
    );
    const removed = remove(part, 'one');
    if (!removed.ok) throw new Error(removed.reason);
    expect(paragraphs(removed.part).map((paragraph) => paragraph.text)).toEqual(['two', 'solo']);
    expect(removed.effect.caret).toEqual({ paragraphId: idOf(part, 'two'), offset: 0 });
    expect(remove(part, 'solo')).toMatchObject({ ok: false, reason: 'block-required' });
  });
});

describe('deleteBlock beside wrappers and tables', () => {
  const body = (...blocks: string[]) =>
    read(
      `<w:document xmlns:w="${W}"><w:body>${blocks.join('')}</w:body></w:document>`,
      '/word/document.xml'
    );

  test('finds the paragraphs of a block custom XML element', () => {
    const custom = (...blocks: string[]) =>
      `<w:customXml w:element="item">${blocks.join('')}</w:customXml>`;
    const part = body(custom(P('a'), P('b')));
    const result = remove(part, 'a');
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphs(result.part).map((paragraph) => paragraph.text)).toEqual(['b']);
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'b'), offset: 0 });
    // The only paragraph of a story stays, wrapper or not.
    const only = body(custom(P('only')));
    expect(remove(only, 'only')).toMatchObject({ ok: false, reason: 'block-required' });
  });

  test('a paragraph after a table moves the caret to the next paragraph, not into the table', () => {
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>${P('cell')}</w:tc></w:tr></w:tbl>`;
    const part = footnotes(P('lead') + table + P('gone') + P('next'));
    const result = remove(part, 'gone');
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'next'), offset: 0 });
  });
});

describe('deleteBlock in a comment', () => {
  const comments = read(
    `<w:comments xmlns:w="${W}">` +
      `<w:comment w:id="0" w:author="A">${P('c1')}${P('c2')}</w:comment>` +
      `<w:comment w:id="1" w:author="A">${P('solo')}</w:comment></w:comments>`,
    '/word/comments.xml'
  );

  test('removes one paragraph of a comment and keeps the caret in it', () => {
    const result = remove(comments, 'c2');
    if (!result.ok) throw new Error(result.reason);
    expect(paragraphs(result.part).map((paragraph) => paragraph.text)).toEqual(['c1', 'solo']);
    expect(result.effect.caret).toEqual({ paragraphId: idOf(comments, 'c1'), offset: 2 });
  });

  test('refuses the only paragraph of a comment', () => {
    expect(remove(comments, 'solo')).toMatchObject({ ok: false, reason: 'block-required' });
  });
});

describe('deleteBlock in a text box', () => {
  const box = (...blocks: string[]) =>
    `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${blocks.join('')}</w:txbxContent>` +
    `</v:textbox></v:shape></w:pict></w:r></w:p>`;
  const body = (...blocks: string[]) =>
    read(
      `<w:document xmlns:w="${W}" xmlns:v="${V}"><w:body>${blocks.join('')}</w:body></w:document>`,
      '/word/document.xml'
    );

  test('removes one paragraph of a text box and keeps the caret in the box', () => {
    const part = body(P('lead'), box(P('in one'), P('in two')));
    const result = remove(part, 'in two');
    if (!result.ok) throw new Error(result.reason);
    expect(result.effect.caret).toEqual({ paragraphId: idOf(part, 'in one'), offset: 6 });
  });

  test('refuses the only paragraph of a text box, although the body has others', () => {
    const part = body(P('lead'), box(P('in only')));
    expect(remove(part, 'in only')).toMatchObject({ ok: false, reason: 'block-required' });
  });

  test('a body paragraph still takes its caret from the body, not from a text box', () => {
    const part = body(box(P('in box')), P('second'));
    const result = remove(part, 'second');
    if (!result.ok) throw new Error(result.reason);
    // The paragraph that holds the box is the body paragraph before the removed one.
    expect(result.effect.caret?.paragraphId).not.toBe(idOf(part, 'in box'));
    expect(result.effect.caret?.paragraphId).toBe(paragraphs(part)[0]!.id);
  });
});
