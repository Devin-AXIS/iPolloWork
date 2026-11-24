// Change who a tracked change is attributed to, without deciding it.
//
// A decision stays pending: only `@w:author`, and `@w:date` when one is given, change on the
// elements that carry it. The planner works from review keys, the same selection unit as a
// batch accept or reject, so a caller selects the same changes it sees in the review pane.
//
//   - A move keeps its range markers in step. `w:moveFromRangeStart` and `w:moveToRangeStart`
//     record an author too, and they change when every wrapper of their named range does.
//   - `w:tblGridChange` is `CT_Markup`: it has no author to change, so it keeps its markup.
//     A decision made only of such records is reported as unsupported.
//   - A revision is identified by `(id, author, date)` per element name. When the new author
//     would give a change the identity of a different pending change, the two would become
//     one card that accepts and rejects together. The planner gives the reattributed change
//     fresh ids instead, so two decisions never merge.

import { findNode } from '../package/ooxml-edit.ts';
import { replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { revisionItemsOf } from './review-reads.ts';
import { reviewItemKey, revisionSiteNodeIdsOf, type ReviewRevisionItem } from './review-items.ts';
import type { RevisionBatchEntry } from './revision-batch.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import { collectRevisionSites, namedMoveRanges } from './tree-op-revisions.ts';
import {
  invalidRevisionAttribution,
  type RevisionAttributionInput,
} from './tree-op-revision-attribution.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** The store's bound on one op's explicit site list, shared with revision decisions. */
const MAX_SITES_PER_OP = 50_000;

/** `xsd:dateTime` with an optional fraction and zone, as `@w:date` records it. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;

/** Why a requested change keeps its attribution. @public */
export type RevisionAuthorSkipReason = 'unknown-revision' | 'unsupported-revision';

/**
 * One reattributed change. `key` and `author` describe the change after the update, because
 * review keys include the author. @public
 */
export interface RevisionAuthorEntry extends RevisionBatchEntry {
  /**
   * The key the caller selected the change by. It differs from `key` when the attribution
   * changed, because review keys include the author and date.
   */
  readonly previousKey: string;
  /** The author the change had before the update. */
  readonly previousAuthor: string;
}

/** Outcome of one attribution change. Counts refer to review decisions, not XML markers. @public */
export interface RevisionAuthorResult {
  /** Changes that now carry the requested attribution, in selection order. */
  readonly updated: readonly RevisionAuthorEntry[];
  /** Requested changes that kept their attribution. */
  readonly skipped: readonly {
    readonly key: string;
    readonly reason: RevisionAuthorSkipReason;
    readonly revision?: RevisionBatchEntry;
  }[];
}

/** The op this module applies. Declared in `tree-op-types.ts`. */
export type SetRevisionAttributionOp = Extract<TreeDocOp, { op: 'setRevisionAttribution' }>;

function wmlAttribute(node: OoxmlElement, localName: string): string | undefined {
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName)
      return attribute.value;
  }
  return undefined;
}

function element(part: OoxmlPart, id: string): OoxmlElement | null {
  const node = findNode(part, id);
  return node && node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI ? node : null;
}

function isMoveRangeStart(node: OoxmlNode): boolean {
  return node.kind === 'moveFromRangeStart' || node.kind === 'moveToRangeStart';
}

/** Whether an attribution input is one this op can write. */
export function invalidRevisionAuthorInput(revision: RevisionAttributionInput): boolean {
  return (
    invalidRevisionAttribution(revision) ||
    (revision.date !== undefined && !DATE_TIME.test(revision.date))
  );
}

/** A planned attribution change: its ops, and how to name the result once they commit. */
export interface RevisionAuthorPlan {
  readonly ops: readonly TreeDocOp[];
  /** The outcome before commit. Updated entries still carry their previous keys. */
  readonly result: RevisionAuthorResult;
  /** The outcome against the committed part, with each updated change under its new key. */
  finish(after: OoxmlPart): RevisionAuthorResult;
}

interface Chosen {
  readonly item: ReviewRevisionItem;
  readonly key: string;
  readonly nodes: readonly OoxmlElement[];
}

/**
 * Plan an attribution change for selected review keys. Omitted keys select every change.
 * `authors` keeps only the changes those authors made.
 * Callers validate `revision` with `invalidRevisionAuthorInput` first.
 * @internal
 */
