import { commentDeletionBudget } from './comment-deletion-budget.ts';
import { rewriteCommentBatch, type CommentPartChanges } from './comment-batch-rewrite.ts';
import {
  attribute,
  chargePart,
  collectOwnerMarkers,
  commentsPartNameForStory,
  keyedMetadataIn,
  walkCharged,
  W15_NAMESPACE_URI,
  W16CID_NAMESPACE_URI,
  type CommentRecord,
  type CommentRecordIndex,
  type CommentScanBudget,
  type KeyedMetadataEntry,
} from './comment-lifecycle-scan.ts';
import {
  expandThread,
  ownerMetadataParts,
  threadChildrenOf,
  type CommentDeletionOwner,
} from './comment-lifecycle-thread.ts';
import { noteIdOf, notesOf } from './note-nodes.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { W14_NAMESPACE_URI } from './ooxml-shared.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

interface Deletion {
  readonly commentId: string;
  readonly parentCommentId?: string;
}

function paraIdOf(node: OoxmlElement): string | null {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]!;
    if (child.kind === 'paragraph') {
      return attribute(child, W14_NAMESPACE_URI, 'paraId')?.toUpperCase() ?? null;
    }
  }
  return null;
}

/** One budget and one package marker scan, independent of the number of requested threads. */
export function deleteCommentBatch(
  pkg: OoxmlPackage,
  deletions: readonly Deletion[],
  owner: CommentDeletionOwner
): OoxmlPackage | null {
  if (deletions.length === 0) return pkg;
  return deleteCommentBatchWithBudget(pkg, deletions, owner, commentDeletionBudget(pkg));
}

