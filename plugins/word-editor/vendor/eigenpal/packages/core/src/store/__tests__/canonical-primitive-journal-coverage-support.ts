// Shared helpers for journal completeness coverage (tasks 3.6 and 3.8).

import { strToU8, zipSync } from 'fflate';
import {
  observeCanonicalPrimitiveJournal,
  flushPendingCanonicalJournals,
} from '../../collaboration/primitive-journal.ts';
import { semanticDigest } from '../package/ooxml-digest.ts';
import {
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/ooxml-package.ts';
import { partNameKey } from '../package/opc-names.ts';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isWmlGridCol, wmlChildNamed } from '../store/tree-op-table-shared.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import type { TreeDocOp, TreeDocOpKind } from '../store/tree-ops.ts';
import type { CanonicalPrimitiveJournal } from '../package/canonical-primitive-journal.ts';
import {
  blobsForJournal,
  replayCanonicalPrimitiveJournal,
} from './canonical-primitive-replayer.ts';

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const OD = `${R}/officeDocument`;
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
export const PIC_URI = PIC;
export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
export const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

export const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (character) => character.charCodeAt(0)
);

export const QA = { id: '1', author: 'QA', date: '2020-01-01T00:00:00Z' } as const;

export type JournalCoverageFixture = {
  readonly kind: TreeDocOpKind;
  readonly bytes: Uint8Array;
  readonly apply: (store: TreePackageStore) => { readonly ok: boolean; readonly reason?: string };
};

export function zipDoc(options: {
  readonly body: string;
  readonly rels?: string;
  readonly overrides?: string;
  readonly defaults?: string;
  readonly extraXmlns?: string;
  readonly extraXml?: Record<string, string>;
  readonly extraBytes?: Record<string, Uint8Array>;
}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        (options.defaults ?? '') +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:w14="${W14}"${
        options.extraXmlns ? ` ${options.extraXmlns}` : ''
      }>` + `<w:body>${options.body}</w:body></w:document>`
    ),
  };
  if (options.rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${options.rels}</Relationships>`
    );
  }
  for (const [name, xml] of Object.entries(options.extraXml ?? {})) {
    entries[name] = strToU8(xml);
  }
  for (const [name, bytes] of Object.entries(options.extraBytes ?? {})) {
    entries[name] = bytes;
  }
  return zipSync(entries);
}

export function plainDoc(
  body = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p><w:sectPr/>'
): Uint8Array {
  return zipDoc({ body });
}

export function openStore(bytes: Uint8Array): TreePackageStore {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  return new TreePackageStore(loaded.package, main);
}

export function transactBody(
  store: TreePackageStore,
  op: TreeDocOp
): { readonly ok: boolean; readonly reason?: string } {
  const result = store.transact({ kind: 'body' }, (context) => {
    context.apply(op);
  });
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export function walkNodes(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) walkNodes(child, visit);
}

export function paragraphsOf(part: OoxmlPart): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  walkNodes(part.root, (node) => {
    if (node.kind === 'paragraph') found.push(node);
  });
  return found;
}

export function firstParagraphId(store: TreePackageStore): string {
  const paragraph = paragraphsOf(store.bodyStore().part)[0];
  if (!paragraph) throw new Error('missing paragraph');
  return paragraph.id;
}

export function paragraphIds(store: TreePackageStore): string[] {
  return paragraphsOf(store.bodyStore().part).map((paragraph) => paragraph.id);
}

export function findKind(part: OoxmlPart, kind: string): OoxmlNode {
  let found: OoxmlNode | undefined;
  walkNodes(part.root, (node) => {
    if (!found && node.kind === kind) found = node;
  });
  if (!found) throw new Error(`missing ${kind}`);
  return found;
}

export function tableIds(store: TreePackageStore): {
  readonly tableId: string;
  readonly rowIds: string[];
  readonly cellIds: string[];
  readonly gridColIds: string[];
} {
  const part = store.bodyStore().part;
  const table = findKind(part, 'table') as OoxmlElement;
  const grid = wmlChildNamed(table, 'tblGrid');
  const gridColIds = grid ? grid.children.filter(isWmlGridCol).map((node) => node.id) : [];
  const rowIds: string[] = [];
  const cellIds: string[] = [];
  for (const child of table.children) {
    if (child.kind !== 'tableRow') continue;
    rowIds.push(child.id);
    for (const cell of child.children) {
      if (cell.kind !== 'textValue' && cell.localName === 'tc') cellIds.push(cell.id);
    }
  }
  return { tableId: table.id, rowIds, cellIds, gridColIds };
}

