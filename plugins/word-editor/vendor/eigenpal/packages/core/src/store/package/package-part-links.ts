// Relationship lookups shared by the resolvers of parts a drawing renders from (diagram and
// chart parts). Only parsed internal parts resolve; external targets never load.

import { RELATIONSHIPS_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement } from './ooxml-tree.ts';
import { resolveRelationship } from './relationships.ts';

/** The root of the internal part `relationshipId` of `ownerPartName` names, if it has that type. */
export function internalPartRoot(
  pkg: OoxmlPackage,
  ownerPartName: string,
  relationshipId: string,
  relationshipType: string
): { readonly root: OoxmlElement; readonly partName: string } | null {
  for (const record of pkg.relationships.get(ownerPartName) ?? []) {
    if (record.id !== relationshipId) continue;
    if (record.type !== relationshipType || record.targetMode !== 'Internal') return null;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return null;
    const part = pkg.parts.get(resolved.target.partName);
    return part ? { root: part.root, partName: resolved.target.partName } : null;
  }
  return null;
}

/** An `r:`-namespaced attribute of `element`. */
export function relationshipAttribute(
  element: OoxmlElement,
  localName: string
): string | undefined {
  for (const attribute of element.attributes) {
    if (attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI && attribute.localName === localName)
      return attribute.value;
  }
  return undefined;
}
