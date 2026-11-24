// Cheap package-level gates for `TreePackageStore`.
//
// The delete gates read the story as the open transaction has left it, which is the tree the
// op edits. The node index moves to that tree with each op, so a batch of deletes finds every
// target without walking the part again.

import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveRelationship, type RelationshipRecord } from '../package/relationships.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { segmentsOf } from './tree-op-segments.ts';
import type { TreeDocOp } from './tree-ops.ts';
import { transactionStoryPart, type TreeDocumentStore } from './tree-store.ts';

/** Cap on nodes visited while probing one `deleteBlock` subtree for note refs. */
export const MAX_DELETE_BLOCK_NOTE_GATE_NODES = 4_000;

/** Nesting depth cap for the same probe (nested tables / SDT husks). */
export const MAX_DELETE_BLOCK_NOTE_GATE_DEPTH = 64;

/** Whether the package declares a footnotes or endnotes part at all. */
export function hasNotesPart(pkg: OoxmlPackage): boolean {
  return resolveNotesPart(pkg, 'footnote') !== null || resolveNotesPart(pkg, 'endnote') !== null;
}

/**
 * Whether one text delete can strand a note body and therefore needs a package cascade.
 * Ambiguous repeated deletes in one paragraph fail closed into the bounded cascade.
 */
