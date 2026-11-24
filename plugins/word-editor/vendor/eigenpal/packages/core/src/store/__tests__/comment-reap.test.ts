// Deleting the words a comment covers deletes the comment — the way Word does it.
//
// The failure this pins: the rail went on drawing a card for a remark whose text was gone, with
// an author, a date and nothing under it, and saving produced a file whose `w:comment` pointed at
// characters the document no longer held. Two halves had to be wrong for that: the emptied
// revision wrapper the untracked delete left behind, and the comment record nothing reaped.
//
// The reap is deliberately narrow, and the last two tests are what keeps it that way: a comment
// the FILE shipped with no range is left exactly as found, and shortening a range is not
// deleting it.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addComment,
  commentAnchorsOfStory,
  findNoteById,
  readOoxmlPackage,
  removeNode,
  TreeDocumentStore,
  TreePackageStore,
  withPart,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '../index.ts';
import { deleteCommentThread, deleteCommentThreadInStory } from '../package/comment-lifecycle.ts';
import {
  commentIds,
  loadDuplicateBodyHeader,
  loadDuplicateNotes,
  markersFor,
  markersUnder,
  paragraphContaining,
  textOf,
} from './comment-lifecycle-test-support.ts';

const FIXTURE = resolve(
  import.meta.dir,
  '../../../../../e2e/fixtures/comprehensive-word-element-test.docx'
);

function fixture(): OoxmlPackage {
  const pkg = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!pkg.ok) throw new Error(pkg.reason);
  return pkg.package;
}

/** A body paragraph holding at least `length` characters, and how many it holds. */
function paragraphWithText(story: OoxmlPart, length: number): { id: string; length: number } {
  const body = story.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind === 'textValue') throw new Error('no body');
  for (const block of body.children) {
    if (block.kind !== 'paragraph') continue;
    const text = textOf(block);
    if (text.length >= length) return { id: block.id, length: text.length };
  }
  throw new Error('no paragraph long enough');
}

interface Probe {
  readonly pkg: OoxmlPackage;
  readonly paragraphId: string;
  readonly length: number;
  /** `w:id` of the comment this fixture just added — the fixture ships four of its own. */
  readonly commentId: string;
}

/** The fixture plus one comment over `[0, 5)` of a body paragraph. */
function withOneComment(): Probe {
  const loaded = fixture();
  const store = new TreeDocumentStore(loaded, loaded.mainDocumentPart);
  const target = paragraphWithText(store.part, 20);
  const added = addComment(store, {
    anchor: { paragraphId: target.id, start: 0, end: 5 },
    author: 'Reap Probe',
    initials: 'RP',
    date: '2026-08-05T10:00:00Z',
    text: 'Check this claim.',
  });
  if (!added.ok) throw new Error(`addComment refused: ${added.reason}`);
  return {
    pkg: store.package,
    paragraphId: target.id,
    length: target.length,
    commentId: added.commentId,
  };
}

