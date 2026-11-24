// Identity alignment for a document update: the incoming package's content, with the open
// package's node ids wherever the two describe the same node.
//
// A package read from bytes carries ids minted from its own structure, so none of them name
// a node of the open document. Installing it verbatim loses every reference that names a node
// (the caret, comment anchors on screen, a peer's cursor) and lowers to a journal that deletes
// and recreates the whole document. Alignment keeps those references: a paragraph the update
// left alone keeps its node, and the same OBJECT where its subtree is unchanged, so layout
// caches keyed by identity still hit. An edited paragraph keeps its id and lowers as the
// splices of its edit.
//
// Content never comes from the open package. Matching decides ids only, and a matched node is
// reused as an object only when it equals the incoming node exactly, so a wrong match costs a
// larger edit, never different content.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { W14_NAMESPACE_URI, WML_NAMESPACE_URI } from './ooxml-shared.ts';

/** Above this many cells a gap between anchors is paired greedily instead of by LCS. */
const MAX_GAP_CELLS = 4096;
/** How far a greedy pass looks ahead for a compatible node. */
const GREEDY_WINDOW = 32;

const exactHashes = new WeakMap<OoxmlNode, string>();
const contentHashes = new WeakMap<OoxmlNode, string>();

function mix(hash: number, value: number): number {
  return Math.imul(hash ^ value, 16777619) >>> 0;
}

function mixText(hash: number, text: string): number {
  let next = mix(hash, text.length);
  for (let index = 0; index < text.length; index += 1) next = mix(next, text.charCodeAt(index));
  return next;
}

/**
 * Attributes that name a node rather than say what it holds: paragraph and text ids, and
 * revision-session ids. A processor may drop or remint them, and an open mints missing
 * paragraph ids by position, so they must not decide which nodes hold the same content.
 */
function isIdentityAttribute(namespaceUri: string, localName: string): boolean {
  if (namespaceUri === W14_NAMESPACE_URI) return localName === 'paraId' || localName === 'textId';
  return namespaceUri === WML_NAMESPACE_URI && localName.startsWith('rsid');
}

/**
 * Two independent 32-bit hashes of the node's whole subtree, memoized per node object.
 * `content` leaves identity attributes out, so a reminted paragraph still hashes as itself.
 */
function hashOf(node: OoxmlNode, content = false): string {
  const memo = content ? contentHashes : exactHashes;
  const known = memo.get(node);
  if (known !== undefined) return known;
  let left = 2166136261;
  let right = 5381;
  const add = (text: string): void => {
    left = mixText(left, text);
    right = mixText(right ^ 0x9e3779b9, text);
  };
  if (node.kind === 'textValue') {
    add('#text');
    add(node.value);
  } else {
    add(node.kind);
    add(node.namespaceUri);
    add(node.localName);
    add(node.prefix ?? '');
    for (const binding of node.namespaceBindings) {
      add(binding.prefix);
      add(binding.namespaceUri);
    }
    for (const attribute of node.attributes) {
      if (content && isIdentityAttribute(attribute.namespaceUri, attribute.localName)) continue;
      add(attribute.namespaceUri);
      add(attribute.localName);
      add(attribute.prefix ?? '');
      add(attribute.value);
    }
    for (const child of node.children) add(hashOf(child, content));
  }
  const hash = `${left.toString(36)}.${right.toString(36)}`;
  memo.set(node, hash);
  return hash;
}

/** Exact structural equality, including authored prefixes and attribute order. */
function sameTree(left: OoxmlNode, right: OoxmlNode): boolean {
  if (left === right) return true;
  if (left.kind === 'textValue' || right.kind === 'textValue') {
    return left.kind === 'textValue' && right.kind === 'textValue' && left.value === right.value;
  }
  if (
    left.kind !== right.kind ||
    left.namespaceUri !== right.namespaceUri ||
    left.localName !== right.localName ||
    left.prefix !== right.prefix ||
    left.attributes.length !== right.attributes.length ||
    left.namespaceBindings.length !== right.namespaceBindings.length ||
    left.children.length !== right.children.length ||
    hashOf(left) !== hashOf(right)
  )
    return false;
  for (let index = 0; index < left.attributes.length; index += 1) {
    const a = left.attributes[index]!;
    const b = right.attributes[index]!;
    if (
      a.kind !== b.kind ||
      a.namespaceUri !== b.namespaceUri ||
      a.localName !== b.localName ||
      a.prefix !== b.prefix ||
      a.value !== b.value
    )
      return false;
  }
  for (let index = 0; index < left.namespaceBindings.length; index += 1) {
    const a = left.namespaceBindings[index]!;
    const b = right.namespaceBindings[index]!;
    if (a.prefix !== b.prefix || a.namespaceUri !== b.namespaceUri) return false;
  }
  for (let index = 0; index < left.children.length; index += 1) {
    if (!sameTree(left.children[index]!, right.children[index]!)) return false;
  }
  return true;
}

