// Lower existing tree primitives to the D3 journal without changing the returned part.
// Runs only while capture is active, so the disabled path never walks attributes or children.

import type { OoxmlAttribute, OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  recordMoveNode,
  recordPutNode,
  recordPutXmlPart,
  recordSetAttribute,
  recordSetNamespaceBinding,
  recordSpliceChildren,
  recordSpliceText,
  textSpliceHint,
} from './canonical-primitive-capture.ts';
import type {
  CanonicalAttributeName,
  CanonicalNodeDescriptor,
} from './canonical-primitive-journal.ts';

/** Membership of ids already in the part. Callers only ask `has`; they must not copy. */
export type KnownIds = { readonly has: (id: string) => boolean };

function attributeNameOf(attribute: OoxmlAttribute): CanonicalAttributeName {
  return attribute.prefix === undefined
    ? { namespaceUri: attribute.namespaceUri, localName: attribute.localName }
    : {
        namespaceUri: attribute.namespaceUri,
        localName: attribute.localName,
        prefix: attribute.prefix,
      };
}

function attributeKey(attribute: OoxmlAttribute): string {
  return `${attribute.namespaceUri}\0${attribute.localName}`;
}

function textSplice(
  previous: string,
  next: string,
  hint?: number
): {
  readonly utf16Start: number;
  readonly deleteCount: number;
  readonly insert: string;
} {
  // Beside equal letters, an insert could stand at several places; the edit says which one.
  // A peer's caret follows letters by identity, so the wrong one moves it into the new text.
  const added = next.length - previous.length;
  if (
    hint !== undefined &&
    added > 0 &&
    hint <= previous.length &&
    next.startsWith(previous.slice(0, hint)) &&
    next.endsWith(previous.slice(hint))
  ) {
    return { utf16Start: hint, deleteCount: 0, insert: next.slice(hint, hint + added) };
  }
  let prefix = 0;
  const shared = Math.min(previous.length, next.length);
  while (prefix < shared && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) {
    suffix += 1;
  }
  return {
    utf16Start: prefix,
    deleteCount: previous.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

function lowerAttributes(logicalId: string, previous: OoxmlElement, next: OoxmlElement): void {
  const before = new Map<string, OoxmlAttribute>();
  for (const attribute of previous.attributes) before.set(attributeKey(attribute), attribute);
  const seen = new Set<string>();
  for (const attribute of next.attributes) {
    const key = attributeKey(attribute);
    seen.add(key);
    const prior = before.get(key);
    if (prior && prior.value === attribute.value && prior.prefix === attribute.prefix) continue;
    recordSetAttribute(logicalId, attributeNameOf(attribute), attribute.value);
  }
  for (const [key, attribute] of before) {
    if (!seen.has(key)) recordSetAttribute(logicalId, attributeNameOf(attribute), null);
  }
}

function lowerNamespaceBindings(
  logicalId: string,
  previous: OoxmlElement,
  next: OoxmlElement
): void {
  const before = new Map<string, string>();
  for (const binding of previous.namespaceBindings) {
    before.set(binding.prefix, binding.namespaceUri);
  }
  const seen = new Set<string>();
  for (const binding of next.namespaceBindings) {
    seen.add(binding.prefix);
    if (before.get(binding.prefix) === binding.namespaceUri) continue;
    recordSetNamespaceBinding(logicalId, binding.prefix, binding.namespaceUri);
  }
  for (const prefix of before.keys()) {
    if (!seen.has(prefix)) recordSetNamespaceBinding(logicalId, prefix, null);
  }
}

function nodeDescriptor(node: OoxmlNode): CanonicalNodeDescriptor {
  if (node.kind === 'textValue') return { logicalId: node.id, kind: 'textValue' };
  return {
    logicalId: node.id,
    kind: node.kind,
    qname:
      node.prefix === undefined
        ? { namespaceUri: node.namespaceUri, localName: node.localName }
        : {
            namespaceUri: node.namespaceUri,
            localName: node.localName,
            prefix: node.prefix,
          },
  };
}

function expandInserted(
  node: OoxmlNode,
  knownIds?: KnownIds,
  previousNodes?: ReadonlyMap<string, OoxmlNode>
): void {
  if (knownIds?.has(node.id)) {
    // A node the document already holds is MOVED here, not created — re-expanding it would
    // duplicate its text on replay. But a move can carry an edit: `insertHyperlink` moves
    // the split `w:ins` inside the new `w:hyperlink` WITH its children replaced. The subtree
    // index from the enclosing capture holds the previous version, so the move lowers as a
    // same-identity diff. Skipping the diff left the journal silent about the moved node's
    // new content, and every receiving replica kept its OLD subtree beside the split pieces
    // the journal did describe — duplicated text on every peer but the author.
    const prior = previousNodes?.get(node.id);
    if (prior && prior !== node) lowerSameIdentity(prior, node, knownIds, previousNodes);
    return;
  }
  recordPutNode(nodeDescriptor(node));
  if (node.kind === 'textValue') {
    // Initial fill of a shell this journal put. Apply replaces the node's current value,
    // because `deleteCount: 0` would insert again if the same journal ran twice.
    if (node.value.length > 0) recordSpliceText(node.id, 0, 0, node.value);
    return;
  }
  for (const attribute of node.attributes) {
    recordSetAttribute(node.id, attributeNameOf(attribute), attribute.value);
  }
  for (const binding of node.namespaceBindings) {
    recordSetNamespaceBinding(node.id, binding.prefix, binding.namespaceUri);
  }
  if (node.children.length === 0) return;
  for (const child of node.children) expandInserted(child, knownIds, previousNodes);
  recordSpliceChildren(
    node.id,
    0,
    0,
    node.children.map((child) => child.id)
  );
}

function qnameChanged(previous: OoxmlElement, next: OoxmlElement): boolean {
  return (
    previous.kind !== next.kind ||
    previous.namespaceUri !== next.namespaceUri ||
    previous.localName !== next.localName ||
    previous.prefix !== next.prefix
  );
}

function indexSubtree(node: OoxmlNode, into: Map<string, OoxmlNode>): void {
  into.set(node.id, node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) indexSubtree(child, into);
}

function lowerSameIdentity(
  previous: OoxmlNode,
  next: OoxmlNode,
  knownIds?: KnownIds,
  previousNodes?: ReadonlyMap<string, OoxmlNode>
): void {
  if (previous === next) return;
  if (previous.kind === 'textValue' || next.kind === 'textValue') {
    const before = previous.kind === 'textValue' ? previous.value : '';
    const after = next.kind === 'textValue' ? next.value : '';
    const splice = textSplice(before, after, textSpliceHint(previous.id));
    recordSpliceText(previous.id, splice.utf16Start, splice.deleteCount, splice.insert);
    return;
  }
  if (qnameChanged(previous, next)) recordPutNode(nodeDescriptor(next));
  lowerAttributes(previous.id, previous, next);
  lowerNamespaceBindings(previous.id, previous, next);
  lowerChildList(previous.id, previous.children, next.children, knownIds, previousNodes);
}

function lowerChildList(
  parentLogicalId: string,
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  knownIds?: KnownIds,
  previousNodes?: ReadonlyMap<string, OoxmlNode>
): void {
  if (previous === next) return;
  const previousById = new Map<string, OoxmlNode>();
  for (const child of previous) previousById.set(child.id, child);

  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start]!.id === next[start]!.id
  ) {
    lowerSameIdentity(previous[start]!, next[start]!, knownIds, previousNodes);
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1]!.id === next[nextEnd - 1]!.id
  ) {
    lowerSameIdentity(previous[previousEnd - 1]!, next[nextEnd - 1]!, knownIds, previousNodes);
    previousEnd -= 1;
    nextEnd -= 1;
  }

  // Children that stay between the trimmed ends keep their place in the shared list. A
  // rebuild that wraps a kept run (new properties before it, pasted runs after it) otherwise
  // deleted and reinserted that run, and two peers rebuilding one paragraph then merged both
  // lists side by side, so the kept run's text moved behind the other peer's insertion.
  const found = keptMiddle(previous, next, start, previousEnd, nextEnd);
  // A child that changes place among kept siblings leaves its old slot before it takes the
  // new one, so no splice lists it twice in this parent.
  const lifted =
    found.length > 0
      ? liftMovedChildren(parentLogicalId, previous, next, { start, previousEnd, nextEnd }, found)
      : null;
  const remaining = lifted?.previous ?? previous;
  const kept = lifted?.kept ?? found;
  const remainingEnd = previousEnd - (previous.length - remaining.length);
  let previousAt = start;
  let nextAt = start;
  let cursor = start;
  for (const [previousIndex, nextIndex] of [...kept, [remainingEnd, nextEnd] as const]) {
    const deleted = previousIndex - previousAt;
    const inserted = next.slice(nextAt, nextIndex);
    if (deleted > 0 || inserted.length > 0) {
      lowerInserted(inserted, previousById, knownIds, previousNodes);
      recordSpliceChildren(
        parentLogicalId,
        cursor,
        deleted,
        inserted.map((child) => child.id)
      );
    }
    cursor += inserted.length;
    if (previousIndex < remainingEnd) {
      lowerSameIdentity(remaining[previousIndex]!, next[nextIndex]!, knownIds, previousNodes);
      cursor += 1;
    }
    previousAt = previousIndex + 1;
    nextAt = nextIndex + 1;
  }
}

