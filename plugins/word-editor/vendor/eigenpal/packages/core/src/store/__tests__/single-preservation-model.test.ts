// The engine carries ONE model (task 6.7, tightened by the phase-4 deletion sweep).
//
// The design rejects "a semantic paragraph model plus raw-XML preservation capsules" because
// two representations need ownership arbitration, and edits, ordering and save then diverge.
// The canonical tree keeps unknown content as generic nodes in source order instead.
//
// Nothing in an import graph expresses that: a capsule is a `string` field, so a lane could
// grow one back without any dependency changing. The legacy byte-capsule lane is deleted, so
// the scan is no longer an allowlist over tree-lane modules — it is ALL of
// `packages/core/src`, and any module that names the second model's vocabulary fails.

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOoxmlPackage, withPart, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { canonicalOoxmlFingerprint } from '../package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp } from '../store/tree-ops.ts';
import { deriveOoxmlIndexes } from '../package/ooxml-indexes.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import { TreeDocumentStore } from '../store/tree-store.ts';
import { openTreeSession } from '../../binding/tree-session.ts';
import { zipSync, strToU8 } from 'fflate';

const CORE_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The second model's vocabulary: verbatim bytes and the source ranges that address them. */
const SECOND_MODEL = /\brPrCapsule\b|\bpPrCapsule\b|\bpAttrsCapsule\b|\bblockRanges\b/;

