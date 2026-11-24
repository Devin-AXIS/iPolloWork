// Character-format ops must change run properties only, never document text.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DATE_TEXT = 'Date: March 2 2026';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphId(part: OoxmlPart): string {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  if (!ids[0]) throw new Error('no paragraph');
  return ids[0];
}

function hasLocalName(part: OoxmlPart, localName: string): boolean {
  let found = false;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) found = true;
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

function formatRange(
  store: TreeDocumentStore,
  paragraphId: string,
  start: number,
  end: number,
  localName: string
): void {
  const result = store.transact((context) => {
    context.apply({
      op: 'setRunProperties',
      paragraphId,
      start,
      end,
      properties: [{ localName }],
    });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

describe('character format keeps paragraph text', () => {
  test('split-range bold keeps Date line text and adds w:b', () => {
    const part = load(`<w:p><w:r><w:t>${DATE_TEXT}</w:t></w:r></w:p>`);
    const store = new TreeDocumentStore(part);
    const id = paragraphId(store.part);
    expect(paragraphTextOf(store.part, id)).toBe(DATE_TEXT);
    expect(hasLocalName(store.part, 'b')).toBe(false);
    formatRange(store, id, 6, 18, 'b');
    expect(paragraphTextOf(store.part, id)).toBe(DATE_TEXT);
    expect(hasLocalName(store.part, 'b')).toBe(true);
  });

  test('split-range underline keeps Date line text and adds w:u', () => {
    const part = load(`<w:p><w:r><w:t>${DATE_TEXT}</w:t></w:r></w:p>`);
    const store = new TreeDocumentStore(part);
    const id = paragraphId(store.part);
    formatRange(store, id, 6, 18, 'u');
    expect(paragraphTextOf(store.part, id)).toBe(DATE_TEXT);
    expect(hasLocalName(store.part, 'u')).toBe(true);
  });
});
