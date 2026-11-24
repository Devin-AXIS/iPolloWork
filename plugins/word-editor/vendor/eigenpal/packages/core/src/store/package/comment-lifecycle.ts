// Removing a comment, and reaping the ones an edit emptied.
//
// A comment is spread over three places: the `w:comment` body in `comments.xml`, the
// `w15:commentEx` thread record in `commentsExtended.xml`, and the
// `w:commentRangeStart`/`w:commentRangeEnd`/`w:commentReference` markers in whichever story it
// annotates. Removing one of the three leaves the file describing a remark that is half there —
// a body no marker points at, or markers naming a comment the package cannot resolve — so all
// of it goes together, as ONE package edit and therefore one undo step.
//
// A THREAD, not one remark, for the same reason `setCommentResolved` resolves a thread: a reply
// whose parent is gone has nothing left to answer, and Word deletes the conversation.
//
// The REAPING half exists because deleting text is how a comment usually dies. Word deletes a
// comment when the words it covered are deleted, and this engine used to keep the record: the
// rail went on drawing a card with an author, a date and nothing under it, and saving produced a
// file whose comment pointed at characters that no longer existed.
//
// The test is deliberately narrow. A comment is reaped only when it COVERED characters before
// the edit in THAT story (and, for a notes part, that note) and, after it, either nothing in
// that story names it or its markers still pair with nothing between them. A neighbour that
// reused the same `w:id` is a different remark. So a comment the file itself shipped orphaned
// is left exactly as found, shortening a range does not take the remark with it, and — the
// case that is easy to get wrong — losing only the `w:commentRangeStart` does not either: the
// `w:commentReference` is what places a comment, and Word keeps one whose reference and words
// are still there.

