import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlPart } from './ooxml-tree.ts';
import { canRemoveContentTypeOverrides, isXmlWhitespace } from './content-type-removal.ts';
import { partNameKey, resolveInternalTarget } from './opc-names.ts';
import { relsPartNameFor, resolveContentTypeOf, withoutPart } from './package-edit.ts';

const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const KINDS = [
  {
    type: 'application/vnd.openxmlformats-package.core-properties+xml',
    namespace: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
    root: 'coreProperties',
    relationship: `${PACKAGE_REL}/metadata/core-properties`,
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
    namespace: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
    root: 'Properties',
    relationship: `${OFFICE_REL}/extended-properties`,
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.custom-properties+xml',
    namespace: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
    root: 'Properties',
    relationship: `${OFFICE_REL}/custom-properties`,
  },
] as const;

/** Remove only recognized property parts. Any ambiguous dependency refuses the whole operation. */
export function withoutDocumentProperties(pkg: OoxmlPackage): OoxmlPackage | null {
  const selected = new Map<string, { part: OoxmlPart; relationship: string }>();
  for (const kind of KINDS) {
    const matches = [...new Set([...pkg.parts.keys(), ...pkg.partBytes.keys()])].filter(
      (name) => resolveContentTypeOf(pkg, name) === kind.type
    );
    if (matches.length > 1) return null;
    const related = (pkg.relationships.get('/') ?? []).filter((r) => r.type === kind.relationship);
    if (related.length > 1) return null;
    const relation = related[0];
    if (relation) {
      if (relation.targetMode !== 'Internal') return null;
      const target = resolveInternalTarget('/', relation.rawTarget);
      if (
        !target.ok ||
        matches.length !== 1 ||
        partNameKey(target.partName) !== partNameKey(matches[0]!)
      )
        return null;
    }
    if (matches.length === 0) continue;
    const part = pkg.parts.get(matches[0]!);
    if (!part || part.root.namespaceUri !== kind.namespace || part.root.localName !== kind.root)
      return null;
    // Standard property parts own no relationships. Do not remove unknown dependent content.
    if (
      (pkg.relationships.get(part.name)?.length ?? 0) > 0 ||
      pkg.parts.has(relsPartNameFor(part.name)) ||
      pkg.partBytes.has(relsPartNameFor(part.name))
    )
      return null;
    selected.set(partNameKey(part.name), { part, relationship: kind.relationship });
  }
  if (selected.size === 0) return pkg;
  if (!canRemoveContentTypeOverrides(pkg, new Set(selected.keys()))) return null;

  for (const [owner, records] of pkg.relationships) {
    for (const record of records) {
      if (record.targetMode === 'External') continue;
      const target = resolveInternalTarget(owner, record.rawTarget);
      const chosen = target.ok && selected.get(partNameKey(target.partName));
      if (!chosen) continue;
      if (owner !== '/' || record.type !== chosen.relationship) return null;
      const relationships = pkg.parts.get(relsPartNameFor(owner));
      if (
        !relationships ||
        relationships.root.namespaceUri !== PACKAGE_REL ||
        relationships.root.localName !== 'Relationships'
      )
        return null;
      // withoutPart removes relationship elements by ID; duplicate or extended records must refuse.
      const matching = relationships.root.children.filter(
        (node) =>
          node.kind !== 'textValue' &&
          node.attributes.some(
            (a) => a.namespaceUri === '' && a.localName === 'Id' && a.value === record.id
          )
      );
      if (matching.length !== 1) return null;
      const node = matching[0]!;
      if (
        node.kind === 'textValue' ||
        node.namespaceUri !== PACKAGE_REL ||
        node.localName !== 'Relationship' ||
        node.attributes.some(
          (a) =>
            a.namespaceUri !== '' || !['Id', 'Type', 'Target', 'TargetMode'].includes(a.localName)
        ) ||
        node.children.some((child) => child.kind !== 'textValue' || !isXmlWhitespace(child.value))
      )
        return null;
    }
  }
  let next = pkg;
  for (const { part } of selected.values()) {
    const removed = withoutPart(next, part.name);
    if (!removed.ok || removed.pkg.contentTypes.overrides.has(partNameKey(part.name))) return null;
    next = removed.pkg;
  }
  return next;
}
