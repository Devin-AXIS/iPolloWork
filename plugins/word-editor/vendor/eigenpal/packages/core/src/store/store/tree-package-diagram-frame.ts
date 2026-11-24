// Drawing ops whose resize of a DrawingML diagram also rescales the diagram's saved drawing
// part, as ONE package undo unit. Other DOCX applications lay the diagram out again for the
// new `wp:extent`; the saved drawing must follow, or this engine and applications that read
// it would paint the old layout in the new frame (`package/diagram-frame.ts`).

import type { OoxmlPart } from '../package/ooxml-tree.ts';
import type { StoryScope, TreePackageStore } from './tree-package-store.ts';
import { transactPackageImage, type ImageIntentResult } from './tree-package-images.ts';
import {
  DIAGRAM_RESCALE_REFUSAL,
  diagramDrawingOf,
  stageDiagramRescale,
} from './tree-op-diagram-drawing.ts';
import type { DrawingTreeDocOp } from './tree-op-types.ts';

/** Whether `ops` resize a diagram of `part`, so they need {@link applyDrawingFrameOps}. */
export function resizesDiagram(part: OoxmlPart, ops: readonly DrawingTreeDocOp[]): boolean {
  return ops.some((op) => op.op === 'resizeDrawing' && diagramDrawingOf(part, op.drawingNodeId));
}

/**
 * Apply drawing ops in one package undo unit. Before each resize of a diagram, the diagram's
 * saved drawing part is rescaled from the frame it has to the frame the op gives it.
 */
export function applyDrawingFrameOps(
  store: TreePackageStore,
  scope: StoryScope,
  ops: readonly DrawingTreeDocOp[]
): ImageIntentResult {
  const first = ops.find((op) => 'drawingNodeId' in op);
  if (!first || !('drawingNodeId' in first)) return { ok: false, reason: 'invalidArgs' };
  // The id the unit reports, as the image lanes do; every op still names its own drawing.
  let refused = false;
  const outcome = transactPackageImage(store, scope, (ctx, owner) => {
    for (const op of ops) {
      if (!stageDiagramRescale(ctx, owner, op)) {
        refused = true;
        return null;
      }
      if (!ctx.apply(op)) return null;
    }
    return first.drawingNodeId;
  });
  return refused ? { ok: false, reason: 'invalidArgs', detail: DIAGRAM_RESCALE_REFUSAL } : outcome;
}
