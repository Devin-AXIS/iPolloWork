// Presence address resolution must not enumerate paragraphs.
//
// A remote caret resolves two stable ids per selection, per actor, on every caret move and
// after every keystroke. A document walk there is O(document) on a path that runs at typing
// rate, and a memo keyed on `packageRevision` does not save it: typing bumps the revision on
// every keystroke, so the memo misses exactly when it is needed and pays for a rebuild on
// top. The assertions below count enumerations rather than milliseconds, because a timing
// assertion goes flaky on a loaded machine and gets deleted by the next person who sees it.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createCollaborationDocumentPort } from '../document-port.ts';
import { collaborationParagraphScanRecorder } from '../paragraph-addresses.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import type { OoxmlNode } from '../../store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const BODY_PARAGRAPHS = 400;
const HEADER_ID = '0000AAAA';
const CELL_IDS = ['0000BBBB', '0000CCCC'] as const;

function stableId(index: number): string {
  return (index + 1).toString(16).toUpperCase().padStart(8, '0');
}

/** Body prose, a two-cell table, and a header — every shape presence must still name. */
function documentBytes(): Uint8Array {
  const prose = Array.from(
    { length: BODY_PARAGRAPHS },
    (_unused, index) =>
      `<w:p w14:paraId="${stableId(index)}" w14:textId="${stableId(index)}">` +
      `<w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`
  ).join('');
  const cells = CELL_IDS.map(
    (id, index) =>
      `<w:tc><w:tcPr/><w:p w14:paraId="${id}" w14:textId="${id}">` +
      `<w:r><w:t>Cell ${index}</w:t></w:r></w:p></w:tc>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:w14="${W14}"><w:body>${prose}` +
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>' +
        `<w:tr>${cells}</w:tr></w:tbl>` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:w14="${W14}">` +
        `<w:p w14:paraId="${HEADER_ID}" w14:textId="${HEADER_ID}">` +
        '<w:r><w:t>Letterhead</w:t></w:r></w:p></w:hdr>'
    ),
  });
}

function openPort() {
  const loaded = readOoxmlPackage(documentBytes());
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  return { store, port: createCollaborationDocumentPort(store, { documentId: 'presence-walk' }) };
}

function firstParagraphNodeId(store: TreePackageStore): string {
  let found: string | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      found = node.id;
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  if (found === null) throw new Error('no body paragraph');
  return found;
}

const WALK_IS_FORBIDDEN =
  'Presence address resolution enumerated paragraphs. Resolving a stable paraId runs twice ' +
  'per remote selection on every caret move and after every keystroke, so a document walk ' +
  'there costs O(document) at typing rate. Memoizing the walk on packageRevision does not ' +
  'fix it, because typing bumps the revision every keystroke. Resolve through an ' +
  'identity-keyed memo (see paragraph-addresses.ts) instead of rebuilding a paragraph list.';

describe('presence address resolution stays off the document walk', () => {
  test('resolving endpoints after a keystroke enumerates no paragraphs', () => {
    const { store, port } = openPort();
    const recorder = collaborationParagraphScanRecorder();
    const targets = [stableId(0), stableId(BODY_PARAGRAPHS - 1), ...CELL_IDS, HEADER_ID];

    // Cold: the first resolution of an id is allowed to build the part maps. Asserted so
    // this file cannot pass by counting a recorder nothing reports into.
    recorder.reset();
    for (const target of targets) expect(port.paragraphByStableId(target)).not.toBeNull();
    expect(recorder.visits).toBeGreaterThan(BODY_PARAGRAPHS);

    const editTarget = firstParagraphNodeId(store);
    for (let keystroke = 0; keystroke < 8; keystroke += 1) {
      const committed = store.transact({ kind: 'body' }, (context) => {
        context.apply({ op: 'insertText', paragraphId: editTarget, offset: 0, text: 'X' });
      });
      if (!committed.ok) throw new Error(committed.detail ?? committed.reason);
      recorder.reset();
      for (const target of targets) {
        expect(port.paragraphByStableId(target)).not.toBeNull();
      }
      expect(
        `${recorder.enumerations} enumerations / ${recorder.visits} visits: ${WALK_IS_FORBIDDEN}`
      ).toBe(`0 enumerations / 0 visits: ${WALK_IS_FORBIDDEN}`);
    }
  });

  test('an unresolvable endpoint does not re-walk while the document is unchanged', () => {
    const { port } = openPort();
    const recorder = collaborationParagraphScanRecorder();
    expect(port.paragraphByStableId('7EADBEEF')).toBeNull();
    recorder.reset();
    for (let read = 0; read < 16; read += 1) {
      expect(port.paragraphByStableId('7EADBEEF')).toBeNull();
    }
    expect(recorder.enumerations).toBe(0);
  });

  test('resolution still names body, cell, and header paragraphs after edits', () => {
    const { store, port } = openPort();
    const editTarget = firstParagraphNodeId(store);
    const committed = store.transact({ kind: 'body' }, (context) => {
      context.apply({ op: 'insertText', paragraphId: editTarget, offset: 0, text: 'Z' });
    });
    if (!committed.ok) throw new Error(committed.detail ?? committed.reason);
    expect(port.paragraphByStableId(stableId(0))).toMatchObject({
      paragraphId: stableId(0),
      text: 'ZParagraph 0',
    });
    expect(port.paragraphByStableId(CELL_IDS[0])).toMatchObject({
      paragraphId: CELL_IDS[0],
      text: 'Cell 0',
    });
    expect(port.paragraphByStableId(HEADER_ID)).toMatchObject({
      paragraphId: HEADER_ID,
      text: 'Letterhead',
    });
    // Lower case on the wire resolves to the same canonical address.
    expect(port.paragraphByStableId(HEADER_ID.toLowerCase())).toMatchObject({
      paragraphId: HEADER_ID,
    });
  });
});