export function parseDrawingTemplate(): OoxmlDrawingNode {
  const xml =
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
    '<w:body><w:p><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="152400" cy="152400"/>' +
    '<wp:docPr id="9" name="copy"/>' +
    '<wp:cNvGraphicFramePr/>' +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId14"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="152400" cy="152400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(xml, {
    name: '/word/template.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return findKind(parsed.part, 'drawing') as OoxmlDrawingNode;
}

export function captureOneJournal(
  store: TreePackageStore,
  run: () => { readonly ok: boolean; readonly reason?: string }
): {
  readonly result: { readonly ok: boolean; readonly reason?: string };
  readonly journal: CanonicalPrimitiveJournal | null;
} {
  const journals: CanonicalPrimitiveJournal[] = [];
  const stop = observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
  try {
    const result = run();
    flushPendingCanonicalJournals(store);
    return { result, journal: journals[0] ?? null };
  } finally {
    stop();
  }
}

function fingerprintMap(pkg: OoxmlPackage): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, part] of pkg.parts) {
    out.set(partNameKey(name), canonicalOoxmlFingerprint(part));
  }
  return out;
}

function reopenDigest(pkg: OoxmlPackage): string {
  const loaded = readOoxmlPackage(writeOoxmlPackage(pkg));
  if (!loaded.ok) throw new Error(loaded.reason);
  const parts = [...loaded.package.parts.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  return JSON.stringify(semanticDigest(parts));
}

function overrideEntries(pkg: OoxmlPackage): string {
  return JSON.stringify(
    [...pkg.contentTypes.overrides.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  );
}

function binaryEntries(pkg: OoxmlPackage): string {
  const rows: string[] = [];
  for (const [name, bytes] of [...pkg.partBytes.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    if (pkg.parts.has(name)) continue;
    rows.push(`${partNameKey(name)}:${bytes.length}:${bytes[0] ?? 0}`);
  }
  return rows.join('|');
}

/**
 * Every relationship the package declares, keyed by what it MEANS rather than which index
 * happens to hold it.
 *
 * `readOoxmlPackage` files an external relationship in BOTH `relationships` and
 * `externalTargets`; `ensureHyperlinkRelationship` mints one into `externalTargets` alone. Two
 * packages that resolve every `r:id` to the same target are equivalent whichever shape they
 * took, and the trees the bytes come from are compared separately. Comparing the raw maps
 * reported a mismatch for a locally minted hyperlink versus the same one after a reopen.
 */
function relationshipEntries(pkg: OoxmlPackage): string {
  const rows = new Set<string>();
  for (const [owner, records] of pkg.relationships) {
    for (const record of records) {
      rows.add(`${owner}|${record.id}|${record.type}|${record.rawTarget}|${record.targetMode}`);
    }
  }
  for (const entry of pkg.externalTargets) {
    rows.add(`${entry.ownerPart}|${entry.id}|${entry.type}|${entry.rawTarget}|External`);
  }
  return [...rows].sort().join(';');
}

export function assertPackagesEquivalent(actual: OoxmlPackage, expected: OoxmlPackage): void {
  const actualPrints = fingerprintMap(actual);
  const expectedPrints = fingerprintMap(expected);
  const names = new Set([...actualPrints.keys(), ...expectedPrints.keys()]);
  for (const name of names) {
    if (actualPrints.get(name) !== expectedPrints.get(name)) {
      throw new Error(`fingerprint mismatch for ${name}`);
    }
  }
  if (reopenDigest(actual) !== reopenDigest(expected)) {
    throw new Error('semanticDigest mismatch after save/reopen');
  }
  if (overrideEntries(actual) !== overrideEntries(expected)) {
    throw new Error('content-type override mismatch');
  }
  if (binaryEntries(actual) !== binaryEntries(expected)) {
    throw new Error('binary part mismatch');
  }
  if (relationshipEntries(actual) !== relationshipEntries(expected)) {
    throw new Error('relationship sidecar mismatch');
  }
}

export function replayAndCompare(
  replica: TreePackageStore,
  source: TreePackageStore,
  journal: CanonicalPrimitiveJournal
): void {
  const replayed = replayCanonicalPrimitiveJournal(
    replica.currentPackage(),
    journal,
    blobsForJournal(source.currentPackage(), journal)
  );
  assertPackagesEquivalent(replayed, source.currentPackage());
}
