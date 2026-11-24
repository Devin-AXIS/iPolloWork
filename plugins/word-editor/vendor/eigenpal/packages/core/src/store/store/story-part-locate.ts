// Header/footer story-part resolution: relationship id -> the hdr/ftr part it names.
//
// Extracted from tree-package-store so the store facade stays under its line budget. The
// checks are the trust boundary's: only the header/footer relationship types resolve, an
// external target refuses, and the target part must actually root a `w:hdr`/`w:ftr`.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveRelationship, type RelationshipRecord } from '../package/relationships.ts';
import type { StoryTargetRejection } from './tree-package-store.ts';

export const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
export const FOOTER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

export function locateHeaderFooterPart(
  pkg: OoxmlPackage,
  rId: string
):
  | { readonly ok: true; readonly partName: string; readonly part: OoxmlPart }
  | { readonly ok: false; readonly reason: StoryTargetRejection; readonly detail?: string } {
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  const record = relationships.find((rel) => rel.id === rId);
  if (!record) {
    return { ok: false, reason: 'dangling-relationship', detail: rId };
  }
  if (record.type !== HEADER_REL_TYPE && record.type !== FOOTER_REL_TYPE) {
    return { ok: false, reason: 'wrong-relationship-type', detail: record.type };
  }
  return resolveInternalStoryPart(pkg, record);
}

export function resolveInternalStoryPart(
  pkg: OoxmlPackage,
  record: RelationshipRecord
):
  | { readonly ok: true; readonly partName: string; readonly part: OoxmlPart }
  | { readonly ok: false; readonly reason: StoryTargetRejection; readonly detail?: string } {
  const resolved = resolveRelationship(record);
  if (resolved.mode === 'External') {
    return { ok: false, reason: 'external-relationship', detail: record.id };
  }
  if (!resolved.target.ok) {
    return {
      ok: false,
      reason: 'bad-relationship-target',
      detail: resolved.target.reason,
    };
  }
  const part = pkg.parts.get(resolved.target.partName);
  if (!part) {
    return { ok: false, reason: 'missing-part', detail: resolved.target.partName };
  }
  const rootName = part.root.localName;
  if (rootName !== 'hdr' && rootName !== 'ftr') {
    return { ok: false, reason: 'not-a-story-part', detail: rootName || part.name };
  }
  return { ok: true, partName: part.name, part };
}
