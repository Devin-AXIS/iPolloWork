// Apply a complete updated package as ONE undoable edit that replicates.
//
// A whole-package replacement (`tree-package-replace.ts`) installs a package and records
// nothing a peer can replay. This write first aligns the incoming package's node ids to the
// open package (`package-update-align.ts`), then records the difference as ordinary journal
// effects: text splices and child splices inside the parts both packages hold, whole new parts,
// removed parts, relationships, content types, and binary parts. A collaboration session
// publishes that journal like any other edit, and its undo takes back this participant's
// update alone.
//
// Locally the aligned package installs verbatim as one package undo unit: undo restores the
// package this replaced, redo installs it again, and earlier history stays below it.

import { captureAlignedSubtree, captureXmlPartRoot } from '../package/canonical-primitive-lower.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  recordDeleteBinary,
  recordDeleteRelationship,
  recordDeleteXmlPart,
  recordPutBinary,
  recordPutContentTypeOverride,
  recordPutRelationship,
  runObservedStoreTransaction,
  runWithoutJournalCapture,
} from '../package/canonical-primitive-capture.ts';
import { resolveContentType } from '../package/content-types.ts';
import { relsPartNameFor, withContentTypeOverrides } from '../package/package-edit.ts';
import { createNodeIdAllocator } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { ooxmlTreesEqual } from '../package/ooxml-serialize.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { partNameKey } from '../package/opc-names.ts';
import { alignPartUpdate } from '../package/package-update-align.ts';
import type { RelationshipRecord } from '../package/relationships.ts';
import { sha256FontBytes as sha256Bytes } from '../package/sha256.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import type { HistoryGroup } from './history-group.ts';
import type { TreePackageStore } from './tree-package-store.ts';
import type { TreeModelChange } from './tree-store.ts';

/** Why an update cannot apply as an edit. The document and its history stay unchanged. */
export type PackageUpdateRefusal =
  'missing-main-part' | 'different-main-part' | 'unaligned' | 'failed';

export type PackageUpdateResult =
  | {
      readonly ok: true;
      /** Null when the update holds what the document already holds: nothing was recorded. */
      readonly change: TreeModelChange | null;
    }
  | { readonly ok: false; readonly reason: PackageUpdateRefusal; readonly detail?: string };

const CONTENT_TYPES_PART = partNameKey('/[Content_Types].xml');
const RELS_SUFFIX = '.rels';

let updateSeq = 0;

const isRelsPart = (name: string): boolean => name.toLowerCase().endsWith(RELS_SUFFIX);

/** `next`'s XML parts, with the ids of `current`'s parts where they describe the same nodes. */
export function alignPackageUpdate(current: OoxmlPackage, next: OoxmlPackage): OoxmlPackage {
  const parts = new Map<string, OoxmlPart>();
  let changed = false;
  for (const [name, part] of next.parts) {
    const previous = current.parts.get(name);
    const aligned = previous
      ? alignPartUpdate(previous, part, createNodeIdAllocator(previous))
      : part;
    if (aligned !== part) changed = true;
    parts.set(name, aligned);
  }
  return changed ? Object.freeze({ ...next, parts }) : next;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameRecord(left: RelationshipRecord, right: RelationshipRecord): boolean {
  return (
    left.type === right.type &&
    left.rawTarget === right.rawTarget &&
    left.targetMode === right.targetMode &&
    left.order === right.order
  );
}

/** Raw entries that are neither a modelled XML part nor the content-types index. */
function binaryEntries(pkg: OoxmlPackage): Map<string, readonly [string, Uint8Array]> {
  const modelled = new Set<string>();
  for (const name of pkg.parts.keys()) modelled.add(partNameKey(name));
  const entries = new Map<string, readonly [string, Uint8Array]>();
  for (const [name, bytes] of pkg.partBytes) {
    const key = partNameKey(name.startsWith('/') ? name : `/${name}`);
    if (key === CONTENT_TYPES_PART || modelled.has(key)) continue;
    entries.set(key, [name, bytes]);
  }
  return entries;
}

function contentTypeIn(pkg: OoxmlPackage, partName: string): string | null {
  const resolved = resolveContentType(pkg.contentTypes, partName);
  return resolved.ok ? resolved.contentType : null;
}

function sameMap<V>(
  left: ReadonlyMap<string, V>,
  right: ReadonlyMap<string, V>,
  same: (a: V, b: V) => boolean
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    const other = right.get(key);
    if (other === undefined || !same(value, other)) return false;
  }
  return true;
}