/**
 * An identity a file keeps across edits: a paragraph or row `w14:paraId`, or a `w:id` such as
 * a comment's or a revision's. Null for nodes without one.
 */
function strongKey(node: OoxmlNode): string | null {
  if (node.kind === 'textValue') return null;
  for (const attribute of node.attributes) {
    if (
      (attribute.namespaceUri === W14_NAMESPACE_URI && attribute.localName === 'paraId') ||
      (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'id')
    ) {
      return `${node.namespaceUri}\0${node.localName}\0${attribute.localName}\0${attribute.value}`;
    }
  }
  return null;
}

function compatible(left: OoxmlNode, right: OoxmlNode): boolean {
  if (left.kind === 'textValue' || right.kind === 'textValue') return left.kind === right.kind;
  return (
    left.kind === right.kind &&
    left.namespaceUri === right.namespaceUri &&
    left.localName === right.localName
  );
}

/** The same content, whatever ids the two carry. */
function sameContent(left: OoxmlNode, right: OoxmlNode): boolean {
  return compatible(left, right) && hashOf(left, true) === hashOf(right, true);
}

type Pair = readonly [number, number];
type Key = (node: OoxmlNode) => string | null;

const contentKey: Key = (node) => hashOf(node, true);

/**
 * Pairs of indexes, ascending in both lists, of children that name the same node. A child
 * that moved pairs with nothing: it lowers as a removal and an insertion, never a move.
 *
 * Content decides first: equal ends, then children whose content occurs once on each side
 * (patience matching). Kept ids decide only between those anchors, because an open mints a
 * missing paragraph id by position: after a removed paragraph, the next one carries the
 * removed one's id, and matching by id first would rewrite every paragraph below it.
 */
export function matchChildren(previous: readonly OoxmlNode[], next: readonly OoxmlNode[]): Pair[] {
  const pairs: Pair[] = [];
  matchRange(previous, next, [0, previous.length, 0, next.length], contentKey, pairs);
  return pairs;
}

/** `[previousStart, previousEnd, nextStart, nextEnd]`. */
type Range = readonly [number, number, number, number];

function matchRange(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  range: Range,
  key: Key,
  out: Pair[]
): void {
  let [previousStart, previousEnd, nextStart, nextEnd] = range;
  while (
    previousStart < previousEnd &&
    nextStart < nextEnd &&
    sameContent(previous[previousStart]!, next[nextStart]!)
  ) {
    out.push([previousStart, nextStart]);
    previousStart += 1;
    nextStart += 1;
  }
  const tail: Pair[] = [];
  while (
    previousEnd > previousStart &&
    nextEnd > nextStart &&
    sameContent(previous[previousEnd - 1]!, next[nextEnd - 1]!)
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
    tail.push([previousEnd, nextEnd]);
  }
  let previousAt = previousStart;
  let nextAt = nextStart;
  const middle: Range = [previousStart, previousEnd, nextStart, nextEnd];
  for (const anchor of uniqueAnchors(previous, next, middle, key)) {
    matchGap(previous, next, [previousAt, anchor[0], nextAt, anchor[1]], key, out);
    out.push(anchor);
    previousAt = anchor[0] + 1;
    nextAt = anchor[1] + 1;
  }
  matchGap(previous, next, [previousAt, previousEnd, nextAt, nextEnd], key, out);
  for (let index = tail.length - 1; index >= 0; index -= 1) out.push(tail[index]!);
}

/**
 * Children whose key occurs exactly once on each side of the range, kept in order by the
 * longest increasing run of their positions (patience matching), in O(n log n). Children
 * without a key never anchor.
 */
function uniqueAnchors(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  [previousStart, previousEnd, nextStart, nextEnd]: Range,
  key: Key
): Pair[] {
  if (previousStart >= previousEnd || nextStart >= nextEnd) return [];
  const counts = new Map<string, { previous: number; next: number; at: number }>();
  for (let index = previousStart; index < previousEnd; index += 1) {
    const value = key(previous[index]!);
    if (value === null) continue;
    const entry = counts.get(value);
    if (entry) entry.previous += 1;
    else counts.set(value, { previous: 1, next: 0, at: index });
  }
  const nextKeys: (string | null)[] = [];
  for (let index = nextStart; index < nextEnd; index += 1) {
    const value = key(next[index]!);
    nextKeys.push(value);
    const entry = value === null ? undefined : counts.get(value);
    if (entry) entry.next += 1;
  }
  const candidates: Pair[] = [];
  for (let index = nextStart; index < nextEnd; index += 1) {
    const value = nextKeys[index - nextStart];
    const entry = value === null || value === undefined ? undefined : counts.get(value);
    if (entry && entry.previous === 1 && entry.next === 1) {
      if (compatible(previous[entry.at]!, next[index]!)) candidates.push([entry.at, index]);
    }
  }
  return longestIncreasing(candidates);
}

