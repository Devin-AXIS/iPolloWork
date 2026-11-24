// Remote canonical package publication for collaboration materialization.
//
// A replica installs one already-validated package as one revision. Collaborative undo
// lives in the replication layer, so this path records no legacy history and emits no
// primitive journal — the incoming package is the result of a remote journal, not new
// local intent.
//
// It installs the package VERBATIM, through `installAuthoritativePackageSnapshot`. The shell
// merge the local path performs exists for LOCAL history, where a snapshot can predate a
// numbering or hyperlink write this replica made. A remotely materialized package is the
// opposite case: every replica already agreed on the whole package, `numbering.xml` included,
// so merging this replica's shell back over it would revert the remote list or link change
// here and leave the two replicas permanently different.

import { runObservedStoreTransaction } from '../package/canonical-primitive-capture.ts';
import { validatePackageInvariants } from '../package/package-edit.ts';
import type { OoxmlExternalTarget, OoxmlPackage } from '../package/ooxml-package.ts';
import { canonicalTreeDifference } from '../package/ooxml-serialize.ts';
import {
  ooxmlTreesEqual,
  validateOoxmlPart,
  validateOoxmlPartDelta,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { RelationshipRecord } from '../package/relationships.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import type { ImpactClass, TreeOpRejection } from './tree-ops.ts';
import type { TreeModelChange } from './tree-store.ts';

/** Attribution stamped on one remote canonical publication. */
export interface RemotePackageAttribution {
  readonly origin: string;
  readonly actorId?: string;
  readonly operationId?: string;
}

/** Host surface required to install one remote package without private store access. */
export interface RemotePackagePublishHost {
  readonly packageRevision: number;
  currentPackage(): OoxmlPackage;
  installAuthoritativePackageSnapshot(snapshot: OoxmlPackage): void;
  publishStoryWrite(change: TreeModelChange | null): TreeModelChange | null;
  bodyStore(): { readonly part: { readonly name: string } };
}

type RemotePublishResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: TreeOpRejection; readonly detail?: string };

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) return true;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function stringMapsEqual(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function relationshipEqual(left: RelationshipRecord, right: RelationshipRecord): boolean {
  return (
    left === right ||
    (left.ownerPart === right.ownerPart &&
      left.id === right.id &&
      left.type === right.type &&
      left.rawTarget === right.rawTarget &&
      left.targetMode === right.targetMode &&
      left.order === right.order)
  );
}

function relationshipsEqual(
  left: ReadonlyMap<string, readonly RelationshipRecord[]>,
  right: ReadonlyMap<string, readonly RelationshipRecord[]>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [owner, records] of left) {
    const other = right.get(owner);
    if (!other || other.length !== records.length) return false;
    if (
      other !== records &&
      records.some((record, index) => !relationshipEqual(record, other[index]!))
    ) {
      return false;
    }
  }
  return true;
}

function externalTargetsEqual(
  left: readonly OoxmlExternalTarget[],
  right: readonly OoxmlExternalTarget[]
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry === other ||
      (entry.ownerPart === other.ownerPart &&
        entry.id === other.id &&
        entry.type === other.type &&
        entry.rawTarget === other.rawTarget &&
        entry.sinkSafe === other.sinkSafe)
    );
  });
}

function partBytesEqual(
  left: ReadonlyMap<string, Uint8Array>,
  right: ReadonlyMap<string, Uint8Array>
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [name, bytes] of left) {
    const other = right.get(name);
    if (!other || !bytesEqual(bytes, other)) return false;
  }
  return true;
}

function contentTypesEqual(left: OoxmlPackage, right: OoxmlPackage): boolean {
  return (
    left.contentTypes === right.contentTypes ||
    (stringMapsEqual(left.contentTypes.defaults, right.contentTypes.defaults) &&
      stringMapsEqual(left.contentTypes.overrides, right.contentTypes.overrides))
  );
}

/**
 * What one incoming package changes relative to the installed one.
 *
 * `equal` decides whether to install at all. The rest decides what to TELL the engine the
 * revision changed, which is the difference between re-breaking one paragraph and
 * invalidating the document.
 */
