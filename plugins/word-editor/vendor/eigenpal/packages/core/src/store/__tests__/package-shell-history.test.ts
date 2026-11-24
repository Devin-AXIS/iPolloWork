// Package shell persistence: numbering / hyperlink resources minted outside tree history
// must survive lifecycle package undo/redo so story redo cannot leave dead numId / rId.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { ensureListDefinition } from '../package/numbering-part.ts';
import { ensureHyperlinkRelationship, relationshipTargetIn } from '../package/hyperlink-part.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from '../package/hyperlink.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const NUMBERING_PART = '/word/numbering.xml';
const HEADER_REL_TYPE = `${R}/header`;

function blankDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr/>' +
        '</w:body></w:document>'
    ),
  });
}

function openStore(options?: ConstructorParameters<typeof TreePackageStore>[2]): TreePackageStore {
  const result = readOoxmlPackage(blankDoc());
  if (!result.ok) throw new Error(result.reason);
  const main = result.package.parts.get(result.package.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(result.package, main, options);
}

function firstParagraphId(store: TreePackageStore): string {
  const ids: string[] = [];
  const walk = (node: { kind?: string; id?: string; children?: readonly unknown[] }): void => {
    if (!node || node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && node.id) ids.push(node.id);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(store.bodyStore().part.root);
  const id = ids[0];
  if (!id) throw new Error('no paragraph');
  return id;
}

function paragraphIdsIn(part: {
  root: { kind?: string; id?: string; children?: readonly unknown[] };
}): string[] {
  const ids: string[] = [];
  const walk = (node: { kind?: string; id?: string; children?: readonly unknown[] }): void => {
    if (!node || node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && node.id) ids.push(node.id);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(part.root);
  return ids;
}

function numberingNumIds(store: TreePackageStore): string[] {
  const part = store.currentPackage().parts.get(NUMBERING_PART);
  if (!part) return [];
  return [...serializeOoxmlPart(part).matchAll(/<w:num w:numId="([^"]+)"/g)].map((m) => m[1]!);
}

function documentNumIds(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return [];
  return [...serializeOoxmlPart(main).matchAll(/<w:numId w:val="([^"]+)"/g)].map((m) => m[1]!);
}

function hyperlinkExternalIds(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  return pkg.externalTargets
    .filter(
      (entry) =>
        entry.ownerPart === pkg.mainDocumentPart && entry.type === HYPERLINK_RELATIONSHIP_TYPE
    )
    .map((entry) => entry.id);
}

function documentHyperlinkIds(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return [];
  return [...serializeOoxmlPart(main).matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"/g)].map(
    (m) => m[1]!
  );
}

function hasHeaderPart(store: TreePackageStore): boolean {
  // Parked scoped `.rels` keep `/word/_rels/headerN.xml.rels` while the owner is absent —
  // only the furniture part itself counts as rendered furniture.
  return [...store.currentPackage().parts.keys()].some((name) =>
    /\/header\d*\.xml$/.test(String(name))
  );
}

function headerRelationshipId(store: TreePackageStore): string {
  const pkg = store.currentPackage();
  const record = (pkg.relationships.get(pkg.mainDocumentPart) ?? []).find(
    (entry) => entry.type === HEADER_REL_TYPE
  );
  if (!record) throw new Error('no header relationship');
  return record.id;
}

function scopedHyperlinkOwners(store: TreePackageStore, ownerPart: string, url: string) {
  return store
    .currentPackage()
    .externalTargets.filter(
      (entry) =>
        entry.ownerPart === ownerPart &&
        entry.type === HYPERLINK_RELATIONSHIP_TYPE &&
        entry.rawTarget === url
    );
}

describe('package shell persistence across lifecycle undo/redo', () => {
  test('HF lifecycle then numbering: undo×2 redo×2 keeps numId resolvable', () => {
    const store = openStore();
    const paragraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    expect(hasHeaderPart(store)).toBe(true);

    const ensured = ensureListDefinition(store.currentPackage(), 'bullet');
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({
          op: 'setListNumbering',
          paragraphId,
          numId: ensured!.numId,
        });
      }).ok
    ).toBe(true);

    expect(numberingNumIds(store)).toContain(ensured!.numId);
    expect(documentNumIds(store)).toContain(ensured!.numId);

    expect(store.undo()).not.toBeNull(); // story numPr
    expect(store.undo()).not.toBeNull(); // package header create
    expect(hasHeaderPart(store)).toBe(false);
    // Shell persists across package snapshot install.
    expect(numberingNumIds(store)).toContain(ensured!.numId);

    expect(store.redo()).not.toBeNull(); // header
    expect(hasHeaderPart(store)).toBe(true);
    expect(numberingNumIds(store)).toContain(ensured!.numId);

    expect(store.redo()).not.toBeNull(); // story numPr
    expect(documentNumIds(store)).toContain(ensured!.numId);
    expect(numberingNumIds(store)).toContain(ensured!.numId);
  });

  test('note lifecycle then hyperlink: undo×2 redo×2 keeps rId resolvable', () => {
    const store = openStore();
    const paragraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'insertNote',
        noteKind: 'footnote',
        paragraphId,
        offset: 4,
      }).ok
    ).toBe(true);
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();

    const ensured = ensureHyperlinkRelationship(store.currentPackage(), 'https://example.com');
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);
    const rId = ensured!.relationshipId;

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({
          op: 'insertHyperlink',
          paragraphId,
          start: 0,
          end: 4,
          relationshipId: rId,
        });
      }).ok
    ).toBe(true);

    expect(hyperlinkExternalIds(store)).toContain(rId);
    expect(documentHyperlinkIds(store)).toContain(rId);

    expect(store.undo()).not.toBeNull(); // story hyperlink
    expect(store.undo()).not.toBeNull(); // package note insert
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).toBeNull();
    expect(hyperlinkExternalIds(store)).toContain(rId);

    expect(store.redo()).not.toBeNull(); // note
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();
    expect(hyperlinkExternalIds(store)).toContain(rId);

    expect(store.redo()).not.toBeNull(); // story hyperlink
    expect(documentHyperlinkIds(store)).toContain(rId);
    expect(hyperlinkExternalIds(store)).toContain(rId);
  });

  test('undo of HF create still removes furniture while keeping later numbering', () => {
    const store = openStore();
    const paragraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);

    const ensured = ensureListDefinition(store.currentPackage(), 'ordered');
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'setListNumbering', paragraphId, numId: ensured!.numId });
    });

    store.undo(); // numPr
    store.undo(); // header

    expect(hasHeaderPart(store)).toBe(false);
    expect(
      store.currentPackage().contentTypes.overrides.has('/word/header1.xml') ||
        [...store.currentPackage().contentTypes.overrides.keys()].some((k) => k.includes('header'))
    ).toBe(false);
    expect(numberingNumIds(store)).toContain(ensured!.numId);
  });

  test('HF lifecycle then scoped hyperlink: undo×2 redo×2 keeps rId resolvable', () => {
    const store = openStore();
    const url = 'https://example.com/hf-scoped';

    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    const headerScope = { kind: 'headerFooter' as const, rId: headerRelationshipId(store) };
    const headerPart = store.partFor(headerScope)!;
    const headerName = headerPart.name;
    const paragraphId = paragraphIdsIn(headerPart)[0]!;

    const ensured = ensureHyperlinkRelationship(store.currentPackage(), url, headerName);
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);
    const rId = ensured!.relationshipId;

    expect(
      store.transact(headerScope, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'HEADER' });
        ctx.apply({
          op: 'insertHyperlink',
          paragraphId,
          start: 0,
          end: 6,
          relationshipId: rId,
        });
      }).ok
    ).toBe(true);

    expect(scopedHyperlinkOwners(store, headerName, url)).toHaveLength(1);
    expect(relationshipTargetIn(store.currentPackage(), headerName, rId)?.target).toBe(url);
    expect(
      store
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === store.currentPackage().mainDocumentPart && entry.rawTarget === url
        )
    ).toBe(false);

    expect(store.undo()).not.toBeNull(); // story
    expect(relationshipTargetIn(store.currentPackage(), headerName, rId)?.target).toBe(url);
    expect(store.undo()).not.toBeNull(); // lifecycle create
    expect(hasHeaderPart(store)).toBe(false);
    // Parked shell survives owner absence.
    expect(scopedHyperlinkOwners(store, headerName, url)).toHaveLength(1);
    expect(
      store
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === store.currentPackage().mainDocumentPart && entry.rawTarget === url
        )
    ).toBe(false);

    expect(store.redo()).not.toBeNull(); // header
    expect(hasHeaderPart(store)).toBe(true);
    expect(relationshipTargetIn(store.currentPackage(), headerName, rId)?.target).toBe(url);

    expect(store.redo()).not.toBeNull(); // story
    expect(JSON.stringify(store.partFor(headerScope)!.root)).toContain('"kind":"hyperlink"');
    expect(relationshipTargetIn(store.currentPackage(), headerName, rId)?.target).toBe(url);

    const reopened = readOoxmlPackage(writeOoxmlPackage(store.currentPackage()));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(relationshipTargetIn(reopened.package, headerName, rId)?.target).toBe(url);
    expect(
      reopened.package.externalTargets.some(
        (entry) => entry.ownerPart === reopened.package.mainDocumentPart && entry.rawTarget === url
      )
    ).toBe(false);
  });

  test('note lifecycle then scoped hyperlink: undo×2 redo×2 keeps rId resolvable', () => {
    const store = openStore();
    const bodyParagraphId = firstParagraphId(store);
    const url = 'https://example.com/note-scoped';

    expect(
      store.applyLifecycleOp({
        op: 'insertNote',
        noteKind: 'footnote',
        paragraphId: bodyParagraphId,
        offset: 4,
      }).ok
    ).toBe(true);
    const notesScope = { kind: 'notesPart' as const, noteKind: 'footnote' as const };
    const notesPart = store.partFor(notesScope)!;
    const notesName = notesPart.name;
    // Skip separator/continuation notes; the inserted body is the last note paragraph.
    const paragraphId = paragraphIdsIn(notesPart).at(-1)!;

    const ensured = ensureHyperlinkRelationship(store.currentPackage(), url, notesName);
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);
    const rId = ensured!.relationshipId;

    expect(
      store.transact(notesScope, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'NOTE' });
        ctx.apply({
          op: 'insertHyperlink',
          paragraphId,
          start: 0,
          end: 4,
          relationshipId: rId,
        });
      }).ok
    ).toBe(true);

    expect(scopedHyperlinkOwners(store, notesName, url)).toHaveLength(1);
    expect(relationshipTargetIn(store.currentPackage(), notesName, rId)?.target).toBe(url);
    expect(
      store
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === store.currentPackage().mainDocumentPart && entry.rawTarget === url
        )
    ).toBe(false);

    expect(store.undo()).not.toBeNull(); // story
    expect(store.undo()).not.toBeNull(); // note lifecycle
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).toBeNull();
    expect(scopedHyperlinkOwners(store, notesName, url)).toHaveLength(1);
    expect(
      store
        .currentPackage()
        .externalTargets.some(
          (entry) =>
            entry.ownerPart === store.currentPackage().mainDocumentPart && entry.rawTarget === url
        )
    ).toBe(false);

    expect(store.redo()).not.toBeNull(); // notes part
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();
    expect(relationshipTargetIn(store.currentPackage(), notesName, rId)?.target).toBe(url);

    expect(store.redo()).not.toBeNull(); // story
    expect(JSON.stringify(store.partFor(notesScope)!.root)).toContain('"kind":"hyperlink"');
    expect(relationshipTargetIn(store.currentPackage(), notesName, rId)?.target).toBe(url);

    const reopened = readOoxmlPackage(writeOoxmlPackage(store.currentPackage()));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(relationshipTargetIn(reopened.package, notesName, rId)?.target).toBe(url);
    expect(
      reopened.package.externalTargets.some(
        (entry) => entry.ownerPart === reopened.package.mainDocumentPart && entry.rawTarget === url
      )
    ).toBe(false);
  });

  test('scoped hyperlink shell evicts when history can no longer restore the owner', () => {
    const store = openStore({ historyLimit: 2 });
    const url = 'https://example.com/hf-evict';
    const bodyParagraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    const headerScope = { kind: 'headerFooter' as const, rId: headerRelationshipId(store) };
    const headerName = store.partFor(headerScope)!.name;
    const paragraphId = paragraphIdsIn(store.partFor(headerScope)!)[0]!;

    const ensured = ensureHyperlinkRelationship(store.currentPackage(), url, headerName)!;
    store.replacePackageShell(ensured.pkg);
    expect(
      store.transact(headerScope, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'HDR' });
        ctx.apply({
          op: 'insertHyperlink',
          paragraphId,
          start: 0,
          end: 3,
          relationshipId: ensured.relationshipId,
        });
      }).ok
    ).toBe(true);

    expect(store.undo()).not.toBeNull();
    expect(store.undo()).not.toBeNull();
    expect(hasHeaderPart(store)).toBe(false);
    expect(scopedHyperlinkOwners(store, headerName, url)).toHaveLength(1);

    // New body edits clear redo and eventually drop the create pointer from undo —
    // the parked header owner becomes unreachable and its shell must go with it.
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: bodyParagraphId, offset: 0, text: '1' });
      }).ok
    ).toBe(true);
    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: bodyParagraphId, offset: 0, text: '2' });
      }).ok
    ).toBe(true);

    expect(hasHeaderPart(store)).toBe(false);
    expect(scopedHyperlinkOwners(store, headerName, url)).toHaveLength(0);
    expect(
      store.currentPackage().parts.has(`/word/_rels/${headerName.slice('/word/'.length)}.rels`)
    ).toBe(false);
  });

  test('reachability boundary: shell-minted parks; lifecycle-cloned owned rels GC', () => {
    // Two hyperlink lanes must not be conflated:
    // 1) replacePackageShell-minted scoped links park while history can restore the owner.
    // 2) unlink-cloned owned .rels travel inside package snapshots and must GC with the orphan.
    const HYPERLINK = `${R}/hyperlink`;
    const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const inherited = (() => {
      const result = readOoxmlPackage(
        zipSync({
          '[Content_Types].xml': strToU8(
            `<Types xmlns="${CT}">` +
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
              '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
              '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
              '</Types>'
          ),
          '_rels/.rels': strToU8(
            `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
          ),
          'word/document.xml': strToU8(
            `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
              '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:pPr>' +
              '<w:r><w:t>one</w:t></w:r></w:p>' +
              '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
              '<w:sectPr/>' +
              '</w:body></w:document>'
          ),
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL_NS}">` +
              `<Relationship Id="rId7" Type="${HEADER_REL_TYPE}" Target="header1.xml"/>` +
              '</Relationships>'
          ),
          'word/header1.xml': strToU8(
            `<w:hdr xmlns:w="${W}" xmlns:r="${R}">` +
              '<w:p><w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>' +
              '</w:hdr>'
          ),
          'word/_rels/header1.xml.rels': strToU8(
            `<Relationships xmlns="${REL_NS}">` +
              `<Relationship Id="rId1" Type="${HYPERLINK}" Target="https://example.com/cloned" TargetMode="External"/>` +
              '</Relationships>'
          ),
        })
      );
      if (!result.ok) throw new Error(result.reason);
      const main = result.package.parts.get(result.package.mainDocumentPart);
      if (!main) throw new Error('no main');
      return new TreePackageStore(result.package, main);
    })();

    expect(
      inherited.applyLifecycleOp({
        op: 'unlinkFromPrevious',
        sectionIndex: 1,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    const cloneName = [...inherited.currentPackage().parts.keys()].find(
      (name) => /\/header\d+\.xml$/.test(name) && name !== '/word/header1.xml'
    )!;
    const cloneRels = `/word/_rels/${cloneName.slice('/word/'.length)}.rels`;
    expect(inherited.currentPackage().parts.has(cloneRels)).toBe(true);

    expect(
      inherited.applyLifecycleOp({
        op: 'linkToPrevious',
        sectionIndex: 1,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    // Lane 2: clone owned rels are gone from the live package (history still has them for undo).
    expect(inherited.currentPackage().parts.has(cloneName)).toBe(false);
    expect(inherited.currentPackage().parts.has(cloneRels)).toBe(false);
    expect(
      inherited.currentPackage().externalTargets.some((entry) => entry.ownerPart === cloneName)
    ).toBe(false);

    // Lane 1: shell-minted link on a created header still parks across delete while undoable.
    const shellStore = openStore();
    const shellUrl = 'https://example.com/shell-park';
    expect(
      shellStore.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    const headerName = shellStore.partFor({
      kind: 'headerFooter',
      rId: headerRelationshipId(shellStore),
    })!.name;
    const ensured = ensureHyperlinkRelationship(shellStore.currentPackage(), shellUrl, headerName)!;
    shellStore.replacePackageShell(ensured.pkg);
    expect(
      shellStore.applyLifecycleOp({
        op: 'deleteHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    expect(hasHeaderPart(shellStore)).toBe(false);
    expect(scopedHyperlinkOwners(shellStore, headerName, shellUrl)).toHaveLength(1);
    expect(
      shellStore.currentPackage().parts.has(`/word/_rels/${headerName.slice('/word/'.length)}.rels`)
    ).toBe(true);
  });
});
