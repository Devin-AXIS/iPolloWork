// Overlap displacement under `wp:anchor/@allowOverlap="0"`, deterministic before paint order.
//
// Word moves an object that may not overlap SIDEWAYS first, at its authored height: flush
// against the right edge of the object it hits when it still fits inside the content box,
// else flush against that object's left edge. Only when neither fits does it move down.
// Printed from Word 16.113: a later picture authored left of the one it hits still goes to
// the right when there is room, and one near the right margin goes to the left.

import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

/** Maximum displacement attempts before next-page deferral. */
export const MAX_OVERLAP_DISPLACEMENT_ATTEMPTS = 256;

const EPSILON = 0.001;

/** Canonical collision/displacement order — source traversal only, not paint metadata. */
export function compareDrawingCollisionOrder(
  left: AnchoredDrawingRecord,
  right: AnchoredDrawingRecord
): number {
  const leftOrder = left.sourceOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.sourceOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.drawingNodeId.localeCompare(right.drawingNodeId);
}

function paintBoundsOverlap(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function shiftBox(box: LayoutBox, dx: number, dy: number): LayoutBox {
  return Object.freeze({ ...box, x: box.x + dx, y: box.y + dy });
}

function shiftPoint(point: { readonly x: number; readonly y: number }, dx: number, dy: number) {
  return Object.freeze({ x: point.x + dx, y: point.y + dy });
}

/** Move a published anchored drawing and every geometry box it carries. */
export function shiftAnchoredDrawing(
  drawing: AnchoredDrawingRecord,
  dx: number,
  dy: number
): AnchoredDrawingRecord {
  if (Math.abs(dx) <= 0.000_1 && Math.abs(dy) <= 0.000_1) return drawing;
  const geometry = drawing.geometry;
  return Object.freeze({
    ...drawing,
    x: drawing.x + dx,
    y: drawing.y + dy,
    paintBounds: shiftBox(drawing.paintBounds, dx, dy),
    hitBounds: shiftBox(drawing.hitBounds, dx, dy),
    geometry: Object.freeze({
      ...geometry,
      contentBounds: shiftBox(geometry.contentBounds, dx, dy),
      paintBounds: shiftBox(geometry.paintBounds, dx, dy),
      hitBounds: shiftBox(geometry.hitBounds, dx, dy),
      transformedCorners: geometry.transformedCorners.map((point) => shiftPoint(point, dx, dy)),
      ...(geometry.imageTransformCorners
        ? {
            imageTransformCorners: geometry.imageTransformCorners.map((point) =>
              shiftPoint(point, dx, dy)
            ),
          }
        : {}),
      clipPolygon: geometry.clipPolygon
        ? geometry.clipPolygon.map((point) => shiftPoint(point, dx, dy))
        : null,
    }),
  });
}

export function shiftAnchoredDrawingY(
  drawing: AnchoredDrawingRecord,
  dy: number
): AnchoredDrawingRecord {
  return shiftAnchoredDrawing(drawing, 0, dy);
}

export interface OverlapDisplacementOptions {
  /** Height of the page's flow area; a drawing pushed past it defers to the next page. */
  readonly contentHeight: number;
  /** Width of the content box that sideways displacement stays inside. Absent: down only. */
  readonly contentWidth?: number;
  readonly maxAttempts?: number;
}

export interface OverlapDisplacementResult {
  readonly drawings: readonly AnchoredDrawingRecord[];
  readonly deferred: readonly AnchoredDrawingRecord[];
  readonly deferredNodeIds: readonly string[];
}

/** Word's sideways move off `blocker`, or null when neither side fits clear of `placed`. */
function sidewaysCandidate(
  candidate: AnchoredDrawingRecord,
  blocker: AnchoredDrawingRecord,
  placed: readonly AnchoredDrawingRecord[],
  contentWidth: number
): AnchoredDrawingRecord | null {
  const box = candidate.paintBounds;
  const right = blocker.paintBounds.x + blocker.paintBounds.width - box.x;
  const left = blocker.paintBounds.x - (box.x + box.width);
  for (const dx of [right, left]) {
    const x = box.x + dx;
    if (x < -EPSILON || x + box.width > contentWidth + EPSILON) continue;
    const moved = shiftAnchoredDrawing(candidate, dx, 0);
    if (!placed.some((existing) => paintBoundsOverlap(existing.paintBounds, moved.paintBounds)))
      return moved;
  }
  return null;
}

/** Deterministic overlap resolution: canonical source order, then stable node id. */
export function resolveOverlapDisplacement(
  drawings: readonly AnchoredDrawingRecord[],
  options: OverlapDisplacementOptions
): OverlapDisplacementResult {
  const maxAttempts = options.maxAttempts ?? MAX_OVERLAP_DISPLACEMENT_ATTEMPTS;
  const sorted = [...drawings].sort(compareDrawingCollisionOrder);
  const placed: AnchoredDrawingRecord[] = [];
  const deferred: AnchoredDrawingRecord[] = [];
  const deferredNodeIds: string[] = [];

  for (const drawing of sorted) {
    if (drawing.allowOverlap) {
      placed.push(drawing);
      continue;
    }
    let candidate = drawing;
    let attempts = 0;
    while (attempts < maxAttempts) {
      const blocker = placed.find((existing) =>
        paintBoundsOverlap(existing.paintBounds, candidate.paintBounds)
      );
      if (!blocker) break;
      const sideways =
        options.contentWidth === undefined
          ? null
          : sidewaysCandidate(candidate, blocker, placed, options.contentWidth);
      if (sideways) {
        candidate = sideways;
        break;
      }
      const step =
        blocker.paintBounds.y + blocker.paintBounds.height - candidate.paintBounds.y + EPSILON;
      candidate = shiftAnchoredDrawingY(candidate, step);
      attempts += 1;
    }
    const stillOverlaps = placed.some((existing) =>
      paintBoundsOverlap(existing.paintBounds, candidate.paintBounds)
    );
    // Only a displaced drawing defers for the page bottom. One that hits nothing keeps its
    // authored position, also when that position reaches into the bottom margin or the page
    // edge: re-deferring it could never fit, and only added blank pages until the budget ran out.
    const pastPageBottom =
      candidate !== drawing &&
      candidate.paintBounds.y + candidate.paintBounds.height > options.contentHeight + EPSILON;
    if (stillOverlaps || pastPageBottom) {
      // The next page has none of this page's blockers: carry the authored x there.
      if (candidate.x !== drawing.x)
        candidate = shiftAnchoredDrawing(candidate, drawing.x - candidate.x, 0);
      deferred.push(candidate);
      deferredNodeIds.push(candidate.drawingNodeId);
      continue;
    }
    placed.push(candidate);
  }

  return Object.freeze({
    drawings: Object.freeze(placed),
    deferred: Object.freeze(deferred),
    deferredNodeIds: Object.freeze(deferredNodeIds),
  });
}

/** Paint layer relative to body text — not the OOXML wrap element. */
export type DrawingPaintLayer = 'behind' | 'inFront';

export function paintLayerOf(drawing: AnchoredDrawingRecord): DrawingPaintLayer {
  return drawing.behindDocument ? 'behind' : 'inFront';
}

/** Stacking order: the behind-text layer first, then `relativeHeight`. 0 keeps document order. */
export function compareDrawingStackOrder(
  left: AnchoredDrawingRecord,
  right: AnchoredDrawingRecord
): number {
  const leftLayer = paintLayerOf(left);
  const rightLayer = paintLayerOf(right);
  if (leftLayer !== rightLayer) return leftLayer === 'behind' ? -1 : 1;
  return left.relativeHeight - right.relativeHeight;
}

export function compareDrawingPaintOrder(
  left: AnchoredDrawingRecord,
  right: AnchoredDrawingRecord
): number {
  return compareDrawingStackOrder(left, right) || compareDrawingCollisionOrder(left, right);
}

export function sortDrawingsForPaint(
  drawings: readonly AnchoredDrawingRecord[]
): readonly AnchoredDrawingRecord[] {
  return Object.freeze([...drawings].sort(compareDrawingPaintOrder));
}

/**
 * A header or footer story's drawings in stack order. The sort is stable, so equal ranks keep
 * the order in which layout placed them.
 */
export function sortStoryDrawingsForPaint(
  drawings: readonly AnchoredDrawingRecord[]
): readonly AnchoredDrawingRecord[] {
  return Object.freeze([...drawings].sort(compareDrawingStackOrder));
}