export interface RemotePackageDelta {
  readonly equal: boolean;
  readonly dirty: readonly string[];
  readonly dependencyKeys: readonly string[];
  readonly impact: ImpactClass;
}

const EQUAL_DELTA: RemotePackageDelta = Object.freeze({
  equal: true,
  dirty: Object.freeze([]),
  dependencyKeys: Object.freeze([]),
  impact: 'global',
});

const WHOLESALE_DELTA: RemotePackageDelta = Object.freeze({
  equal: false,
  dirty: Object.freeze([]),
  dependencyKeys: Object.freeze([]),
  impact: 'global',
});

function wholesaleVerdict(changed: readonly [OoxmlPart, OoxmlPart][]): RemotePackageDelta {
  for (const [part, other] of changed) {
    if (!ooxmlTreesEqual(part, other)) return WHOLESALE_DELTA;
    // Equal content under other ids still installs: a collaboration journal names the nodes
    // the next edit touches by these ids.
    if (!canonicalTreeDifference(other.root, part.root).idsPreserved) return WHOLESALE_DELTA;
  }
  return EQUAL_DELTA;
}

/**
 * Compare an incoming package with the installed one and classify the difference.
 *
 * A replica receives a package that shares every object it did not change, so the parts and
 * the subtrees that moved are found by identity and everything else costs nothing. Only the
 * main document part can narrow the verdict: a difference anywhere else — bytes,
 * relationships, content types, a furniture or notes part — is reported wholesale, because
 * proving which pages a style or numbering change reaches is not this function's job.
 */
export function remotePackageDelta(next: OoxmlPackage, current: OoxmlPackage): RemotePackageDelta {
  if (next === current) return EQUAL_DELTA;
  if (
    next.mainDocumentPart !== current.mainDocumentPart ||
    next.parts.size !== current.parts.size ||
    !partBytesEqual(next.partBytes, current.partBytes) ||
    !relationshipsEqual(next.relationships, current.relationships) ||
    !externalTargetsEqual(next.externalTargets, current.externalTargets) ||
    !contentTypesEqual(next, current)
  ) {
    return WHOLESALE_DELTA;
  }
  const changed: [OoxmlPart, OoxmlPart][] = [];
  for (const [name, part] of next.parts) {
    const other = current.parts.get(name);
    if (!other) return WHOLESALE_DELTA;
    if (part !== other) changed.push([part, other]);
  }
  if (changed.length === 0) return EQUAL_DELTA;
  const [part, other] = changed[0]!;
  if (changed.length > 1 || part.name !== next.mainDocumentPart) {
    return wholesaleVerdict(changed);
  }
  const difference = canonicalTreeDifference(other.root, part.root);
  if (difference.undecided) return wholesaleVerdict(changed);
  if (difference.equal && difference.idsPreserved) return EQUAL_DELTA;
  // Equal content under other ids still installs: the ids are how a collaboration journal
  // names the nodes the next edit touches. Only the renamed paragraphs need new layout.
  if (difference.equal) {
    if (difference.renamedOutsideParagraphs || difference.renamedParagraphIds.length === 0) {
      return WHOLESALE_DELTA;
    }
    return {
      equal: false,
      dirty: difference.renamedParagraphIds,
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      impact: 'text-local',
    };
  }
  // A narrowed impact tells layout it may keep what it has for every paragraph outside
  // `dirty`. That is only true when the paragraphs still exist under the same ids and no
  // block moved, so anything else falls back to the wholesale answer.
  if (
    !difference.idsPreserved ||
    difference.reach === 'outside-paragraph' ||
    difference.paragraphIds.length === 0
  ) {
    return WHOLESALE_DELTA;
  }
  return {
    equal: false,
    dirty: difference.paragraphIds,
    dependencyKeys: [DEPENDENCY_KEY_IDS.story],
    impact: difference.reach === 'paragraph-text' ? 'text-local' : 'flow-structural',
  };
}

/** True when identity or the canonical equality oracle says the packages match. */
export function remotePackagesAreEquivalent(left: OoxmlPackage, right: OoxmlPackage): boolean {
  return remotePackageDelta(left, right).equal;
}

function reject(detail: string): RemotePublishResult {
  return { ok: false, reason: 'package-invariant', detail };
}