/** The first table in a story, with its rows — for the row-deletion case. */
function findFirstTable(
  story: OoxmlPart
): { id: string; rows: readonly { id: string; node: OoxmlNode }[] } | null {
  let found: { id: string; rows: { id: string; node: OoxmlNode }[] } | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'table') {
      const rows = node.children
        .filter((child) => child.kind === 'tableRow')
        .map((child) => ({ id: child.id, node: child }));
      if (rows.length > 1) {
        found = { id: node.id, rows };
        return;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(story.root);
  return found;
}

/** The first paragraph inside a node, with how many characters it holds. */
function firstParagraphIn(row: { node: OoxmlNode }): { id: string; length: number } | null {
  let found: { id: string; length: number } | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const text = textOf(node);
      if (text.length > 0) found = { id: node.id, length: text.length };
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(row.node);
  return found;
}

describe('a comment dies with the words it covered', () => {
  test('deleting the whole commented range removes the record, its markers and its anchor', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);

    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 5 });
    });

    expect(result.ok).toBe(true);
    const after = store.currentPackage();
    expect(commentIds(after, mainName)).not.toContain(commentId);
    // Markers go with the record. A `commentRangeEnd` naming a comment the package cannot
    // resolve is exactly the half-deleted state the reap exists to prevent.
    expect(markersFor(after.parts.get(mainName)!, commentId)).toEqual([]);
    expect(
      commentAnchorsOfStory(after.parts.get(mainName)!).some(
        (anchor) => anchor.commentId === commentId
      )
    ).toBe(false);
    // The fixture's OWN four comments are untouched: nothing about them was deleted.
    expect(commentIds(after, mainName).length).toBe(4);
  });

  test('undo puts the words and the remark back together', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);

    store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 5 });
    });
    expect(commentIds(store.currentPackage(), mainName)).not.toContain(commentId);

    expect(store.undo()).not.toBeNull();
    // ONE undo, not two. The reap rides the same package pointer as the deletion, so a reader
    // never sees the intermediate state where the text is back and the comment is not.
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
    expect(markersFor(store.currentPackage().parts.get(mainName)!, commentId).length).toBe(3);
  });

  test('shortening a range keeps the comment', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);

    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 2 });
    });

    expect(result.ok).toBe(true);
    // Three characters of the five still carry the remark, so there is still something to
    // remark on. Reaping here would delete a comment on text the reader can still see.
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
  });

  test('losing only the start marker keeps the comment — the reference still places it', () => {
    const { pkg, paragraphId, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(mainName)!);

    // Remove just the `w:commentRangeStart`, the way deleting a block that held it does. The
    // end marker, the reference and the commented words all survive, and Word keeps the
    // comment: the REFERENCE is what anchors it. Reading "no usable range" as "this edit
    // emptied it" deleted a remark whose text was still on screen.
    const start = markersFor(store.currentPackage().parts.get(mainName)!, commentId)[0];
    if (start === undefined) throw new Error('no start marker');
    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.applyPackage((current) => {
        const part = current.parts.get(mainName)!;
        const removed = removeNode(part, start, { deferValidation: true });
        return removed.ok ? withPart(current, removed.part) : current;
      });
      // Paired with a real text edit, so the gate opens and the reap actually runs.
      ctx.apply({ op: 'deleteText', paragraphId, start: 0, end: 1 });
    });

    expect(result.ok).toBe(true);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
  });

  test('deleting the row a comment lives in reaps it', () => {
    // `deleteTableRow` names a TABLE, not a paragraph, and carries away every cell paragraph
    // under the row — markers included. It has no cheap subtree to probe, so it opens the reap
    // gate outright; without that the exact orphan this module exists to prevent survived.
    const loaded = fixture();
    const store = new TreeDocumentStore(loaded, loaded.mainDocumentPart);
    const table = findFirstTable(store.part);
    if (!table) throw new Error('the fixture has no table');
    const cellParagraph = firstParagraphIn(table.rows[0]!);
    if (!cellParagraph) throw new Error('no paragraph in the first row');
    const added = addComment(store, {
      anchor: { paragraphId: cellParagraph.id, start: 0, end: cellParagraph.length },
      author: 'Reap Probe',
      date: '2026-08-05T10:00:00Z',
      text: 'Row remark.',
    });
    if (!added.ok) throw new Error(`addComment refused: ${added.reason}`);

    const mainName = loaded.mainDocumentPart;
    const packaged = new TreePackageStore(store.package, store.package.parts.get(mainName)!);
    expect(commentIds(packaged.currentPackage(), mainName)).toContain(added.commentId);

    const result = packaged.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteTableRow', tableId: table.id, rowId: table.rows[0]!.id });
    });

    expect(result.ok).toBe(true);
    expect(commentIds(packaged.currentPackage(), mainName)).not.toContain(added.commentId);
  });

  test('an edit elsewhere leaves a comment the file shipped orphaned exactly as found', () => {
    const { pkg, paragraphId, length, commentId } = withOneComment();
    const mainName = pkg.mainDocumentPart;
    // Strand it the way a foreign producer can: drop the start marker, leaving an end with
    // nothing before it. Stranded in the PACKAGE, before any store opens it, so this is a file
    // that ARRIVED this way rather than an edit the engine made.
    const story = pkg.parts.get(mainName)!;
    const start = markersFor(story, commentId)[0];
    if (start === undefined) throw new Error('no start marker to strip');
    const stripped = removeNode(story, start, { deferValidation: true });
    if (!stripped.ok) throw new Error('could not strand the comment');
    expect(
      commentAnchorsOfStory(stripped.part).some(
        (anchor) => anchor.commentId === commentId && anchor.orphaned
      )
    ).toBe(true);

    const store = new TreePackageStore(withPart(pkg, stripped.part), stripped.part);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);

    // Now edit somewhere the comment never was. The remark is already rangeless, so the reap
    // must not read that as "this edit emptied it" — a file's own orphan is not ours to delete.
    const result = store.transact({ kind: 'body', partName: mainName }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: length - 2, end: length - 1 });
    });
    expect(result.ok).toBe(true);
    expect(commentIds(store.currentPackage(), mainName)).toContain(commentId);
  });
});

