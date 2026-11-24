// Note package lifecycle: insert/delete/convert/properties + package undo + bounds.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import {
  applyNoteLifecycleOp,
  canonicalOoxmlFingerprint,
  collectNoteReferences,
  collectPackageNoteReferences,
  createNoteReferenceScanBudget,
  diagnoseNoteReferences,
  findNoteById,
  isNormalNote,
  MAX_NOTE_REFERENCE_PARTS,
  noteIdOf,
  noteKindOf,
  noteReferenceKindOf,
  readOoxmlPackage,
  readOoxmlPart,
  resolveNotesPart,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlPackage,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/index.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import {
  authoredDocumentFootnoteProperties,
  authoredFootnotePropertiesFromSectPr,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../package/note-properties.ts';
import { collectSectionPropertyNodes } from '../package/hf-references.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly footnotes?: string;
  readonly endnotes?: string;
  readonly settings?: string;
  readonly rels?: string;
  readonly overrides?: string;
}): Uint8Array {
  const hasFn = options.footnotes !== undefined;
  const hasEn = options.endnotes !== undefined;
  const rels =
    options.rels ??
    [
      hasFn ? `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` : '',
      hasEn ? `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` : '',
      options.settings
        ? `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`
        : '',
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
        (options.settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        (options.overrides ?? '') +
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
  if (options.settings) entries['word/settings.xml'] = strToU8(options.settings);
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

function mainPartOf(pkg: OoxmlPackage): OoxmlPart {
  return pkg.parts.get(pkg.mainDocumentPart)!;
}

function firstParagraphId(pkg: OoxmlPackage): string {
  const main = mainPartOf(pkg);
  const body = main.root.children.find((child) => child.kind === 'body')!;
  const p = body.children.find((child) => child.kind === 'paragraph')!;
  return p.id;
}

const seededNotes =
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="3"><w:p><w:r><w:t>three</w:t></w:r></w:p></w:footnote>`;

/** The ancestors of the first footnote citation under `root`, or null when there is none. */
function citationAncestors(root: OoxmlNode): OoxmlNode[] | null {
  const path: OoxmlNode[] = [];
  const visit = (node: OoxmlNode, ancestors: OoxmlNode[]): boolean => {
    if (node.kind === 'textValue') return false;
    if (node.localName === 'footnoteReference') {
      for (const ancestor of ancestors) path.push(ancestor);
      return true;
    }
    ancestors.push(node);
    for (const child of node.children) if (visit(child, ancestors)) return true;
    ancestors.pop();
    return false;
  };
  return visit(root, []) ? path : null;
}

describe('insertNote', () => {
  test('creates part/rel/content-type and allocates id from max+1', () => {
    const store = openStore(build({}));
    const paragraphId = firstParagraphId(store.currentPackage());
    const bodyRevision = store.revisionFor({ kind: 'body' });
    const result = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.change?.impact).toBe('global');
    expect(store.revisionFor({ kind: 'body' })).toBe((bodyRevision ?? 0) + 1);

    const pkg = store.currentPackage();
    const notes = resolveNotesPart(pkg, 'footnote');
    expect(notes).not.toBeNull();
    expect(notes!.root.kind).toBe('footnotes');
    expect(findNoteById(notes!.root, 1)).toBeDefined();
    expect(pkg.contentTypes.overrides.get('/word/footnotes.xml')).toContain('footnotes');

    const refs = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.noteId).toBe(1);

    // Undo restores absence of the part relationship content.
    store.undo();
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).toBeNull();
    store.redo();
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();
  });

  test('seeds from existing max and never allocates reserved ids', () => {
    const store = openStore(build({ footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = applyNoteLifecycleOp(store.currentPackage(), {
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.noteId).toBe(4);
    expect(result.noteId).toBeGreaterThan(0);
  });

  test('refuses id exhaustion', () => {
    const huge =
      `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>` +
      `<w:footnote w:id="2147483647"><w:p><w:r><w:t>max</w:t></w:r></w:p></w:footnote>`;
    const store = openStore(build({ footnotes: huge }));
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('invalidArgs');
  });
});

describe('deleteNote / convertNote / cascade', () => {
  test('deleteNote removes reference and body; undo restores both', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const beforeFn = canonicalOoxmlFingerprint(
      resolveNotesPart(store.currentPackage(), 'footnote')!
    );
    const result = store.applyLifecycleOp({
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const pkg = store.currentPackage();
    expect(findNoteById(resolveNotesPart(pkg, 'footnote')!.root, 1)).toBeUndefined();
    expect(collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!)).toHaveLength(0);

    store.undo();
    const undone = store.currentPackage();
    expect(findNoteById(resolveNotesPart(undone, 'footnote')!.root, 1)).toBeDefined();
    expect(canonicalOoxmlFingerprint(resolveNotesPart(undone, 'footnote')!)).toBe(beforeFn);
  });

  test('deleteText across noteReference cascades body in one undo', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const main = store.bodyStore().part;
    const paragraph = main.root.children
      .find((child) => child.kind === 'body')!
      .children.find((child) => child.kind === 'paragraph')!;
    const text = paragraphTextOf(main, paragraph.id)!;
    expect(text.length).toBe(3);
    const result = store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: paragraph.id, start: 1, end: 2 });
    });
    expect(result.ok).toBe(true);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeUndefined();
    store.undo();
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
  });

  test('convertNote moves body and rewrites reference kind', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes: seededNotes,
        endnotes:
          `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const pkg = store.currentPackage();
    expect(findNoteById(resolveNotesPart(pkg, 'footnote')!.root, 1)).toBeUndefined();
    const end = resolveNotesPart(pkg, 'endnote')!;
    const converted = end.root.children.find(
      (child) => child.kind === 'note' && (noteIdOf(child) ?? 0) > 0
    );
    expect(converted).toBeDefined();
    expect(noteKindOf(converted!)).toBe('endnote');
    const refs = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.noteKind).toBe('endnote');
    expect(refs[0]!.noteId).toBe(noteIdOf(converted!)!);
    const refNode = pkg.parts
      .get(pkg.mainDocumentPart)!
      .root.children.find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'noteReference')!;
    expect(noteReferenceKindOf(refNode)).toBe('endnote');
  });

  test('convertNote from an opened notes store keeps paragraph identity', () => {
    // Opening the notes store mints paraIds under a prefix only the source root declares.
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    store.partFor({ kind: 'notesPart', noteKind: 'footnote' });
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    if (!result.ok) throw new Error(`${result.reason} ${result.detail ?? ''}`);
    const end = resolveNotesPart(store.currentPackage(), 'endnote')!;
    const xml = serializeOoxmlPart(end);
    expect(xml).toContain('paraId');
    expect(readOoxmlPart(xml, { name: end.name, contentType: end.contentType }).ok).toBe(true);
  });

  test('convertNote keeps paragraph identity when the target binds its prefix elsewhere', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const bytes = build({
      body,
      footnotes: seededNotes,
      endnotes:
        `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
        `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`,
    });
    // The target root uses the prefix the source's minted paraIds use for another URI.
    const entries = unzipSync(bytes);
    entries['word/endnotes.xml'] = strToU8(
      new TextDecoder()
        .decode(entries['word/endnotes.xml'])
        .replace('<w:endnotes ', '<w:endnotes xmlns:w14="urn:other" ')
    );
    const store = openStore(zipSync(entries));
    store.partFor({ kind: 'notesPart', noteKind: 'footnote' });
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    if (!result.ok) throw new Error(`${result.reason} ${result.detail ?? ''}`);
    const end = resolveNotesPart(store.currentPackage(), 'endnote')!;
    const xml = serializeOoxmlPart(end);
    expect(xml).toContain('"urn:other"');
    expect(xml).toContain('paraId');
    expect(readOoxmlPart(xml, { name: end.name, contentType: end.contentType }).ok).toBe(true);
  });

  test('deleteNote on missing id fails closed', () => {
    const store = openStore(build({ footnotes: seededNotes }));
    const result = store.applyLifecycleOp({
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 99,
    });
    expect(result.ok).toBe(false);
  });

  test('deleteNote refuses reserved separator ids', () => {
    const pkg = load(build({ footnotes: seededNotes }));
    for (const noteId of [-1, 0]) {
      const result = applyNoteLifecycleOp(pkg, {
        op: 'deleteNote',
        noteKind: 'footnote',
        noteId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.detail).toBe('noteId');
    }
  });
});

describe('convertNote reference style rewriting', () => {
  const endnoteSeeds =
    `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
    `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`;

  const footnoteWithStyledBody =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p>` +
    `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>` +
    `<w:r><w:t>one</w:t></w:r>` +
    `</w:p></w:footnote>`;

  const endnoteWithStyledBody =
    endnoteSeeds +
    `<w:endnote w:id="1"><w:p>` +
    `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:endnoteRef/></w:r>` +
    `<w:r><w:t>one</w:t></w:r>` +
    `</w:p></w:endnote>`;

  function citationXml(kind: 'footnote' | 'endnote', id: number, extra = ''): string {
    const ref = kind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
    const style = kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
    return (
      `<w:p><w:r><w:rPr><w:rStyle w:val="${style}"/>${extra}</w:rPr>` +
      `<w:${ref} w:id="${id}"/></w:r></w:p>`
    );
  }

  test('footnote→endnote rewrites citation and body built-in rStyle', () => {
    const store = openStore(
      build({
        body: citationXml('footnote', 1, '<w:vertAlign w:val="superscript"/>'),
        footnotes: footnoteWithStyledBody,
        endnotes: endnoteSeeds,
      })
    );
    const beforeMainFp = canonicalOoxmlFingerprint(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const pkg = store.currentPackage();
    const mainXml = serializeOoxmlPart(pkg.parts.get(pkg.mainDocumentPart)!);
    const endXml = serializeOoxmlPart(resolveNotesPart(pkg, 'endnote')!);
    expect(mainXml).toContain('<w:endnoteReference');
    expect(mainXml).toContain('<w:rStyle w:val="EndnoteReference"/>');
    expect(mainXml).not.toContain('FootnoteReference');
    expect(endXml).toContain('<w:endnoteRef/>');
    expect(endXml).toContain('<w:rStyle w:val="EndnoteReference"/>');
    expect(endXml).toContain('<w:vertAlign w:val="superscript"/>');
    expect(endXml).not.toContain('FootnoteReference');

    const refs = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(refs[0]!.noteKind).toBe('endnote');

    const saved = writeOoxmlPackage(pkg);
    const reopened = load(saved);
    expect(diagnoseNoteReferences(reopened)).toEqual([]);
    expect(serializeOoxmlPart(reopened.parts.get(reopened.mainDocumentPart)!)).toContain(
      'EndnoteReference'
    );

    store.undo();
    const undone = store.currentPackage();
    expect(canonicalOoxmlFingerprint(undone.parts.get(undone.mainDocumentPart)!)).toBe(
      beforeMainFp
    );
    expect(serializeOoxmlPart(undone.parts.get(undone.mainDocumentPart)!)).toContain(
      'FootnoteReference'
    );
    store.redo();
    expect(serializeOoxmlPart(store.currentPackage().parts.get(pkg.mainDocumentPart)!)).toContain(
      'EndnoteReference'
    );
  });

  test('endnote→footnote rewrites citation and body built-in rStyle', () => {
    const store = openStore(
      build({
        body: citationXml('endnote', 1),
        footnotes:
          `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>`,
        endnotes: endnoteWithStyledBody,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'endnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const pkg = store.currentPackage();
    const mainXml = serializeOoxmlPart(pkg.parts.get(pkg.mainDocumentPart)!);
    const fnXml = serializeOoxmlPart(resolveNotesPart(pkg, 'footnote')!);
    expect(mainXml).toContain('<w:footnoteReference');
    expect(mainXml).toContain('<w:rStyle w:val="FootnoteReference"/>');
    expect(mainXml).not.toContain('EndnoteReference');
    expect(fnXml).toContain('<w:footnoteRef/>');
    expect(fnXml).toContain('<w:rStyle w:val="FootnoteReference"/>');
    expect(fnXml).not.toContain('EndnoteReference');
  });

  test('preserves customMarkFollows and absent rStyle on citation', () => {
    const body =
      `<w:p><w:r><w:endnoteReference w:id="1" w:customMarkFollows="1"/></w:r>` +
      `<w:r><w:rPr><w:rStyle w:val="MyFootnoteLookalike"/></w:rPr><w:t>plain</w:t></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes:
          `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>`,
        endnotes: endnoteWithStyledBody,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'endnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const mainXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(mainXml).toContain('w:customMarkFollows="1"');
    expect(mainXml).not.toContain('<w:rStyle w:val="FootnoteReference"/>');
    expect(mainXml).toContain('<w:rStyle w:val="MyFootnoteLookalike"/>');
    const refs = collectNoteReferences(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(refs[0]!.customMarkFollows).toBe(true);
  });

  test('does not rewrite unrelated runs with same-looking style name', () => {
    const body =
      citationXml('footnote', 1) +
      `<w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:t>not a note</w:t></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes: footnoteWithStyledBody,
        endnotes: endnoteSeeds,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const mainXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    const citationHits = (mainXml.match(/EndnoteReference/g) ?? []).length;
    expect(citationHits).toBe(1);
    expect(mainXml).toContain(
      '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:t>not a note</w:t></w:r>'
    );
  });

  test('leaves custom rStyle on note-mark run unchanged', () => {
    const styledFootnotes =
      `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>` +
      `<w:footnote w:id="1"><w:p>` +
      `<w:r><w:rPr><w:rStyle w:val="MyNoteMark"/></w:rPr><w:footnoteRef/></w:r>` +
      `<w:r><w:t>x</w:t></w:r></w:p></w:footnote>`;
    const store = openStore(
      build({
        body: citationXml('footnote', 1),
        footnotes: styledFootnotes,
        endnotes: endnoteSeeds,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const endXml = serializeOoxmlPart(resolveNotesPart(store.currentPackage(), 'endnote')!);
    expect(endXml).toContain('<w:rStyle w:val="MyNoteMark"/>');
    expect(endXml).not.toContain('EndnoteReference');
  });

  test('preserves foreign-namespace rStyle/val while rewriting WML built-in', () => {
    const body =
      `<w:p xmlns:x="urn:evil"><w:r><w:rPr>` +
      `<x:rStyle x:val="FootnoteReference"/>` +
      `<w:rStyle w:val="FootnoteReference" x:val="FootnoteReference"/>` +
      `</w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes: footnoteWithStyledBody,
        endnotes: endnoteSeeds,
      })
    );
    const beforeFp = canonicalOoxmlFingerprint(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const mainXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(mainXml).toContain('<w:rStyle w:val="EndnoteReference"');
    expect(mainXml).toMatch(/x:rStyle[^>]*x:val="FootnoteReference"/);
    expect(mainXml).toContain('x:val="FootnoteReference"');
    // Foreign lookalike must not be rewritten to EndnoteReference.
    expect(mainXml).toMatch(/x:rStyle[^>]*x:val="FootnoteReference"/);
    expect(mainXml).not.toMatch(/x:rStyle[^>]*x:val="EndnoteReference"/);

    store.undo();
    expect(
      canonicalOoxmlFingerprint(
        store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
      )
    ).toBe(beforeFp);
  });

  test('rewrites built-in style on citation nested under hyperlink', () => {
    const body =
      `<w:p><w:hyperlink w:anchor="here"><w:r><w:rPr>` +
      `<w:rStyle w:val="FootnoteReference"/></w:rPr>` +
      `<w:footnoteReference w:id="1"/></w:r></w:hyperlink></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes: footnoteWithStyledBody,
        endnotes: endnoteSeeds,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const mainXml = serializeOoxmlPart(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    expect(mainXml).toContain('<w:endnoteReference');
    expect(mainXml).toContain('<w:rStyle w:val="EndnoteReference"/>');
    expect(mainXml).toContain('<w:hyperlink');
  });
});

describe('setNoteProperties', () => {
  test('refuses endnote pageBottom and invents nothing on unedited save', () => {
    const store = openStore(build({}));
    const refused = store.applyLifecycleOp({
      op: 'setNoteProperties',
      scope: 'document',
      endnote: { position: 'pageBottom' },
    });
    expect(refused.ok).toBe(false);

    const bytes = writeOoxmlPackage(store.currentPackage());
    const reopened = load(bytes);
    expect(settingsPartOf(reopened)).toBeNull();
    expect(
      reopened.parts
        .get(reopened.mainDocumentPart)!
        .root.children.some(
          (child) => child.kind !== 'textValue' && child.localName === 'footnotePr'
        )
    ).toBe(false);
  });

  test('document scope writes settings footnotePr and the section footnotePr', () => {
    const store = openStore(build({}));
    const result = store.applyLifecycleOp({
      op: 'setNoteProperties',
      scope: 'document',
      footnote: {
        numFmt: 'lowerRoman',
        numStart: 2,
        numRestart: 'eachSect',
        position: 'pageBottom',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const settings = settingsPartOf(store.currentPackage());
    expect(settings).not.toBeNull();
    const authored = authoredDocumentFootnoteProperties(settings);
    expect(authored?.numFmt).toBe('lowerRoman');
    expect(authored?.numStart).toBe(2);
    // Numbering resolves from the section, so the write reaches the section too.
    const sectPr = collectSectionPropertyNodes(mainPartOf(store.currentPackage()).root)[0];
    const section = authoredFootnotePropertiesFromSectPr(sectPr);
    expect(resolveFootnoteProperties(section).numFmt).toBe('lowerRoman');
    expect(resolveFootnoteProperties(section).numStart).toBe(2);
  });
});

describe('D9 note fingerprint / digest', () => {
  test('unedited note parts fingerprint round-trip; edit changes digest', () => {
    const bytes = build({
      body: `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`,
      footnotes: seededNotes,
    });
    const loaded = load(bytes);
    const fn = resolveNotesPart(loaded, 'footnote')!;
    const beforeFp = canonicalOoxmlFingerprint(fn);
    const beforeDigest = semanticDigest([fn]);
    const written = writeOoxmlPackage(loaded);
    const reopened = load(written);
    const fnAgain = resolveNotesPart(reopened, 'footnote')!;
    expect(canonicalOoxmlFingerprint(fnAgain)).toBe(beforeFp);
    expect(diffSemanticDigests(beforeDigest, semanticDigest([fnAgain]))).toEqual([]);

    const store = openStore(bytes);
    const note = findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)!;
    const para = note.children.find((c) => c.kind === 'paragraph')!;
    const text = paragraphTextOf(resolveNotesPart(store.currentPackage(), 'footnote')!, para.id)!;
    const ok = store.transact({ kind: 'notesPart', noteKind: 'footnote' }, (ctx) => {
      ctx.apply({
        op: 'insertText',
        paragraphId: para.id,
        offset: text.length,
        text: 'X',
      });
    });
    expect(ok.ok).toBe(true);
    const edited = resolveNotesPart(store.currentPackage(), 'footnote')!;
    expect(diffSemanticDigests(beforeDigest, semanticDigest([edited])).length).toBeGreaterThan(0);
  });
});

describe('TreePackageStore notes coexistence', () => {
  test('body / HF / footnotes / endnotes keep independent revisions', () => {
    const withHeader = build({
      body:
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>`,
      footnotes: seededNotes,
      endnotes:
        `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
        `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>` +
        `<w:endnote w:id="1"><w:p><w:r><w:t>e</w:t></w:r></w:p></w:endnote>`,
      rels:
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    });
    const unzipped = unzipSync(withHeader);
    unzipped['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>hdr</w:t></w:r></w:p></w:hdr>`
    );
    const store = openStore(zipSync(unzipped));

    const bodyRev = store.revisionFor({ kind: 'body' })!;
    const fn = store.resolveStory({ kind: 'notesPart', noteKind: 'footnote' });
    expect(fn.ok).toBe(true);
    if (!fn.ok) throw new Error(fn.reason);
    const enBefore = store.revisionFor({ kind: 'notesPart', noteKind: 'endnote' })!;
    const hf = store.resolveStory({ kind: 'headerFooter', rId: 'rId7' });
    expect(hf.ok).toBe(true);
    if (!hf.ok) throw new Error(hf.reason);

    const fnPara = fn.store.part.root.children
      .find((child) => child.kind === 'note' && noteIdOf(child) === 3)!
      .children.find((child) => child.kind === 'paragraph')!;
    const fnRevBefore = fn.store.revision;
    store.transact({ kind: 'notesPart', noteKind: 'footnote' }, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: fnPara.id, offset: 0, text: '!' });
    });
    expect(store.revisionFor({ kind: 'body' })).toBe(bodyRev);
    expect(store.revisionFor({ kind: 'notesPart', noteKind: 'footnote' })).toBeGreaterThan(
      fnRevBefore
    );
    expect(store.revisionFor({ kind: 'notesPart', noteKind: 'endnote' })).toBe(enBefore);

    const saved = writeOoxmlPackage(store.currentPackage());
    const reopened = load(saved);
    expect(resolveNotesPart(reopened, 'footnote')).not.toBeNull();
    expect(diagnoseNoteReferences(reopened)).toEqual([]);
  });
});

