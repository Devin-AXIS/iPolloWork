// Authoring bookmarks: add a named marker pair around a range, or take one away.
//
// A bookmark is a `w:bookmarkStart` carrying the name and a `w:bookmarkEnd` closing it, paired
// by `@w:id`. Both are zero-width range markup between runs, so placing them splits a run at
// most and never moves an offset: every other position in the story stays where it was.
//
// NAMES ARE CASE-INSENSITIVE AND UNIQUE. Adding a name the part already declares, in any case,
// moves that bookmark: the old pair goes and the new one takes the name as written. Uniqueness
// across the parts of a package is the caller's half, because a tree op addresses one part:
// the editor and the automation API remove the name from the other part in the same package
// transaction (`withoutBookmarkInPart`), so the move is one undo step.
//
// A bookmark is not a revision. Its markers carry no author and no date, so adding or removing
// one in suggesting mode writes the markers directly, the way a reviewer's bookmark is added.

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  removeNode,
} from '../package/ooxml-edit.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { withPart, type OoxmlPackage } from '../package/ooxml-package.ts';
import { bookmarkNameKey, bookmarkNameProblem } from '../package/bookmark-names.ts';
import { listBookmarks, listBookmarkPairs } from '../package/bookmark-list.ts';
import { bookmarkPairNodes } from '../package/toc-build.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import { nextBookmarkId } from './tree-op-bookmark-ids.ts';
import { PackageEditRefusal } from './package-edit-refusal.ts';
import { markerSiteAt } from './tree-op-comments.ts';
import { effectiveContentLockAt, isBoundAt } from './tree-op-nodes.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

/** A text position in the op's part. */
export interface BookmarkOpPosition {
  readonly paragraphId: string;
  readonly offset: number;
}

/**
 * Add a bookmark around `start`..`end`, or at one point when the two are equal.
 *
 * The name must pass `bookmarkNameProblem`. A bookmark the part already declares under the
 * same name, compared without case, is removed in the same op.
 */
export interface InsertBookmarkOp {
  readonly op: 'insertBookmark';
  readonly name: string;
  readonly start: BookmarkOpPosition;
  readonly end: BookmarkOpPosition;
}

/**
 * Remove every marker pair that declares this name, compared without case. The name is the
 * one the file declares, so it is not held to the authoring rules.
 *
 * With `keepFirst`, remove only the copies: the pair `listBookmarks` answers for the name
 * stays where it is. Refused when the part holds no copy. Two collaborators who both remove
 * the copies remove the same nodes, so their edits converge on one bookmark.
 */
export interface DeleteBookmarkOp {
  readonly op: 'deleteBookmark';
  readonly name: string;
  readonly keepFirst?: boolean;
  /** @internal Limit a text deletion to one enclosed pair; explicit name deletion omits this. */
  readonly pair?: { readonly startNodeId: string; readonly endNodeId: string };
}

export type BookmarkTreeOp = InsertBookmarkOp | DeleteBookmarkOp;

/** Whether an op is one of the bookmark ops this module owns. */
export function isBookmarkTreeOp(op: { readonly op: string }): op is BookmarkTreeOp {
  return op.op === 'insertBookmark' || op.op === 'deleteBookmark';
}

export { withBookmarkEditRules } from './tree-op-bookmark-edits.ts';

/** The longest file-declared name a delete addresses; the read side lists no longer one. */
const MAX_DELETED_NAME_LENGTH = 256;

function wmlValue(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName
  )?.value;
}

/**
 * The marker nodes of every bookmark this name addresses: starts with the name, and the ends
 * that carry their `@w:id`. Ends are matched by id only within this part.
 */
function markerIdsNamed(part: OoxmlPart, name: string): readonly string[] {
  const key = bookmarkNameKey(name);
  const starts: string[] = [];
  const ids = new Set<string>();
  const ends: { readonly nodeId: string; readonly markerId: string }[] = [];
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.kind === 'bookmarkStart') {
      const named = wmlValue(node, 'name');
      const id = wmlValue(node, 'id');
      if (named !== undefined && bookmarkNameKey(named) === key) {
        starts.push(node.id);
        if (id !== undefined) ids.add(id);
      }
      continue;
    }
    if (node.kind === 'bookmarkEnd') {
      const id = wmlValue(node, 'id');
      if (id !== undefined) ends.push({ nodeId: node.id, markerId: id });
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return [...starts, ...ends.filter((end) => ids.has(end.markerId)).map((end) => end.nodeId)];
}

