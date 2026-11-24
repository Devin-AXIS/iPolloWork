import { retainedNestedRowSites } from './revision-table-preserve-nested.ts';
import {
  guardedControlIds,
  guardKeepsRevisions,
  holdsGuardedControls,
} from './revision-content-lock.ts';
import {
  boundTableAlignments,
  bundledTableHistories,
  unboundTableHistories,
} from './revision-table-unbound-history.ts';
import { deferredTableGridSites } from './revision-table-grid-history.ts';
import { planOrdinaryMoves } from './revision-move-ranges.ts';
import {
  CELL_REVISION_NAMES,
  tableRevisionContentTarget,
  tableRevisionRemovals,
  tableRevisionNeighbours,
  neighbourWidthPairs,
  revisionAttribute,
  tableMergeDependencies,
} from './revision-table-plan.ts';
import { ancestorIdsOf } from './node-ancestors.ts';
import { paragraphMergeSources } from './revision-paragraph-merge.ts';
import { preservedRevisionProperty } from './revision-property-records.ts';
import { recordedProperties } from './tree-op-tracked-properties.ts';
import { isInertMarker } from './revision-marker-content.ts';
import { orphanDestinationGroups } from './revision-moved-marks.ts';
import { findNode, parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { revisionItemsOf } from './review-reads.ts';
import { reviewItemKey, revisionSiteNodeIdsOf, type ReviewRevisionItem } from './review-items.ts';
import {
  collectRevisionSites,
  resolveRevisions,
  namedMoveRanges,
  orphanMoveDestinationSites,
  type RevisionSite,
} from './tree-op-revisions.ts';
import type { RevisionSiteRefusal } from './revision-site-refusal.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** A canonical review decision. Keys are valid only in the open document. @public */
export interface RevisionBatchEntry {
  readonly key: string;
  readonly author: string;
  readonly partName: string;
  readonly revisionKind: ReviewRevisionItem['revisionKind'];
  /** For a formatting change, its OOXML property-change element, as the review item has it. */
  readonly formattingKind?: string;
}

/** Why a requested decision remains pending. @public */
export type RevisionBatchSkipReason =
  'unsupported-revision' | 'incomplete-group' | 'retained-structure' | 'unknown-revision';

/**
 * The structure behind a skip.
 *
 * For `unsupported-revision`: a refused site, a formatting change whose earlier properties were
 * not recorded so it cannot be rejected, a read-only review item, a change with no sites, a
 * change a content control lock keeps (`locked-content`), or a change in a data-bound content
 * control (`bound-content`). The last two have their own codes, `review.locked-content` and
 * `review.bound-content`; `reviewCodeOfSkip` reads them.
 *
 * For `incomplete-group`, the change the decision would also decide: the other half of a move or
 * merge (`paired-change`), a change inside content the decision removes (`removed-content`) or
 * inside properties a reject replaces (`replaced-properties`), a change the decision would empty
 * (`emptied-change`), a change that encloses the selected one (`enclosing-change`), or another
 * site of a group the planner keeps together (`grouped-change`).
 *
 * For `retained-structure`: a row kept for the table nested in it (`nested-table`).
 *
 * @public
 */
export type RevisionBatchSkipDetail =
  | RevisionSiteRefusal
  | 'unrecorded-properties'
  | 'read-only'
  | 'no-sites'
  | 'paired-change'
  | 'removed-content'
  | 'replaced-properties'
  | 'emptied-change'
  | 'enclosing-change'
  | 'grouped-change'
  | 'nested-table'
  | 'locked-content'
  | 'bound-content';

/** Outcome of one selected-set decision. Counts refer to review decisions, not XML markers. @public */
export interface RevisionBatchResult {
  readonly resolved: readonly RevisionBatchEntry[];
  readonly skipped: readonly {
    readonly key: string;
    readonly reason: RevisionBatchSkipReason;
    readonly revision?: RevisionBatchEntry;
    /**
     * The condition or structure behind the skip, such as `locked-content` or `paired-change`.
     * `reviewCodeOfSkip` turns the reason and the detail into one review code.
     */
    readonly detail?: RevisionBatchSkipDetail;
  }[];
  /** All pending decisions in the addressed scope, including excluded and unsupported changes. */
  readonly remaining: number;
}

/** Formatting history records of a table, its rows, and its cells. */
const TABLE_HISTORY_NAMES: ReadonlySet<string> = new Set([
  'tblPrChange',
  'tblGridChange',
  'tblPrExChange',
  'trPrChange',
  'tcPrChange',
]);

/**
 * @internal Pure preflight; callers commit its operations through their normal write guards.
 *
 * `countRemaining: false` skips the exact count of the decisions left after the batch, and
 * reports `remaining` as the decisions not resolved here. The exact count resolves the whole
 * batch once more on a copy and lists what is left, which on a long reviewed document cost more
 * than the plan itself, and a caller that reads only the operations or the skipped changes
 * (a check, one decision, an editor that recounts its queue) paid it on every call.
 */
export function planRevisionBatch(
  part: OoxmlPart,
  action: 'accept' | 'reject',
  keys?: readonly string[],
  scopeRoot?: OoxmlNode,
  options?: {
    readonly countRemaining?: boolean;
    /**
     * A decision on these changes themselves, not a filtered selection: the other half of a
     * selected move resolves with it, and changes inside content it removes go along.
     */
    readonly explicit?: boolean;
  }
): {
  ops: readonly TreeDocOp[];
  result: RevisionBatchResult;
  /** Keys of unselected changes the decision removes with their content. Explicit only. */
  swept?: readonly string[];
} {
  let plan = planRevisionBatchOnce(part, action, keys, scopeRoot, options);
  // An explicit decision that removes part of another change resolves that change whole.
  for (let pass = 0; keys && pass < 3 && plan.partial?.length; pass++) {
    if (!plan.result.skipped.some((skip) => skip.reason === 'incomplete-group')) break;
    keys = [...new Set([...keys, ...plan.partial])];
    plan = planRevisionBatchOnce(part, action, keys, scopeRoot, options);
  }
  const { partial: _partial, ...rest } = plan;
  return rest;
}

function planRevisionBatchOnce(
  part: OoxmlPart,
  action: 'accept' | 'reject',
  keys?: readonly string[],
  scopeRoot?: OoxmlNode,
  options?: Parameters<typeof planRevisionBatch>[4]
): ReturnType<typeof planRevisionBatch> & { partial?: readonly string[] } {
  const root = scopeRoot ?? part.root;
  const scopedPart = root.kind === 'textValue' ? part : { ...part, root };
  const items = revisionItemsOf(scopedPart);
  const allSites = keys === undefined ? collectRevisionSites(scopedPart) : [];
  const auxiliaryIds = [
    ...unboundTableHistories(scopedPart, allSites),
    ...allSites.filter((site) => site.node.localName === 'numberingChange').map((s) => s.node.id),
  ];
  const cleanup: TreeDocOp[] = auxiliaryIds.length
    ? [
        {
          op: 'acceptAllRevisions',
          siteNodeIds: auxiliaryIds,
          ...(scopeRoot ? { scopeRootId: scopeRoot.id } : {}),
        },
      ]
    : [];
  if (keys?.length === 0 || items.length === 0) {
    return {
      ops: cleanup,
      result: {
        resolved: [],
        skipped: [...new Set(keys ?? [])].map((key) => ({ key, reason: 'unknown-revision' })),
        remaining: items.length,
      },
    };
  }
  const selected = new Set(keys ?? items.map(reviewItemKey));
  const byKey = new Map(items.map((item) => [reviewItemKey(item), item]));
  const selectedSites = new Set<string>();
  for (const key of selected) {
    const item = byKey.get(key);
    if (item) for (const id of revisionSiteNodeIdsOf(item)) selectedSites.add(id);
  }
  const sites = collectRevisionSites(scopedPart);
  const movePlan = planOrdinaryMoves(root, sites, selectedSites, action);
  for (const id of movePlan.selected) selectedSites.add(id);
  // A named move resolves both of its halves together, and so does a vertical cell merge with
  // its continuations, a destination with no source with its paragraph mark, and a
  // removed cell with its neighbour's width history. A decision on
  // one change therefore decides the whole group; a selection by filter, such as one author's
  // changes, does not reach the rest of it.
  const namedMoves = [...namedMoveRanges(root).values()];
  const orphanDestinations = orphanMoveDestinationSites(root, sites);
  const authorOf = (id: string) => {
    const node = findNode(scopedPart, id);
    return node && node.kind !== 'textValue' ? revisionAttribute(node, 'author') : undefined;
  };
  // A width change beside a removed cell decides with the cell. When another author made it,
  // only a decision on the cell takes it along: a decision on the width alone leaves the cell.
  // An explicit decision reaches a pair through a bundle only when the cell is by an author it
  // names, so it never removes another author's cell; otherwise the width resolves alone.
  // A table alignment entry stays pending when a decision removes the cell that held part of
  // its history: the rest of the entry keeps the alignment's rows (see `keepAlignmentRows`).
  const alignments = boundTableAlignments(scopedPart, sites);
  const alignmentEntries = new Set(
    items
      .map(revisionSiteNodeIdsOf)
      .filter((ids) => ids.some((id) => alignments.has(id)))
      .flat()
  );
  const named = new Set(selectedSites);
  const namedAuthors = new Set([...named].map(authorOf));
  const widthPairs = neighbourWidthPairs(scopedPart, sites, action).filter((ids) => {
    const removal = ids.slice(0, -1);
    const history = authorOf(ids.at(-1)!);
    if (!removal.every((id) => authorOf(id) === history) && !removal.some((id) => named.has(id)))
      return false;
    if (!options?.explicit) return true;
    // A decision on a table alignment entry decides formatting only, never the cell.
    if (alignmentEntries.has(ids.at(-1)!) && !removal.some((id) => named.has(id))) return false;
    return ids.some((id) => named.has(id)) || removal.every((id) => namedAuthors.has(authorOf(id)));
  });
  const mergeGroups = [
    ...(sites.some((site) => site.node.localName === 'cellMerge')
      ? tableMergeDependencies(scopedPart, action)
      : []),
    ...orphanDestinationGroups(root, orphanDestinations),
    ...widthPairs,
    ...bundledTableHistories(scopedPart, sites),
  ];
  if (options?.explicit) {
    // A pair can reach part of another change, which then resolves whole: repeat until the
    // selection stops growing.
    const linked = [
      ...namedMoves.map((range) => range.wrappers.map((node) => node.id)),
      ...mergeGroups,
      // An alignment entry stays pending without the part a removed cell takes along.
      ...(mergeGroups.length
        ? items
            .map(revisionSiteNodeIdsOf)
            .filter((ids) => !ids.some((id) => alignmentEntries.has(id)))
        : []),
    ];
    for (let grew = true, pass = 0; grew && pass <= linked.length; pass++) {
      grew = false;
      for (const ids of linked)
        if (ids.some((id) => selectedSites.has(id)))
          for (const id of ids) if (!selectedSites.has(id)) grew = !!selectedSites.add(id);
    }
  }
  for (const item of items) {
    const ids = revisionSiteNodeIdsOf(item);
    if (ids.length && ids.every((id) => selectedSites.has(id))) selected.add(reviewItemKey(item));
  }
  const indices = new Map(sites.map((site, index) => [site.node.id, index]));
  const parents = sites.map((_, index) => index);
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]!]!;
      index = parents[index]!;
    }
    return index;
  };
  const join = (a: number, b: number): void => {
    parents[find(b)] = find(a);
  };
  for (const dependency of movePlan.dependencies) {
    const own = dependency.flatMap((id) => (indices.has(id) ? [indices.get(id)!] : []));
    for (const index of own) join(own[0]!, index);
  }
  const owners = new Map<string, number>();
  for (const item of items) {
    const own = revisionSiteNodeIdsOf(item).flatMap((id) => {
      const index = indices.get(id);
      return index === undefined ? [] : [index];
    });
    for (const index of own) join(own[0]!, index);
  }
  const selectedTableSites = sites.filter((site) => selectedSites.has(site.node.id));
  const removedTables = new Set(tableRevisionRemovals(part, selectedTableSites, action).keys());
  const mergeSources = new Map<string, ReadonlySet<string>>();
  // Row decisions can remove every descendant. Property restoration replaces the live
  // property container. Containment also protects wrappers the resolver would sweep empty.
  // Content a selected decision removes, which takes every change inside it along. A refused
  // decision, or a row that stays to keep a nested table, removes nothing.
  const removedRoots = new Set<string>();
  // Which selected site removes each root, so a decision that skips removes nothing.
  const rootOwners = new Map<string, number>();
  const removeRoot = (id: string, owner: number): void => {
    removedRoots.add(id);
    rootOwners.set(id, owner);
  };
  const retainedAtStart = new Set(retainedNestedRowSites(part, sites, action));
  const removes = (site: RevisionSite) => !site.refused && !retainedAtStart.has(site.node.id);
  for (const [index, site] of sites.entries()) {
    if (
      selectedSites.has(site.node.id) &&
      removes(site) &&
      !site.paragraphMark &&
      // A destination with no source keeps its content when rejected.
      !orphanDestinations.has(site.node.id) &&
      (action === 'accept'
        ? site.node.kind === 'revisionDelete' || site.node.kind === 'revisionMoveFrom'
        : site.node.kind === 'revisionInsert' || site.node.kind === 'revisionMoveTo')
    )
      removeRoot(site.node.id, index);
    if (
      action === 'reject' &&
      site.propertyChange &&
      site.parent &&
      selectedSites.has(site.node.id)
    ) {
      // Restoration preserves live paragraph marks and, for pPrChange, rPr/sectPr.
      // Only children actually replaced by the resolver depend on this decision.
      for (const child of site.parent.children) {
        const preserved = preservedRevisionProperty(site.node.localName, child);
        if (preserved) continue;
        owners.set(child.id, index);
        // The restored properties replace this one, so a change recorded inside it goes too.
        if (child.id !== site.node.id && removes(site)) removeRoot(child.id, index);
      }
    }
    // Removing a paragraph mark merges its text forward and drops its paragraph properties.
    // Keep numbering, section and formatting decisions in those properties in the same group.
    const removesMark =
      action === 'accept'
        ? site.node.localName === 'del' || site.node.localName === 'moveFrom'
        : site.node.localName === 'ins' || site.node.localName === 'moveTo';
    if (
      site.paragraphMark &&
      site.parent &&
      removesMark &&
      !orphanDestinations.has(site.node.id) &&
      selectedSites.has(site.node.id)
    ) {
      const properties = parentNodeOf(part, site.parent.id);
      const paragraph = properties && parentNodeOf(part, properties.id);
      const container = paragraph && parentNodeOf(part, paragraph.id);
      if (properties && paragraph && container) {
        let sources = mergeSources.get(container.id);
        if (!sources) {
          sources = paragraphMergeSources(container.children, removedTables);
          mergeSources.set(container.id, sources);
        }
        if (sources.has(paragraph.id)) {
          owners.set(properties.id, index);
          if (removes(site)) removeRoot(properties.id, index);
        }
      }
    }
    if (selectedSites.has(site.node.id) && tableRevisionContentTarget(part, site, action)) {
      const target = tableRevisionContentTarget(part, site, action);
      if (target && !site.refused) {
        owners.set(target.id, index);
        if (removes(site)) removeRoot(target.id, index);
      }
    }
  }
  for (const [cellId, markers] of tableRevisionNeighbours(part, selectedTableSites, action)) {
    const cell = findNode(part, cellId);
    const markerIndex = indices.get(markers[0]!);
    if (cell?.kind !== 'tableCell' || markerIndex === undefined) continue;
    // The decision rewrites the neighbour's geometry, not the neighbour's own cell change.
    for (const property of cell.children) {
      if (property.localName !== 'tcPr') continue;
      for (const child of property.children) {
        if (child.kind === 'textValue' || CELL_REVISION_NAMES.has(child.localName)) continue;
        owners.set(child.id, markerIndex);
      }
    }
  }
  // A lock that keeps the enclosing change's own decision but allows the nested one's leaves
  // them apart, so the decision the lock allows still applies. Only changes inside a guarded
  // control ask the guard.
  const guardedControls = guardedControlIds(part);
  const insideGuarded = (index: number): boolean => {
    for (
      let node = parentNodeOf(part, sites[index]!.node.id);
      node;
      node = parentNodeOf(part, node.id)
    )
      if (guardedControls.has(node.id)) return true;
    return false;
  };
  const lockedAlone = new Map<number, boolean>();
  const keptAlone = (index: number): boolean => {
    let kept = lockedAlone.get(index);
    if (kept === undefined) {
      kept = guardKeepsRevisions(part, [sites[index]!.node.id], action) !== null;
      lockedAlone.set(index, kept);
    }
    return kept;
  };
  const lockSeparates = (ancestor: number, own: number): boolean =>
    guardedControls.size > 0 &&
    ['revisionInsert', 'revisionDelete'].includes(sites[own]!.node.kind) &&
    ['revisionInsert', 'revisionDelete'].includes(sites[ancestor]!.node.kind) &&
    insideGuarded(own) &&
    keptAlone(ancestor) &&
    !keptAlone(own);
  // A subtree holding no site and no owner joins nothing, so the walk keeps to their ancestors.
  const reached = ancestorIdsOf(scopedPart, [...indices.keys(), ...owners.keys()]);
  const visit = (node: OoxmlNode, ancestor?: number): void => {
    if (!reached.has(node.id)) return;
    const site = indices.get(node.id);
    const owner = owners.get(node.id);
    if (site !== undefined && owner !== undefined) join(owner, site);
    const own = site ?? owner;
    // A run's formatting record, and the properties its reject restores, neither remove nor
    // empty the wrapper around them, and the wrapper's decision takes the record with its text.
    // Either resolves alone in an explicit decision; a filtered selection keeps them together.
    const independent =
      (options?.explicit === true &&
        own !== undefined &&
        (site === undefined || owner === undefined || owner === site) &&
        sites[own]!.node.localName === 'rPrChange') ||
      (own !== undefined && ancestor !== undefined && lockSeparates(ancestor, own));
    if (own !== undefined && ancestor !== undefined && !independent) join(ancestor, own);
    const next = own ?? ancestor;
    if (node.kind !== 'textValue') for (const child of node.children) visit(child, next);
  };
  visit(root);
  for (const range of namedMoves) {
    const own = range.wrappers.flatMap((node) => {
      const index = indices.get(node.id);
      return index === undefined ? [] : [index];
    });
    for (const index of own) join(own[0]!, index);
  }
  for (const ids of mergeGroups) {
    const group = ids.flatMap((id) => {
      const index = indices.get(id);
      return index === undefined ? [] : [index];
    });
    for (const index of group) join(group[0]!, index);
  }
  const groups = new Map<number, typeof sites>();
  const buildGroups = (): void => {
    groups.clear();
    for (const [index, site] of sites.entries()) {
      const id = find(index);
      const group = groups.get(id) ?? [];
      group.push(site);
      groups.set(id, group);
    }
  };
  buildGroups();
  const isContentWrapper = (node: OoxmlNode) =>
    node.kind === 'revisionInsert' ||
    node.kind === 'revisionDelete' ||
    node.kind === 'revisionMoveFrom' ||
    node.kind === 'revisionMoveTo';
  // A wrapper whose whole content the selection removes is swept empty with it. Position
  // markers beside that content do not keep it.
  const sweptEmpty = (node: OoxmlNode | null): boolean => {
    if (!node || node.kind === 'textValue' || !isContentWrapper(node)) return false;
    const content = node.children.filter(
      (child) => child.kind !== 'textValue' && !isInertMarker(child)
    );
    return content.length > 0 && content.every((child) => removedRoots.has(child.id));
  };
  // A change inside removed content, or emptied by it, goes with it in an explicit decision, so
  // it does not leave the group incomplete.
  const removedBySelection = (id: string): boolean => {
    if (!options?.explicit || !removedRoots.size) return false;
    for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
      if (removedRoots.has(node.id)) return true;
    return sweptEmpty(findNode(part, id));
  };
  // An unselected change joined only by nesting resolves on its own: the selected decision
  // neither removes nor empties it, rewrites no properties it sits in, and is not the other
  // half of its move or merge. Accepting one author's insertion keeps another author's
  // deletion inside it pending, as deciding that insertion alone does. A half inside content
  // the selection removes pairs its partner too, so the partner is not left without it.
  const paired = new Set(
    [
      ...namedMoves.map((range) => range.wrappers.map((node) => node.id)),
      ...mergeGroups,
      ...movePlan.dependencies,
      // One change's own sites share its identity and resolve only together.
      ...items.map(revisionSiteNodeIdsOf),
    ]
      .filter((ids) => ids.some((id) => selectedSites.has(id) || removedBySelection(id)))
      .flat()
  );
  const nestedOnly = (site: RevisionSite): boolean => {
    if (paired.has(site.node.id) || owners.has(site.node.id)) return false;
    for (let node = parentNodeOf(part, site.node.id); node; node = parentNodeOf(part, node.id))
      if (owners.has(node.id) || removedRoots.has(node.id)) return false;
    return !sweptEmpty(site.node);
  };
  const reasons = new Map<number, RevisionBatchSkipReason>();
  const details = new Map<number, RevisionBatchSkipDetail>();
  // A lock or a binding keeps a decision the op's guard would refuse: the group is skipped, so
  // the rest of the decision applies. Asked of the guard itself, once per group.
  const guarded = holdsGuardedControls(part);
  const guardAnswers = new Map<string, 'locked-content' | 'bound-content' | null>();
  const lockedGroup = (group: readonly RevisionSite[]) => {
    if (!guarded) return null;
    const ids = group.map((site) => site.node.id);
    const key = ids.join('\u0000');
    let answer = guardAnswers.get(key);
    if (answer === undefined) {
      answer = guardKeepsRevisions(part, ids, action);
      guardAnswers.set(key, answer);
    }
    return answer;
  };
  const decideGroups = (): void => {
    reasons.clear();
    details.clear();
    for (const [id, group] of groups) {
      const touched = group.some((site) => selectedSites.has(site.node.id));
      const refused = group.find((site) => site.refused);
      const unrecorded =
        action === 'reject' &&
        group.some((site) => site.propertyChange && recordedProperties(site.node) === null);
      const locked = !refused && !unrecorded && lockedGroup(group);
      if (refused || unrecorded || locked) {
        reasons.set(id, 'unsupported-revision');
        details.set(id, refused?.refusal ?? (locked || 'unrecorded-properties'));
      } else {
        const blocking = group.find(
          (site) =>
            !selectedSites.has(site.node.id) &&
            !removedBySelection(site.node.id) &&
            !(options?.explicit && alignmentEntries.has(site.node.id)) &&
            !(touched && nestedOnly(site))
        );
        if (blocking) {
          reasons.set(id, 'incomplete-group');
          details.set(id, blockingStructure(blocking));
        }
      }
    }
  };
  // What an unselected site in a deciding group is to the decision, for telemetry and hosts.
  const blockingStructure = (site: RevisionSite): RevisionBatchSkipDetail => {
    if (paired.has(site.node.id)) return 'paired-change';
    for (let node = parentNodeOf(part, site.node.id); node; node = parentNodeOf(part, node.id)) {
      if (removedRoots.has(node.id)) return 'removed-content';
      if (owners.has(node.id)) return 'replaced-properties';
    }
    if (sweptEmpty(site.node)) return 'emptied-change';
    const encloses = [...selectedSites].some((id) => {
      for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
        if (node.id === site.node.id) return true;
      return false;
    });
    return encloses ? 'enclosing-change' : 'grouped-change';
  };
  const markReadOnly = (): void => {
    for (const item of items) {
      if (!item.readOnly) continue;
      for (const id of revisionSiteNodeIdsOf(item)) {
        const index = indices.get(id);
        if (index === undefined) continue;
        reasons.set(find(index), 'unsupported-revision');
        // An item is read-only BECAUSE a site refused it: keep that site's specific reason.
        if (!details.has(find(index))) details.set(find(index), 'read-only');
      }
    }
  };
  // A removal whose own decision is refused removes nothing, so changes it would have taken
  // along must keep their groups incomplete. Each pass drops at least one root, so this ends.
  const settleGroups = (): void => {
    for (;;) {
      decideGroups();
      markReadOnly();
      // Only a refusal: a removal kept incomplete by the change it would take along still
      // removes it in the plan's terms, and that change keeps its group incomplete.
      const dropped = [...rootOwners].filter(
        ([, owner]) => reasons.get(find(owner)) === 'unsupported-revision'
      );
      if (!dropped.length) return;
      for (const [root] of dropped) {
        removedRoots.delete(root);
        rootOwners.delete(root);
      }
    }
  };
  settleGroups();
  // Cell removal may remove its row; row removal may remove the containing table.
  // Only eligible groups contribute to this closure, so a retained row does not block peers.
  const eligible = sites.filter(
    (site, index) => selectedSites.has(site.node.id) && !reasons.has(find(index))
  );
  let removedContainer = false;
  const eligibleRemovals = tableRevisionRemovals(part, eligible, action);
  for (const [id, markerIds] of eligibleRemovals) {
    if (owners.has(id)) continue;
    const owner = indices.get(markerIds[0]!);
    if (owner !== undefined) {
      owners.set(id, owner);
      // The removed row or table takes the changes in it along, as removed content does.
      removeRoot(id, owner);
      removedContainer = true;
    }
  }
  if (removedContainer) {
    visit(root);
    // The removal joined new sites to the deciding groups; decide those groups again. A refused
    // site still refuses its joined group, as each pass decides it from the sites.
    buildGroups();
    settleGroups();
  }
  const resolved: RevisionBatchEntry[] = [];
  const skipped: RevisionBatchResult['skipped'][number][] = [];
  const acceptedSites = new Set<string>();
  const retainedRows = new Set(retainedAtStart);
  // A nested row can remain pending only if no eligible ancestor action removes it.
  for (const id of retainedRows) {
    let ancestor = parentNodeOf(part, id);
    while (ancestor) {
      if (eligibleRemovals.has(ancestor.id)) {
        retainedRows.delete(id);
        break;
      }
      ancestor = parentNodeOf(part, ancestor.id);
    }
  }
  for (const key of selected) {
    const item = byKey.get(key);
    if (!item) {
      skipped.push({ key, reason: 'unknown-revision' });
      continue;
    }
    const entry: RevisionBatchEntry = {
      key,
      author: item.author,
      partName: part.name,
      revisionKind: item.revisionKind,
      ...(item.formattingKind ? { formattingKind: item.formattingKind } : {}),
    };
    const ids = revisionSiteNodeIdsOf(item);
    let reason: RevisionBatchSkipReason | undefined;
    let detail: RevisionBatchSkipDetail | undefined;
    for (const id of ids) {
      const index = indices.get(id);
      reason = index === undefined ? 'incomplete-group' : reasons.get(find(index));
      detail = index === undefined ? undefined : details.get(find(index));
      if (reason) break;
    }
    if (!ids.length) {
      reason = 'unsupported-revision';
      detail = 'no-sites';
    }
    if (reason)
      skipped.push({
        key,
        reason,
        revision: entry,
        ...(detail ? { detail } : {}),
      });
    else {
      if (ids.some((id) => retainedRows.has(id)))
        skipped.push({
          key,
          reason: 'retained-structure',
          revision: entry,
          detail: 'nested-table',
        });
      else resolved.push(entry);
      for (const id of ids) if (!retainedRows.has(id)) acceptedSites.add(id);
    }
  }
  const gridCandidates = deferredTableGridSites(part, sites, acceptedSites);
  const deferredGrids = new Set<string>();
  for (const item of items) {
    const ids = revisionSiteNodeIdsOf(item);
    // Only a grouped row decision carries deferred grid metadata. A standalone
    // grid request is explicit and must retain its normal resolution semantics.
    if (item.formattingKind !== 'tblGridChange' && ids.length > 1)
      for (const id of ids) if (gridCandidates.has(id)) deferredGrids.add(id);
  }
  const siteNodeIds = [...acceptedSites].filter(
    (id) => !movePlan.implicit.has(id) && !deferredGrids.has(id)
  );
  // Changes the decision removes with their content leave the document too, so they are
  // reported as resolved. Only roots whose own decision applies remove anything.
  for (const [root, owner] of rootOwners)
    if (reasons.has(find(owner))) {
      removedRoots.delete(root);
      rootOwners.delete(root);
    }
  const swept = options?.explicit
    ? items.filter((item) => {
        if (selected.has(reviewItemKey(item))) return false;
        const ids = revisionSiteNodeIdsOf(item);
        return ids.length > 0 && ids.every(removedBySelection);
      })
    : [];
  // Changes the decision removes only in part, for the caller to decide whole. A table row or
  // cell the selection removes counts even when the part it removes keeps the group pending.
  const insideRemoval = (id: string): boolean => {
    for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
      if (removedTables.has(node.id)) return true;
    return removedBySelection(id);
  };
  // Only table formatting history outside the removal: text or structure there stays its own.
  const formattingOnly = (id: string) => {
    const index = indices.get(id);
    return index !== undefined && TABLE_HISTORY_NAMES.has(sites[index]!.node.localName);
  };
  const partial = options?.explicit
    ? items.filter((item) => {
        if (selected.has(reviewItemKey(item))) return false;
        const ids = revisionSiteNodeIdsOf(item);
        const outside = ids.filter((id) => !insideRemoval(id));
        return (
          outside.length < ids.length &&
          outside.length > 0 &&
          outside.every(formattingOnly) &&
          !ids.some((id) => alignmentEntries.has(id))
        );
      })
    : [];
  for (const item of swept)
    resolved.push({
      key: reviewItemKey(item),
      author: item.author,
      partName: part.name,
      revisionKind: item.revisionKind,
      ...(item.formattingKind ? { formattingKind: item.formattingKind } : {}),
    });
  let remaining = items.length - resolved.length;
  // Removing a row can make two formerly separated formatting groups adjacent.
  // Partial outcomes must count the resulting queue, not subtract from the old one.
  if (remaining > 0 && siteNodeIds.length && options?.countRemaining !== false) {
    // Resolution transfers its mutable node index to the rebuilt root. Keep the
    // original root's index and allocator state untouched during pure preflight.
    const previewPart = { ...part, root: { ...part.root } };
    const preview = resolveRevisions(previewPart, action, undefined, {
      siteNodeIds,
      ...(scopeRoot ? { scopeRootId: scopeRoot.id } : {}),
    });
    if (preview.ok && preview.part) {
      const afterRoot = scopeRoot ? findNode(preview.part, scopeRoot.id) : preview.part.root;
      remaining =
        afterRoot && afterRoot.kind !== 'textValue'
          ? revisionItemsOf({ ...preview.part, root: afterRoot }).length
          : 0;
    }
  }
  return {
    ...(swept.length ? { swept: swept.map(reviewItemKey) } : {}),
    ...(partial.length ? { partial: partial.map(reviewItemKey) } : {}),
    ops: acceptedSites.size
      ? [
          ...cleanup,
          {
            op: action === 'accept' ? 'acceptAllRevisions' : 'rejectAllRevisions',
            siteNodeIds,
            ...(scopeRoot ? { scopeRootId: scopeRoot.id } : {}),
          },
        ]
      : cleanup,
    result: { resolved, skipped, remaining },
  };
}
