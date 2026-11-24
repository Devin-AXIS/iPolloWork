import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createCollaborationDocumentPort } from '../document-port.ts';
import { normalizeParagraphIdentity, paraIdOf } from '../../store/package/para-id.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { ORIGIN_IDS } from '../../store/registry/frozen-ids.ts';
import type { CollaborationApplyResult } from '../replication.ts';

function bytesWithParagraphIds(ids: readonly (string | null)[]): Uint8Array {
  const paragraphs = ids
    .map(
      (id, index) =>
        `<w:p${id ? ` w14:paraId="${id}" w14:textId="${id}"` : ''}><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`),
  });
}

function open(ids: readonly (string | null)[]) {
  const loaded = readOoxmlPackage(bytesWithParagraphIds(ids));
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  return { store, port: createCollaborationDocumentPort(store, { documentId: 'test-document' }) };
}

describe('canonical collaboration document port', () => {
  test('normalizes missing and duplicate paragraph identities deterministically', () => {
    const first = open([null, '11111111', '11111111']).port.paragraphs();
    const second = open([null, '11111111', '11111111']).port.paragraphs();
    expect(first.map((paragraph) => paragraph.paragraphId)).toEqual(
      second.map((paragraph) => paragraph.paragraphId)
    );
    expect(new Set(first.map((paragraph) => paragraph.paragraphId)).size).toBe(3);
    expect(first.every((paragraph) => /^[0-7][0-9A-F]{7}$/.test(paragraph.paragraphId))).toBe(true);
  });

  test('collaboration-derived canonical commits bypass legacy snapshot history', () => {
    const { store, port } = open(['11111111']);
    expect(store.canUndo).toBe(false);
    expect(
      port.applyParagraphText('11111111', 'Remote text', {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'bob',
        operationId: 'bob-1',
      })
    ).toEqual({ ok: true, changed: true });
    expect(store.canUndo).toBe(false);
    expect(store.undo()).toBeNull();
    expect(port.paragraphs()[0]!.text).toBe('Remote text');
    const paragraph = port.paragraphs()[0]!;
    const local = store.transact({ kind: 'body' }, (context) => {
      context.apply({
        op: 'insertText',
        paragraphId: paragraph.nodeId,
        offset: paragraph.text.length,
        text: ' local',
      });
    });
    expect(local.ok).toBe(true);
    expect(store.canUndo).toBe(true);
    expect(port.paragraphs()[0]!.text).toBe('Remote text local');
    expect(store.undo()).not.toBeNull();
    expect(port.paragraphs()[0]!.text).toBe('Remote text');
  });

  test('publishes multi-paragraph updates atomically and replays acknowledged output as a no-op', () => {
    const { store, port } = open(['11111111', '22222222']);
    let publications = 0;
    store.subscribe(() => {
      publications += 1;
    });
    const mutation = {
      origin: ORIGIN_IDS.mutationRemote,
      actorId: 'bob',
      operationId: 'bob-batch-1',
    };
    const updates = [
      { paragraphId: '11111111', text: 'First remote text' },
      { paragraphId: '22222222', text: 'Second remote text' },
    ];

    expect(port.applyParagraphTexts(updates, mutation)).toEqual({ ok: true, changed: true });
    expect(port.paragraphs().map((paragraph) => paragraph.text)).toEqual([
      'First remote text',
      'Second remote text',
    ]);
    expect(publications).toBe(1);
    const revision = port.revision();

    expect(port.applyParagraphTexts(updates, mutation)).toEqual({ ok: true, changed: false });
    expect(port.revision()).toBe(revision);
    expect(publications).toBe(1);
  });

  test('an invalid paragraphId returns the typed refusal instead of throwing', () => {
    // The port is @public and the update is wire-shaped: a non-string id used to throw a
    // TypeError at `.toUpperCase()` before the id was ever looked up.
    const { port } = open(['11111111']);
    const mutation = {
      origin: ORIGIN_IDS.mutationRemote,
      actorId: 'bob',
      operationId: 'bob-bad-id-1',
    };
    const refused: CollaborationApplyResult = { ok: false, reason: 'unknown-paragraph-id' };

    expect(
      port.applyParagraphTexts(
        [{ paragraphId: 42 as unknown as string, text: 'Remote text' }],
        mutation
      )
    ).toEqual(refused);
    expect(port.applyParagraphTexts([{ paragraphId: '', text: 'Remote text' }], mutation)).toEqual(
      refused
    );
    // Bounded like the file's other limits, so a hostile id cannot drive a long scan.
    expect(
      port.applyParagraphTexts([{ paragraphId: 'A'.repeat(257), text: 'Remote text' }], mutation)
    ).toEqual(refused);
    expect(port.paragraphs()[0]?.text).toBe('Paragraph 0');
  });

  test('applyRemotePackage publishes one revision and emits no primitive journal', () => {
    const source = open(['11111111']);
    expect(
      source.port.applyParagraphText('11111111', 'Remote package text', {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'source',
        operationId: 'source-1',
      })
    ).toEqual({ ok: true, changed: true });
    const { store, port } = open(['11111111']);
    const journals: unknown[] = [];
    port.observePrimitiveJournal((journal) => journals.push(journal));
    let publications = 0;
    port.subscribe(() => {
      publications += 1;
    });
    const mutation = {
      origin: ORIGIN_IDS.mutationRemote,
      actorId: 'bob',
      operationId: 'bob-package-1',
    };
    expect(port.applyRemotePackage(source.store.currentPackage(), mutation)).toEqual({
      ok: true,
      changed: true,
    });
    port.flushPendingJournals();
    expect(port.paragraphs()[0]!.text).toBe('Remote package text');
    expect(publications).toBe(1);
    expect(journals).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    expect(port.applyRemotePackage(source.store.currentPackage(), mutation)).toEqual({
      ok: true,
      changed: false,
    });
    expect(publications).toBe(1);
    expect(
      port.applyParagraphText('11111111', 'Local follow-up', {
        origin: ORIGIN_IDS.mutationRemote,
        actorId: 'bob',
        operationId: 'bob-text-1',
      })
    ).toEqual({ ok: true, changed: true });
    expect(port.paragraphs()[0]!.text).toBe('Local follow-up');
  });

  test('paragraphByStableId finds a header paragraph the body list omits', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0"?><Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="${REL}">` +
          `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="${REL}">` +
          `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:w14="${W14}">` +
          '<w:body><w:p w14:paraId="11111111" w14:textId="11111111"><w:r><w:t>Body</w:t></w:r></w:p>' +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:body></w:document>'
      ),
      'word/header1.xml': strToU8(
        `<?xml version="1.0"?><w:hdr xmlns:w="${W}" xmlns:w14="${W14}">` +
          '<w:p w14:paraId="12345678" w14:textId="12345678"><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
    if (!main) throw new Error('missing main part');
    const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
    const port = createCollaborationDocumentPort(store, { documentId: 'header-port' });
    expect(port.paragraphs().map((paragraph) => paragraph.paragraphId)).toEqual(['11111111']);
    const header = port.paragraphByStableId('12345678');
    expect(header).toMatchObject({ paragraphId: '12345678', text: 'Header' });
    expect(port.paragraphByNodeId(header!.nodeId)).toBeNull();
  });

  test('paragraphByStableId mints a header paraId the package does not store', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0"?><Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="${REL}">` +
          `<Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<?xml version="1.0"?><Relationships xmlns="${REL}">` +
          `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}">` +
          '<w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
          '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr></w:body></w:document>'
      ),
      'word/header1.xml': strToU8(
        `<?xml version="1.0"?><w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>`
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
    if (!main) throw new Error('missing main part');
    const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
    const port = createCollaborationDocumentPort(store, { documentId: 'header-mint' });
    const headerPart = [...store.currentPackage().parts.values()].find(
      (part) => part.root.localName === 'hdr'
    );
    if (!headerPart) throw new Error('missing header part');
    const live = headerPart.root.children.find((node) => node.kind !== 'textValue');
    expect(live && live.kind !== 'textValue' ? paraIdOf(live) : null).toBeNull();
    const identified = normalizeParagraphIdentity(headerPart);
    const paragraph = identified.root.children.find((node) => node.kind !== 'textValue');
    const minted = paragraph && paragraph.kind !== 'textValue' ? paraIdOf(paragraph) : null;
    expect(minted).toMatch(/^[0-9A-Fa-f]{8}$/);
    expect(port.paragraphByStableId(minted!)).toMatchObject({
      paragraphId: minted!.toUpperCase(),
      text: 'Header',
    });
  });
});
