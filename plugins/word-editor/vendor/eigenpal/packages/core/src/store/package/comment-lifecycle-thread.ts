// Bounded comment-thread index: parent links, coincident inference, fail-closed metadata.
//
// Split out of comment-lifecycle.ts so deletion stays under the line cap while resolution
// and reap share one indexer.

import { noteIdOf, notesOf } from './note-nodes.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { W14_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import {
  attribute,
  chargePart,
  collectOwnerCommentSpans,
  commentsPartNameForStory,
  indexCommentRecords,
  keyedMetadataIn,
  keyedMetadataMisplaced,
  metadataPartNamesFor,
  MAX_COMMENT_SCAN_DEPTH,
  type CommentRecord,
  type CommentRecordIndex,
  type CommentScanBudget,
  type KeyedMetadataEntry,
  W15_NAMESPACE_URI,
  W16CID_NAMESPACE_URI,
} from './comment-lifecycle-scan.ts';

/**
 * Which story a comment deletion or resolution may read markers from.
 *
 * `w:id` is not unique across stories: a header and the body can both hold comment 1.
 */
export interface CommentDeletionOwner {
  /** Canonical name of the part holding the story's markers. */
  readonly storyPartName: string;
  /**
   * When the story is one note inside a shared notes part, that note's `w:id`.
   * Absent means the whole part is the story (body, header, footer).
   */
  readonly noteId?: number;
}

/** One `w15:commentEx` from the charged metadata scan, reused by the writer. */
export interface CommentExIndexEntry {
  readonly partName: string;
  readonly node: OoxmlElement;
  readonly paraId: string;
  readonly parentParaId?: string;
  readonly done: boolean;
}

function commentExDone(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on';
}