/**
 * Validate every modeled part and the package invariants. Does not install.
 *
 * `installed` is the package this replica already holds, and every part of it has already
 * been proven valid — a remote install validates before it installs, a local commit
 * validates in `TreeDocumentStore`, and the first package is validated on open. So a part
 * that arrives as the SAME OBJECT needs nothing, and a part that arrives changed is proven
 * against its own predecessor, which re-proves every node the edit could have touched and
 * skips the object-identical subtrees it could not. Omitting `installed` validates in full,
 * which is what a first install and a resync do.
 *
 * The saving comes from not re-proving unchanged nodes, never from proving less about
 * changed ones: `validateOoxmlPartDelta` runs the identical rules on every node it visits.
 * Its one narrowing is that an id duplicated ACROSS a pruned and a rebuilt subtree is not
 * observed. That case cannot be constructed by a peer here, hostile or not: the ids of a
 * remotely materialized part are the keys of one shared map, and the materializer refuses
 * to place a key twice in one pass.
 */
export function validateRemoteCanonicalPackage(
  pkg: OoxmlPackage,
  installed?: OoxmlPackage
): RemotePublishResult | null {
  if (!pkg.parts.get(pkg.mainDocumentPart)) {
    return reject('no-main-document');
  }
  for (const [name, part] of pkg.parts) {
    const previous = installed?.parts.get(name);
    if (previous === part) continue;
    const result = previous ? validateOoxmlPartDelta(previous, part) : validateOoxmlPart(part);
    if (!result.ok) {
      return reject(`invalid-part:${name}:${result.issues[0]?.code ?? 'invalid'}`);
    }
  }
  const invariants = validatePackageInvariants(pkg);
  if (!invariants.ok) {
    return reject(invariants.issues[0]?.code ?? 'package-invariant');
  }
  return null;
}

/**
 * Install one remotely materialized package as one canonical revision.
 *
 * A package that says the same thing as the installed one publishes nothing. That guard is
 * load-bearing rather than an optimization: the engine's layout, line-breaking and story
 * caches are keyed on object identity, so installing a content-equal package would bump the
 * revision, miss every cache, and re-render a document that did not change.
 *
 * The published change describes the difference, not the package. A remote keystroke
 * reaches the engine as the same `text-local` commit over the same paragraph id that the
 * author's own keystroke published, so no consumer can tell the two apart. `global` remains
 * the answer whenever the difference is genuinely wholesale — a seed, a resync, a
 * membership change, or anything outside the main document part.
 *
 * Capture runs so nested package hooks cannot leak a journal; the commit predicate stays
 * false.
 */
export function publishRemoteCanonicalPackage(
  store: object & RemotePackagePublishHost,
  pkg: OoxmlPackage,
  attribution: RemotePackageAttribution
): RemotePublishResult {
  const current = store.currentPackage();
  const delta = remotePackageDelta(pkg, current);
  if (delta.equal) {
    return { ok: true, change: null };
  }
  const rejection = validateRemoteCanonicalPackage(pkg, current);
  if (rejection) return rejection;
  const bodyPartName = store.bodyStore().part.name;
  // The narrowed dirty set names paragraphs of the main document part. A body store that is
  // not that part means the ids would address the wrong story.
  const narrowed = delta.impact !== 'global' && pkg.mainDocumentPart === bodyPartName;
  return runObservedStoreTransaction(
    store,
    () => {
      const fromRevision = store.packageRevision;
      store.installAuthoritativePackageSnapshot(pkg);
      const change = store.publishStoryWrite({
        change: 'model-change',
        fromRevision,
        toRevision: fromRevision + 1,
        commitId: `pkg-remote-${fromRevision + 1}`,
        origin: attribution.origin,
        ...(attribution.actorId ? { actorId: attribution.actorId } : {}),
        ...(attribution.operationId ? { operationId: attribution.operationId } : {}),
        dirty: narrowed ? delta.dirty : [],
        created: [],
        deleted: [],
        splitJoin: [],
        dependencyKeys: narrowed ? delta.dependencyKeys : [],
        impact: narrowed ? delta.impact : 'global',
        story: { kind: 'body', partName: bodyPartName },
      });
      return { ok: true as const, change };
    },
    () => false
  );
}