/** Whether an aligned update holds exactly what the document holds. */
const sameRecords = (a: readonly RelationshipRecord[], b: readonly RelationshipRecord[]) =>
  a.length === b.length &&
  a.every((record, index) => {
    const other = b[index]!;
    return record.id === other.id && sameRecord(record, other);
  });

/**
 * Whether `landed` holds what `incoming` says: every XML part (ignoring node ids), every
 * relationship, and every binary. Content types are left out, because an author records
 * forced overrides for new binaries that the incoming package may type by a default.
 *
 * A collaboration session that refuses an update realigns the replica to shared state, so a
 * mismatch after publishing means the update did not land.
 */
export function packageUpdateLanded(landed: OoxmlPackage, incoming: OoxmlPackage): boolean {
  return (
    sameMap(landed.parts, incoming.parts, (a, b) => ooxmlTreesEqual(a, b)) &&
    sameMap(landed.relationships, incoming.relationships, sameRecords) &&
    sameMap(binaryEntries(landed), binaryEntries(incoming), (a, b) => sameBytes(a[1], b[1]))
  );
}

function samePackage(current: OoxmlPackage, next: OoxmlPackage): boolean {
  const records = sameRecords;
  return (
    sameMap(current.parts, next.parts, (a, b) => a === b) &&
    sameMap(current.relationships, next.relationships, records) &&
    sameMap(binaryEntries(current), binaryEntries(next), (a, b) => sameBytes(a[1], b[1])) &&
    sameMap(current.contentTypes.defaults, next.contentTypes.defaults, (a, b) => a === b) &&
    sameMap(current.contentTypes.overrides, next.contentTypes.overrides, (a, b) => a === b)
  );
}

/**
 * Record every effect that turns `current` into `next`, in an order a replica can apply:
 * binaries and new parts before the relationships that name them, removals last.
 */
function recordPackageDifference(
  current: OoxmlPackage,
  next: OoxmlPackage
): (readonly [string, string])[] {
  const currentBinaries = binaryEntries(current);
  const nextBinaries = binaryEntries(next);
  const putBinaries: (readonly [string, string])[] = [];
  for (const [key, [name, bytes]] of nextBinaries) {
    const previous = currentBinaries.get(key);
    if (previous && sameBytes(previous[1], bytes)) continue;
    const mediaType = contentTypeIn(next, key) ?? 'application/octet-stream';
    putBinaries.push([name.startsWith('/') ? name : `/${name}`, mediaType]);
    recordPutBinary({
      storageKey: name,
      digest: sha256Bytes(bytes),
      size: bytes.byteLength,
      mediaType,
    });
  }

  for (const [name, part] of next.parts) {
    const previous = current.parts.get(name);
    if (!previous) {
      captureXmlPartRoot(part);
      continue;
    }
    if (isRelsPart(name)) continue;
    captureAlignedSubtree(previous.root, part.root);
  }

  const owners = new Set<string>([...current.relationships.keys(), ...next.relationships.keys()]);
  for (const owner of owners) {
    // A removed owner takes its relationships with it.
    if (owner !== '/' && !next.parts.has(owner) && !nextBinaries.has(partNameKey(owner))) continue;
    const before = new Map((current.relationships.get(owner) ?? []).map((r) => [r.id, r]));
    const after = next.relationships.get(owner) ?? [];
    for (const record of after) {
      const previous = before.get(record.id);
      if (!previous || !sameRecord(previous, record)) recordPutRelationship(owner, record);
    }
    const kept = new Set(after.map((record) => record.id));
    for (const id of before.keys()) if (!kept.has(id)) recordDeleteRelationship(owner, id);
  }

  // Overrides a replica needs to resolve every part as `next` does. A replica builds content
  // types from recorded overrides only, so a part typed by a new Default gets an override.
  const names = [...next.parts.keys(), ...[...nextBinaries.keys()]];
  for (const name of names) {
    const wanted = contentTypeIn(next, name);
    if (wanted === null) continue;
    const key = partNameKey(name);
    const override = next.contentTypes.overrides.get(key);
    const replica = current.contentTypes.overrides.get(key);
    if (override !== undefined) {
      if (replica !== override) recordPutContentTypeOverride(name, override);
      continue;
    }
    const fallback = resolveContentType(
      { defaults: current.contentTypes.defaults, overrides: new Map() },
      name
    );
    if (replica !== undefined || !fallback.ok || fallback.contentType !== wanted)
      recordPutContentTypeOverride(name, wanted);
  }

  // A removed owner takes its `.rels` part with it. A `.rels` part removed while its owner
  // stays is deleted on its own, or a replica keeps it as an empty relationships part.
  const removedOwnerRels = new Set<string>();
  for (const name of current.parts.keys())
    if (!next.parts.has(name)) removedOwnerRels.add(relsPartNameFor(name).toLowerCase());
  for (const [key, [name]] of currentBinaries)
    if (!nextBinaries.has(key))
      removedOwnerRels.add(relsPartNameFor(name.startsWith('/') ? name : `/${name}`).toLowerCase());
  for (const name of current.parts.keys()) {
    if (next.parts.has(name)) continue;
    if (!isRelsPart(name) || !removedOwnerRels.has(name.toLowerCase())) recordDeleteXmlPart(name);
  }
  for (const [key, [name]] of currentBinaries) {
    if (!nextBinaries.has(key)) recordDeleteBinary(name);
  }
  return putBinaries;
}

