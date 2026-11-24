// One decision on a text revision nested with other pending text revisions.
//
// A strike over another author's inserted words sits inside their insertion, and a third
// author's strike can sit beside it. Each author decides their own change: accepting the
// insertion leaves the strikes pending, and rejecting one strike leaves the others. The batch
// planner groups every revision that nests with another, so a single decision on one of them
// would otherwise refuse as an incomplete group.
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  reviewItemKey,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from '../store/store/review-items.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import { planRevisionBatch } from '../store/store/revision-batch.ts';
import { collectRevisionSites } from '../store/store/tree-op-revisions.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationStoryReads } from './reads.ts';
import { sharesItsPart } from './stories.ts';

const TEXT_KINDS: readonly string[] = ['insert', 'delete'];

/**
 * Every item that nests with `target`, directly or through other items, including `target`.
 *
 * Two items join when a site of one is an ancestor of a site of the other, so two strikes
 * inside one insertion join through it.
 */
function nestedGroup(
  part: OoxmlPart,
  items: readonly ReviewRevisionItem[],
  target: string
): ReviewRevisionItem[] {
  const ownerOf = new Map<string, number>();
  items.forEach((item, index) => {
    for (const id of revisionSiteNodeIdsOf(item)) ownerOf.set(id, index);
  });
  const parents = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  for (const [id, owner] of ownerOf) {
    for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id)) {
      const ancestor = ownerOf.get(node.id);
      if (ancestor !== undefined) parents[find(ancestor)] = find(owner);
    }
  }
  const at = items.findIndex((item) => reviewItemKey(item) === target);
  if (at < 0) return [];
  const root = find(at);
  return items.filter((_, index) => find(index) === root);
}

/**
 * Site-scoped ops for one text insertion or deletion nested with other text revisions, or no
 * ops when anything else shares its group.
 *
 * The preflight resolves the item's whole nested group as one batch first. Only when that
 * group is resolvable text do the ops resolve the item's own sites alone.
 */
export function nestedTextDecisionOps(
  reads: AutomationStoryReads,
  item: ReviewRevisionItem,
  action: 'accept' | 'reject'
): readonly TreeDocOp[] {
  if (!TEXT_KINDS.includes(item.revisionKind)) return [];
  const scope = sharesItsPart(reads.story) ? reads.root : undefined;
  const scoped = scope && scope.kind !== 'textValue' ? { ...reads.part, root: scope } : reads.part;
  const group = nestedGroup(reads.part, revisionItemsOf(scoped), reviewItemKey(item));
  if (group.length < 2 || group.some((member) => !TEXT_KINDS.includes(member.revisionKind)))
    return [];
  const keys = group.map(reviewItemKey);
  if (
    planRevisionBatch(reads.part, action, keys, scope, { countRemaining: false }).result.skipped
      .length
  )
    return [];
  const own = new Set(revisionSiteNodeIdsOf(item));
  const op = action === 'accept' ? ('acceptRevision' as const) : ('rejectRevision' as const);
  const groups = new Map<
    string,
    { revision: ReviewRevisionItem['address']; localName: string; siteNodeIds: string[] }
  >();
  for (const site of collectRevisionSites(reads.part)) {
    if (!own.has(site.node.id)) continue;
    const attribute = (name: string) =>
      site.node.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value;
    const revision = item.addresses.find(
      (address) =>
        address.id === attribute('id') &&
        address.author === (attribute('author') ?? '') &&
        (address.date ?? '') === (attribute('date') ?? '')
    );
    if (!revision) return [];
    const localName = site.node.localName;
    const key = JSON.stringify([revision, localName]);
    const known = groups.get(key);
    if (known) known.siteNodeIds.push(site.node.id);
    else groups.set(key, { revision, localName, siteNodeIds: [site.node.id] });
  }
  return [...groups.values()].map((entry) => ({ op, ...entry }));
}