describe('convertAllNotes atomic bulk lifecycle', () => {
  test('converts every footnote in one undo unit with saved round-trip', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/><w:t xml:space="preserve"> </w:t><w:footnoteReference w:id="3"/></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes: seededNotes,
        endnotes:
          `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`,
      })
    );
    const beforeFp = canonicalOoxmlFingerprint(
      store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
    );
    const result = store.applyLifecycleOp({ op: 'convertAllNotes', fromKind: 'footnote' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);

    const pkg = store.currentPackage();
    const fnRoot = resolveNotesPart(pkg, 'footnote')!.root;
    expect(findNoteById(fnRoot, 1)).toBeUndefined();
    expect(findNoteById(fnRoot, 3)).toBeUndefined();
    expect(fnRoot.children.filter((child) => isNormalNote(child)).length).toBe(0);
    const end = resolveNotesPart(pkg, 'endnote')!;
    const normalEnds = end.root.children.filter((child) => isNormalNote(child));
    expect(normalEnds.length).toBe(2);
    const refs = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(refs.every((hit) => hit.noteKind === 'endnote')).toBe(true);
    expect(refs.map((hit) => hit.atomOffset)).toEqual([0, 2]);

    const saved = writeOoxmlPackage(pkg);
    const reopened = load(saved);
    expect(diagnoseNoteReferences(reopened)).toEqual([]);
    expect(
      collectNoteReferences(reopened.parts.get(reopened.mainDocumentPart)!).map((h) => h.noteKind)
    ).toEqual(['endnote', 'endnote']);

    // One undo restores the pre-conversion package.
    store.undo();
    expect(
      canonicalOoxmlFingerprint(
        store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
      )
    ).toBe(beforeFp);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
    store.redo();
    expect(
      collectNoteReferences(
        store.currentPackage().parts.get(store.currentPackage().mainDocumentPart)!
      ).every((hit) => hit.noteKind === 'endnote')
    ).toBe(true);
  });
});