export function deleteMayStrandNote(
  pkg: OoxmlPackage,
  store: TreeDocumentStore,
  op: Extract<TreeDocOp, { op: 'deleteText' }>,
  seenParagraphs: Set<string>
): boolean {
  if (!hasNotesPart(pkg)) return false;
  if (seenParagraphs.has(op.paragraphId)) return true;
  seenParagraphs.add(op.paragraphId);
  const paragraph = findNode(transactionStoryPart(store), op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return true;
  return segmentsOf(paragraph).some(
    (segment) =>
      segment.node.kind === 'noteReference' && segment.start < op.end && segment.end > op.start
  );
}

/**
 * Whether removing a block subtree can strand a note body.
 *
 * Range deletion of a fully selected table uses `deleteBlock` (no `deleteText` on cell
 * paragraphs), so this gate walks only that subtree — never the whole package — and uses
 * the same segment model as text deletes. Budget overrun or a missing block fails closed.
 */
export function deleteBlockMayStrandNote(
  pkg: OoxmlPackage,
  store: TreeDocumentStore,
  op: Extract<TreeDocOp, { op: 'deleteBlock' }>,
  seenBlocks: Set<string>
): boolean {
  if (!hasNotesPart(pkg)) return false;
  if (seenBlocks.has(op.blockId)) return true;
  seenBlocks.add(op.blockId);
  const block = findNode(transactionStoryPart(store), op.blockId);
  if (!block || block.kind === 'textValue') return true;

  let visited = 0;
  const walk = (node: OoxmlNode, depth: number): boolean => {
    if (visited >= MAX_DELETE_BLOCK_NOTE_GATE_NODES || depth > MAX_DELETE_BLOCK_NOTE_GATE_DEPTH) {
      return true;
    }
    visited += 1;
    if (node.kind === 'textValue') return false;
    if (node.kind === 'paragraph') {
      return segmentsOf(node).some((segment) => segment.node.kind === 'noteReference');
    }
    for (const child of node.children) {
      if (walk(child, depth + 1)) return true;
    }
    return false;
  };
  return walk(block, 0);
}

/** Whether a subtree holds a comment range marker, within the same budget the note gates use. */
function subtreeHasCommentMarker(
  node: OoxmlNode,
  depth: number,
  visited: { count: number }
): boolean {
  if (
    visited.count >= MAX_DELETE_BLOCK_NOTE_GATE_NODES ||
    depth > MAX_DELETE_BLOCK_NOTE_GATE_DEPTH
  ) {
    return true;
  }
  visited.count += 1;
  if (node.kind === 'textValue') return false;
  if (
    node.kind === 'commentRangeStart' ||
    node.kind === 'commentRangeEnd' ||
    node.kind === 'commentReference'
  ) {
    return true;
  }
  for (const child of node.children) {
    if (subtreeHasCommentMarker(child, depth + 1, visited)) return true;
  }
  return false;
}

/**
 * Whether an op can empty a comment's range and therefore needs the package reap.
 *
 * MARKERS, not offsets. A `deleteText` that removes every character between a comment's start
 * and end never touches the markers themselves — they occupy no offsets — so the only cheap
 * question worth asking is whether the paragraph (or the block subtree) holds any marker at
 * all. Documents with no comments answer no on the first line and pay nothing.
 *
 * Fails CLOSED: a paragraph the store cannot find, or a subtree past the budget, runs the reap
 * rather than skipping it. The reap is itself a diff and does nothing when nothing was emptied.
 */
export function deleteMayEmptyCommentRange(
  anyComment: () => boolean,
  store: TreeDocumentStore,
  op: Extract<TreeDocOp, { op: 'deleteText' | 'deleteBlock' }>,
  seenTargets: Set<string>
): boolean {
  if (!anyComment()) return false;
  const targetId = op.op === 'deleteText' ? op.paragraphId : op.blockId;
  if (seenTargets.has(targetId)) return true;
  seenTargets.add(targetId);
  const target = findNode(transactionStoryPart(store), targetId);
  if (!target || target.kind === 'textValue') return true;
  return subtreeHasCommentMarker(target, 0, { count: 0 });
}

export const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
export const FOOTER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';

type LocatedHeaderFooter =
  | { readonly ok: true; readonly partName: string; readonly part: OoxmlPart }
  | {
      readonly ok: false;
      readonly reason:
        | 'dangling-relationship'
        | 'wrong-relationship-type'
        | 'external-relationship'
        | 'bad-relationship-target'
        | 'missing-part'
        | 'not-a-story-part';
      readonly detail?: string;
    };

/** Resolve a header/footer rId to its canonical part, or a typed refusal. */
export function locateHeaderFooterPart(pkg: OoxmlPackage, rId: string): LocatedHeaderFooter {
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  const record = relationships.find((rel) => rel.id === rId);
  if (!record) {
    return { ok: false, reason: 'dangling-relationship', detail: rId };
  }
  if (record.type !== HEADER_REL_TYPE && record.type !== FOOTER_REL_TYPE) {
    return { ok: false, reason: 'wrong-relationship-type', detail: record.type };
  }
  return resolveInternalStoryPart(pkg, record);
}

function resolveInternalStoryPart(
  pkg: OoxmlPackage,
  record: RelationshipRecord
): LocatedHeaderFooter {
  const resolved = resolveRelationship(record);
  if (resolved.mode === 'External') {
    return { ok: false, reason: 'external-relationship', detail: record.id };
  }
  if (!resolved.target.ok) {
    return {
      ok: false,
      reason: 'bad-relationship-target',
      detail: resolved.target.reason,
    };
  }
  const part = pkg.parts.get(resolved.target.partName);
  if (!part) {
    return { ok: false, reason: 'missing-part', detail: resolved.target.partName };
  }
  const rootName = part.root.localName;
  if (rootName !== 'hdr' && rootName !== 'ftr') {
    return { ok: false, reason: 'not-a-story-part', detail: rootName || part.name };
  }
  return { ok: true, partName: part.name, part };
}

/** Revision ops whose result can remove a note reference along with the content it sits in. */
export const RESOLUTION_OPS: ReadonlySet<string> = new Set([
  'acceptRevision',
  'rejectRevision',
  'acceptAllRevisions',
  'rejectAllRevisions',
]);

/**
 * Ops that remove whole blocks without naming one, so no cheap subtree probe exists.
 *
 * Row and column deletion take a table id and carry away every cell paragraph under it —
 * comment range markers included. Gated by kind rather than by content: the reap they open is
 * a before/after diff and finds nothing when the table held no comment.
 */
export const CONTENT_REMOVING_OPS: ReadonlySet<string> = new Set([
  'authorTable',
  'deleteTableRow',
  'deleteTableColumn',
  'mergeTableCells',
  'removeContentControl',
  'removeRepeatingSectionItem',
  'removeToc',
]);
