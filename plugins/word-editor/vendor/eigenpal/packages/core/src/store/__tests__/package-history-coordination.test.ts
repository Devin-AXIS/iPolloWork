// Package-history coordination: cascaded deleteText / deleteBlock as one undo unit,
// failed-cascade rollback of story history, and identity no-ops for empty convertAllNotes.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  findNoteById,
  readOoxmlPackage,
  resolveNotesPart,
  type OoxmlPackage,
} from '../package/index.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import type { TreeModelChange } from '../store/tree-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly footnotes?: string;
  readonly endnotes?: string;
}): Uint8Array {
  const hasFn = options.footnotes !== undefined;
  const hasEn = options.endnotes !== undefined;
  const rels = [
    hasFn ? `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` : '',
    hasEn ? `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` : '',
  ].join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (hasFn
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        (hasEn
          ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        (options.body ?? '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>') +
        (options.body?.includes('sectPr') ? '' : '<w:sectPr/>') +
        '</w:body></w:document>'
    ),
  };
  if (rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    );
  }
  if (hasFn) {
    entries['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">${options.footnotes}</w:footnotes>`
    );
  }
  if (hasEn) {
    entries['word/endnotes.xml'] = strToU8(
      `<w:endnotes xmlns:w="${W}">${options.endnotes}</w:endnotes>`
    );
  }
  return zipSync(entries);
}

function load(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openStore(bytes: Uint8Array): TreePackageStore {
  const pkg = load(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}

function firstParagraphId(pkg: OoxmlPackage): string {
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const body = main.root.children.find((child) => child.kind === 'body')!;
  const p = body.children.find((child) => child.kind === 'paragraph')!;
  return p.id;
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
  const id = walk(part.root);
  if (!id) throw new Error(`no ${kind}`);
  return id;
}

const seededNotes =
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="3"><w:p><w:r><w:t>three</w:t></w:r></w:p></w:footnote>`;

const cellWithNote = `<w:tc><w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p></w:tc>`;
const plainCell = (text: string): string => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const tableWithNote =
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid>` +
  `<w:tr>${cellWithNote}${plainCell('x')}</w:tr>` +
  `<w:tr>${plainCell('y')}${plainCell('z')}</w:tr></w:tbl>`;
const nestedTableWithNote =
  `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="200"/></w:tblGrid>` +
  `<w:tr><w:tc><w:p><w:r><w:t>outer</w:t></w:r></w:p>${tableWithNote}<w:p><w:r><w:t/></w:r></w:p></w:tc></w:tr></w:tbl>`;

describe('cascaded deleteText package history unit', () => {
  test('edit → cascade delete → undo → undo restores prior edit; redo is symmetric', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'EDIT-' });
      }).ok
    ).toBe(true);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-A\uFFFCZ');
    const depthAfterEdit = store.bodyStore().historyDepth;
    const revAfterEdit = store.packageRevision;

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteText', paragraphId, start: 6, end: 7 });
      }).ok
    ).toBe(true);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeUndefined();
    // Cascade owns the package pointer — no orphan local story undo entry.
    expect(store.bodyStore().historyDepth).toBe(depthAfterEdit);
    expect(store.packageRevision).toBe(revAfterEdit + 1);

    expect(store.undo()).not.toBeNull();
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-A\uFFFCZ');

    expect(store.undo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('A\uFFFCZ');
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    expect(store.redo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('EDIT-A\uFFFCZ');
    expect(store.redo()).not.toBeNull();
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeUndefined();
  });

  test('failed cascade after prior undo preserves redo and history exactly', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const pkg = load(build({ body, footnotes: seededNotes }));
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const store = new TreePackageStore(pkg, main, {
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
      note: findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1),
    };

    const failed = store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId, start: 1, end: 2 });
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('expected cascade failure');
    expect(failed.detail).toBe('note-cascade-failed');

    expect(store.packageRevision).toBe(before.packageRevision);
    expect(store.canUndo).toBe(before.canUndo);
    expect(store.canRedo).toBe(before.canRedo);
    expect(store.bodyStore().revision).toBe(before.bodyRevision);
    expect(store.bodyStore().historyDepth).toBe(before.historyDepth);
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe(before.text);
    expect(findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)).toBe(
      before.note
    );

    expect(store.redo()).not.toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, paragraphId)).toBe('XA\uFFFCZ');
  });
});

