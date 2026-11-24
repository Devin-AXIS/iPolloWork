// History groups: consecutive transactions naming one gesture extend one undo entry.
//
// The store rule is identity on the top entry: a transaction carrying the token the top
// entry holds folds into it; anything else — another token, no token, undo, redo, a
// composition closing — records its own entry, and the package coordinator closes a
// story's group whenever history moves above it (a package unit, another story's pointer,
// a package-level undo or redo).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/index.ts';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const HEADER_REL_TYPE = `${R}/header`;

function loadPart(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function firstParagraphId(part: OoxmlPart): string {
  const walk = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const id = walk(part.root);
  if (!id) throw new Error('no paragraph');
  return id;
}

function story(): { store: TreeDocumentStore; id: string } {
  const part = loadPart('<w:p><w:r><w:t>Hello</w:t></w:r></w:p>');
  return { store: new TreeDocumentStore(part), id: firstParagraphId(part) };
}

const text = (s: TreeDocumentStore, id: string): string | null => paragraphTextOf(s.part, id);

/** Append `suffix` as one transaction, optionally as a frame of `group`. */
function append(s: TreeDocumentStore, id: string, suffix: string, group?: symbol): void {
  const at = text(s, id)!.length;
  const result = s.transact(
    (ctx) => {
      ctx.selectionBefore({ paragraphId: id, start: at, end: at });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: at, text: suffix });
      ctx.selectionAfter({ paragraphId: id, start: at + suffix.length, end: at + suffix.length });
    },
    group ? { historyGroup: group } : {}
  );
  if (!result.ok) throw new Error(result.reason);
}

describe('TreeDocumentStore history groups', () => {
  test('frames of one gesture are one entry; undo restores the state before the first', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    append(s, id, ' b', gesture);
    append(s, id, ' c', gesture);
    expect(s.revision).toBe(3); // every frame published
    expect(s.historyDepth).toBe(1);
    expect(text(s, id)).toBe('Hello a b c');
    s.undo();
    expect(text(s, id)).toBe('Hello');
    expect(s.historyDepth).toBe(0);
    s.redo();
    expect(text(s, id)).toBe('Hello a b c');
  });

  test('the entry keeps the first frame’s selectionBefore and the last frame’s selectionAfter', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    append(s, id, ' b', gesture);
    expect(s.selectionForUndo()).toEqual({ paragraphId: id, start: 5, end: 5 });
    s.undo();
    expect(s.selectionForRedo()).toEqual({ paragraphId: id, start: 9, end: 9 });
  });

  test('another token is another entry', () => {
    const { store: s, id } = story();
    append(s, id, ' a', Symbol('first'));
    append(s, id, ' b', Symbol('second'));
    expect(s.historyDepth).toBe(2);
  });

  test('an ungrouped transaction closes the group', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    append(s, id, ' x');
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(3);
    s.undo();
    expect(text(s, id)).toBe('Hello a x');
  });

  test('undo and redo close the group', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    s.undo();
    s.redo();
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(2);
    s.undo();
    expect(text(s, id)).toBe('Hello a');
  });

  test('undo closes the group even when the entry below it carries the same token', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    append(s, id, ' x');
    s.undo(); // ' a' is on top again, still tagged — and undo is a boundary
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(2);
    s.undo();
    expect(text(s, id)).toBe('Hello a');
  });

  test('closeHistoryGroup makes the next frame a new entry', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    s.closeHistoryGroup();
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(2);
  });

  test('a transaction that applies nothing leaves the group open', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    const result = s.transact(() => {}, { historyGroup: gesture });
    expect(result).toEqual({ ok: true, change: null });
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(1);
  });

  test('an ungrouped transaction that applies nothing still closes the group', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    expect(s.transact(() => {})).toEqual({ ok: true, change: null });
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(2);
  });

  test('a refused ungrouped transaction closes the group too', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    const refused = s.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: 'no-such-paragraph', offset: 0, text: 'x' })
    );
    expect(refused.ok).toBe(false);
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(2);
  });

  test('a composition records its own entry and closes the group', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    s.beginComposition();
    append(s, id, 'に', gesture);
    s.endComposition();
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(3);
  });

  test('a checkpoint restore keeps the group the restored entry held', () => {
    const { store: s, id } = story();
    const gesture = Symbol('drag');
    append(s, id, ' a', gesture);
    const checkpoint = s.checkpoint();
    append(s, id, ' x');
    s.restoreCheckpoint(checkpoint);
    append(s, id, ' b', gesture);
    expect(s.historyDepth).toBe(1);
    expect(text(s, id)).toBe('Hello a b');
  });
});

function packageBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>' +
        '</w:body></w:document>'
    ),
  });
}

function openPackage(): { store: TreePackageStore; id: string } {
  const result = readOoxmlPackage(packageBytes());
  if (!result.ok) throw new Error(result.reason);
  const pkg: OoxmlPackage = result.package;
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return { store: new TreePackageStore(pkg, main), id: firstParagraphId(main) };
}

function bodyText(store: TreePackageStore, id: string): string | null {
  return paragraphTextOf(store.bodyStore().part, id);
}

function appendBody(store: TreePackageStore, id: string, suffix: string, group?: symbol): void {
  const at = bodyText(store, id)!.length;
  const result = store.transact(
    { kind: 'body' },
    (ctx) => ctx.apply({ op: 'insertText', paragraphId: id, offset: at, text: suffix }),
    group ? { historyGroup: group } : {}
  );
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

function headerRelationshipId(store: TreePackageStore): string {
  const pkg = store.currentPackage();
  const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (entry) => entry.type === HEADER_REL_TYPE
  );
  if (!record) throw new Error('no header relationship');
  return record.id;
}

describe('TreePackageStore history groups', () => {
  test('frames on one story are one package undo unit', () => {
    const { store, id } = openPackage();
    const gesture = Symbol('drag');
    appendBody(store, id, ' a', gesture);
    appendBody(store, id, ' b', gesture);
    expect(store.undo()).not.toBeNull();
    expect(bodyText(store, id)).toBe('Hello');
    expect(store.canUndo).toBe(false);
    expect(store.redo()).not.toBeNull();
    expect(bodyText(store, id)).toBe('Hello a b');
  });

  test('a package unit pushed above the group closes it', () => {
    const { store, id } = openPackage();
    const gesture = Symbol('drag');
    appendBody(store, id, ' a', gesture);
    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    appendBody(store, id, ' b', gesture);
    expect(store.undo()).not.toBeNull(); // ' b' alone
    expect(bodyText(store, id)).toBe('Hello a');
    expect(store.undo()).not.toBeNull(); // the header
    expect(store.undo()).not.toBeNull(); // ' a'
    expect(bodyText(store, id)).toBe('Hello');
  });

  test('a frame in another story extends the group as one package unit', () => {
    const { store, id } = openPackage();
    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    const headerScope = { kind: 'headerFooter' as const, rId: headerRelationshipId(store) };
    const headerPart = store.partFor(headerScope);
    if (!headerPart) throw new Error('no header part');
    const headerParagraph = firstParagraphId(headerPart);
    const headerText = () => paragraphTextOf(store.partFor(headerScope)!, headerParagraph);
    const gesture = Symbol('drag');
    appendBody(store, id, ' a', gesture);
    const inHeader = store.transact(
      headerScope,
      (ctx) => ctx.apply({ op: 'insertText', paragraphId: headerParagraph, offset: 0, text: 'H' }),
      { historyGroup: gesture }
    );
    expect(inHeader.ok).toBe(true);
    appendBody(store, id, ' b', gesture);
    expect(store.undo()).not.toBeNull(); // the whole gesture
    expect(bodyText(store, id)).toBe('Hello');
    expect(headerText()).toBe('');
    expect(store.redo()).not.toBeNull();
    expect(bodyText(store, id)).toBe('Hello a b');
    expect(headerText()).toBe('H');
    expect(store.undo()).not.toBeNull();
    expect(store.undo()).not.toBeNull(); // the header
    expect(store.canUndo).toBe(false);
  });

  test('a package-level undo closes the group', () => {
    const { store, id } = openPackage();
    const gesture = Symbol('drag');
    appendBody(store, id, ' a', gesture);
    appendBody(store, id, ' b', gesture);
    expect(store.undo()).not.toBeNull();
    appendBody(store, id, ' c', gesture);
    expect(store.undo()).not.toBeNull();
    expect(bodyText(store, id)).toBe('Hello');
    expect(store.canUndo).toBe(false);
  });
});
