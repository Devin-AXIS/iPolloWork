// Authored relationship records (document-engine task 2.6). Each record retains
// owner part, authored id, type, raw target lexical form, target mode, and
// significant order — nothing is materialized away. Internal targets resolve via
// the owner-relative profile; external targets are retained verbatim and never
// owner-resolved or fetched. Duplicate relationship ids within one owner fail
// closed.

import { resolveInternalTarget, validateExternalTarget, type NameResult } from './opc-names.ts';

/** OOXML image relationship type for embedded or linked media parts. */
export const IMAGE_RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/**
 * Whether a relationship points inside the package or out of it.
 *
 * The security-relevant distinction: an `External` target is retained VERBATIM and never
 * owner-resolved or fetched, because auto-loading a file-supplied remote target is a zero-click
 * external fetch.
 */
export type TargetMode = 'Internal' | 'External';

/**
 * One authored relationship, with nothing materialized away: owner part, id, type, raw target
 * lexical form, mode, and position.
 */
export interface RelationshipRecord {
  readonly ownerPart: string; // canonical part name of the source part
  readonly id: string; // authored r:id, e.g. "rId1"
  readonly type: string; // relationship type URI
  readonly rawTarget: string; // authored lexical target, retained verbatim
  readonly targetMode: TargetMode;
  readonly order: number; // significant order within the owner's rels
}

/** Why a relationship set is invalid. Duplicate ids within one owner fail closed. */
export type RelationshipError = {
  readonly code: 'duplicate-id';
  readonly ownerPart: string;
  readonly id: string;
};

/** The validated relationship set, or the conflict that rejected it. */
export type RelationshipSetResult =
  | { readonly ok: true; readonly byOwner: ReadonlyMap<string, readonly RelationshipRecord[]> }
  | { readonly ok: false; readonly error: RelationshipError };

/** Group relationships by owner in authored order; reject duplicate ids per owner. */
export function buildRelationshipSet(
  records: readonly RelationshipRecord[]
): RelationshipSetResult {
  const byOwner = new Map<string, RelationshipRecord[]>();
  const idsByOwner = new Map<string, Set<string>>();
  for (const rec of [...records].sort((a, b) => a.order - b.order)) {
    const ids = idsByOwner.get(rec.ownerPart) ?? new Set<string>();
    if (ids.has(rec.id)) {
      return { ok: false, error: { code: 'duplicate-id', ownerPart: rec.ownerPart, id: rec.id } };
    }
    ids.add(rec.id);
    idsByOwner.set(rec.ownerPart, ids);
    const list = byOwner.get(rec.ownerPart) ?? [];
    list.push(rec);
    byOwner.set(rec.ownerPart, list);
  }
  return { ok: true, byOwner };
}

/**
 * A relationship resolved to a part, or the reason it could not be.
 *
 * External targets resolve to a refusal by design: they are never followed from a file.
 */
export type ResolvedRelationship =
  | { readonly mode: 'Internal'; readonly target: NameResult; readonly raw: string }
  | { readonly mode: 'External'; readonly sinkSafe: NameResult; readonly raw: string };

/**
 * Resolve a relationship to a runtime projection while the raw target stays
 * authored. Internal -> owner-relative part name; External -> sink-safe
 * validation only (never owner-resolved, never fetched). `raw` is always the
 * verbatim authored target.
 */
export function resolveRelationship(rec: RelationshipRecord): ResolvedRelationship {
  if (rec.targetMode === 'External') {
    return {
      mode: 'External',
      sinkSafe: validateExternalTarget(rec.rawTarget),
      raw: rec.rawTarget,
    };
  }
  return {
    mode: 'Internal',
    target: resolveInternalTarget(rec.ownerPart, rec.rawTarget),
    raw: rec.rawTarget,
  };
}

/**
 * An image relationship resolved to package bytes, or why it was refused.
 *
 * External-mode image rels are refused rather than fetched — the no-zero-click-external-fetch
 * rule applies to images exactly as it does to links.
 */
export type ImageRelationshipResolution =
  | { readonly mode: 'internal'; readonly partName: string; readonly raw: string }
  | { readonly mode: 'external'; readonly sinkSafe: boolean; readonly raw: string }
  | { readonly mode: 'missing' };

/**
 * Resolve an image relationship id from an owner part. Internal targets resolve
 * owner-relative; external targets are never fetched; a missing id is `missing`.
 */
export function resolveImageRelationship(
  records: readonly RelationshipRecord[] | undefined,
  ownerPart: string,
  relationshipId: string
): ImageRelationshipResolution {
  if (!records) return { mode: 'missing' };
  for (const record of records) {
    if (record.ownerPart !== ownerPart) continue;
    if (record.id !== relationshipId) continue;
    if (record.type !== IMAGE_RELATIONSHIP_TYPE) return { mode: 'missing' };
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'External') {
      return { mode: 'external', sinkSafe: resolved.sinkSafe.ok, raw: resolved.raw };
    }
    if (!resolved.target.ok) return { mode: 'missing' };
    return { mode: 'internal', partName: resolved.target.partName, raw: resolved.raw };
  }
  return { mode: 'missing' };
}
