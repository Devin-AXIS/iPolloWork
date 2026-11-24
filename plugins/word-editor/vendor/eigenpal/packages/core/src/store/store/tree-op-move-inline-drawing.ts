import { findNode, removeNode, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import {
  isCanonicalPrimitiveCaptureActive,
  runWithoutJournalCapture,
} from '../package/canonical-primitive-capture.ts';
import {
  WP_NAMESPACE_URI,
  type OoxmlDrawingNode,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  effectiveContentLockAt,
  isBoundAt,
  parentOf,
  paragraphContainingNode,
  TEXT_DEPS,
} from './tree-op-nodes.ts';
import { segmentsOf } from './tree-op-segments.ts';
import { validateDrawingOp } from './tree-op-drawings.ts';
import { applyPlaceRunNodes } from './tree-op-run-placement.ts';
import type { DrawingTreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

type Move = Extract<DrawingTreeDocOp, { op: 'moveInlineDrawing' }>;

function blockedMove(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (
    node.attributes.some((a) => a.localName === 'noMove' && (a.value === '1' || a.value === 'true'))
  )
    return true;
  return node.children.some(blockedMove);
}

/** Move only ordinary inline picture runs; retained wrappers never lose their semantics. */
export function validateMoveInlineDrawing(part: OoxmlPart, op: Move): TreeOpRejection | null {
  const drawing = findNode(part, op.drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing') return 'not-a-drawing';
  if (
    !drawing.children.some((n) => n.namespaceUri === WP_NAMESPACE_URI && n.localName === 'inline')
  )
    return 'not-a-picture-drawing';
  const source = paragraphContainingNode(part, drawing.id);
  const run = parentOf(part, drawing.id);
  if (!source || !run || run.kind !== 'run' || parentOf(part, run.id)?.id !== source.id)
    return 'invalid-range';
  if (blockedMove(drawing)) return 'drawing-locked';
  for (const id of [drawing.id, op.paragraphId]) {
    if (isBoundAt(part, id)) return 'bound';
    if (effectiveContentLockAt(part, id).content) return 'locked';
  }
  const deletion = validateDrawingOp(part, { op: 'deleteDrawing', drawingNodeId: drawing.id });
  if (deletion) return deletion;
  return validateDrawingOp(part, {
    op: 'insertDrawing',
    paragraphId: op.paragraphId,
    offset: op.offset,
    drawing: drawing as OoxmlDrawingNode,
  });
}

/** Preserve the drawing identity so concurrent moves resolve to one destination. */
export function applyMoveInlineDrawing(
  part: OoxmlPart,
  op: Move,
  options?: EditOptions
): TreeOpResult {
  const result = runWithoutJournalCapture(() => moveDrawing(part, op, options));
  if (!result.ok || result.part === part || !isCanonicalPrimitiveCaptureActive()) return result;
  // Capture against the original tree so the moved subtree stays known to the journal.
  const replaced = replaceNode(part, part.root.id, result.part.root, options);
  return replaced.ok ? { ...result, part: replaced.part } : { ok: false, reason: 'tree-invariant' };
}

function moveDrawing(part: OoxmlPart, op: Move, options?: EditOptions): TreeOpResult {
  const refusal = validateMoveInlineDrawing(part, op);
  if (refusal) return { ok: false, reason: refusal };
  const drawing = findNode(part, op.drawingNodeId)!;
  const source = paragraphContainingNode(part, drawing.id)!;
  const segment = segmentsOf(source).find((s) => s.node.id === drawing.id);
  if (!segment) return { ok: false, reason: 'invalid-range' };
  const same = source.id === op.paragraphId;
  if (same && op.offset >= segment.start && op.offset <= segment.end)
    return {
      ok: true,
      part,
      effect: { dirty: [], created: [], deleted: [], dependencyKeys: [], impact: 'text-local' },
    };
  const run = parentOf(part, drawing.id)!;
  const removed = removeNode(part, drawing.id, options);
  if (!removed.ok) return { ok: false, reason: 'tree-invariant' };
  const destination = findNode(removed.part, op.paragraphId) as OoxmlParagraphNode;
  const offset =
    same && op.offset > segment.start ? op.offset - (segment.end - segment.start) : op.offset;
  const payload = {
    ...run,
    children: [...run.children.filter((n) => n.kind === 'runProperties'), drawing],
  } as OoxmlNode;
  const inserted = applyPlaceRunNodes(
    removed.part,
    destination,
    offset,
    [payload],
    options,
    new Set([drawing.id])
  );
  if (!inserted.ok) return inserted;
  return {
    ...inserted,
    effect: {
      dirty: [source.id, destination.id, drawing.id],
      created: [],
      deleted: [],
      dependencyKeys: TEXT_DEPS,
      impact: 'flow-structural',
    },
  };
}