describe('story-owned comment deletion does not follow a bare w:id into another story', () => {
  test('stripping the body leaves a header that reused the same id', () => {
    const pkg = loadDuplicateBodyHeader();
    const main = pkg.mainDocumentPart;
    const stripped = deleteCommentThreadInStory(pkg, '1', { storyPartName: main });
    if (stripped === null) throw new Error('deletion refused');
    expect(markersFor(stripped.parts.get(main)!, '1')).toEqual([]);
    expect(markersFor(stripped.parts.get('/word/header1.xml')!, '1').length).toBe(3);
    expect(commentIds(stripped, main)).toContain('1');
  });

  test('deleteCommentThread without an owner defaults to the main story, not every part', () => {
    const pkg = loadDuplicateBodyHeader();
    const main = pkg.mainDocumentPart;
    const stripped = deleteCommentThread(pkg, '1');
    if (stripped === null) throw new Error('deletion refused');
    expect(markersFor(stripped.parts.get(main)!, '1')).toEqual([]);
    expect(markersFor(stripped.parts.get('/word/header1.xml')!, '1').length).toBe(3);
    expect(commentIds(stripped, main)).toContain('1');
  });

  test('deleting the body’s commented words leaves a header that reused the same id', () => {
    const pkg = loadDuplicateBodyHeader();
    const main = pkg.mainDocumentPart;
    const target = paragraphContaining(pkg.parts.get(main)!.root, 'body');
    const store = new TreePackageStore(pkg, pkg.parts.get(main)!);
    const result = store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: target.id, start: 0, end: target.length });
    });
    expect(result.ok).toBe(true);
    const after = store.currentPackage();
    expect(markersFor(after.parts.get(main)!, '1')).toEqual([]);
    expect(markersFor(after.parts.get('/word/header1.xml')!, '1').length).toBe(3);
    expect(commentIds(after, main)).toContain('1');
  });

  test('deleting one note’s commented words leaves the neighbour that reused the same id', () => {
    const pkg = loadDuplicateNotes();
    const main = pkg.mainDocumentPart;
    const store = new TreePackageStore(pkg, pkg.parts.get(main)!);
    const notes = store.partFor({ kind: 'notesPart', noteKind: 'footnote' });
    if (!notes) throw new Error('footnotes part missing');
    const note = findNoteById(notes.root, 1);
    if (!note) throw new Error('footnote 1 missing');
    const target = paragraphContaining(note, 'one');
    const result = store.transact({ kind: 'notesPart', noteKind: 'footnote' }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: target.id, start: 0, end: target.length });
    });
    expect(result.ok).toBe(true);
    const after = store.currentPackage().parts.get(notes.name)!;
    const first = findNoteById(after.root, 1);
    const second = findNoteById(after.root, 2);
    if (!first || !second) throw new Error('notes missing after reap');
    expect(markersUnder(first, '1')).toEqual([]);
    expect(markersUnder(second, '1').length).toBe(3);
    expect(commentIds(store.currentPackage(), main)).toContain('1');
  });
});
