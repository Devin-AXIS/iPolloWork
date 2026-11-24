// Replacing picture bytes is a content edit: leave placeholder state and unwrap temporary
// controls in the same transaction as the drawing and media change.
import { replaceChildren } from '../package/ooxml-edit.ts';
import type { EditOptions } from '../package/ooxml-edit.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { applyDrawingOp } from './tree-op-drawings.ts';
import { applyTreeOp } from './tree-op-apply.ts';
import {
  contentControlAncestorsOf,
  contentControlPropertiesOf,
  effectiveLockOf,
  isTemporaryControl,
} from './tree-op-nodes.ts';
import type { DrawingTreeDocOp, TreeOpResult } from './tree-op-types.ts';

export function applyDrawingContentEdit(
  part: OoxmlPart,
  op: DrawingTreeDocOp,
  options?: EditOptions
): TreeOpResult {
  if (op.op !== 'replaceDrawingResource') return applyDrawingOp(part, op, options);
  const controls = contentControlAncestorsOf(part, op.drawingNodeId).reverse();
  if (
    controls.some(
      (control) => isTemporaryControl(control) && effectiveLockOf(part, control).wrapper
    )
  ) {
    return { ok: false, reason: 'locked' };
  }
  let result = applyDrawingOp(part, op, options);
  for (const control of controls) {
    if (!result.ok) return result;
    if (isTemporaryControl(control)) {
      const unwrapped = applyTreeOp(
        result.part,
        { op: 'removeContentControl', controlId: control.id },
        options
      );
      if (!unwrapped.ok) return unwrapped;
      result = {
        ...unwrapped,
        effect: {
          ...result.effect,
          dirty: [...result.effect.dirty, ...unwrapped.effect.dirty],
          impact: 'flow-structural',
        },
      };
    } else {
      const properties = contentControlPropertiesOf(control);
      if (!properties) continue;
      const children = properties.children.filter(
        (child) => child.kind === 'textValue' || child.localName !== 'showingPlcHdr'
      );
      if (children.length === properties.children.length) continue;
      const edited = replaceChildren(result.part, properties.id, children, options);
      if (!edited.ok) return { ok: false, reason: 'tree-invariant' };
      result = { ...result, part: edited.part };
    }
  }
  return result;
}