function lowerInserted(
  inserted: readonly OoxmlNode[],
  previousById: ReadonlyMap<string, OoxmlNode>,
  knownIds?: KnownIds,
  previousNodes?: ReadonlyMap<string, OoxmlNode>
): void {
  for (const node of inserted) {
    const prior = previousById.get(node.id) ?? previousNodes?.get(node.id);
    if (prior) {
      // A rejected deletion unwraps `w:del` and turns `w:delText` into `w:t` on the same id.
      // That run was a grandchild, so a parent-only previous list skipped the qname change.
      // Replay then kept `w:delText` outside any wrapper.
      if (prior !== node) lowerSameIdentity(prior, node, knownIds, previousNodes);
      continue;
    }
    // Existing document nodes that MOVE into this parent must not be re-expanded. Re-emitting
    // putNode/spliceText for a joined run duplicates its text on replay. `expandInserted`
    // still diffs a moved node against its indexed previous version, so a move that also
    // edits the subtree reaches the journal.
    expandInserted(node, knownIds, previousNodes);
  }
}

/**
 * Remove, as their own splices, the children that both middles hold but the kept order does not.
 *
 * Splices run in list order. A child that moves toward the start of the list was inserted at
 * its new slot before the splice that removed its old one. The list then held one id twice,
 * and an apply that shows only one copy of a repeated child read the later removal as the next
 * sibling: moving a block up by two dropped the block after its old place. Removing moved
 * children first, right to left, keeps every list free of repeats and every index unambiguous.
 *
 * Returns the previous list without the moved children and the kept pairs reindexed to it, or
 * null when nothing moved.
 */
