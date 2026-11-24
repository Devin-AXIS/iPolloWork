import type { DrawingProjection, ImageWrapTarget } from '../store/package/drawing-projection.ts';
import type { DrawingTreeDocOp } from '../store/store/tree-op-types.ts';

/** Inline quarter-turn pictures exchange stored axes when they cross the inline boundary. */
export function wrapExtentOf(
  projection: DrawingProjection,
  wrap: ImageWrapTarget,
  extent = projection.extentEmu
): DrawingProjection['extentEmu'] | null {
  const rotation = projection.picture?.transform.rotationDegrees;
  if (
    (projection.kind === 'inline') === (wrap === 'inline') ||
    rotation === undefined ||
    Math.abs(rotation % 180) !== 90 ||
    extent.cx === extent.cy
  )
    return null;
  return { cx: extent.cy, cy: extent.cx };
}

export interface WrapExtentOverrides {
  readonly widthEmu?: number;
  readonly heightEmu?: number;
  readonly resetToNaturalSize?: boolean;
}
/** Use existing operations so every collaboration participant receives the same authored extent. */
export function preserveWrapExtentOps(
  projection: DrawingProjection,
  wrap: ImageWrapTarget,
  ops: DrawingTreeDocOp[],
  overrides?: WrapExtentOverrides,
  drawingNodeId = projection.drawingNodeId
): void {
  const extent = wrapExtentOf(projection, wrap);
  if (!extent) return;
  const index = ops.findIndex((op) => op.op === 'resizeDrawing');
  const resize = ops[index];
  if (resize?.op === 'resizeDrawing') {
    ops[index] = {
      ...resize,
      extentEmu: {
        cx:
          overrides?.widthEmu !== undefined || overrides?.resetToNaturalSize
            ? resize.extentEmu.cx
            : extent.cx,
        cy:
          overrides?.heightEmu !== undefined || overrides?.resetToNaturalSize
            ? resize.extentEmu.cy
            : extent.cy,
      },
    };
  } else ops.push({ op: 'resizeDrawing', drawingNodeId, extentEmu: extent });
}
