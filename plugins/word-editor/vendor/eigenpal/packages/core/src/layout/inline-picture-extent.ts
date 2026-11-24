import type { DrawingProjection } from '../store/package/drawing-projection.ts';

/** Quarter-turn inline pictures occupy the rotated extent, before effect insets. */
export function inlinePictureExtent(projection: DrawingProjection): DrawingProjection['extentEmu'] {
  const rotation = projection.picture?.transform.rotationDegrees;
  if (projection.kind === 'inline' && rotation !== undefined && Math.abs(rotation % 180) === 90) {
    const { cx, cy } = projection.extentEmu;
    return { cx: cy, cy: cx };
  }
  return projection.extentEmu;
}
