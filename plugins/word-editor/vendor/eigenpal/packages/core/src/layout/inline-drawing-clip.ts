// Rigid moves and region clips of a placed drawing's geometry. Split out of
// `drawing-layout.ts`, which re-exports the clips, so that module stays inside its line
// budget; behavior is unchanged.

import { clipBoxToRegion, hitBoundsOf } from './drawing-clip-box.ts';
import type { InlineDrawingRecord } from './drawing-layout.ts';
import { clipGeometryToRegion, type DrawingGeometry } from './drawing-geometry.ts';
import type { LayoutBox } from './semantic-records.ts';

/** Translate a drawing's geometry by (dx, dy); the same object when the move is negligible. */
export function shiftGeometry(geometry: DrawingGeometry, dx: number, dy: number): DrawingGeometry {
  if (Math.abs(dx) < 0.000_1 && Math.abs(dy) < 0.000_1) return geometry;
  const shiftBox = (box: LayoutBox): LayoutBox =>
    Object.freeze({ ...box, x: box.x + dx, y: box.y + dy });
  const shiftPoint = (point: { readonly x: number; readonly y: number }) =>
    Object.freeze({ x: point.x + dx, y: point.y + dy });
  return Object.freeze({
    ...geometry,
    contentBounds: shiftBox(geometry.contentBounds),
    paintBounds: shiftBox(geometry.paintBounds),
    hitBounds: shiftBox(geometry.hitBounds),
    transformedCorners: Object.freeze(geometry.transformedCorners.map(shiftPoint)),
    ...(geometry.imageTransformCorners
      ? { imageTransformCorners: Object.freeze(geometry.imageTransformCorners.map(shiftPoint)) }
      : {}),
    clipPolygon: geometry.clipPolygon ? Object.freeze(geometry.clipPolygon.map(shiftPoint)) : null,
  });
}

export function clipInlineDrawingRecordVertically(
  drawing: InlineDrawingRecord,
  regionTop: number,
  regionBottom: number
): InlineDrawingRecord {
  return clipInlineDrawingRecordToRegion(
    drawing,
    Object.freeze({
      x: drawing.x,
      y: regionTop,
      width: drawing.width,
      height: Math.max(0, regionBottom - regionTop),
    })
  );
}

/** Clip paint/hit to `region` on both axes; authored `width`/`height` stay unchanged. */
export function clipInlineDrawingRecordToRegion(
  drawing: InlineDrawingRecord,
  region: LayoutBox
): InlineDrawingRecord {
  const paintBounds = clipBoxToRegion(drawing.paintBounds, region);
  const hitBounds = hitBoundsOf(paintBounds);
  const dx = drawing.x - drawing.geometry.contentBounds.x;
  const dy = drawing.y - drawing.geometry.contentBounds.y;
  const shiftedGeometry = shiftGeometry(drawing.geometry, dx, dy);
  return Object.freeze({
    ...drawing,
    paintBounds,
    hitBounds,
    geometry: clipGeometryToRegion(shiftedGeometry, region),
  });
}

/**
 * Clip an inline drawing to the paper sideways and the body band vertically. Text art whose ink
 * rises over its box (an arch) keeps that ink past the band.
 */
export function clipInlineDrawingToBodyBand(
  drawing: InlineDrawingRecord,
  paper: LayoutBox,
  bandHeight: number
): InlineDrawingRecord {
  const art = drawing.textArt?.inkBounds !== undefined;
  return clipInlineDrawingRecordToRegion(drawing, {
    x: paper.x,
    y: art ? -1e5 : 0,
    width: paper.width,
    height: art ? 2e5 : bandHeight,
  });
}
