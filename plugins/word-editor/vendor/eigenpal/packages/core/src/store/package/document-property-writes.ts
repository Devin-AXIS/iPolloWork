import { createNodeIdAllocator, replaceChildren, replaceNode } from './ooxml-edit.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { readOoxmlPart, type OoxmlNode } from './ooxml-tree.ts';
import { withNewPart, withRelationship } from './package-edit.ts';
import { resolveInternalTarget } from './opc-names.ts';
import { isValidXmlText } from './sinks.ts';
import { escapeXml } from './sinks.ts';

const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const TYPE = 'application/vnd.openxmlformats-package.core-properties+xml';
const MEMBERS = {
  author: [DC, 'creator'],
  title: [DC, 'title'],
  subject: [DC, 'subject'],
  comments: [DC, 'description'],
  keywords: [CP, 'keywords'],
  category: [CP, 'category'],
} as const;
const READ_MEMBERS = { ...MEMBERS, lastAuthor: [CP, 'lastModifiedBy'] } as const;
export type DocumentPropertyName = keyof typeof READ_MEMBERS;
export type DocumentPropertyWrites = Partial<Record<keyof typeof MEMBERS, string>>;
export const DOCUMENT_PROPERTY_NAMES = Object.keys(READ_MEMBERS) as DocumentPropertyName[];

export function documentPropertiesPart(pkg: OoxmlPackage) {
  const rel = (pkg.relationships.get('/') ?? []).find((r) => r.type === REL);
  if (!rel || rel.targetMode !== 'Internal') return null;
  const target = resolveInternalTarget('/', rel.rawTarget);
  return target.ok ? (pkg.parts.get(target.partName) ?? null) : null;
}

export function documentProperty(pkg: OoxmlPackage, name: DocumentPropertyName): string {
  const part = documentPropertiesPart(pkg);
  const [ns, local] = READ_MEMBERS[name];
  const node = part?.root.children.find(
    (n) => n.kind !== 'textValue' && n.namespaceUri === ns && n.localName === local
  );
  return node && node.kind !== 'textValue'
    ? node.children.map((n) => (n.kind === 'textValue' ? n.value : '')).join('')
    : '';
}

export function validDocumentPropertyWrites(value: unknown): value is DocumentPropertyWrites {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, text]) =>
        Object.hasOwn(MEMBERS, key) &&
        typeof text === 'string' &&
        text.length <= 4096 &&
        isValidXmlText(text)
    )
  );
}

/** Preserve unknown properties and update only the requested core-property elements. */
export function withDocumentProperties(
  pkg: OoxmlPackage,
  values: DocumentPropertyWrites
): OoxmlPackage | null {
  if (!validDocumentPropertyWrites(values)) return null;
  if ((pkg.relationships.get('/') ?? []).filter((r) => r.type === REL).length > 1) return null;
  const existing = documentPropertiesPart(pkg);
  if (
    existing &&
    (existing.contentType !== TYPE ||
      existing.root.namespaceUri !== CP ||
      existing.root.localName !== 'coreProperties')
  )
    return null;
  if (!existing && (pkg.relationships.get('/') ?? []).some((r) => r.type === REL)) return null;
  const name = existing?.name ?? '/docProps/core.xml';
  if (!existing && (pkg.parts.has(name) || pkg.partBytes.has(name))) return null;
  const parsed = readOoxmlPart(
    `<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}">${Object.entries(values)
      .map(([key, value]) => {
        const [ns, local] = MEMBERS[key as keyof typeof MEMBERS];
        const prefix = ns === CP ? 'cp' : 'dc';
        return `<${prefix}:${local}>${escapeXml(value)}</${prefix}:${local}>`;
      })
      .join('')}</cp:coreProperties>`,
    { name, contentType: TYPE }
  );
  if (!parsed.ok) return null;
  if (existing) {
    let part = existing;
    const nextId = createNodeIdAllocator(existing);
    const fresh = (node: OoxmlNode): OoxmlNode =>
      node.kind === 'textValue'
        ? { ...node, id: nextId() }
        : ({ ...node, id: nextId(), children: node.children.map(fresh) } as OoxmlNode);
    for (const authored of parsed.part.root.children) {
      if (authored.kind === 'textValue') continue;
      const matches = part.root.children.filter(
        (n) =>
          n.kind !== 'textValue' &&
          n.namespaceUri === authored.namespaceUri &&
          n.localName === authored.localName
      );
      if (matches.length > 1) return null;
      const previous = matches[0];
      let result;
      if (previous && previous.kind !== 'textValue') {
        if (previous.children.some((child) => child.kind !== 'textValue')) return null;
        const oldText =
          previous.children.length === 1 && previous.children[0]?.kind === 'textValue'
            ? previous.children[0]
            : null;
        const newText = authored.children.find((n) => n.kind === 'textValue');
        const children =
          oldText && newText?.kind === 'textValue'
            ? [{ ...oldText, value: newText.value }]
            : authored.children.map(fresh);
        result = replaceNode(part, previous.id, { ...previous, children } as OoxmlNode);
      } else {
        const children: OoxmlNode[] = Array.from(part.root.children);
        children.push(fresh(authored));
        result = replaceChildren(part, part.root.id, children);
      }
      if (!result.ok) return null;
      part = result.part;
    }
    return withPart(pkg, part);
  }
  const next = withNewPart(pkg, name, parsed.part.root, TYPE);
  if (!next.parts.has(name)) return null;
  const related = withRelationship(next, '/', REL, name.slice(1));
  return related.ok ? related.pkg : null;
}