/** Comments here name the very fields they forbid, so they cannot count as occurrences. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every .ts source under packages/core/src, tests excluded (tests may quote the vocabulary). */
function collectCoreSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectCoreSources(path, out);
    } else if (entry.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OD = `${R}/officeDocument`;

/** A minimal well-formed DOCX around the given document.xml body, plus extra parts. */
function buildDocx(
  bodyInner: string,
  options: {
    readonly overrides?: string;
    readonly rels?: string;
    readonly extraParts?: Record<string, string>;
    readonly documentAttrs?: string;
  } = {}
): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"${options.documentAttrs ?? ''}><w:body>${bodyInner}</w:body></w:document>`
    ),
  };
  if (options.rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${options.rels}</Relationships>`
    );
  }
  for (const [name, xml] of Object.entries(options.extraParts ?? {})) {
    entries[name] = strToU8(xml);
  }
  return zipSync(entries);
}

/** A paragraph whose formatting and content include elements the typed model does not know. */
function unknownContentDocx(): Uint8Array {
  const body =
    '<w:p><w:r>' +
    '<w:rPr><w:b/><ext:futureRunProp xmlns:ext="urn:test:ext" val="keep"/></w:rPr>' +
    '<w:t>hello</w:t>' +
    '</w:r>' +
    '<w:r><w:drawing><wp:inline xmlns:wp="urn:test:wp"><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r>' +
    '<ext:futureParagraphChild xmlns:ext="urn:test:ext">tail</ext:futureParagraphChild>' +
    '</w:p>';
  return buildDocx(body);
}

describe('the engine keeps ONE model (task 6.7)', () => {
  test('no module under packages/core/src names a preservation capsule or a source range', () => {
    const sources = collectCoreSources(CORE_SRC);
    // A scan over nothing proves nothing: the corpus must really be the engine.
    expect(sources.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of sources) {
      if (SECOND_MODEL.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(relative(CORE_SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the regex matches the fields it is meant to and not a lookalike', () => {
    expect(SECOND_MODEL.test('const x = run.rPrCapsule;')).toBe(true);
    expect(SECOND_MODEL.test('preservation.blockRanges.get(id)')).toBe(true);
    // Not a capsule: an unrelated identifier that merely contains the word.
    expect(SECOND_MODEL.test('const encapsulated = 1;')).toBe(false);
  });
});

describe('unknown content does not lock a paragraph read-only (task 6.7)', () => {
  const open = (): { store: TreeDocumentStore; paragraphId: string } => {
    const read = readOoxmlPackage(unknownContentDocx());
    if (!read.ok) throw new Error(read.reason);
    const part = read.package.parts.get(read.package.mainDocumentPart)!;
    const indexes = deriveOoxmlIndexes(read.package, 1);
    const paragraphId = [...indexes.paragraphs.values()][0]!.nodeId;
    return { store: new TreeDocumentStore(part), paragraphId };
  };

  test('a paragraph carrying unknown runs, properties and children is still editable', () => {
    const { store, paragraphId } = open();
    const result = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' })
    );
    expect(result.ok).toBe(true);
    expect(paragraphTextOf(store.part, paragraphId)).toContain('Xhello');
  });

  test('the unknown content is still there afterwards, as nodes rather than bytes', () => {
    const { store, paragraphId } = open();
    store.transact((tx) => tx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' }));
    // Its survival is a property of the NODES, not of a retained byte range that a later
    // edit could invalidate.
    const xml = JSON.stringify(store.part);
    expect(xml).toContain('futureRunProp');
    expect(xml).toContain('futureParagraphChild');
    expect(xml).toContain('urn:test:wp');
  });
});

describe('the one model reaches beyond plain body paragraphs (phase-4 sweep)', () => {
  test('a table document opens editable and an insertText into a cell paragraph commits', () => {
    const body =
      '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>';
    const opened = openTreeSession(buildDocx(body));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const session = opened.session;
    expect(session.editable).toBe(true);

    // Body paragraph first, cell paragraph after it in document order, then the empty paragraph
    // the body reads after its final table. Assert on text to be sure the op lands in the cell.
    const ids = session.paragraphIds();
    expect(ids.length).toBe(3);
    const cellParagraphId = ids[1]!;
    expect(paragraphTextOf(session.part(), cellParagraphId)).toBe('cell');

    const result = session.applyTreeOps([
      { op: 'insertText', paragraphId: cellParagraphId, offset: 0, text: 'X' },
    ]);
    expect(result.committed).toBe(true);
    expect(result.rejected).toBe(false);
    expect(paragraphTextOf(session.part(), cellParagraphId)).toBe('Xcell');
  });

  test('a document with a default header opens and resolves the header part', () => {
    const headerXml = `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>HEADER</w:t></w:r></w:p></w:hdr>`;
    const bytes = buildDocx(
      '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>',
      {
        documentAttrs: ` xmlns:r="${R}"`,
        overrides:
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
        rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
        extraParts: { 'word/header1.xml': headerXml },
      }
    );
    const opened = openTreeSession(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const header = opened.session.headerFooterParts().headers.get('default');
    expect(header).toBeDefined();
  });
});

describe('generic direct body children survive package save (task 4.6)', () => {
  test('a body-level unknown element survives a nearby paragraph edit through writeOoxmlPackage', () => {
    const body =
      '<w:p><w:r><w:t>editable</w:t></w:r></w:p>' +
      '<ext:futureBodyChild xmlns:ext="urn:test:ext" flag="keep">orphan</ext:futureBodyChild>' +
      '<w:p><w:r><w:t>neighbor</w:t></w:r></w:p>';
    const loaded = readOoxmlPackage(buildDocx(body));
    if (!loaded.ok) throw new Error(loaded.reason);

    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const indexes = deriveOoxmlIndexes(loaded.package, 1);
    const paragraphId = indexes.stories.get(main.name)!.paragraphs[0]!.nodeId;
    const edited = applyTreeOp(main, { op: 'insertText', paragraphId, offset: 0, text: 'X' });
    if (!edited.ok) throw new Error(edited.reason);

    const fingerprintBefore = canonicalOoxmlFingerprint(edited.part);
    const digestBefore = semanticDigest([edited.part]);
    const reopened = readOoxmlPackage(writeOoxmlPackage(withPart(loaded.package, edited.part)));
    if (!reopened.ok) throw new Error(reopened.reason);

    const reopenedMain = reopened.package.parts.get(main.name)!;
    expect(JSON.stringify(reopenedMain)).toContain('futureBodyChild');
    expect(JSON.stringify(reopenedMain)).toContain('flag');
    expect(canonicalOoxmlFingerprint(reopenedMain)).toBe(fingerprintBefore);
    expect(diffSemanticDigests(digestBefore, semanticDigest([reopenedMain]))).toEqual([]);
    expect(
      deriveOoxmlIndexes(reopened.package, 2).stories.get(main.name)!.paragraphs[0]!.text
    ).toBe('Xeditable');
  });
});