/** Internal test seam. No edits or journal primitives escape an incomplete plan. */
export function deleteCommentBatchWithBudget(
  pkg: OoxmlPackage,
  deletions: readonly Deletion[],
  owner: CommentDeletionOwner,
  budget: CommentScanBudget
): OoxmlPackage | null {
  const commentsName = commentsPartNameForStory(pkg, owner.storyPartName);
  const commentsPart = commentsName === null ? undefined : pkg.parts.get(commentsName);
  if (!commentsPart) return pkg;
  const records: CommentRecord[] = [];
  if (!chargePart(budget)) return null;
  walkCharged(commentsPart.root, budget, (node) => {
    if (node.kind !== 'comment') return false;
    if (attribute(node, WML_NAMESPACE_URI, 'id') !== undefined) {
      records.push({ partName: commentsPart.name, node });
    }
    return true;
  });
  const meta = ownerMetadataParts(pkg, owner);
  const metadata = keyedMetadataIn(pkg, [meta.extended, meta.ids], budget);
  if (budget.truncated) return null;
  const part = pkg.parts.get(owner.storyPartName);
  const root =
    part === undefined
      ? null
      : owner.noteId === undefined
        ? part.root
        : (notesOf(part.root).find((note) => noteIdOf(note) === owner.noteId) ?? null);

  // Records in another story can retain a selected id. Keep individual marker identities:
  // deleting a comment body can itself remove markers that kept a later batch target alive.
  const externalNodes = new Map<string, string>();
  const externalCounts = new Map<string, number>();
  for (const candidate of pkg.parts.values()) {
    if (!candidate.name.endsWith('.xml')) continue;
    if (!chargePart(budget)) return null;
    if (candidate.root === root) continue;
    let sameComments: boolean | undefined;
    walkCharged(candidate.root, budget, (node) => {
      if (node === root) return true;
      if (!['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(node.kind))
        return false;
      const id = attribute(node, WML_NAMESPACE_URI, 'id');
      if (id === undefined) return true;
      sameComments ??= commentsPartNameForStory(pkg, candidate.name) === commentsName;
      if (sameComments) {
        externalNodes.set(`${candidate.name}\0${node.id}`, id);
        externalCounts.set(id, (externalCounts.get(id) ?? 0) + 1);
      }
      return true;
    });
    if (budget.truncated) return null;
  }

  const changes = new Map<string, CommentPartChanges>();
  const changeFor = (partName: string): CommentPartChanges => {
    let value = changes.get(partName);
    if (!value) {
      value = { removed: new Set(), replaced: new Map() };
      changes.set(partName, value);
    }
    return value;
  };
  const current = (entry: CommentRecord | KeyedMetadataEntry): OoxmlElement | null => {
    const change = changes.get(entry.partName);
    if (change?.removed.has(entry.node.id)) return null;
    return change?.replaced.get(entry.node.id) ?? entry.node;
  };
  const remove = (entry: CommentRecord | KeyedMetadataEntry): void => {
    changeFor(entry.partName).removed.add(entry.node.id);
    const forget = (node: OoxmlNode): void => {
      changeFor(entry.partName).removed.add(node.id);
      const key = `${entry.partName}\0${node.id}`;
      const id = externalNodes.get(key);
      if (id !== undefined) {
        externalNodes.delete(key);
        externalCounts.set(id, externalCounts.get(id)! - 1);
      }
      if (node.kind !== 'textValue') for (const child of node.children) forget(child);
    };
    forget(entry.node);
  };
  const update = (
    entry: CommentRecord | KeyedMetadataEntry,
    ns: string,
    name: string,
    value: string
  ): void => {
    const node = current(entry);
    if (!node) return;
    const attributes = node.attributes.map((item) =>
      item.kind === 'genericExtension' &&
      item.namespaceUri === ns &&
      item.localName === name &&
      item.value !== value
        ? { ...item, value }
        : item
    );
    if (attributes.some((item, index) => item !== node.attributes[index])) {
      changeFor(entry.partName).replaced.set(node.id, { ...node, attributes } as OoxmlElement);
    }
  };
  const recordIndex = (): CommentRecordIndex => {
    const byId = new Map<string, CommentRecord>();
    const duplicateIds = new Set<string>();
    for (const entry of records) {
      const node = current(entry);
      if (!node) continue;
      const id = attribute(node, WML_NAMESPACE_URI, 'id')!;
      if (byId.has(id)) duplicateIds.add(id);
      else byId.set(id, { ...entry, node });
    }
    return { byId, duplicateIds };
  };
  const currentMetadata = (): KeyedMetadataEntry[] =>
    metadata.flatMap((entry) => {
      const node = current(entry);
      return node ? [{ ...entry, node }] : [];
    });
  const graph = () =>
    threadChildrenOf(pkg, owner, budget, false, {
      records: recordIndex(),
      metadata: currentMetadata(),
    });
  // A valid thread-only batch only removes graph vertices. Reuse its index throughout.
  // Mixed replies can reparent descendants; rebuild their small metadata index as needed.
  const initial = deletions.every((item) => item.parentCommentId === undefined) ? graph() : null;
  if (budget.truncated) return null;
  const cached = initial && !initial.malformed && initial.duplicateIds.size === 0 ? initial : null;
  const markers = new Set<string>();
  const metadataByParaId = new Map<string, KeyedMetadataEntry[]>();
  for (const entry of metadata) {
    const id =
      attribute(entry.node, W15_NAMESPACE_URI, 'paraId') ??
      attribute(entry.node, W16CID_NAMESPACE_URI, 'paraId');
    if (id === undefined) continue;
    const key = id.toUpperCase();
    const bucket = metadataByParaId.get(key);
    if (bucket) bucket.push(entry);
    else metadataByParaId.set(key, [entry]);
  }
  const removeMetadata = (paraIds: ReadonlySet<string>): void => {
    for (const id of paraIds) {
      for (const entry of metadataByParaId.get(id) ?? []) {
        if (current(entry)) remove(entry);
      }
    }
  };

  for (const deletion of deletions) {
    const { commentId, parentCommentId } = deletion;
    if (parentCommentId !== undefined) {
      const index = recordIndex().byId;
      const record = index.get(commentId);
      const parent = index.get(parentCommentId);
      if (!record || !parent || commentId === parentCommentId) continue;
      markers.add(commentId);
      if ((externalCounts.get(commentId) ?? 0) > 0) continue;
      const replyParaId = paraIdOf(record.node);
      const parentParaId = paraIdOf(parent.node);
      for (const candidate of index.values()) {
        if (attribute(candidate.node, W16CID_NAMESPACE_URI, 'parentId') === commentId) {
          update(candidate, W16CID_NAMESPACE_URI, 'parentId', parentCommentId);
        }
      }
      if (replyParaId !== null && parentParaId !== null) {
        for (const entry of metadata) {
          const node = current(entry);
          if (
            entry.partName === meta.extended &&
            node &&
            attribute(node, W15_NAMESPACE_URI, 'paraIdParent')?.toUpperCase() === replyParaId
          ) {
            update(entry, W15_NAMESPACE_URI, 'paraIdParent', parentParaId);
          }
        }
      }
      remove(record);
      if (replyParaId !== null) removeMetadata(new Set([replyParaId]));
      continue;
    }
    const built = cached ?? graph();
    if (budget.truncated) return null;
    if (!built.records.has(commentId)) continue;
    const thread = expandThread(commentId, built.childrenOf, budget);
    if (budget.truncated) return null;
    const paraIds = new Set<string>();
    // Decide retention for the whole thread before removing any record, as a single delete does.
    const doomed = [...thread].filter((id) => (externalCounts.get(id) ?? 0) === 0);
    for (const id of thread) markers.add(id);
    for (const id of doomed) {
      const record = built.records.get(id);
      if (!record) continue;
      const paraId = paraIdOf(record.node);
      if (paraId !== null) paraIds.add(paraId);
      remove(record);
      if (cached) {
        cached.records.delete(id);
        cached.childrenOf.delete(id);
        const parent = cached.parentCommentIdByChildId.get(id);
        if (parent !== undefined) {
          const children = cached.childrenOf.get(parent);
          if (children)
            cached.childrenOf.set(
              parent,
              children.filter((child) => child !== id)
            );
        }
      }
    }
    removeMetadata(paraIds);
  }
  if (root && markers.size > 0) {
    if (!chargePart(budget)) return null;
    const hits = collectOwnerMarkers(root, markers, budget);
    if (hits.truncated) return null;
    const removed = changeFor(owner.storyPartName).removed;
    for (const id of hits.emptiedRuns) removed.add(id);
    for (const id of hits.doomed) removed.add(id);
  }
  return rewriteCommentBatch(pkg, changes);
}