describe('note reference scan budget', () => {
  test('records atomOffset and shares visited budget across snapshots', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const pkg = load(build({ body, footnotes: seededNotes }));
    const hits = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.atomOffset).toBe(1);
    expect(hits[0]!.partName).toBe(pkg.mainDocumentPart);

    const budget = createNoteReferenceScanBudget(8);
    collectPackageNoteReferences(pkg, { budget });
    expect(budget.visited).toBeLessThanOrEqual(8);
    collectPackageNoteReferences(pkg, { budget });
    expect(budget.truncated).toBe(true);
  });

  function padPart(name: string): OoxmlPart {
    const read = readOoxmlPart(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>pad</w:t></w:r></w:p></w:hdr>`,
      {
        name,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      }
    );
    if (!read.ok) throw new Error(read.reason);
    return read.part;
  }

  /** Insert padding XML parts ahead of existing ones so late refs sit after the part gate. */
  function prependPaddingParts(pkg: OoxmlPackage, count: number): OoxmlPackage {
    const parts = new Map<string, OoxmlPart>();
    for (let i = 0; i < count; i += 1) {
      const name = `/word/_pad${i}.xml`;
      parts.set(name, padPart(name));
    }
    for (const [name, part] of pkg.parts) parts.set(name, part);
    return { ...pkg, parts };
  }

  test('deleteNote N parts succeeds; N+1 truncates atomically with package unchanged', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const base = load(build({ body, footnotes: seededNotes }));
    const xmlCount = [...base.parts.values()].filter((part) => part.name.endsWith('.xml')).length;

    const atCap = prependPaddingParts(base, 0);
    const ok = applyNoteLifecycleOp(
      atCap,
      { op: 'deleteNote', noteKind: 'footnote', noteId: 1 },
      { scanBudget: createNoteReferenceScanBudget(20_000, xmlCount) }
    );
    expect(ok.ok).toBe(true);

    const padded = prependPaddingParts(base, 3);
    const beforeFp = canonicalOoxmlFingerprint(padded.parts.get(padded.mainDocumentPart)!);
    const beforeNotesFp = canonicalOoxmlFingerprint(resolveNotesPart(padded, 'footnote')!);
    // Cap equals padding only — original document/notes parts are past the gate and hold
    // the late reference.
    const refused = applyNoteLifecycleOp(
      padded,
      { op: 'deleteNote', noteKind: 'footnote', noteId: 1 },
      { scanBudget: createNoteReferenceScanBudget(20_000, 3) }
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected truncation');
    expect(refused.detail).toBe('reference-scan-truncated');
    expect(canonicalOoxmlFingerprint(padded.parts.get(padded.mainDocumentPart)!)).toBe(beforeFp);
    expect(canonicalOoxmlFingerprint(resolveNotesPart(padded, 'footnote')!)).toBe(beforeNotesFp);
    expect(collectNoteReferences(padded.parts.get(padded.mainDocumentPart)!)).toHaveLength(1);
    expect(findNoteById(resolveNotesPart(padded, 'footnote')!.root, 1)).toBeDefined();
  });

  test('convertNote rejects on visited-node budget exhaustion before late reference', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const base = load(
      build({
        body,
        footnotes: seededNotes,
        endnotes:
          `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`,
      })
    );
    const padded = prependPaddingParts(base, 8);
    const beforeMain = canonicalOoxmlFingerprint(padded.parts.get(padded.mainDocumentPart)!);
    const beforeFn = canonicalOoxmlFingerprint(resolveNotesPart(padded, 'footnote')!);

    const refused = applyNoteLifecycleOp(
      padded,
      { op: 'convertNote', fromKind: 'footnote', noteId: 1 },
      // Tiny visited budget exhausts while walking padding parts; late citation never seen.
      { scanBudget: createNoteReferenceScanBudget(12, MAX_NOTE_REFERENCE_PARTS) }
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('expected truncation');
    expect(refused.detail).toBe('reference-scan-truncated');
    expect(canonicalOoxmlFingerprint(padded.parts.get(padded.mainDocumentPart)!)).toBe(beforeMain);
    expect(canonicalOoxmlFingerprint(resolveNotesPart(padded, 'footnote')!)).toBe(beforeFn);
    expect(resolveNotesPart(padded, 'endnote')).not.toBeNull();
    expect(
      resolveNotesPart(padded, 'endnote')!.root.children.some((child) => isNormalNote(child))
    ).toBe(false);
  });

  test('package collector marks part-budget truncation without mutating hits into a partial rewrite', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const base = load(build({ body, footnotes: seededNotes }));
    const padded = prependPaddingParts(base, 2);
    const budget = createNoteReferenceScanBudget(20_000, 2);
    const hits = collectPackageNoteReferences(padded, {
      budget,
      maxHits: Number.POSITIVE_INFINITY,
    });
    expect(budget.truncated).toBe(true);
    expect(budget.parts).toBe(2);
    // Late main-document reference must not appear when the part gate truncates first.
    expect(hits.every((hit) => hit.partName.startsWith('/word/_pad'))).toBe(true);
  });
});