function liftMovedChildren(
  parentLogicalId: string,
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  middle: { readonly start: number; readonly previousEnd: number; readonly nextEnd: number },
  kept: readonly (readonly [number, number])[]
): { previous: OoxmlNode[]; kept: (readonly [number, number])[] } | null {
  // Only the middles can hold a moved child: the trimmed ends match by id and position.
  const keptAt = new Set(kept.map(([previousIndex]) => previousIndex));
  const nextIds = new Set<string>();
  for (let index = middle.start; index < middle.nextEnd; index += 1) nextIds.add(next[index]!.id);
  const movedAt: number[] = [];
  for (let index = middle.start; index < middle.previousEnd; index += 1) {
    if (!keptAt.has(index) && nextIds.has(previous[index]!.id)) movedAt.push(index);
  }
  if (movedAt.length === 0) return null;
  let end = movedAt.length;
  while (end > 0) {
    let run = end - 1;
    while (run > 0 && movedAt[run - 1] === movedAt[run]! - 1) run -= 1;
    recordSpliceChildren(parentLogicalId, movedAt[run]!, end - run, []);
    end = run;
  }
  const moved = new Set(movedAt);
  let skipped = 0;
  return {
    previous: previous.filter((_, index) => !moved.has(index)),
    kept: kept.map(([previousIndex, nextIndex]) => {
      while (skipped < movedAt.length && movedAt[skipped]! < previousIndex) skipped += 1;
      return [previousIndex - skipped, nextIndex] as const;
    }),
  };
}

