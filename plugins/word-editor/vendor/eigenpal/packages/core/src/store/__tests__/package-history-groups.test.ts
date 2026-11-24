// History groups across package units: the coordinator merges a group's frames, story
// transactions and package writes alike, into one package undo pointer.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../package/index.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { addPackageComment, setPackageCommentResolved } from '../store/comment-package-write.ts';
import { observeHistoryGroup, type HistoryCaptureKind } from '../store/history-group.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMMENTS = '/word/comments.xml';

function open(): { store: TreePackageStore; id: string } {
  const bytes = zipSync({
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
        '<w:p><w:r><w:t>Hello world</w:t></w:r></w:p><w:sectPr/>' +
        '</w:body></w:document>'
    ),
  });
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  const main = result.package.parts.get(result.package.mainDocumentPart)!;
  const find = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'paragraph') return node.id;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return { store: new TreePackageStore(result.package, main), id: find(main.root)! };
}

const text = (store: TreePackageStore, id: string) => paragraphTextOf(store.bodyStore().part, id);
const commentCount = (store: TreePackageStore): number => {
  const part = store.currentPackage().parts.get(COMMENTS);
  return part ? part.root.children.filter((child) => child.kind !== 'textValue').length : 0;
};

function append(store: TreePackageStore, id: string, suffix: string, group?: symbol): void {
  const at = text(store, id)!.length;
  const result = store.transact(
    { kind: 'body' },
    (ctx) => {
      ctx.selectionBefore({ paragraphId: id, start: at, end: at });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: at, text: suffix });
      ctx.selectionAfter({ paragraphId: id, start: at + suffix.length, end: at + suffix.length });
    },
    group ? { historyGroup: group } : {}
  );
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

function comment(store: TreePackageStore, id: string, body: string, group?: symbol): string {
  const result = addPackageComment(
    store,
    { anchor: { paragraphId: id, start: 0, end: 5 }, author: 'Reviewer', text: body },
    { kind: 'body' },
    group
  );
  if (!result.ok) throw new Error(result.reason);
  return result.commentId;
}

describe('package history groups', () => {
  test('a story edit, a comment and another edit in one group are one undo and one redo', () => {
    const { store, id } = open();
    append(store, id, ' before');
    const decision = Symbol('decision');
    append(store, id, ' a', decision);
    comment(store, id, 'Counter-proposal', decision);
    append(store, id, ' b', decision);
    expect(text(store, id)).toBe('Hello world before a b');
    expect(commentCount(store)).toBe(1);

    expect(store.undo()).not.toBeNull();
    expect(text(store, id)).toBe('Hello world before');
    expect(commentCount(store)).toBe(0);
    expect(store.redo()).not.toBeNull();
    expect(text(store, id)).toBe('Hello world before a b');
    expect(commentCount(store)).toBe(1);

    // The absorbed story entries are gone, so the edit before the group is still one step.
    expect(store.undo()).not.toBeNull();
    expect(store.undo()).not.toBeNull();
    expect(text(store, id)).toBe('Hello world');
    expect(store.canUndo).toBe(false);
  });

  test('the merged step restores the first frame’s selection and reapplies the last one’s', () => {
    const { store, id } = open();
    const decision = Symbol('decision');
    append(store, id, ' a', decision);
    comment(store, id, 'Note', decision);
    append(store, id, ' b', decision);
    expect(store.selectionForUndo()).toEqual({ paragraphId: id, start: 11, end: 11 });
    store.undo();
    expect(store.selectionForRedo()).toEqual({ paragraphId: id, start: 15, end: 15 });
  });

  test('frames report started, then extended, across package units', () => {
    const { store, id } = open();
    const decision = Symbol('decision');
    const kinds: HistoryCaptureKind[] = [];
    const frame = (write: () => void) => {
      let kind: HistoryCaptureKind | undefined;
      observeHistoryGroup(decision, (reported) => (kind = reported), write);
      kinds.push(kind!);
    };
    frame(() => comment(store, id, 'First', decision));
    frame(() => append(store, id, ' a', decision));
    frame(() => setPackageCommentResolved(store, '0', true, decision));
    expect(kinds).toEqual(['started', 'extended', 'extended']);
  });

  test('an ungrouped write closes the group', () => {
    const { store, id } = open();
    const decision = Symbol('decision');
    comment(store, id, 'First', decision);
    append(store, id, ' x');
    append(store, id, ' b', decision);
    store.undo();
    expect(text(store, id)).toBe('Hello world x');
    store.undo();
    expect(text(store, id)).toBe('Hello world');
    expect(commentCount(store)).toBe(1);
  });

  test('another group closes the group', () => {
    const { store, id } = open();
    comment(store, id, 'First', Symbol('first'));
    append(store, id, ' b', Symbol('second'));
    store.undo();
    expect(commentCount(store)).toBe(1);
    expect(text(store, id)).toBe('Hello world');
  });

  test('undo closes the group: a later frame is its own step', () => {
    const { store, id } = open();
    const decision = Symbol('decision');
    comment(store, id, 'First', decision);
    append(store, id, ' a', decision);
    store.undo();
    append(store, id, ' b', decision);
    comment(store, id, 'Again', decision);
    store.undo();
    expect(text(store, id)).toBe('Hello world');
    expect(commentCount(store)).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  test('a lifecycle op joins the group', () => {
    const { store, id } = open();
    const decision = Symbol('decision');
    append(store, id, ' a', decision);
    const created = store.applyLifecycleOp(
      { op: 'createHeaderFooter', sectionIndex: 0, kind: 'header', variant: 'default' },
      { historyGroup: decision }
    );
    expect(created.ok).toBe(true);
    const headers = () =>
      [...store.currentPackage().parts.keys()].filter((name) => name.includes('header'));
    expect(headers()).toHaveLength(1);
    store.undo();
    expect(text(store, id)).toBe('Hello world');
    expect(headers()).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  for (const prior of [199, 200, 205]) {
    test(`with ${prior} earlier edits, a story frame and a comment frame still merge`, () => {
      const { store, id } = open();
      for (let index = 0; index < prior; index += 1) append(store, id, '.');
      const earlier = text(store, id);
      const decision = Symbol('decision');
      const kinds: HistoryCaptureKind[] = [];
      const frame = (write: () => void) => {
        let kind: HistoryCaptureKind | undefined;
        observeHistoryGroup(decision, (reported) => (kind = reported), write);
        kinds.push(kind!);
      };
      frame(() => append(store, id, ' a', decision));
      frame(() => comment(store, id, 'Counter-proposal', decision));
      expect(kinds).toEqual(['started', 'extended']);
      store.undo();
      expect(text(store, id)).toBe(earlier);
      expect(commentCount(store)).toBe(0);
      store.undo();
      expect(text(store, id)).toBe(earlier!.slice(0, -1));
    });
  }
});