/**
 * Install `incoming` (read and normalized as an open would) as one undoable edit.
 *
 * Refuses, with nothing changed, when the update names a different main document part or
 * cannot be expressed as an edit of the open package.
 */
export function applyPackageUpdate(
  store: TreePackageStore,
  incoming: OoxmlPackage,
  historyGroup: HistoryGroup = Symbol('document-update')
): PackageUpdateResult {
  const before = store.currentPackage();
  if (!incoming.parts.has(incoming.mainDocumentPart))
    return { ok: false, reason: 'missing-main-part' };
  if (incoming.mainDocumentPart !== before.mainDocumentPart)
    return { ok: false, reason: 'different-main-part' };
  let next: OoxmlPackage;
  try {
    next = alignPackageUpdate(before, incoming);
  } catch (error) {
    return { ok: false, reason: 'failed', detail: String(error) };
  }
  if (next === before || samePackage(before, next)) return { ok: true, change: null };
  return runObservedStoreTransaction(
    store,
    (): PackageUpdateResult => {
      if (isCanonicalPrimitiveCaptureActive()) {
        let putBinaries: (readonly [string, string])[];
        try {
          putBinaries = recordPackageDifference(before, next);
        } catch (error) {
          return { ok: false, reason: 'unaligned', detail: String(error) };
        }
        // A replica types each binary it receives with an explicit Override, as an image
        // insert does; the author takes the same Override so both save the same index.
        if (putBinaries.length > 0)
          next = runWithoutJournalCapture(() => withContentTypeOverrides(next, putBinaries));
      }
      const fromRevision = store.packageRevision;
      runWithoutJournalCapture(() => store.installAuthoritativePackageSnapshot(next));
      store.adoptGroupedPackageUnit(before, historyGroup);
      updateSeq += 1;
      const change = store.publishStoryWrite({
        change: 'model-change',
        fromRevision,
        toRevision: fromRevision + 1,
        commitId: `pkg-update-${updateSeq}`,
        origin: ORIGIN_IDS.mutationHuman,
        dirty: [],
        created: [],
        deleted: [],
        splitJoin: [],
        dependencyKeys: [],
        impact: 'global',
        story: { kind: 'body', partName: store.bodyStore().part.name },
      });
      return { ok: true, change };
    },
    (result) => result.ok && result.change !== null,
    historyGroup
  );
}