/** Above this many index pairs the middle is lowered as one splice, as before. */
const MAX_KEPT_SEARCH_CELLS = 4096;

/**
 * Index pairs of the longest run of children, in order, that both middles share by id.
 * Ascending in both lists. Empty when either middle is empty or too large to search.
 */
function keptMiddle(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  start: number,
  previousEnd: number,
  nextEnd: number
): (readonly [number, number])[] {
  const rows = previousEnd - start;
  const columns = nextEnd - start;
  if (rows === 0 || columns === 0 || rows * columns > MAX_KEPT_SEARCH_CELLS) return [];
  const nextIndexOf = new Map<string, number>();
  for (let index = start; index < nextEnd; index += 1) nextIndexOf.set(next[index]!.id, index);
  let shared = false;
  for (let index = start; index < previousEnd && !shared; index += 1) {
    shared = nextIndexOf.has(previous[index]!.id);
  }
  if (!shared) return [];
  // lengths[i][j]: longest shared order of previous[start + i ..] and next[start + j ..].
  const width = columns + 1;
  const lengths = new Uint16Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        previous[start + i]!.id === next[start + j]!.id
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const pairs: (readonly [number, number])[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (previous[start + i]!.id === next[start + j]!.id) {
      pairs.push([start + i, start + j]);
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** Lower `replaceChildren` after a successful edit. */
export function captureReplaceChildren(
  target: OoxmlElement,
  children: readonly OoxmlNode[],
  knownIds?: KnownIds
): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  // Index only the children the edit replaces or removes. A child kept by identity lowers as
  // no change, and no other child can hold a node of its unchanged subtree. Enter and
  // Backspace replace the body's child list, so indexing every kept paragraph made each one
  // cost the size of the document.
  const previousNodes = new Map<string, OoxmlNode>([[target.id, target]]);
  const stays = new Set(children);
  for (const child of target.children) {
    if (!stays.has(child)) indexSubtree(child, previousNodes);
  }
  lowerChildList(target.id, target.children, children, knownIds, previousNodes);
}

/** Lower `insertChildren` after a successful edit. */
export function captureInsertChildren(
  target: OoxmlElement,
  index: number,
  children: readonly OoxmlNode[],
  knownIds?: KnownIds
): void {
  if (!isCanonicalPrimitiveCaptureActive() || children.length === 0) return;
  const at = Math.max(0, Math.min(index, target.children.length));
  const existing = new Set(target.children.map((child) => child.id));
  for (const child of children) {
    if (existing.has(child.id) || knownIds?.has(child.id)) continue;
    expandInserted(child, knownIds);
  }
  recordSpliceChildren(
    target.id,
    at,
    0,
    children.map((child) => child.id)
  );
}

/** Lower `moveChild` after a successful edit; `index` counts siblings without the moved child. */
export function captureMoveChild(parentId: string, childId: string, index: number): void {
  if (isCanonicalPrimitiveCaptureActive()) recordMoveNode(childId, parentId, index);
}

/** Lower `removeNode` after a successful edit. */
export function captureRemoveNode(parent: OoxmlElement, nodeId: string): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  const index = parent.children.findIndex((child) => child.id === nodeId);
  if (index < 0) return;
  recordSpliceChildren(parent.id, index, 1, []);
}

/** Lower `replaceNode` after a successful edit. */
export function captureReplaceNode(
  previous: OoxmlNode,
  parent: OoxmlElement | null,
  replacement: OoxmlNode,
  knownIds?: KnownIds
): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  if (previous.id === replacement.id) {
    const previousNodes = new Map<string, OoxmlNode>();
    indexSubtree(previous, previousNodes);
    lowerSameIdentity(previous, replacement, knownIds, previousNodes);
    return;
  }
  if (!parent) return;
  const index = parent.children.findIndex((child) => child.id === previous.id);
  if (index < 0) return;
  // Index the replaced subtree, so a known node MOVED into the replacement still lowers as a
  // same-identity diff of its edit rather than replaying with its previous content.
  const previousNodes = new Map<string, OoxmlNode>();
  indexSubtree(previous, previousNodes);
  expandInserted(replacement, knownIds, previousNodes);
  recordSpliceChildren(parent.id, index, 1, [replacement.id]);
}