function storyRootOf(pkg: OoxmlPackage, owner: CommentDeletionOwner): OoxmlNode | null {
  const part = pkg.parts.get(owner.storyPartName);
  if (!part) return null;
  if (owner.noteId === undefined) return part.root;
  for (const note of notesOf(part.root)) {
    if (noteIdOf(note) === owner.noteId) return note;
  }
  return null;
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

function spanKey(span: {
  readonly startParagraphId: string;
  readonly startOffset: number;
  readonly endParagraphId: string;
  readonly endOffset: number;
}): string {
  return (
    `${span.startParagraphId}:${span.startOffset}` + `|${span.endParagraphId}:${span.endOffset}`
  );
}

function isZeroWidth(span: {
  readonly startParagraphId: string;
  readonly startOffset: number;
  readonly endParagraphId: string;
  readonly endOffset: number;
}): boolean {
  return span.startParagraphId === span.endParagraphId && span.startOffset === span.endOffset;
}

export function ownerMetadataParts(
  pkg: OoxmlPackage,
  owner: CommentDeletionOwner
): { readonly extended: string | null; readonly ids: string | null } {
  const commentsPart = commentsPartNameForStory(pkg, owner.storyPartName);
  return metadataPartNamesFor(pkg, owner.storyPartName, commentsPart);
}

/**
 * Parent → children in one story's comments part, from every supported link.
 *
 * Explicit `@w16cid:parentId` and `@w15:paraIdParent` first; coincident-range inference
 * only when the child has no `commentsExtended` record, matching the review-queue reader.
 * A second `commentEx` / `commentId` for the same key is malformed even when values match.
 */
export function threadChildrenOf(
  pkg: OoxmlPackage,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget,
  inferCoincident: boolean,
  scanned?: {
    readonly records: CommentRecordIndex;
    readonly metadata: KeyedMetadataEntry[];
  }
): {
  readonly childrenOf: Map<string, string[]>;
  readonly records: Map<string, CommentRecord>;
  readonly duplicateIds: ReadonlySet<string>;
  readonly parentParaIdByCommentId: Map<string, string>;
  readonly parentCommentIdByChildId: Map<string, string>;
  readonly commentExByParaId: Map<string, CommentExIndexEntry>;
  readonly extendedPartName: string | null;
  readonly malformed: boolean;
} {
  const commentsPart = commentsPartNameForStory(pkg, owner.storyPartName);
  const indexed =
    scanned?.records ??
    (commentsPart === null
      ? { byId: new Map<string, CommentRecord>(), duplicateIds: new Set<string>() }
      : indexCommentRecords(pkg, commentsPart, budget));
  const records = indexed.byId;
  const childrenOf = new Map<string, string[]>();
  const linkedChildren = new Map<string, Set<string>>();
  const parentParaIdByCommentId = new Map<string, string>();
  const parentCommentIdByChildId = new Map<string, string>();
  const commentExByParaId = new Map<string, CommentExIndexEntry>();
  const meta = ownerMetadataParts(pkg, owner);
  const empty = {
    childrenOf,
    records,
    duplicateIds: indexed.duplicateIds,
    parentParaIdByCommentId,
    parentCommentIdByChildId,
    commentExByParaId,
    extendedPartName: meta.extended,
    malformed: false,
  };
  if (budget.truncated) return empty;

  const idByParaId = new Map<string, string>();
  for (const [id, record] of records) {
    const paraId = paraIdOf(record.node);
    if (paraId === null) continue;
    const existing = idByParaId.get(paraId);
    if (existing !== undefined && existing !== id) return { ...empty, malformed: true };
    idByParaId.set(paraId, id);
  }

  let malformed = false;
  const link = (parentId: string, childId: string): void => {
    if (parentId === childId) {
      malformed = true;
      return;
    }
    const existing = parentCommentIdByChildId.get(childId);
    if (existing !== undefined && existing !== parentId) {
      malformed = true;
      return;
    }
    parentCommentIdByChildId.set(childId, parentId);
    const parentNode = records.get(parentId)?.node;
    const parentPara = parentNode === undefined ? null : paraIdOf(parentNode);
    if (parentPara !== null && !parentParaIdByCommentId.has(childId)) {
      parentParaIdByCommentId.set(childId, parentPara);
    }
    let bucket = childrenOf.get(parentId);
    let seen = linkedChildren.get(parentId);
    if (!bucket || !seen) {
      bucket = [];
      seen = new Set();
      childrenOf.set(parentId, bucket);
      linkedChildren.set(parentId, seen);
    }
    if (seen.has(childId)) return;
    seen.add(childId);
    bucket.push(childId);
  };

  for (const [id, record] of records) {
    const named = attribute(record.node, W16CID_NAMESPACE_URI, 'parentId');
    if (named === undefined) continue;
    if (named === id) {
      malformed = true;
      continue;
    }
    if (!records.has(named)) continue;
    link(named, id);
  }

  const extendedParaIds = new Set<string>();
  const seenEx = new Set<string>();
  const seenIdPara = new Set<string>();
  const seenDurable = new Set<string>();
  const metadata = scanned?.metadata ?? keyedMetadataIn(pkg, [meta.extended, meta.ids], budget);
  if (budget.truncated) return { ...empty, malformed: false };
  if (keyedMetadataMisplaced(pkg, metadata)) return { ...empty, malformed: true };
  for (const entry of metadata) {
    if (entry.node.namespaceUri === W15_NAMESPACE_URI && entry.node.localName === 'commentEx') {
      const paraId = attribute(entry.node, W15_NAMESPACE_URI, 'paraId');
      if (paraId === undefined) continue;
      const key = paraId.toUpperCase();
      if (seenEx.has(key)) return { ...empty, malformed: true };
      seenEx.add(key);
      const parentParaId = attribute(entry.node, W15_NAMESPACE_URI, 'paraIdParent');
      const parentKey = parentParaId === undefined ? undefined : parentParaId.toUpperCase();
      extendedParaIds.add(key);
      commentExByParaId.set(key, {
        partName: entry.partName,
        node: entry.node,
        paraId: key,
        ...(parentKey === undefined ? {} : { parentParaId: parentKey }),
        done: commentExDone(attribute(entry.node, W15_NAMESPACE_URI, 'done')),
      });
      if (parentKey === undefined) continue;
      const child = idByParaId.get(key);
      const parent = idByParaId.get(parentKey);
      if (child !== undefined && parent !== undefined) {
        parentParaIdByCommentId.set(child, parentKey);
        link(parent, child);
      }
      continue;
    }
    if (entry.node.namespaceUri !== W16CID_NAMESPACE_URI || entry.node.localName !== 'commentId') {
      continue;
    }
    const paraId = attribute(entry.node, W16CID_NAMESPACE_URI, 'paraId');
    const durableId = attribute(entry.node, W16CID_NAMESPACE_URI, 'durableId');
    if (paraId !== undefined) {
      const key = paraId.toUpperCase();
      if (seenIdPara.has(key)) return { ...empty, malformed: true };
      seenIdPara.add(key);
    }
    if (durableId !== undefined) {
      const key = durableId.toUpperCase();
      if (seenDurable.has(key)) return { ...empty, malformed: true };
      seenDurable.add(key);
    }
  }
  if (budget.truncated) return { ...empty, malformed: false };
  if (malformed) return { ...empty, malformed: true };

  if (inferCoincident) {
    const root = storyRootOf(pkg, owner);
    if (root) {
      if (!chargePart(budget)) return { ...empty, malformed: false };
      const { spans, truncated } = collectOwnerCommentSpans(root, budget);
      if (truncated) return { ...empty, malformed: false };
      const firstOnSpan = new Map<string, string>();
      for (const id of records.keys()) {
        const span = spans.get(id);
        if (span === undefined || isZeroWidth(span)) continue;
        const key = spanKey(span);
        if (!firstOnSpan.has(key)) {
          firstOnSpan.set(key, id);
          continue;
        }
        const paraId = paraIdOf(records.get(id)!.node);
        if (paraId !== null && extendedParaIds.has(paraId)) continue;
        link(firstOnSpan.get(key)!, id);
      }
    }
  }
  if (malformed) return { ...empty, malformed: true };
  if (parentGraphCycles(parentCommentIdByChildId, budget)) return { ...empty, malformed: true };
  if (budget.truncated) return { ...empty, malformed: false };

  return {
    childrenOf,
    records,
    duplicateIds: indexed.duplicateIds,
    parentParaIdByCommentId,
    parentCommentIdByChildId,
    commentExByParaId,
    extendedPartName: meta.extended,
    malformed: false,
  };
}

function parentGraphCycles(
  parentOf: ReadonlyMap<string, string>,
  budget: CommentScanBudget
): boolean {
  const seen = new Set<string>();
  for (const start of parentOf.keys()) {
    if (seen.has(start)) continue;
    const path = new Set<string>();
    let walk: string | undefined = start;
    let hops = 0;
    while (walk !== undefined) {
      if (hops > MAX_COMMENT_SCAN_DEPTH) {
        budget.truncated = true;
        return false;
      }
      if (path.has(walk)) return true;
      if (seen.has(walk)) break;
      path.add(walk);
      seen.add(walk);
      walk = parentOf.get(walk);
      hops += 1;
    }
  }
  return false;
}

export function expandThread(
  rootId: string,
  childrenOf: Map<string, string[]>,
  budget: CommentScanBudget
): Set<string> {
  const thread = new Set<string>([rootId]);
  const queue = [rootId];
  let head = 0;
  let depth = 0;
  let levelEnd = 1;
  while (head < queue.length) {
    if (depth > MAX_COMMENT_SCAN_DEPTH) {
      budget.truncated = true;
      return thread;
    }
    const current = queue[head]!;
    head += 1;
    for (const child of childrenOf.get(current) ?? []) {
      if (thread.has(child)) continue;
      thread.add(child);
      queue.push(child);
    }
    if (head === levelEnd) {
      depth += 1;
      levelEnd = queue.length;
    }
  }
  return thread;
}

/** Why {@link indexCommentThread} refused to name a thread. */
export type CommentThreadIndexReason =
  'scan-truncated' | 'duplicate-comment' | 'malformed-metadata' | 'unknown-comment';

/** Bounded thread index for a story-owned comments part. Fail closed: no partial set. */
export type CommentThreadIndexResult =
  | {
      readonly ok: true;
      readonly ids: ReadonlySet<string>;
      readonly records: ReadonlyMap<string, CommentRecord>;
      readonly parentParaIdByCommentId: ReadonlyMap<string, string>;
      readonly parentCommentIdByChildId: ReadonlyMap<string, string>;
      readonly commentExByParaId: ReadonlyMap<string, CommentExIndexEntry>;
      readonly extendedPartName: string | null;
    }
  | { readonly ok: false; readonly reason: CommentThreadIndexReason };

/**
 * A comment and every comment that answers it, transitively, in this story's comments part.
 *
 * Truncation, duplicate `w:id`s, or a second metadata node for one key refuse rather than
 * returning a partial thread the caller would resolve halfway.
 */
export function indexCommentThread(
  pkg: OoxmlPackage,
  rootId: string,
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): CommentThreadIndexResult {
  const built = threadChildrenOf(pkg, owner, budget, true);
  if (budget.truncated) return { ok: false, reason: 'scan-truncated' };
  if (built.malformed) return { ok: false, reason: 'malformed-metadata' };
  if (!built.records.has(rootId)) {
    return { ok: false, reason: 'unknown-comment' };
  }
  const ids = expandThread(rootId, built.childrenOf, budget);
  if (budget.truncated) return { ok: false, reason: 'scan-truncated' };
  for (const id of ids) {
    if (built.duplicateIds.has(id)) return { ok: false, reason: 'duplicate-comment' };
  }
  return {
    ok: true,
    ids,
    records: built.records,
    parentParaIdByCommentId: built.parentParaIdByCommentId,
    parentCommentIdByChildId: built.parentCommentIdByChildId,
    commentExByParaId: built.commentExByParaId,
    extendedPartName: built.extendedPartName,
  };
}