/** Exact canonical marker identities remain unambiguous when file-level ids repeat. */
function exactPairIds(part: OoxmlPart, op: DeleteBookmarkOp): readonly string[] {
  const key = bookmarkNameKey(op.name);
  const found = listBookmarkPairs(part).find(
    (record) =>
      record.startNodeId === op.pair?.startNodeId &&
      record.endNodeId === op.pair?.endNodeId &&
      bookmarkNameKey(record.name) === key
  );
  return found ? [found.startNodeId, found.endNodeId] : [];
}

/** The bookmark a name means in this part: the first, as `listBookmarks` answers. */
function firstNamed(part: OoxmlPart, name: string) {
  const key = bookmarkNameKey(name);
  return listBookmarks(part).find((record) => bookmarkNameKey(record.name) === key);
}

/** Document order of two paragraphs in one part: negative when `a` comes first. */
function paragraphOrder(part: OoxmlPart, a: string, b: string): number {
  if (a === b) return 0;
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.id === a) return -1;
    if (node.id === b) return 1;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }
  return 0;
}

function validPosition(part: OoxmlPart, position: BookmarkOpPosition): TreeOpRejection | null {
  if (!position || typeof position.paragraphId !== 'string') return 'unknown-paragraph';
  const paragraph = findNode(part, position.paragraphId);
  if (!paragraph) return 'unknown-paragraph';
  if (paragraph.kind !== 'paragraph') return 'not-a-paragraph';
  if (!Number.isInteger(position.offset) || position.offset < 0) return 'offset-out-of-range';
  if (position.offset > paragraphOffsetIndex(paragraph).length) return 'offset-out-of-range';
  if (isBoundAt(part, paragraph.id)) return 'bound';
  if (effectiveContentLockAt(part, paragraph.id).content) return 'locked';
  return null;
}

function removedMarkerIds(part: OoxmlPart, op: BookmarkTreeOp): readonly string[] {
  const kept = op.op === 'deleteBookmark' && op.keepFirst ? firstNamed(part, op.name) : undefined;
  const ids =
    op.op === 'deleteBookmark' && op.pair ? exactPairIds(part, op) : markerIdsNamed(part, op.name);
  return ids.filter((id) => id !== kept?.startNodeId && id !== kept?.endNodeId);
}

function markerRemovalRefusal(part: OoxmlPart, op: BookmarkTreeOp): TreeOpRejection | null {
  for (const id of removedMarkerIds(part, op)) {
    if (isBoundAt(part, id)) return 'bound';
    if (effectiveContentLockAt(part, id).content) return 'locked';
  }
  return null;
}

/** Refuse a bookmark op before any tree work, so a refusal is a true no-op. */
export function validateBookmarkOp(part: OoxmlPart, op: BookmarkTreeOp): TreeOpRejection | null {
  if (typeof op.name !== 'string') return 'invalidArgs';
  // A delete names a bookmark the file declares, which may predate the authoring rules.
  if (op.op === 'deleteBookmark') {
    if (op.name.length === 0 || op.name.length > MAX_DELETED_NAME_LENGTH) return 'invalidArgs';
    if (op.keepFirst !== undefined && typeof op.keepFirst !== 'boolean') return 'invalidArgs';
    if (op.pair !== undefined) {
      if (!op.pair || typeof op.pair !== 'object' || op.keepFirst) return 'invalidArgs';
      return exactPairIds(part, op).length === 2 ? markerRemovalRefusal(part, op) : 'invalidArgs';
    }
    if (op.keepFirst)
      return (firstNamed(part, op.name)?.copies ?? 0) > 1
        ? markerRemovalRefusal(part, op)
        : 'invalidArgs';
    return markerIdsNamed(part, op.name).length > 0
      ? markerRemovalRefusal(part, op)
      : 'invalidArgs';
  }
  if (bookmarkNameProblem(op.name) !== null) return 'invalidArgs';
  const start = validPosition(part, op.start);
  if (start) return start;
  const end = validPosition(part, op.end);
  if (end) return end;
  const order = paragraphOrder(part, op.start.paragraphId, op.end.paragraphId);
  if (order > 0 || (order === 0 && op.start.offset > op.end.offset)) return 'invalid-range';
  return markerRemovalRefusal(part, op);
}