/** The longest run of candidates (ascending in `next`) whose `previous` indexes also ascend. */
function longestIncreasing(candidates: readonly Pair[]): Pair[] {
  if (candidates.length === 0) return [];
  const tails: number[] = [];
  const parents = new Int32Array(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index]![0];
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[tails[middle]!]![0] < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) parents[index] = tails[low - 1]!;
    tails[low] = index;
  }
  const run: Pair[] = [];
  for (let at = tails[tails.length - 1]!; at >= 0; at = parents[at]!) run.push(candidates[at]!);
  return run.reverse();
}

/**
 * Pair the children between two content anchors: by kept ids once, then by weighted LCS for a
 * small gap or greedily for a large one.
 */
function matchGap(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  range: Range,
  key: Key,
  out: Pair[]
): void {
  const [previousStart, previousEnd, nextStart, nextEnd] = range;
  if (previousStart >= previousEnd || nextStart >= nextEnd) return;
  if (key === contentKey) {
    matchRange(previous, next, range, strongKey, out);
    return;
  }
  const rows = previousEnd - previousStart;
  const columns = nextEnd - nextStart;
  if (rows * columns <= MAX_GAP_CELLS) {
    weightedLcs(previous, next, previousStart, previousEnd, nextStart, nextEnd, out);
  } else {
    greedy(previous, next, previousStart, previousEnd, nextStart, nextEnd, out);
  }
}

function weight(left: OoxmlNode, right: OoxmlNode): number {
  if (!compatible(left, right)) return 0;
  if (hashOf(left, true) === hashOf(right, true)) return 4;
  const leftKey = strongKey(left);
  return leftKey !== null && leftKey === strongKey(right) ? 3 : 1;
}

function weightedLcs(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  previousStart: number,
  previousEnd: number,
  nextStart: number,
  nextEnd: number,
  out: Pair[]
): void {
  const rows = previousEnd - previousStart;
  const columns = nextEnd - nextStart;
  const width = columns + 1;
  const best = new Float64Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      const pair = weight(previous[previousStart + i]!, next[nextStart + j]!);
      const take = pair > 0 ? pair + best[(i + 1) * width + j + 1]! : 0;
      best[i * width + j] = Math.max(take, best[(i + 1) * width + j]!, best[i * width + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    const pair = weight(previous[previousStart + i]!, next[nextStart + j]!);
    if (pair > 0 && best[i * width + j] === pair + best[(i + 1) * width + j + 1]!) {
      out.push([previousStart + i, nextStart + j]);
      i += 1;
      j += 1;
    } else if (best[(i + 1) * width + j]! >= best[i * width + j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
}

function greedy(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[],
  previousStart: number,
  previousEnd: number,
  nextStart: number,
  nextEnd: number,
  out: Pair[]
): void {
  let at = previousStart;
  for (let index = nextStart; index < nextEnd && at < previousEnd; index += 1) {
    const limit = Math.min(previousEnd, at + GREEDY_WINDOW);
    for (let candidate = at; candidate < limit; candidate += 1) {
      if (compatible(previous[candidate]!, next[index]!)) {
        out.push([candidate, index]);
        at = candidate + 1;
        break;
      }
    }
  }
}

/** Give every node of a subtree the open package has no counterpart for a fresh id. */
function withFreshIds(node: OoxmlNode, mint: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: mint() };
  return {
    ...node,
    id: mint(),
    children: node.children.map((child) => withFreshIds(child, mint)),
  } as OoxmlNode;
}

function alignNode(previous: OoxmlNode, next: OoxmlNode, mint: () => string): OoxmlNode {
  if (sameTree(previous, next)) return previous;
  if (next.kind === 'textValue')
    return next.id === previous.id ? next : { ...next, id: previous.id };
  if (previous.kind === 'textValue') return withFreshIds(next, mint);
  const counterparts: (OoxmlNode | undefined)[] = new Array(next.children.length);
  for (const [previousIndex, nextIndex] of matchChildren(previous.children, next.children)) {
    counterparts[nextIndex] = previous.children[previousIndex];
  }
  const children = next.children.map((child, index) => {
    const counterpart = counterparts[index];
    return counterpart ? alignNode(counterpart, child, mint) : withFreshIds(child, mint);
  });
  return { ...next, id: previous.id, children } as OoxmlNode;
}

/**
 * `next`'s content with `previous`'s ids where they correspond. Every other node takes an id
 * from `mint`, which must never return an id `previous` (or its history) holds.
 */
export function alignPartUpdate(
  previous: OoxmlPart,
  next: OoxmlPart,
  mint: () => string
): OoxmlPart {
  const root = alignNode(previous.root, next.root, mint) as OoxmlElement;
  if (root === previous.root && next.contentType === previous.contentType) return previous;
  return { ...next, id: previous.id, root };
}
