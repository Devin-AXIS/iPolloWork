// Remote canonical package publication (full-document-yjs-collaboration task 4.11).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  observeCanonicalPrimitiveJournal,
  flushPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import { withPart, readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const REMOTE = {
  origin: ORIGIN_IDS.mutationRemote,
  actorId: 'bob',
  operationId: 'bob-remote-1',
};

function documentBytes(body = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function headerBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>SHARED</w:t></w:r></w:p></w:hdr>`
    ),
  });
}

/** A package with a numbering part, the shell resource the local install path merges. */
function numberingBytes(lvlText: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId5" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
        '<w:r><w:t>item</w:t></w:r></w:p><w:sectPr/>' +
        '</w:body></w:document>'
    ),
    'word/numbering.xml': strToU8(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">' +
        `<w:numFmt w:val="decimal"/><w:lvlText w:val="${lvlText}"/>` +
        '</w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
        '</w:numbering>'
    ),
  });
}

function levelTextOf(part: OoxmlPart | undefined): string | null {
  if (!part) return null;
  const visit = (node: OoxmlNode): string | null => {
    if (node.kind === 'textValue') return null;
    if (node.namespaceUri === W && node.localName === 'lvlText') {
      return node.attributes.find((attribute) => attribute.localName === 'val')?.value ?? null;
    }
    for (const child of node.children) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(part.root);
}

function loadPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openStore(bytes: Uint8Array = documentBytes()): TreePackageStore {
  const pkg = loadPackage(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}

function firstParagraphId(part: OoxmlPart): string {
  const visit = (node: OoxmlNode): string | null => {
    if (node.kind === 'paragraph') return node.id;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const id = visit(part.root);
  if (!id) throw new Error('no paragraph');
  return id;
}

function insertAtStart(store: TreePackageStore, text: string): void {
  const id = firstParagraphId(store.bodyStore().part);
  const result = store.transact({ kind: 'body' }, (context) => {
    context.apply({ op: 'insertText', paragraphId: id, offset: 0, text });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
}

function editedPackage(bytes: Uint8Array, text: string): OoxmlPackage {
  const store = openStore(bytes);
  insertAtStart(store, text);
  return store.currentPackage();
}

function withDuplicateRootChild(pkg: OoxmlPackage): OoxmlPackage {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main || main.root.kind === 'textValue') throw new Error('no main');
  const child = main.root.children[0];
  if (!child) throw new Error('no child');
  return withPart(pkg, {
    ...main,
    root: { ...main.root, children: [...main.root.children, child] },
  });
}

function withDanglingRelationship(pkg: OoxmlPackage): OoxmlPackage {
  const owner = pkg.mainDocumentPart;
  const existing = pkg.relationships.get(owner) ?? [];
  const relationships = new Map(pkg.relationships);
  relationships.set(owner, [
    ...existing,
    {
      ownerPart: owner,
      id: 'rId99',
      type: `${R}/comments`,
      rawTarget: 'comments.xml',
      targetMode: 'Internal',
      order: existing.length,
    },
  ]);
  return Object.freeze({ ...pkg, relationships });
}

describe('remote canonical package publication', () => {
  test('a valid remote package publishes exactly one change and bumps revision by one', () => {
    const store = openStore();
    const before = store.packageRevision;
    const current = store.currentPackage();
    const publications: string[] = [];
    store.subscribe((change) => publications.push(change.origin));
    const remote = editedPackage(documentBytes(), 'X');
    const result = store.publishRemotePackage(remote, REMOTE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.change).not.toBeNull();
    expect(result.change?.origin).toBe(ORIGIN_IDS.mutationRemote);
    expect(store.packageRevision).toBe(before + 1);
    expect(publications).toEqual([ORIGIN_IDS.mutationRemote]);
    expect(store.currentPackage()).not.toBe(current);
    expect(paragraphTextOf(store.bodyStore().part, firstParagraphId(store.bodyStore().part))).toBe(
      'XHello'
    );
  });

  test('an invalid remote package with a malformed modeled part is refused unchanged', () => {
    const store = openStore();
    const beforePkg = store.currentPackage();
    const beforeRev = store.packageRevision;
    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    const result = store.publishRemotePackage(withDuplicateRootChild(beforePkg), REMOTE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('package-invariant');
    expect(result.detail?.startsWith('invalid-part:')).toBe(true);
    expect(store.packageRevision).toBe(beforeRev);
    expect(store.currentPackage()).toBe(beforePkg);
    expect(publications).toBe(0);
  });

  test('an invalid remote package with a broken package invariant is refused unchanged', () => {
    const store = openStore();
    const beforePkg = store.currentPackage();
    const beforeRev = store.packageRevision;
    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    const result = store.publishRemotePackage(withDanglingRelationship(beforePkg), REMOTE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('package-invariant');
    expect(result.detail).toBe('dangling-relationship');
    expect(store.packageRevision).toBe(beforeRev);
    expect(store.currentPackage()).toBe(beforePkg);
    expect(publications).toBe(0);
  });

  test('duplicate remote publication of the same content is a no-op', () => {
    const store = openStore();
    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    const remote = editedPackage(documentBytes(), 'X');
    const first = store.publishRemotePackage(remote, REMOTE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.change).not.toBeNull();
    expect(store.publishRemotePackage(remote, REMOTE)).toEqual({ ok: true, change: null });
    const revision = store.packageRevision;
    const current = store.currentPackage();
    expect(store.publishRemotePackage(current, REMOTE)).toEqual({ ok: true, change: null });
    const twin = loadPackage(documentBytes());
    const twinStore = new TreePackageStore(twin, twin.parts.get(twin.mainDocumentPart)!);
    insertAtStart(twinStore, 'X');
    expect(store.publishRemotePackage(twinStore.currentPackage(), REMOTE)).toEqual({
      ok: true,
      change: null,
    });
    expect(store.packageRevision).toBe(revision);
    expect(store.currentPackage()).toBe(current);
    expect(publications).toBe(1);
  });

  test('publishing a remote package does not append to undo history', () => {
    const store = openStore();
    expect(store.canUndo).toBe(false);
    expect(store.publishRemotePackage(editedPackage(documentBytes(), 'X'), REMOTE).ok).toBe(true);
    expect(store.canUndo).toBe(false);
    expect(store.undo()).toBeNull();
    expect(paragraphTextOf(store.bodyStore().part, firstParagraphId(store.bodyStore().part))).toBe(
      'XHello'
    );
  });

  test('publishing a remote package emits no primitive journal', () => {
    const store = openStore();
    const journals: unknown[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    expect(store.publishRemotePackage(editedPackage(documentBytes(), 'X'), REMOTE).ok).toBe(true);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(0);
    insertAtStart(store, 'Y');
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
  });

  test('a remote numbering part replaces the local copy instead of being merged away', () => {
    // The local install path merges this replica's numbering over an incoming snapshot,
    // because a LOCAL history snapshot can predate a numbering write. A remote package is
    // already agreed, so the same merge would revert a remote list change here forever.
    const store = openStore(numberingBytes('%1.'));
    expect(levelTextOf(store.currentPackage().parts.get('/word/numbering.xml'))).toBe('%1.');
    const remote = loadPackage(numberingBytes('%1)'));
    const result = store.publishRemotePackage(remote, REMOTE);
    expect(result.ok).toBe(true);
    expect(levelTextOf(store.currentPackage().parts.get('/word/numbering.xml'))).toBe('%1)');
  });

  test('unchanged parts keep reference identity after a remote publish', () => {
    const bytes = headerBytes();
    const store = openStore(bytes);
    const header = store.partFor({ kind: 'headerFooter', rId: 'rId7' });
    expect(header).not.toBeNull();
    const headerBefore = store.currentPackage().parts.get('/word/header1.xml');
    expect(headerBefore).toBe(header);
    const remoteBody = editedPackage(bytes, 'Z').parts.get(store.currentPackage().mainDocumentPart);
    if (!remoteBody) throw new Error('no remote body');
    const remote = withPart(store.currentPackage(), remoteBody);
    expect(store.publishRemotePackage(remote, REMOTE).ok).toBe(true);
    expect(store.currentPackage().parts.get('/word/header1.xml')).toBe(headerBefore);
    expect(paragraphTextOf(store.bodyStore().part, firstParagraphId(store.bodyStore().part))).toBe(
      'Zbody'
    );
  });
});