import { findNode, removeNode, replaceNode } from './ooxml-edit.ts';
import { commentDeletionBudget } from './comment-deletion-budget.ts';
import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { noteIdOf, notesOf } from './note-nodes.ts';
import { type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';
import {
  attribute,
  chargePart,
  chargeVisit,
  collectOwnerAnchorStates,
  collectOwnerMarkers,
  commentRecordsIn,
  commentsPartNameForStory,
  createCommentScanBudget,
  idsStillMarked,
  keyedMetadataIn,
  type CommentRecord,
  type CommentScanBudget,
  type MarkerHits,
  type OwnerAnchorState,
  W15_NAMESPACE_URI,
  W16CID_NAMESPACE_URI,
} from './comment-lifecycle-scan.ts';
import {
  expandThread,
  ownerMetadataParts,
  threadChildrenOf,
  type CommentDeletionOwner,
} from './comment-lifecycle-thread.ts';

export {
  indexCommentThread,
  type CommentDeletionOwner,
  type CommentExIndexEntry,
  type CommentThreadIndexReason,
  type CommentThreadIndexResult,
} from './comment-lifecycle-thread.ts';

export { hasAnyComment } from '../store/comment-reads.ts';

/** The `w14` namespace, where `paraId` lives — the key thread state is recorded under. */
const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';

function defaultOwner(pkg: OoxmlPackage): CommentDeletionOwner {
  return { storyPartName: pkg.mainDocumentPart };
}

const notesByIdCache = new WeakMap<OoxmlNode, Map<number, OoxmlNode>>();

/** One O(n) index per notes-part root; lookups are O(1). */
function notesById(root: OoxmlNode): Map<number, OoxmlNode> {
  const cached = notesByIdCache.get(root);
  if (cached) return cached;
  const indexed = new Map<number, OoxmlNode>();
  for (const note of notesOf(root)) {
    const id = noteIdOf(note);
    if (id !== null) indexed.set(id, note);
  }
  notesByIdCache.set(root, indexed);
  return indexed;
}

function storyRootOf(pkg: OoxmlPackage, owner: CommentDeletionOwner): OoxmlNode | null {
  const part = pkg.parts.get(owner.storyPartName);
  if (!part) return null;
  if (owner.noteId === undefined) return part.root;
  return notesById(part.root).get(owner.noteId) ?? null;
}

/**
 * Notes in a shared part are each a story. Expanding `owner` without a `noteId` is what stops
 * a footnotes.xml walk from treating two notes that reused `w:id` as one remark.
 */
function expandOwners(
  pkg: OoxmlPackage,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): CommentDeletionOwner[] {
  if (owner.noteId !== undefined) return [owner];
  const part = pkg.parts.get(owner.storyPartName);
  if (!part || (part.root.kind !== 'footnotes' && part.root.kind !== 'endnotes')) return [owner];
  if (!chargePart(budget)) return [];
  const expanded: CommentDeletionOwner[] = [];
  for (const note of notesOf(part.root)) {
    if (!chargeVisit(budget)) return expanded;
    const id = noteIdOf(note);
    if (id === null || id <= 0) continue;
    expanded.push({ storyPartName: owner.storyPartName, noteId: id });
  }
  return expanded.length > 0 ? expanded : [owner];
}

/** Notes the edit removed (typically via reference cascade) — each is still a deletion owner. */
function vanishedNoteOwners(
  before: OoxmlPackage,
  after: OoxmlPackage,
  budget: CommentScanBudget
): CommentDeletionOwner[] {
  const owners: CommentDeletionOwner[] = [];
  for (const part of before.parts.values()) {
    if (part.root.kind !== 'footnotes' && part.root.kind !== 'endnotes') continue;
    if (!chargePart(budget)) return owners;
    const afterPart = after.parts.get(part.name);
    const afterIds = afterPart === undefined ? new Set<number>() : notesById(afterPart.root);
    for (const note of notesOf(part.root)) {
      if (!chargeVisit(budget)) return owners;
      const id = noteIdOf(note);
      if (id === null || id <= 0) continue;
      if (afterIds.has(id)) continue;
      owners.push({ storyPartName: part.name, noteId: id });
    }
  }
  return owners;
}

/** What one story (one note, when `noteId` is set) says about every comment's anchor. */
function anchorStates(
  pkg: OoxmlPackage,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): Map<string, OwnerAnchorState> | null {
  const root = storyRootOf(pkg, owner);
  if (!root) return new Map();
  if (!chargePart(budget)) return null;
  const { states, truncated } = collectOwnerAnchorStates(root, budget);
  return truncated ? null : states;
}

/** The `w14:paraId` of a comment's last paragraph, upper-cased, when it has one. */
function paraIdOf(comment: OoxmlElement): string | null {
  for (let index = comment.children.length - 1; index >= 0; index -= 1) {
    const child = comment.children[index]!;
    if (child.kind !== 'paragraph') continue;
    const value = attribute(child, W14_NAMESPACE_URI, 'paraId');
    return value === undefined ? null : value.toUpperCase();
  }
  return null;
}

function recordsForOwner(
  pkg: OoxmlPackage,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): Map<string, CommentRecord> {
  const commentsPart = commentsPartNameForStory(pkg, owner.storyPartName);
  return commentsPart === null ? new Map() : commentRecordsIn(pkg, commentsPart, budget);
}

/**
 * A comment and every comment that answers it, transitively, in this story's comments part
 * and that part's related commentsExtended — never every XML part, so a header comments part
 * that reused a paraId is not a child of the body's.
 *
 * Deletion expands first-wins and ignores duplicate-id refusal: overflow is the fail-closed
 * signal ({@link CommentScanBudget.truncated}), matching the rest of the reap path.
 */
function threadOf(
  pkg: OoxmlPackage,
  rootId: string,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): Set<string> {
  const built = threadChildrenOf(pkg, owner, budget, false);
  return expandThread(rootId, built.childrenOf, budget);
}

/** Remove named nodes from one part in a single rebuild, parents first. */
function removeFromPart(
  pkg: OoxmlPackage,
  partName: string,
  nodeIds: readonly string[]
): OoxmlPackage | null {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  let current = part;
  for (const nodeId of nodeIds) {
    if (!findNode(current, nodeId)) continue;
    const removed = removeNode(current, nodeId, { deferValidation: true });
    if (!removed.ok) return null;
    current = removed.part;
  }
  return current === part ? pkg : withPart(pkg, current);
}

/** Replace one namespaced attribute value on every matching element in a part. */
function replaceAttributeValues(
  pkg: OoxmlPackage,
  partName: string,
  replacements: ReadonlyMap<string, string>,
  namespaceUri: string,
  localName: string
): OoxmlPackage | null {
  const part = pkg.parts.get(partName);
  if (!part || replacements.size === 0) return pkg;
  let current = part;
  for (const [nodeId, value] of replacements) {
    const node = findNode(current, nodeId);
    if (!node || node.kind === 'textValue') continue;
    let changed = false;
    const attributes = node.attributes.map((entry) => {
      if (
        entry.kind !== 'genericExtension' ||
        entry.namespaceUri !== namespaceUri ||
        entry.localName !== localName
      ) {
        return entry;
      }
      changed = entry.value !== value;
      return changed ? { ...entry, value } : entry;
    });
    if (!changed) continue;
    const replacement = { ...node, attributes } as OoxmlElement;
    const replaced = replaceNode(current, nodeId, replacement, { deferValidation: true });
    if (!replaced.ok) return null;
    current = replaced.part;
  }
  return current === part ? pkg : withPart(pkg, current);
}

/**
 * Strip every `w:commentRangeStart` / `w:commentRangeEnd` / `w:commentReference` naming one of
 * `commentIds` in `owner`'s story. A header that reused the same `w:id` keeps its markers.
 *
 * A `w:commentReference` is a RUN CHILD, and a run left holding only its `w:rPr` renders
 * nothing — so an emptied run goes with it, exactly as the text-delete sweep drops one.
 */
function stripMarkers(
  pkg: OoxmlPackage,
  commentIds: ReadonlySet<string>,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): { readonly pkg: OoxmlPackage; readonly truncated: boolean } | null {
  const part = pkg.parts.get(owner.storyPartName);
  const root = storyRootOf(pkg, owner);
  if (!part || !root) return { pkg, truncated: false };
  if (!chargePart(budget)) return { pkg, truncated: true };
  const hits = collectOwnerMarkers(root, commentIds, budget);
  if (hits.truncated) return { pkg, truncated: true };
  if (hits.doomed.length === 0 && hits.emptiedRuns.length === 0) return { pkg, truncated: false };
  const next = removeFromPart(pkg, part.name, [...hits.emptiedRuns, ...hits.doomed]);
  return next === null ? null : { pkg: next, truncated: false };
}

function removeKeyedParaIdEntries(
  pkg: OoxmlPackage,
  paraIds: ReadonlySet<string>,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): OoxmlPackage | null {
  if (paraIds.size === 0) return pkg;
  const meta = ownerMetadataParts(pkg, owner);
  const doomedByPart = new Map<string, string[]>();
  for (const entry of keyedMetadataIn(pkg, [meta.extended, meta.ids], budget)) {
    const paraId =
      attribute(entry.node, W15_NAMESPACE_URI, 'paraId') ??
      attribute(entry.node, W16CID_NAMESPACE_URI, 'paraId');
    if (paraId === undefined || !paraIds.has(paraId.toUpperCase())) continue;
    const bucket = doomedByPart.get(entry.partName);
    if (bucket) bucket.push(entry.node.id);
    else doomedByPart.set(entry.partName, [entry.node.id]);
  }
  if (budget.truncated) return pkg;
  let next = pkg;
  for (const [partName, nodeIds] of doomedByPart) {
    const removed = removeFromPart(next, partName, nodeIds);
    if (removed === null) return null;
    next = removed;
  }
  return next;
}

function applyThreadDeletion(
  pkg: OoxmlPackage,
  commentId: string,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): OoxmlPackage | null {
  const records = recordsForOwner(pkg, owner, budget);
  if (!records.has(commentId)) return pkg;
  const thread = threadOf(pkg, commentId, owner, budget);
  if (budget.truncated) return pkg;

  const stripped = stripMarkers(pkg, thread, owner, budget);
  if (stripped === null) return null;
  if (stripped.truncated) return pkg;
  let next = stripped.pkg;

  // Records stay when another story still names the id. An incomplete scan cancels
  // the whole deletion because it cannot prove which records are unused.
  const remaining = idsStillMarked(
    next,
    thread,
    commentsPartNameForStory(pkg, owner.storyPartName),
    budget
  );
  if (remaining.truncated) return pkg;
  const doomedIds = new Set([...thread].filter((id) => !remaining.marked.has(id)));

  const paraIds = new Set<string>();
  const byPart = new Map<string, string[]>();
  for (const id of doomedIds) {
    const record = records.get(id);
    if (!record) continue;
    const paraId = paraIdOf(record.node);
    if (paraId !== null) paraIds.add(paraId);
    const bucket = byPart.get(record.partName);
    if (bucket) bucket.push(record.node.id);
    else byPart.set(record.partName, [record.node.id]);
  }

  for (const [partName, nodeIds] of byPart) {
    const removed = removeFromPart(next, partName, nodeIds);
    if (removed === null) return null;
    next = removed;
  }

  const cleaned = removeKeyedParaIdEntries(next, paraIds, owner, budget);
  return budget.truncated ? pkg : cleaned;
}

/**
 * Delete a comment thread: that story's markers, and metadata no other story still names.
 *
 * `owner` names the story whose markers may be stripped. Omitted, it is the main document
 * body — never every XML part. A header or note that reused the same `w:id` is a different
 * remark; pass its part (and `noteId` when the story is one note) to delete that one.
 *
 * Returns the package unchanged when the id names no comment, and null when a removal was
 * refused — a caller inside a transaction rolls back rather than committing a package whose
 * comment is half gone.
 */
export function deleteCommentThread(
  pkg: OoxmlPackage,
  commentId: string,
  owner?: CommentDeletionOwner
): OoxmlPackage | null {
  const budget = commentDeletionBudget(pkg);
  const result = applyThreadDeletion(pkg, commentId, owner ?? defaultOwner(pkg), budget);
  return budget.truncated ? null : result;
}

/**
 * Delete a comment thread in one story: that story's markers, and metadata no other story
 * still names.
 */
export function deleteCommentThreadInStory(
  pkg: OoxmlPackage,
  commentId: string,
  owner: CommentDeletionOwner
): OoxmlPackage | null {
  return deleteCommentThread(pkg, commentId, owner);
}

/** Test seam: inject a scan budget. Not re-exported from the package barrel. */
export function deleteCommentThreadWithBudget(
  pkg: OoxmlPackage,
  commentId: string,
  owner: CommentDeletionOwner | undefined,
  budget: CommentScanBudget
): OoxmlPackage | null {
  return applyThreadDeletion(pkg, commentId, owner ?? defaultOwner(pkg), budget);
}

/**
 * Delete one reply while preserving its parent, siblings and descendants.
 *
 * Descendants are reparented to the deleted reply's parent before its record is removed. Office's
 * public reply model is flat, but foreign files can carry nested `w15:paraIdParent` or
 * `w16cid:parentId` links; leaving either link pointed at a missing record would orphan comments
 * this operation did not ask to delete.
 *
 * Marker stripping is scoped to `owner`. The record stays when another story still names the id;
 * that path strips only this owner's markers and leaves parent links and metadata untouched.
 * Every bounded scan required for the deletion runs first; truncation returns the original
 * package so a remaining-marker overflow cannot commit a reparent or a stripped marker.
 *
 * Returns the package unchanged when either id no longer names a comment, and null when any
 * rewrite is refused.
 */
export function deleteCommentReply(
  pkg: OoxmlPackage,
  commentId: string,
  parentCommentId: string,
  owner: CommentDeletionOwner
): OoxmlPackage | null {
  const budget = commentDeletionBudget(pkg);
  const result = deleteCommentReplyWithBudget(pkg, commentId, parentCommentId, owner, budget);
  return budget.truncated ? null : result;
}

/** Test seam: inject a scan budget. Not re-exported from the package barrel. */
export function deleteCommentReplyWithBudget(
  pkg: OoxmlPackage,
  commentId: string,
  parentCommentId: string,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): OoxmlPackage | null {
  const records = recordsForOwner(pkg, owner, budget);
  if (budget.truncated) return pkg;
  const record = records.get(commentId);
  const parent = records.get(parentCommentId);
  if (!record || !parent || commentId === parentCommentId) return pkg;

  const part = pkg.parts.get(owner.storyPartName);
  const root = storyRootOf(pkg, owner);
  let hits: MarkerHits = { doomed: [], emptiedRuns: [], truncated: false };
  if (part && root) {
    if (!chargePart(budget)) return pkg;
    hits = collectOwnerMarkers(root, new Set([commentId]), budget);
    if (hits.truncated) return pkg;
  }

  const remaining = idsStillMarked(
    pkg,
    new Set([commentId]),
    commentsPartNameForStory(pkg, owner.storyPartName),
    budget,
    root
  );
  if (remaining.truncated) return pkg;

  const keepRecord = remaining.marked.has(commentId);
  if (keepRecord) {
    if (!part || (hits.doomed.length === 0 && hits.emptiedRuns.length === 0)) return pkg;
    return removeFromPart(pkg, part.name, [...hits.emptiedRuns, ...hits.doomed]);
  }

  const replyParaId = paraIdOf(record.node);
  const parentParaId = paraIdOf(parent.node);
  const childRecordUpdates = new Map<string, Map<string, string>>();
  for (const candidate of records.values()) {
    if (attribute(candidate.node, W16CID_NAMESPACE_URI, 'parentId') !== commentId) continue;
    let updates = childRecordUpdates.get(candidate.partName);
    if (!updates) {
      updates = new Map();
      childRecordUpdates.set(candidate.partName, updates);
    }
    updates.set(candidate.node.id, parentCommentId);
  }

  const extendedUpdates = new Map<string, Map<string, string>>();
  if (replyParaId !== null && parentParaId !== null) {
    const meta = ownerMetadataParts(pkg, owner);
    for (const entry of keyedMetadataIn(pkg, [meta.extended], budget)) {
      const linked = attribute(entry.node, W15_NAMESPACE_URI, 'paraIdParent');
      if (linked?.toUpperCase() !== replyParaId) continue;
      let updates = extendedUpdates.get(entry.partName);
      if (!updates) {
        updates = new Map();
        extendedUpdates.set(entry.partName, updates);
      }
      updates.set(entry.node.id, parentParaId);
    }
    if (budget.truncated) return pkg;
  }

  const doomedMeta = new Map<string, string[]>();
  if (replyParaId !== null) {
    const meta = ownerMetadataParts(pkg, owner);
    for (const entry of keyedMetadataIn(pkg, [meta.extended, meta.ids], budget)) {
      const paraId =
        attribute(entry.node, W15_NAMESPACE_URI, 'paraId') ??
        attribute(entry.node, W16CID_NAMESPACE_URI, 'paraId');
      if (paraId === undefined || paraId.toUpperCase() !== replyParaId) continue;
      const bucket = doomedMeta.get(entry.partName);
      if (bucket) bucket.push(entry.node.id);
      else doomedMeta.set(entry.partName, [entry.node.id]);
    }
    if (budget.truncated) return pkg;
  }

  let next = pkg;
  for (const [partName, updates] of childRecordUpdates) {
    const replaced = replaceAttributeValues(
      next,
      partName,
      updates,
      W16CID_NAMESPACE_URI,
      'parentId'
    );
    if (replaced === null) return null;
    next = replaced;
  }
  for (const [partName, updates] of extendedUpdates) {
    const replaced = replaceAttributeValues(
      next,
      partName,
      updates,
      W15_NAMESPACE_URI,
      'paraIdParent'
    );
    if (replaced === null) return null;
    next = replaced;
  }
  if (part && (hits.doomed.length > 0 || hits.emptiedRuns.length > 0)) {
    const stripped = removeFromPart(next, part.name, [...hits.emptiedRuns, ...hits.doomed]);
    if (stripped === null) return null;
    next = stripped;
  }
  const withoutRecord = removeFromPart(next, record.partName, [record.node.id]);
  if (withoutRecord === null) return null;
  next = withoutRecord;
  for (const [partName, nodeIds] of doomedMeta) {
    const removed = removeFromPart(next, partName, nodeIds);
    if (removed === null) return null;
    next = removed;
  }
  return next;
}

/**
 * Delete every comment the edit between `before` and `after` emptied in `owner`'s story.
 *
 * `owner` omitted is the main document body, matching {@link deleteCommentThread}.
 *
 * THE TEST, exactly, and per story. A comment dies when the words it covered in that story are
 * gone and nothing in that story still places it. A neighbour that reused the same `w:id` is
 * judged under its own owner. Notes that vanished (reference cascade) are reaped as their own
 * stories so a unique id still loses its `comments.xml` body. Remaining-marker overflow
 * preserves comments/commentEx/commentId metadata rather than deleting records the scan could
 * not prove unused. Null is reserved for a removal that actually failed.
 */
export function cascadeEmptiedComments(
  before: OoxmlPackage,
  after: OoxmlPackage,
  owner?: CommentDeletionOwner
): OoxmlPackage | null {
  return cascadeEmptiedCommentsWithBudget(before, after, owner, createCommentScanBudget());
}

/** Test seam: inject a scan budget. Not re-exported from the package barrel. */
export function cascadeEmptiedCommentsWithBudget(
  before: OoxmlPackage,
  after: OoxmlPackage,
  owner: CommentDeletionOwner | undefined,
  budget: CommentScanBudget
): OoxmlPackage | null {
  const scan = budget;
  const resolved = owner ?? defaultOwner(before);
  const owners = [...expandOwners(before, resolved, scan)];
  if (scan.truncated) return after;
  for (const vanished of vanishedNoteOwners(before, after, scan)) {
    if (scan.truncated) return after;
    if (
      owners.some(
        (item) => item.storyPartName === vanished.storyPartName && item.noteId === vanished.noteId
      )
    ) {
      continue;
    }
    owners.push(vanished);
  }

  let next = after;
  const pending: { owner: CommentDeletionOwner; commentId: string }[] = [];
  for (const item of owners) {
    if (scan.truncated) return after;
    const statesBefore = anchorStates(before, item, scan);
    const statesAfter = anchorStates(next, item, scan);
    if (statesBefore === null || statesAfter === null) return after;
    for (const [commentId, was] of statesBefore) {
      if (!was.covering) continue;
      const now = statesAfter.get(commentId);
      const gone = now === undefined || !now.anyMarker;
      if (!gone && !(now.paired && !now.covering)) continue;
      pending.push({ owner: item, commentId });
    }
  }

  // Strip every owning story first, then one remaining-marker scan per comments part, so a
  // notes-part reap does not walk the package once per note.
  const threads: { owner: CommentDeletionOwner; ids: Set<string> }[] = [];
  for (const item of pending) {
    if (scan.truncated) return after;
    const ids = threadOf(next, item.commentId, item.owner, scan);
    if (scan.truncated) return after;
    const stripped = stripMarkers(next, ids, item.owner, scan);
    if (stripped === null) return null;
    if (stripped.truncated) return after;
    next = stripped.pkg;
    threads.push({ owner: item.owner, ids });
  }

  const grouped = new Map<string | null, Set<string>>();
  for (const item of threads) {
    const commentsPart = commentsPartNameForStory(next, item.owner.storyPartName);
    let ids = grouped.get(commentsPart);
    if (!ids) {
      ids = new Set();
      grouped.set(commentsPart, ids);
    }
    for (const id of item.ids) ids.add(id);
  }
  const keepByPart = new Map<string | null, ReadonlySet<string>>();
  for (const [commentsPart, ids] of grouped) {
    const remaining = idsStillMarked(next, ids, commentsPart, scan);
    keepByPart.set(commentsPart, remaining.truncated ? ids : remaining.marked);
  }

  for (const item of threads) {
    const commentsPart = commentsPartNameForStory(next, item.owner.storyPartName);
    const keep = keepByPart.get(commentsPart) ?? item.ids;
    const doomedIds = new Set([...item.ids].filter((id) => !keep.has(id)));
    if (doomedIds.size === 0) continue;
    const records = recordsForOwner(next, item.owner, scan);
    const paraIds = new Set<string>();
    const byPart = new Map<string, string[]>();
    for (const id of doomedIds) {
      const record = records.get(id);
      if (!record) continue;
      const paraId = paraIdOf(record.node);
      if (paraId !== null) paraIds.add(paraId);
      const bucket = byPart.get(record.partName);
      if (bucket) bucket.push(record.node.id);
      else byPart.set(record.partName, [record.node.id]);
    }
    for (const [partName, nodeIds] of byPart) {
      const removed = removeFromPart(next, partName, nodeIds);
      if (removed === null) return null;
      next = removed;
    }
    const cleaned = removeKeyedParaIdEntries(next, paraIds, item.owner, scan);
    if (cleaned === null) return null;
    next = cleaned;
  }
  return next;
}
