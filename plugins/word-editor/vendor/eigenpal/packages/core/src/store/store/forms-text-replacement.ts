import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { enforcesFormsProtection, sectionProtectsForms } from './forms-protection.ts';
import { resolveReach, treeOpReach } from './tree-op-content-controls.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** Keep a replacement in its original inline control when deletion leaves that control empty. */
export function createFormsTextReplacementContext(): (
  part: OoxmlPart,
  settings: OoxmlPart | null | undefined,
  op: TreeDocOp
) => TreeDocOp {
  let previous: {
    partName: string;
    paragraphId: string;
    offset: number;
    controlId: string;
  } | null = null;
  return (part, settings, op) => {
    const held = previous;
    previous = null;
    if (
      !enforcesFormsProtection(settings) ||
      !('paragraphId' in op) ||
      !sectionProtectsForms(part, op.paragraphId)
    )
      return op;
    if (
      op.op === 'insertText' &&
      !op.revision &&
      op.inside === undefined &&
      held &&
      held.partName === part.name &&
      held.paragraphId === op.paragraphId &&
      held.offset === op.offset
    ) {
      return { ...op, inside: held.controlId };
    }
    if (op.op !== 'deleteText' || op.revision || op.start >= op.end) return op;
    const paragraph = findNode(part, op.paragraphId);
    if (paragraph?.kind !== 'paragraph') return op;
    const reach = resolveReach(part, treeOpReach(op));
    if (reach.unprotected.length) return op;
    const offsets = paragraphOffsetIndex(paragraph);
    // The innermost control containing the WHOLE deletion owns the replacement. A touched
    // sibling or a partially selected outer control must never gain ownership of the text.
    for (const touch of reach.touches) {
      const span = offsets.spanOf(touch.control);
      if (span && span.start <= op.start && span.end >= op.end) {
        previous = {
          partName: part.name,
          paragraphId: op.paragraphId,
          offset: op.start,
          controlId: touch.control.id,
        };
      }
    }
    return op;
  };
}
