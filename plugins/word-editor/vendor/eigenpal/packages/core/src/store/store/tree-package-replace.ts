import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import type { TreePackageStore } from './tree-package-store.ts';
import type { TreeModelChange } from './tree-store.ts';

/** Why a whole-package replacement was refused. */
export type PackageReplacementRefusal = 'missing-main-part' | 'different-main-part';

export type PackageReplacementResult =
  | { readonly ok: true; readonly change: TreeModelChange | null }
  | { readonly ok: false; readonly reason: PackageReplacementRefusal };

let replacementSeq = 0;

/**
 * Replace the whole package with one this replica derived from it, as ONE package undo unit.
 *
 * For writes that rebuild many parts at once, such as a document compare. The package installs
 * verbatim: it was derived from the current package, so no live shell resource needs merging
 * back. Undo restores the package this replaced in one step, and redo installs it again. The
 * change publishes with `global` impact, because every story may have moved.
 */
export function replaceWholePackage(
  store: TreePackageStore,
  next: OoxmlPackage
): PackageReplacementResult {
  const before = store.currentPackage();
  if (next === before) return { ok: true, change: null };
  if (!next.parts.has(next.mainDocumentPart)) return { ok: false, reason: 'missing-main-part' };
  if (next.mainDocumentPart !== before.mainDocumentPart)
    return { ok: false, reason: 'different-main-part' };
  const fromRevision = store.packageRevision;
  store.installAuthoritativePackageSnapshot(next);
  store.adoptPackageUnit(before);
  replacementSeq += 1;
  const change = store.publishStoryWrite({
    change: 'model-change',
    fromRevision,
    toRevision: fromRevision + 1,
    commitId: `pkg-replace-${replacementSeq}`,
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
}