export function planRevisionAuthorChange(
  part: OoxmlPart,
  revision: RevisionAttributionInput,
  keys?: readonly string[],
  scopeRoot?: OoxmlNode,
  authors?: readonly string[]
): RevisionAuthorPlan {
  const root = scopeRoot ?? part.root;
  const scopedPart = root.kind === 'textValue' ? part : { ...part, root };
  const items = revisionItemsOf(scopedPart);
  const byKey = new Map(items.map((item) => [reviewItemKey(item), item]));
  const skipped: RevisionAuthorResult['skipped'][number][] = [];
  const chosen: Chosen[] = [];
  const from = authors === undefined ? undefined : new Set(authors);
  for (const key of new Set(keys ?? byKey.keys())) {
    const item = byKey.get(key);
    // An author filter narrows the selection; callers refuse it beside explicit keys.
    if (from && item && !from.has(item.author)) continue;
    if (!item) {
      skipped.push({ key, reason: 'unknown-revision' });
      continue;
    }
    const nodes = revisionSiteNodeIdsOf(item).flatMap((id) => {
      const node = element(part, id);
      return node && wmlAttribute(node, 'author') !== undefined ? [node] : [];
    });
    if (nodes.length) chosen.push({ item, key, nodes });
    else skipped.push({ key, reason: 'unsupported-revision', revision: entryOf(item, key, part) });
  }

  // Renumber only the changes that would otherwise share a card with another decision. The
  // preview finds them with the review derivation itself, so every grouping rule counts.
  const renumbered = new Set<number>();
  let ops = attributionOps(chosen, revision, renumbered, root);
  for (let pass = 0; pass < 3 && ops.length; pass += 1) {
    const merged = mergedChoices(part, chosen, preview(part, ops));
    const fresh = [...merged].filter((index) => !renumbered.has(index));
    if (!fresh.length) break;
    for (const index of fresh) renumbered.add(index);
    ops = attributionOps(chosen, revision, renumbered, root);
  }

  const entries = (after: OoxmlPart | null): RevisionAuthorEntry[] => {
    const next = new Map<string, ReviewRevisionItem>();
    if (after)
      for (const item of revisionItemsOf(after))
        for (const id of revisionSiteNodeIdsOf(item)) next.set(id, item);
    return chosen.map(({ item, key, nodes }) => {
      const now = next.get(nodes[0]!.id);
      return {
        ...(now
          ? entryOf(now, reviewItemKey(now), part)
          : { ...entryOf(item, key, part), author: revision.author }),
        previousKey: key,
        previousAuthor: item.author,
      };
    });
  };
  return {
    ops,
    result: { updated: entries(null), skipped },
    finish: (after) => ({ updated: entries(after), skipped }),
  };
}

/** The ops for a selection; `renumbered` names choices that take fresh ids at apply time. */
function attributionOps(
  chosen: readonly Chosen[],
  revision: RevisionAttributionInput,
  renumbered: ReadonlySet<number>,
  root: OoxmlNode
): TreeDocOp[] {
  type Site = { nodeId: string; renumber?: string };
  const groups: Site[][] = [];
  const selected = new Set<string>();
  for (const [index, { nodes }] of chosen.entries()) {
    const group: Site[] = [];
    for (const node of nodes) {
      selected.add(node.id);
      const id = wmlAttribute(node, 'id');
      if (renumbered.has(index) && id !== undefined)
        group.push({ nodeId: node.id, renumber: `${index}:${id}` });
      else if (changes(node, revision)) group.push({ nodeId: node.id });
    }
    if (group.length) groups.push(group);
  }
  // A move's range starts follow once every wrapper of their named range is reattributed.
  if (chosen.some(({ item }) => item.revisionKind === 'moveFrom' || item.revisionKind === 'moveTo'))
    for (const range of namedMoveRanges(root).values()) {
      if (!range.wrappers.length || !range.wrappers.every((node) => selected.has(node.id)))
        continue;
      for (const marker of range.markers)
        if (isMoveRangeStart(marker) && wmlAttribute(marker, 'author') !== undefined)
          if (changes(marker, revision)) groups.push([{ nodeId: marker.id }]);
    }
  // Chunks end at a choice's boundary, so one renumbered change mints its ids in one op.
  const ops: TreeDocOp[] = [];
  let sites: Site[] = [];
  for (const group of groups) {
    if (sites.length && sites.length + group.length > MAX_SITES_PER_OP) {
      ops.push({ op: 'setRevisionAttribution', revision, sites });
      sites = [];
    }
    for (const site of group) sites.push(site);
  }
  if (sites.length) ops.push({ op: 'setRevisionAttribution', revision, sites });
  return ops;
}

/** The ops applied to a copy, deferring validation; the commit validates the real result. */
function preview(part: OoxmlPart, ops: readonly TreeDocOp[]): OoxmlPart {
  // Edits hand the node index to the rebuilt root. Keep the original root's index untouched.
  let current: OoxmlPart = { ...part, root: { ...part.root } };
  for (const op of ops) {
    const applied = applySetRevisionAttribution(current, op as SetRevisionAttributionOp, {
      deferValidation: true,
    });
    if (!applied.ok) throw new Error(`revision attribution preview failed: ${applied.reason}`);
    current = applied.part;
  }
  return current;
}

/**
 * Choices whose card, after the change, also holds another decision. The whole part is read:
 * review cards group across every note or text box that shares it.
 */