/**
 * Lower an id-aligned rewrite of one subtree: `next` keeps the ids of `previous` wherever the
 * two describe the same node, and every other node in `next` carries an id `previous` lacks.
 *
 * Kept children appear in the same relative order in both lists, so a two-pointer walk finds
 * them without the bounded LCS of {@link lowerChildList}. A kept child therefore never lowers as
 * a deletion plus a reinsertion, which a peer would read as moving content it is editing.
 */
export function captureAlignedSubtree(previous: OoxmlNode, next: OoxmlNode): void {
  if (!isCanonicalPrimitiveCaptureActive() || previous === next) return;
  lowerAligned(previous, next);
}

function lowerAligned(previous: OoxmlNode, next: OoxmlNode): void {
  if (previous === next) return;
  if (previous.kind === 'textValue' || next.kind === 'textValue') {
    lowerSameIdentity(previous, next);
    return;
  }
  if (qnameChanged(previous, next)) recordPutNode(nodeDescriptor(next));
  lowerAttributes(previous.id, previous, next);
  lowerNamespaceBindings(previous.id, previous, next);
  if (previous.children === next.children) return;
  const nextIds = new Set<string>();
  for (const child of next.children) nextIds.add(child.id);
  const previousById = new Map<string, OoxmlNode>();
  for (const child of previous.children) previousById.set(child.id, child);
  let cursor = 0;
  let at = 0;
  const before = previous.children;
  const after = next.children;
  let index = 0;
  while (index < after.length || at < before.length) {
    // Children `next` dropped leave first, as one splice per run.
    let removed = 0;
    while (at + removed < before.length && !nextIds.has(before[at + removed]!.id)) removed += 1;
    // Children only `next` holds arrive as one splice per run.
    const inserted: OoxmlNode[] = [];
    while (index < after.length && !previousById.has(after[index]!.id)) {
      inserted.push(after[index]!);
      index += 1;
    }
    if (removed > 0 || inserted.length > 0) {
      for (const node of inserted) expandInserted(node);
      recordSpliceChildren(
        previous.id,
        cursor,
        removed,
        inserted.map((node) => node.id)
      );
      at += removed;
      cursor += inserted.length;
    }
    if (index < after.length && at < before.length) {
      // A kept child out of order would need a move; alignment never produces one.
      if (before[at]!.id !== after[index]!.id) throw new Error('unaligned children');
      lowerAligned(before[at]!, after[index]!);
      at += 1;
      index += 1;
      cursor += 1;
    } else if (removed === 0 && inserted.length === 0) {
      break;
    }
  }
}

/** Lower a new or replaced XML part root before `putXmlPart`. */
export function captureXmlPartRoot(part: OoxmlPart, knownIds?: KnownIds): void {
  if (!isCanonicalPrimitiveCaptureActive()) return;
  expandInserted(part.root, knownIds);
  recordPutXmlPart(part.name, part.root.id);
}
