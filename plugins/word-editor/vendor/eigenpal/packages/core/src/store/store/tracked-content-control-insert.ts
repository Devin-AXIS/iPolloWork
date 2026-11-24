import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { splitRunsAt } from './tree-op-apply.ts';
import { controlElement, propertiesFor } from './tree-op-content-control-insert.ts';
import { contentControlEffect } from './tree-op-content-controls.ts';
import { effectiveContentLockAt, isBoundAt, fromEdit } from './tree-op-nodes.ts';
import { paragraphLength, splitsSurrogate, paragraphOffsetIndex } from './tree-op-segments.ts';
import { applyDeleteTracked } from './tree-op-tracked-delete.ts';
import { build, copy, revisionAttributes } from './tree-op-tracked.ts';
import { nextRevisionId } from './tree-op-revision-ids.ts';
import type { TreeDocOp, TreeOpResult } from './tree-op-types.ts';

type Insert = Extract<TreeDocOp, { op: 'insertContentControl' }>;

/** Restrict wrapper proposals to nonempty ordinary text, with no existing review or range markup. */
export function canTrackContentControl(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number
): boolean {
  const paragraph = findNode(part, paragraphId);
  if (
    !paragraph ||
    paragraph.kind !== 'paragraph' ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= end ||
    end > paragraphLength(paragraph)
  )
    return false;
  if (
    splitsSurrogate(paragraph, start) ||
    splitsSurrogate(paragraph, end) ||
    effectiveContentLockAt(part, paragraphId).content ||
    isBoundAt(part, paragraphId)
  )
    return false;
  for (
    let parent = parentNodeOf(part, paragraphId);
    parent;
    parent = parentNodeOf(part, parent.id)
  ) {
    if (parent.kind.startsWith('revision')) return false;
  }
  const index = paragraphOffsetIndex(paragraph);
  const hasRevision = (node: OoxmlNode): boolean =>
    node.kind !== 'textValue' &&
    (node.kind.startsWith('revision') ||
      (node.namespaceUri === WML_NAMESPACE_URI &&
        ['ins', 'del', 'moveFrom', 'moveTo'].includes(node.localName)) ||
      node.localName.endsWith('Change') ||
      node.children.some(hasRevision));
  return paragraph.children.every((node) => {
    // Paragraph properties have no text span. Check their revisions before offsets.
    if (node.kind === 'paragraphProperties') return !hasRevision(node);
    const span = index.spanOf(node);
    if (!span || span.end < start || span.start > end) return true;
    if (span.start === span.end) return false;
    if (span.end === start || span.start === end) return true;
    return (
      node.kind === 'run' &&
      !hasRevision(node) &&
      node.children.every((child) => child.kind === 'text' || child.kind === 'runProperties')
    );
  });
}

/** A native replacement keeps original runs for rejection and the inserted SDT for acceptance. */
export function applyTrackedContentControl(
  part: OoxmlPart,
  op: Insert,
  options?: EditOptions
): TreeOpResult {
  if (!op.revision || !canTrackContentControl(part, op.paragraphId, op.start, op.end))
    return { ok: false, reason: 'indivisible-content' };
  let current = part;
  for (const edge of [op.end, op.start]) {
    const paragraph = findNode(current, op.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph')
      return { ok: false, reason: 'unknown-paragraph' };
    const split = splitRunsAt(current, paragraph, edge, options);
    if (!split.ok) return split;
    current = split.part;
  }
  const paragraph = findNode(current, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph')
    return { ok: false, reason: 'unknown-paragraph' };
  const index = paragraphOffsetIndex(paragraph);
  const selected = paragraph.children.filter((node) => {
    const span = index.spanOf(node);
    return span && span.end > op.start && span.start < op.end;
  });
  // Structured containers need their own revision semantics. Never flatten them into text.
  if (
    !selected.length ||
    selected.some(
      (node) =>
        node.kind !== 'run' ||
        node.children.some((child) => child.kind !== 'text' && child.kind !== 'runProperties')
    )
  )
    return { ok: false, reason: 'indivisible-content' };
  const deleted = applyDeleteTracked(current, paragraph, op.start, op.end, op.revision, options);
  if (!deleted.ok) return deleted;
  const after = findNode(deleted.part, op.paragraphId);
  if (!after || after.kind !== 'paragraph') return { ok: false, reason: 'unknown-paragraph' };
  const mint = createNodeIdAllocator(deleted.part);
  const control = controlElement(
    propertiesFor(deleted.part, op, mint),
    selected.map((node) => copy(mint, node)),
    mint
  );
  const revisionId = options?.trackedRevisionIds?.mint() ?? nextRevisionId(deleted.part)();
  const insertion = build(
    mint(),
    'revisionInsert',
    'ins',
    revisionAttributes(revisionId, op.revision),
    [control]
  );
  const offsets = paragraphOffsetIndex(after);
  const children: OoxmlNode[] = [];
  let placed = false;
  for (const child of after.children) {
    const span = offsets.spanOf(child);
    if (!placed && child.kind !== 'paragraphProperties' && span && span.start >= op.end) {
      children.push(insertion);
      placed = true;
    }
    children.push(child);
  }
  if (!placed) children.push(insertion);
  return fromEdit(
    replaceChildren(deleted.part, after.id, children, options),
    contentControlEffect(after.id, 'flow-structural')
  );
}