function mergedChoices(part: OoxmlPart, chosen: readonly Chosen[], after: OoxmlPart): Set<number> {
  const before = new Map<string, ReviewRevisionItem>();
  for (const item of revisionItemsOf(part))
    for (const id of revisionSiteNodeIdsOf(item)) before.set(id, item);
  const choiceOf = new Map<string, number>();
  for (const [index, { nodes }] of chosen.entries())
    for (const node of nodes) choiceOf.set(node.id, index);
  const merged = new Set<number>();
  for (const item of revisionItemsOf(after)) {
    const ids = revisionSiteNodeIdsOf(item);
    if (new Set(ids.map((id) => before.get(id))).size < 2) continue;
    for (const id of ids) {
      const index = choiceOf.get(id);
      if (index !== undefined) merged.add(index);
    }
  }
  return merged;
}

function changes(node: OoxmlElement, revision: RevisionAttributionInput): boolean {
  return (
    wmlAttribute(node, 'author') !== revision.author ||
    (revision.date !== undefined && wmlAttribute(node, 'date') !== revision.date)
  );
}

function entryOf(item: ReviewRevisionItem, key: string, part: OoxmlPart): RevisionBatchEntry {
  return {
    key,
    author: item.author,
    partName: part.name,
    revisionKind: item.revisionKind,
    ...(item.formattingKind ? { formattingKind: item.formattingKind } : {}),
  };
}

/** Each site is a whole-node write, so content control locks apply to it as to any edit. */
export function attributionTargets(op: SetRevisionAttributionOp): { readonly nodeId: string }[] {
  return Array.isArray(op.sites) ? op.sites.map(({ nodeId }) => ({ nodeId })) : [];
}

/** Shape checks; the applier checks that each site still carries an attribution. */
export function validateSetRevisionAttribution(
  op: SetRevisionAttributionOp
): TreeOpRejection | null {
  if (typeof op.revision !== 'object' || op.revision === null) return 'invalid-property-value';
  if (invalidRevisionAuthorInput(op.revision)) return 'invalid-property-value';
  if (!Array.isArray(op.sites) || op.sites.length === 0 || op.sites.length > MAX_SITES_PER_OP)
    return 'invalid-property-value';
  for (const site of op.sites) {
    if (typeof site !== 'object' || site === null) return 'invalid-property-value';
    if (typeof site.nodeId !== 'string' || site.nodeId.length === 0)
      return 'invalid-property-value';
    if (
      site.renumber !== undefined &&
      (typeof site.renumber !== 'string' || site.renumber.length === 0 || site.renumber.length > 64)
    )
      return 'invalid-property-value';
  }
  return null;
}

/** Rewrite the attribution of each named revision element. */
export function applySetRevisionAttribution(
  part: OoxmlPart,
  op: SetRevisionAttributionOp,
  options?: EditOptions
): TreeOpResult {
  const shape = validateSetRevisionAttribution(op);
  if (shape) return { ok: false, reason: shape };
  const revisionSites = new Set(collectRevisionSites(part).map((site) => site.node.id));
  // Fresh ids are minted here, inside the transaction, so a collaboration actor's stripe
  // applies and two replicas renumbering from one snapshot cannot mint the same id.
  let mint: (() => string) | undefined;
  const fresh = new Map<string, string>();
  let current = part;
  for (const site of op.sites) {
    const node = element(current, site.nodeId);
    if (
      !node ||
      !(revisionSites.has(node.id) || isMoveRangeStart(node)) ||
      wmlAttribute(node, 'author') === undefined ||
      (site.renumber !== undefined && wmlAttribute(node, 'id') === undefined)
    )
      return { ok: false, reason: 'invalid-property-value', detail: 'not-a-revision-site' };
    let id: string | undefined;
    if (site.renumber !== undefined) {
      id = fresh.get(site.renumber);
      if (id === undefined) {
        mint ??= options?.revisionIds ?? nextRevisionId(part);
        id = mint();
        fresh.set(site.renumber, id);
      }
    }
    const written = replaceNode(
      current,
      node.id,
      { ...node, attributes: attributed(node, op.revision, id) } as OoxmlNode,
      options
    );
    if (!written.ok) return { ok: false, reason: 'tree-invariant' };
    current = written.part;
  }
  return {
    ok: true,
    part: current,
    effect: {
      dirty: [],
      created: [],
      deleted: [],
      // Markup colors and review cards follow the author, wherever the change sits.
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      impact: 'flow-structural',
    },
  };
}

function attributed(
  node: OoxmlElement,
  revision: RevisionAttributionInput,
  id: string | undefined
): OoxmlAttribute[] {
  const values = new Map<string, string>([['author', revision.author]]);
  if (revision.date !== undefined) values.set('date', revision.date);
  if (id !== undefined) values.set('id', id);
  const attributes = node.attributes.map((attribute) => {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) return attribute;
    const value = values.get(attribute.localName);
    if (value === undefined) return attribute;
    values.delete(attribute.localName);
    return { ...attribute, value } as OoxmlAttribute;
  });
  // Only a missing `@w:date` can remain: author and id were required above. It takes the
  // prefix the author attribute already uses, which is bound wherever that one is.
  const prefix =
    node.attributes.find(
      (attribute) =>
        attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
    )?.prefix ?? 'w';
  for (const [localName, value] of values)
    attributes.push({
      kind: 'genericExtension',
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix,
      value,
    });
  return attributes;
}
