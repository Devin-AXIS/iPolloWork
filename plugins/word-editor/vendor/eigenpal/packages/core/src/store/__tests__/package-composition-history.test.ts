// IME composition + note-reference cascade: the whole composition promotes to one
// package history unit so undo/redo restore citation and note body together.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  findNoteById,
  readOoxmlPackage,
  resolveNotesPart,
  type OoxmlPackage,
} from '../package/index.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: { readonly body?: string; readonly footnotes?: string }): Uint8Array {
  const hasFn = options.footnotes !== undefined;
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (hasFn
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        (options.body ?? '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>') +
        '<w:sectPr/></w:body></w:document>'
    ),
  };
  if (hasFn) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    );
    entries['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">${options.footnotes}</w:footnotes>`
    );
  }
  return zipSync(entries);
}

function load(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openStore(bytes: Uint8Array, options?: ConstructorParameters<typeof TreePackageStore>[2]) {
  const pkg = load(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main, options);
}

function firstParagraphId(pkg: OoxmlPackage): string {
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const body = main.root.children.find((child) => child.kind === 'body')!;
  const p = body.children.find((child) => child.kind === 'paragraph')!;
  return p.id;
}

function notePresent(store: TreePackageStore, id: number): boolean {
  const part = resolveNotesPart(store.currentPackage(), 'footnote');
  if (!part) return false;
  return findNoteById(part.root, id) !== undefined;
}

const seededNotes =
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="3"><w:p><w:r><w:t>three</w:t></w:r></w:p></w:footnote>`;

const citationBody = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;

describe('IME composition + note-ref cascade package history', () => {
  test('endComposition + undo restores citation and note body together', () => {
    const store = openStore(build({ body: citationBody, footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());
    const depthBefore = store.bodyStore().historyDepth;

    expect(store.beginComposition({ kind: 'body' })).toBe(true);
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteText', paragraphId, start: 1, end: 2 });
      }).ok
    ).toBe(true);
    expect(notePresent(store, 1)).toBe(false);
    expect(store.canUndo).toBe(false);

    store.endComposition();
    expect(store.canUndo).toBe(true);
    // Cascade owns the package pointer — no orphan local story undo entry.
    expect(store.bodyStore().historyDepth).toBe(depthBefore);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('AZ');

    expect(store.undo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(notePresent(store, 1)).toBe(true);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  test('redo after composition cascade is symmetric', () => {
    const store = openStore(build({ body: citationBody, footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());

    store.beginComposition({ kind: 'body' });
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteText', paragraphId, start: 1, end: 2 });
      }).ok
    ).toBe(true);
    store.endComposition();

    store.undo();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(notePresent(store, 1)).toBe(true);

    expect(store.redo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('AZ');
    expect(notePresent(store, 1)).toBe(false);

    expect(store.undo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(notePresent(store, 1)).toBe(true);
  });

  test('mixed text edit + note delete inside one composition is one undo unit', () => {
    const store = openStore(build({ body: citationBody, footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());

    store.beginComposition({ kind: 'body' });
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'EDIT-' });
      }).ok
    ).toBe(true);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-A\uFFFCZ');
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        // "EDIT-A" is 6 chars; delete the footnote atom at offset 6.
        ctx.apply({ op: 'deleteText', paragraphId, start: 6, end: 7 });
      }).ok
    ).toBe(true);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-AZ');
    expect(notePresent(store, 1)).toBe(false);
    store.endComposition();

    expect(store.canUndo).toBe(true);
    expect(store.undo()).not.toBeNull();
    // One step back to the pre-composition baseline — not the post-insert intermediate.
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(notePresent(store, 1)).toBe(true);
    expect(store.canUndo).toBe(false);

    expect(store.redo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-AZ');
    expect(notePresent(store, 1)).toBe(false);
  });

  test('failed cascade under composition rolls back and leaves history coherent', () => {
    const store = openStore(build({ body: citationBody, footnotes: seededNotes }), {
      cascadeDeletedNoteReferences: () => null,
    });
    const paragraphId = firstParagraphId(store.currentPackage());

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' });
      }).ok
    ).toBe(true);
    expect(store.undo()).not.toBeNull();
    expect(store.canRedo).toBe(true);

    const before = {
      packageRevision: store.packageRevision,
      canUndo: store.canUndo,
      canRedo: store.canRedo,
      bodyRevision: store.bodyStore().revision,
      historyDepth: store.bodyStore().historyDepth,
      text: paragraphTextOf(store.bodyStore().part, paragraphId),
    };

    expect(store.beginComposition({ kind: 'body' })).toBe(true);
    const failed = store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 1, end: 2 });
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('expected cascade failure');
    expect(failed.detail).toBe('note-cascade-failed');
    expect(store.bodyStore().compositionActive).toBe(true);
    expect(notePresent(store, 1)).toBe(true);

    store.endComposition();
    expect(store.packageRevision).toBe(before.packageRevision);
    expect(store.canUndo).toBe(before.canUndo);
    expect(store.canRedo).toBe(before.canRedo);
    expect(store.bodyStore().revision).toBe(before.bodyRevision);
    expect(store.bodyStore().historyDepth).toBe(before.historyDepth);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe(before.text);
    expect(store.bodyStore().compositionActive).toBe(false);

    expect(store.redo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('XA\uFFFCZ');
  });

  test('cancelComposition after package cascade restores note body', () => {
    const store = openStore(build({ body: citationBody, footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());

    store.beginComposition({ kind: 'body' });
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'EDIT-' });
      }).ok
    ).toBe(true);
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteText', paragraphId, start: 6, end: 7 });
      }).ok
    ).toBe(true);
    expect(notePresent(store, 1)).toBe(false);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-AZ');

    store.cancelComposition();
    expect(store.bodyStore().compositionActive).toBe(false);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(notePresent(store, 1)).toBe(true);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });

  test('ordinary composition without cascade still records one story pointer', () => {
    const store = openStore(build({ body: citationBody, footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());
    const depthBefore = store.bodyStore().historyDepth;

    store.beginComposition({ kind: 'body' });
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'Hi' });
      }).ok
    ).toBe(true);
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 2, text: '!' });
      }).ok
    ).toBe(true);
    expect(notePresent(store, 1)).toBe(true);
    store.endComposition();

    expect(store.bodyStore().historyDepth).toBe(depthBefore + 1);
    expect(store.canUndo).toBe(true);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('Hi!A\uFFFCZ');

    store.undo();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(notePresent(store, 1)).toBe(true);
  });
});
