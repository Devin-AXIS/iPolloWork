// The rich-clipboard-fidelity acceptance oracle (design D9): normalized block signatures
// over a body story. Strips `w:sectPr`, revision-save noise, comment markers and lexical
// `xml:space`; maps every remapped identifier namespace (numbering, notes, bookmarks,
// rels, `wp:docPr`, SDT ids) by order of first appearance so fresh target ids compare
// equal; resolves relationship references by target (URL or media content hash).

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import { sha256FontBytes } from '../package/sha256.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

interface OracleContext {
  readonly pkg: OoxmlPackage;
  readonly ownerPart: string;
  readonly maps: Map<string, Map<string, string>>;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function bodyOf(part: OoxmlPart): OoxmlElement {
  const body =
    part.root.kind === 'document'
      ? part.root.children.find((child) => child.kind === 'body')
      : null;
  if (!body || !isElement(body)) throw new Error('no body');
  return body;
}

function appearance(ctx: OracleContext, namespace: string, value: string): string {
  let map = ctx.maps.get(namespace);
  if (!map) {
    map = new Map();
    ctx.maps.set(namespace, map);
  }
  let mapped = map.get(value);
  if (mapped === undefined) {
    mapped = `${namespace}#${map.size}`;
    map.set(value, mapped);
  }
  return mapped;
}

function resolvedRel(ctx: OracleContext, relId: string): string {
  const external = ctx.pkg.externalTargets.find(
    (entry) => entry.ownerPart === ctx.ownerPart && entry.id === relId
  );
  if (external) return `rel:external:${external.type}:${external.rawTarget}`;
  const records = ctx.pkg.relationships.get(ctx.ownerPart) ?? [];
  const record = records.find((entry) => entry.id === relId);
  if (!record) return `rel:missing`;
  if (record.targetMode === 'External') return `rel:external:${record.type}:${record.rawTarget}`;
  const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
  if (!resolved.ok) return 'rel:bad';
  const bytes =
    ctx.pkg.partBytes.get(resolved.partName) ??
    ctx.pkg.partBytes.get(resolved.partName.replace(/^\//, ''));
  return bytes ? `rel:media:${sha256FontBytes(bytes)}` : `rel:part:${record.type}`;
}

function skipInOracle(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.localName === 'sectPr' && node.namespaceUri === W) return true;
  if (
    (node.localName === 'commentRangeStart' || node.localName === 'commentRangeEnd') &&
    node.namespaceUri === W
  ) {
    return true;
  }
  if (node.kind === 'run' && node.children.some((child) => child.kind === 'commentReference')) {
    return true;
  }
  return false;
}

function oracleSignature(node: OoxmlNode, ctx: OracleContext, parentLocal: string): string {
  if (node.kind === 'textValue') return `T(${node.value})`;
  const attrs: string[] = [];
  for (const attribute of node.attributes) {
    if (attribute.localName.startsWith('rsid')) continue;
    // Lexical form, not content: the canonical serializer re-derives it on every save.
    if (attribute.localName === 'space' && attribute.namespaceUri.endsWith('/XML/1998/namespace'))
      continue;
    if (
      attribute.namespaceUri === W14 &&
      (attribute.localName === 'paraId' || attribute.localName === 'textId')
    ) {
      continue;
    }
    let value = attribute.value;
    if (attribute.namespaceUri === R) {
      value = resolvedRel(ctx, value);
    } else if (node.localName === 'numId' && attribute.localName === 'val') {
      value = appearance(ctx, 'num', value);
    } else if (
      (node.localName === 'footnoteReference' || node.localName === 'endnoteReference') &&
      attribute.localName === 'id'
    ) {
      value = appearance(ctx, `note:${node.localName}`, value);
    } else if (
      (node.localName === 'bookmarkStart' || node.localName === 'bookmarkEnd') &&
      attribute.localName === 'id'
    ) {
      value = appearance(ctx, 'bookmark', value);
    } else if (node.localName === 'docPr' && attribute.localName === 'id') {
      value = appearance(ctx, 'docPr', value);
    } else if (
      node.localName === 'id' &&
      parentLocal === 'sdtPr' &&
      attribute.localName === 'val'
    ) {
      value = appearance(ctx, 'sdt', value);
    }
    attrs.push(`${attribute.namespaceUri}|${attribute.localName}=${value}`);
  }
  const children = node.children
    .filter((child) => !skipInOracle(child))
    .map((child) => oracleSignature(child, ctx, node.localName))
    .join('');
  return `E(${node.namespaceUri}:${node.localName}[${attrs.sort().join(',')}]{${children}})`;
}

/**
 * Note-body signatures in BODY REFERENCE ORDER, ids normalized away, so a source and a
 * target whose note ids were remapped still compare equal note-for-note.
 */
export function referencedNoteSignatures(
  pkg: OoxmlPackage,
  ownerPart: string,
  kind: 'footnote' | 'endnote'
): string[] {
  const part = pkg.parts.get(ownerPart)!;
  const referenceLocal = kind === 'footnote' ? 'footnoteReference' : 'endnoteReference';
  const referenced: string[] = [];
  const scan = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'noteReference' && node.localName === referenceLocal) {
      const id = node.attributes.find((attribute) => attribute.localName === 'id')?.value;
      if (id !== undefined) referenced.push(id);
    }
    for (const child of node.children) scan(child);
  };
  scan(bodyOf(part) as OoxmlNode);

  const notesPart = pkg.parts.get(
    kind === 'footnote' ? '/word/footnotes.xml' : '/word/endnotes.xml'
  );
  if (!notesPart || notesPart.root.kind === 'textValue') return referenced.map(() => 'missing');
  const notesById = new Map<string, OoxmlElement>();
  for (const child of (notesPart.root as OoxmlElement).children) {
    if (child.kind === 'textValue' || child.kind !== 'note') continue;
    const id = child.attributes.find((attribute) => attribute.localName === 'id')?.value;
    if (id !== undefined) notesById.set(id, child);
  }
  const ctx: OracleContext = { pkg, ownerPart: notesPart.name, maps: new Map() };
  return referenced.map((id) => {
    const note = notesById.get(id);
    if (!note) return 'missing';
    const withoutId = {
      ...note,
      attributes: note.attributes.filter((attribute) => attribute.localName !== 'id'),
    } as OoxmlElement;
    return oracleSignature(withoutId, ctx, 'notes');
  });
}

export function normalizedBodySignatures(pkg: OoxmlPackage, ownerPart: string): string[] {
  const part = pkg.parts.get(ownerPart)!;
  const ctx: OracleContext = { pkg, ownerPart, maps: new Map() };
  return bodyOf(part)
    .children.filter(
      (child) =>
        child.kind === 'paragraph' || child.kind === 'table' || child.kind === 'contentControl'
    )
    .filter((child) => !skipInOracle(child))
    .map((child) => oracleSignature(child, ctx, 'body'));
}
