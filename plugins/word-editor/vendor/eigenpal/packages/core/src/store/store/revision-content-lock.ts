// Which revision decisions a content lock lets through.
//
// A content lock protects what a control holds. A decision that keeps that content as it reads
// (accepting an insertion or a property change, rejecting a deletion) changes nothing the lock
// protects, so it goes through. A decision that removes content or restores old formatting meets
// the lock and the change stays pending, in a single decision and in Accept All or Reject All.

import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import { contentControlsIn } from '../package/content-control-nodes.ts';
import { declaredLockOf, isBoundContentControl } from './tree-op-nodes.ts';
import {
  contentControlBindingRefusal,
  contentControlLockRefusal,
} from './tree-op-content-controls.ts';
import type { RevisionOpAction } from './tree-op-revisions.ts';
import type { RevisionAddress, TreeDocOp } from './tree-op-types.ts';
import { REVISION_LOCAL_NAMES } from './revision-container-presence.ts';

/** Whether deciding this revision removes the content its wrapper holds. */
export function revisionNodeRemovesContent(node: OoxmlNode, action: RevisionOpAction): boolean {
  if (node.kind === 'textValue') return false;
  if (node.localName === 'ins' || node.localName === 'moveTo') return action === 'reject';
  if (node.localName === 'del' || node.localName === 'moveFrom') return action === 'accept';
  return false;
}

/** Whether deciding this revision leaves the content and its formatting as they read. */
export function revisionDecisionKeepsContent(node: OoxmlNode, action: RevisionOpAction): boolean {
  if (node.kind === 'textValue' || node.namespaceUri !== WML_NAMESPACE_URI) return false;
  const name = node.localName;
  if (action === 'reject') return name === 'del' || name === 'moveFrom';
  return name === 'ins' || name === 'moveTo' || name.endsWith('PrChange');
}

/**
 * Whether the part holds a control a lock or a data binding guards, so that a decision there may
 * meet the guard. Most documents hold none, and the planner then asks nothing.
 */
export function holdsGuardedControls(part: OoxmlPart): boolean {
  return guardedControlIds(part).size > 0;
}

/** The content controls a lock or a data binding guards, by node id. */
export function guardedControlIds(part: OoxmlPart): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const { node } of contentControlsIn(part.root)) {
    const lock = declaredLockOf(node);
    if (lock.wrapper || lock.content || isBoundContentControl(node)) ids.add(node.id);
  }
  return ids;
}

/**
 * What keeps a decision on these sites from applying, a lock or a data binding, or null: the
 * same question the op's own guard answers, so a plan never holds a decision the op refuses.
 */
export function guardKeepsRevisions(
  part: OoxmlPart,
  siteNodeIds: readonly string[],
  action: RevisionOpAction
): 'locked-content' | 'bound-content' | null {
  const op = action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions';
  return guardKeepsOps(part, [{ op, siteNodeIds } as TreeDocOp]);
}

/** What keeps any of these ops from applying, a lock or a data binding, or null. */
export function guardKeepsOps(
  part: OoxmlPart,
  ops: readonly TreeDocOp[]
): 'locked-content' | 'bound-content' | null {
  for (const op of ops) {
    if (contentControlLockRefusal(part, op)) return 'locked-content';
    if (contentControlBindingRefusal(part, op)) return 'bound-content';
  }
  return null;
}

/** Whether a node is a revision the op names: by site, by element, and by address. */
export function isRevisionNode(
  node: OoxmlNode,
  revision: RevisionAddress | undefined,
  localName?: string,
  siteNodeIds?: ReadonlySet<string>
): boolean {
  if (node.kind === 'textValue') return false;
  if (siteNodeIds !== undefined && !siteNodeIds.has(node.id)) return false;
  if (node.namespaceUri !== WML_NAMESPACE_URI) return false;
  if (!REVISION_LOCAL_NAMES.has(node.localName)) return false;
  if (localName !== undefined && node.localName !== localName) return false;
  if (!revision) return true;
  const attribute = (name: string): string | undefined =>
    node.attributes.find(
      (entry) => entry.localName === name && entry.namespaceUri === WML_NAMESPACE_URI
    )?.value;
  if (attribute('id') !== revision.id) return false;
  if (
    (attribute('author') ?? (node.localName === 'tblGridChange' ? '' : undefined)) !==
    revision.author
  )
    return false;
  if (revision.date !== undefined && attribute('date') !== revision.date) return false;
  return true;
}