/** Apply a validated bookmark op. */
export function applyBookmarkOp(
  part: OoxmlPart,
  op: BookmarkTreeOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateBookmarkOp(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const dirty = new Set<string>();
  let current = part;
  for (const nodeId of removedMarkerIds(part, op)) {
    const paragraph = paragraphOf(current, nodeId);
    if (paragraph) dirty.add(paragraph);
    const removed = removeNode(current, nodeId, options);
    if (!removed.ok) return { ok: false, reason: 'tree-invariant', detail: 'bookmark-remove' };
    current = removed.part;
  }
  if (op.op === 'insertBookmark') {
    const mintNode = createNodeIdAllocator(current);
    const pair = bookmarkPairNodes(mintNode, op.name, nextBookmarkId(current)());
    // The END first: placing it cannot move the start's offset, and at one point the start
    // then lands in front of it, which is the order a point bookmark is written in.
    for (const [position, node] of [
      [op.end, pair.end],
      [op.start, pair.start],
    ] as const) {
      const paragraph = findNode(current, position.paragraphId);
      if (!paragraph || paragraph.kind !== 'paragraph')
        return { ok: false, reason: 'tree-invariant' };
      const site = markerSiteAt(current, paragraph, position.offset, options);
      if (!site.ok) return site;
      const inserted = insertChildren(site.part, site.containerId, site.index, [node], options);
      if (!inserted.ok) return { ok: false, reason: 'tree-invariant', detail: 'bookmark-insert' };
      current = inserted.part;
      dirty.add(position.paragraphId);
    }
  }
  return {
    ok: true,
    part: current,
    effect: {
      dirty: [...dirty],
      created: [],
      deleted: [],
      dependencyKeys: [DEPENDENCY_KEY_IDS.story],
      // Markers add no characters and no height.
      impact: 'text-local',
    },
  };
}

/**
 * The package with every bookmark of this name removed from one part, for moving a name out
 * of another story inside the same transaction. The package is unchanged when that part does
 * not declare the name. Protected markers refuse the whole package transaction.
 */
export function withoutBookmarkInPart(
  pkg: OoxmlPackage,
  partName: string,
  name: string
): OoxmlPackage {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const result = applyBookmarkOp(part, { op: 'deleteBookmark', name });
  // Refuse the whole package transaction when another story protects these markers.
  if (!result.ok && (result.reason === 'locked' || result.reason === 'bound')) {
    throw new PackageEditRefusal('bookmark markers are protected', result.reason);
  }
  return result.ok ? withPart(pkg, result.part) : pkg;
}

/**
 * The `deleteBookmark` ops for the bookmarks an untracked deletion of `from`..`to` encloses,
 * for a deletion that crosses paragraphs. `order` lists the part's paragraph ids in document
 * order. A range bookmark goes when the deletion covers it edge to edge; a point bookmark goes
 * when it is strictly inside. Applied before the text ops, so they find nothing left to drop.
 */
export function enclosedBookmarkDeletions(
  part: OoxmlPart,
  from: BookmarkOpPosition,
  to: BookmarkOpPosition,
  order: readonly string[]
): readonly DeleteBookmarkOp[] {
  const index = new Map(order.map((id, position) => [id, position]));
  const key = (position: BookmarkOpPosition) =>
    [index.get(position.paragraphId) ?? -1, position.offset] as const;
  const compare = (a: BookmarkOpPosition, b: BookmarkOpPosition) => {
    const [ap, ao] = key(a);
    const [bp, bo] = key(b);
    return ap === bp ? ao - bo : ap - bp;
  };
  if (!index.has(from.paragraphId) || !index.has(to.paragraphId)) return [];
  const ops: DeleteBookmarkOp[] = [];
  for (const record of listBookmarkPairs(part)) {
    if (!index.has(record.start.paragraphId) || !index.has(record.end.paragraphId)) continue;
    const point = compare(record.start, record.end) === 0;
    const enclosed = point
      ? compare(from, record.start) < 0 && compare(record.start, to) < 0
      : compare(from, record.start) <= 0 && compare(record.end, to) <= 0;
    if (enclosed)
      ops.push({
        op: 'deleteBookmark',
        name: record.name,
        pair: { startNodeId: record.startNodeId, endNodeId: record.endNodeId },
      });
  }
  return ops;
}

/** The paragraph a node sits in, or null for a marker between blocks. */
function paragraphOf(part: OoxmlPart, nodeId: string): string | null {
  const stack: { readonly node: OoxmlNode; readonly paragraph: string | null }[] = [
    { node: part.root, paragraph: null },
  ];
  while (stack.length > 0) {
    const { node, paragraph } = stack.pop()!;
    if (node.kind === 'textValue') continue;
    const inside = node.kind === 'paragraph' ? node.id : paragraph;
    if (node.id === nodeId) return inside;
    for (const child of node.children) stack.push({ node: child, paragraph: inside });
  }
  return null;
}
