// Pure geometry of an image drag on the overlay: EMU and point conversion, the extent a resize
// produces, and the position a move produces. No editor state, so a host can reuse it.

import type { DrawingPositionInput } from '../store/package/drawing-projection.ts';

/** Which of the eight resize handles a drag started from, by compass direction. */
export type ImageResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** EMUs per point. DrawingML stores extents in EMU; layout works in points. */
export const EMU_PER_POINT = 12_700;

/** Points to EMU, rounded — EMUs are integral in the file. */
export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

/** EMU to points. Unrounded, so overlay geometry keeps sub-point precision during a drag. */
export function emuToOverlayPoints(emu: number): number {
  return emu / EMU_PER_POINT;
}

/**
 * The extent a resize drag produces, in EMU.
 *
 * Computed from the drag's START extent rather than the previous frame's, so a drag that reverses
 * direction lands exactly where it began instead of accumulating rounding error.
 *
 * `preserveAspect` behaves the way Word's handles do: a corner handle scales by whichever axis
 * moved further, while an edge handle drives the other axis from the original ratio. Both axes
 * are floored at one point, so a drag past the opposite edge cannot invert the image.
 */
export function computeResizedImageExtentEmu(
  startWidthEmu: number,
  startHeightEmu: number,
  handle: ImageResizeHandle,
  deltaWidthPt: number,
  deltaHeightPt: number,
  preserveAspect: boolean
): { readonly cx: number; readonly cy: number } {
  let widthPt = emuToOverlayPoints(startWidthEmu);
  let heightPt = emuToOverlayPoints(startHeightEmu);
  const aspect = widthPt / heightPt;
  const horizontal = handle.includes('e') ? deltaWidthPt : handle.includes('w') ? -deltaWidthPt : 0;
  const vertical = handle.includes('s') ? deltaHeightPt : handle.includes('n') ? -deltaHeightPt : 0;
  widthPt = Math.max(1, widthPt + horizontal);
  heightPt = Math.max(1, heightPt + vertical);
  if (preserveAspect) {
    const corner = handle.length === 2;
    if (corner) {
      const scale = Math.max(
        widthPt / emuToOverlayPoints(startWidthEmu),
        heightPt / emuToOverlayPoints(startHeightEmu)
      );
      widthPt = Math.max(1, emuToOverlayPoints(startWidthEmu) * scale);
      heightPt = Math.max(1, widthPt / aspect);
    } else if (handle === 'e' || handle === 'w') {
      heightPt = Math.max(1, widthPt / aspect);
    } else {
      widthPt = Math.max(1, heightPt * aspect);
    }
  }
  return Object.freeze({ cx: pointsToEmu(widthPt), cy: pointsToEmu(heightPt) });
}

/**
 * The position a move drag produces, preserving the anchoring the file already used.
 *
 * A `frame`-mode position keeps its `relativeToH`/`relativeToV` bases and only shifts the offsets
 * it actually had — writing an offset the file omitted would re-anchor the drawing to a different
 * reference and move it somewhere the drag never pointed.
 */
export function computeMovedImagePosition(
  start: DrawingPositionInput,
  deltaXPt: number,
  deltaYPt: number
): DrawingPositionInput {
  if (start.mode === 'simple') {
    return Object.freeze({
      mode: 'simple' as const,
      horizontalEmu: (start.horizontalEmu ?? 0) + pointsToEmu(deltaXPt),
      verticalEmu: (start.verticalEmu ?? 0) + pointsToEmu(deltaYPt),
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(start.horizontalEmu !== undefined
      ? { horizontalEmu: start.horizontalEmu + pointsToEmu(deltaXPt) }
      : {}),
    ...(start.verticalEmu !== undefined
      ? { verticalEmu: start.verticalEmu + pointsToEmu(deltaYPt) }
      : {}),
    ...(start.relativeToH !== undefined ? { relativeToH: start.relativeToH } : {}),
    ...(start.relativeToV !== undefined ? { relativeToV: start.relativeToV } : {}),
  });
}
