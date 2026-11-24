// What a drawing op is and how far it reaches: the op family, its layout impact, and the
// effect a committed drawing edit reports.

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { paragraphContainingNode, TEXT_DEPS } from './tree-op-nodes.ts';
import type { DrawingTreeDocOp, ImpactClass, TreeDocOp, TreeOpEffect } from './tree-op-types.ts';

export function drawingOpImpact(op: DrawingTreeDocOp): ImpactClass {
  switch (op.op) {
    case 'setDrawingMetadata':
    case 'setDrawingLocks':
    case 'replaceDrawingResource':
    case 'setShapeFormat':
      return 'text-local';
    case 'moveInlineDrawing':
    case 'insertDrawing':
    case 'deleteDrawing':
    case 'resizeDrawing':
    case 'cropDrawing':
    case 'positionDrawing':
    case 'setDrawingWrap':
    case 'transformDrawing':
      return 'flow-structural';
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return 'flow-structural';
    }
  }
}

/** The effect of an edit to one drawing: its paragraph and the drawing are dirty. */
export function drawingEffect(
  part: OoxmlPart,
  drawingId: string,
  op: DrawingTreeDocOp
): TreeOpEffect {
  const paragraph = paragraphContainingNode(part, drawingId);
  const dirty = paragraph ? [paragraph.id, drawingId] : [drawingId];
  return {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: drawingOpImpact(op),
  };
}

/** Whether an op is one of the drawing ops. Narrows the type. */
export function isDrawingTreeDocOp(op: TreeDocOp): op is DrawingTreeDocOp {
  return (
    op.op === 'moveInlineDrawing' ||
    op.op === 'insertDrawing' ||
    op.op === 'replaceDrawingResource' ||
    op.op === 'deleteDrawing' ||
    op.op === 'resizeDrawing' ||
    op.op === 'cropDrawing' ||
    op.op === 'positionDrawing' ||
    op.op === 'setDrawingWrap' ||
    op.op === 'setDrawingMetadata' ||
    op.op === 'setDrawingLocks' ||
    op.op === 'transformDrawing' ||
    op.op === 'setShapeFormat'
  );
}

/** Whether a title or description is short XML text with no control characters. */
export function isValidXmlMetadata(value: string): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0 ||
      (code >= 0x1 && code <= 0x8) ||
      code === 0xb ||
      code === 0xc ||
      (code >= 0xe && code <= 0x1f)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The frame edits a text box takes: its size lives in `wp:extent`, and its text wrap in the
 * `wp:anchor` or `wp:inline` frame, as a picture's does.
 */
export const TEXTBOX_FRAME_EDITS: ReadonlySet<DrawingTreeDocOp['op']> = new Set([
  'resizeDrawing',
  'positionDrawing',
  'setDrawingWrap',
  'deleteDrawing',
  'setDrawingMetadata',
]);

/**
 * The frame edits a shape, line or group takes: its place, text wrap, removal and alt text. Its
 * size also lives in its own geometry (`a:xfrm`, a group's child extents), so a resize is refused.
 */
export const SHAPE_FRAME_EDITS: ReadonlySet<DrawingTreeDocOp['op']> = new Set([
  'positionDrawing',
  'setDrawingWrap',
  'deleteDrawing',
  'setDrawingMetadata',
]);