describe('cascaded deleteBlock package history unit', () => {
  test('deleteBlock of table with noteReference cascades body in one undo', () => {
    const body = `<w:p><w:r><w:t>before</w:t></w:r></w:p>${tableWithNote}<w:p><w:r><w:t>after</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const tableId = firstOfKind(store.bodyStore().part, 'table');
    const depthBefore = store.bodyStore().historyDepth;
    const revBefore = store.packageRevision;

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteBlock', blockId: tableId });
      }).ok
    ).toBe(true);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeUndefined();
    expect(store.bodyStore().historyDepth).toBe(depthBefore);
    expect(store.packageRevision).toBe(revBefore + 1);

    expect(store.undo()).not.toBeNull();
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
    expect(firstOfKind(store.bodyStore().part, 'table')).toBe(tableId);
  });

  test('deleteBlock of outer table cascades noteReference in nested table', () => {
    const body =
      `<w:p><w:r><w:t>before</w:t></w:r></w:p>${nestedTableWithNote}` +
      `<w:p><w:r><w:t>after</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const outerTableId = firstOfKind(store.bodyStore().part, 'table');

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteBlock', blockId: outerTableId });
      }).ok
    ).toBe(true);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeUndefined();
    expect(store.undo()).not.toBeNull();
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
  });

  test('failed cascade after deleteBlock rolls back table and note body', () => {
    const body = `<w:p><w:r><w:t>before</w:t></w:r></w:p>${tableWithNote}<w:p><w:r><w:t>after</w:t></w:r></w:p>`;
    const pkg = load(build({ body, footnotes: seededNotes }));
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const store = new TreePackageStore(pkg, main, {
      cascadeDeletedNoteReferences: () => null,
    });
    const tableId = firstOfKind(store.bodyStore().part, 'table');
    const before = {
      packageRevision: store.packageRevision,
      canUndo: store.canUndo,
      historyDepth: store.bodyStore().historyDepth,
      note: findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1),
      tables: store
        .bodyStore()
        .part.root.children.find((child) => child.kind === 'body')!
        .children.filter((child) => child.kind === 'table').length,
    };

    const failed = store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'deleteBlock', blockId: tableId });
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('expected cascade failure');
    expect(failed.detail).toBe('note-cascade-failed');
    expect(store.packageRevision).toBe(before.packageRevision);
    expect(store.canUndo).toBe(before.canUndo);
    expect(store.bodyStore().historyDepth).toBe(before.historyDepth);
    expect(findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)).toBe(
      before.note
    );
    expect(
      store
        .bodyStore()
        .part.root.children.find((child) => child.kind === 'body')!
        .children.filter((child) => child.kind === 'table').length
    ).toBe(before.tables);
  });

  test('ordinary deleteBlock without note refs does not cascade', () => {
    let cascadeCalls = 0;
    const body =
      `<w:p><w:r><w:t>before</w:t></w:r></w:p>` +
      `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>` +
      `<w:tr>${plainCell('a')}</w:tr></w:tbl>` +
      `<w:p><w:r><w:t>after</w:t></w:r></w:p>`;
    const pkg = load(build({ body, footnotes: seededNotes }));
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const store = new TreePackageStore(pkg, main, {
      cascadeDeletedNoteReferences: (_before, after) => {
        cascadeCalls += 1;
        return after;
      },
    });
    const tableId = firstOfKind(store.bodyStore().part, 'table');

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'deleteBlock', blockId: tableId });
      }).ok
    ).toBe(true);
    expect(cascadeCalls).toBe(0);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
  });
});

describe('convertAllNotes identity no-ops', () => {
  test('empty source convertAllNotes is identity: no revision, history, or event', () => {
    const store = openStore(build({}));
    const changes: TreeModelChange[] = [];
    store.subscribe((change) => changes.push(change));
    const beforeRev = store.packageRevision;
    const beforeFp = canonicalOoxmlFingerprint(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );

    const result = store.applyLifecycleOp({ op: 'convertAllNotes', fromKind: 'footnote' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.change).toBeNull();
    expect(store.packageRevision).toBe(beforeRev);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(changes).toHaveLength(0);
    expect(
      canonicalOoxmlFingerprint(
        store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
      )
    ).toBe(beforeFp);
  });

  test('all-already-destination convertAllNotes is identity: no revision, history, or event', () => {
    const body = `<w:p><w:r><w:endnoteReference w:id="1"/></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        endnotes:
          `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>` +
          `<w:endnote w:id="1"><w:p><w:r><w:t>only-end</w:t></w:r></w:p></w:endnote>`,
        footnotes:
          `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>`,
      })
    );
    const changes: TreeModelChange[] = [];
    store.subscribe((change) => changes.push(change));
    const beforeRev = store.packageRevision;
    const beforeFp = canonicalOoxmlFingerprint(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );

    const result = store.applyLifecycleOp({ op: 'convertAllNotes', fromKind: 'footnote' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.change).toBeNull();
    expect(store.packageRevision).toBe(beforeRev);
    expect(store.canUndo).toBe(false);
    expect(changes).toHaveLength(0);
    expect(
      canonicalOoxmlFingerprint(
        store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
      )
    ).toBe(beforeFp);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'endnote')!.root, 1)
    ).toBeDefined();
  });
});
