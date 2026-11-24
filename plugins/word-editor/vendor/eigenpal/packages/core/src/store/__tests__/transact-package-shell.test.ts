// A `ctx.applyPackage` write beyond the story part survives the transaction (issue #558).
//
// The transact tail syncs the STORY PART back into the package. A relationship, content type,
// or extra part written through `ctx.applyPackage` needs the package-unit promotion the image
// and paste lanes perform. Before the fix, that write reached the primitive journal — every
// collaboration peer replayed it — while `currentPackage()` lost it, so the author saved a
// `w:hyperlink` whose `r:id` resolved to nothing.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  ensureHyperlinkRelationship,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlNode,
  type StoryScope,
  type TreeModelChange,
} from '../index.ts';

const BODY: StoryScope = { kind: 'body' };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>alpha bravo canvas</w:t></w:r></w:p>' +
        '<w:sectPr/></w:body></w:document>'
    ),
  });
}

function storeOf(): TreePackageStore {
  const loaded = readOoxmlPackage(documentBytes());
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  return new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
}

function firstParagraphId(store: TreePackageStore): string {
  const walkFor = (node: OoxmlNode): string | null => {
    if (node.kind === 'paragraph') return node.id;
    if (node.kind === 'textValue') return null;
    for (const child of node.children) {
      const found = walkFor(child);
      if (found) return found;
    }
    return null;
  };
  const id = walkFor(store.bodyStore().part.root);
  if (!id) throw new Error('no paragraph');
  return id;
}

function linkThroughApplyPackage(store: TreePackageStore): string {
  let relationshipId = '';
  const result = store.transact(BODY, (context) => {
    context.applyPackage((pkg) => {
      const ensured = ensureHyperlinkRelationship(pkg, 'https://example.com/doc');
      if (!ensured) throw new Error('hyperlink relationship refused');
      relationshipId = ensured.relationshipId;
      return ensured.pkg;
    });
    context.apply({
      op: 'insertHyperlink',
      paragraphId: firstParagraphId(store),
      start: 0,
      end: 5,
      relationshipId,
    });
  });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  return relationshipId;
}

function relationshipTargets(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  return (pkg.relationships.get(pkg.mainDocumentPart) ?? []).map((record) => record.rawTarget);
}

describe('applyPackage shell writes inside transact', () => {
  test('the relationship survives in currentPackage and in the saved bytes', () => {
    const store = storeOf();
    const relationshipId = linkThroughApplyPackage(store);
    const pkg = store.currentPackage();
    const records = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
    expect(records.some((record) => record.id === relationshipId)).toBe(true);
    const reopened = readOoxmlPackage(writeOoxmlPackage(pkg));
    if (!reopened.ok) throw new Error(reopened.reason);
    const saved = reopened.package.relationships.get(reopened.package.mainDocumentPart) ?? [];
    // Before the fix the author's save held a `w:hyperlink` with a dangling `r:id`.
    expect(saved.some((record) => record.id === relationshipId)).toBe(true);
  });

  test('one undo restores the story edit and the package write together', () => {
    const store = storeOf();
    const before = relationshipTargets(store);
    linkThroughApplyPackage(store);
    expect(relationshipTargets(store)).toContain('https://example.com/doc');
    const undone = store.undo();
    expect(undone).not.toBeNull();
    // A story-only undo pointer would restore the text and leave the relationship: the
    // promotion makes the pair one package unit.
    expect(relationshipTargets(store)).toEqual(before);
  });

  test('the promotion keeps shell state the working package never saw', () => {
    const store = storeOf();
    // A lifecycle op writes /word/footnotes.xml, its relationship, and its content-type
    // override into the COORDINATOR's package; the body store's own working package never
    // sees them. A promotion that installed the stale working package erased all three —
    // the author's save silently dropped every footnote.
    const inserted = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId: firstParagraphId(store),
      offset: 5,
    });
    if (!inserted.ok) throw new Error(inserted.reason);
    expect(store.currentPackage().parts.has('/word/footnotes.xml')).toBe(true);
    linkThroughApplyPackage(store);
    const pkg = store.currentPackage();
    expect(pkg.parts.has('/word/footnotes.xml')).toBe(true);
    expect(pkg.contentTypes.overrides.has('/word/footnotes.xml')).toBe(true);
    const records = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
    expect(records.some((record) => record.rawTarget.includes('footnotes.xml'))).toBe(true);
    expect(records.some((record) => record.rawTarget === 'https://example.com/doc')).toBe(true);
    const reopened = readOoxmlPackage(writeOoxmlPackage(pkg));
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.package.parts.has('/word/footnotes.xml')).toBe(true);
  });

  test('a story-only applyPackage keeps its own change classification', () => {
    const store = storeOf();
    let published: TreeModelChange | null = null;
    const stop = store.subscribe((change) => {
      published = change;
    });
    const result = store.transact(BODY, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: firstParagraphId(store),
        offset: 0,
        text: 'X',
      });
      // Identity edit on the story part alone: no shell promotion, no synthetic global.
      context.applyPackage((pkg) => pkg);
    });
    stop();
    if (!result.ok) throw new Error(result.detail ?? result.reason);
    const change = published as TreeModelChange | null;
    expect(change).not.toBeNull();
    expect(change?.impact).toBe('text-local');
  });
});
