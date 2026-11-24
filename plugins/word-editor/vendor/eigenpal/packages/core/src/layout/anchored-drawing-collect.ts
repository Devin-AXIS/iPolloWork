// The anchored drawings a page collects as the body flow places their paragraphs.

import type { AnchoredDrawingRecord, InlineDrawingLayoutContext } from './drawing-layout.ts';
import {
  MAX_ANCHOR_PAGE_DEFERRALS,
  withAnchoredDrawingLayoutFallback,
} from './drawing-exclusion.ts';
import { resolveOverlapDisplacement, type OverlapDisplacementOptions } from './drawing-overlap.ts';

/** The page's drawings, those deferred to the next page, and how often each was deferred. */
export interface AnchoredDrawingCollection {
  readonly pending: AnchoredDrawingRecord[];
  readonly deferred: AnchoredDrawingRecord[];
  readonly deferCounts: Map<string, number>;
}

/**
 * The source order of a drawing, looked up by the drawing its atom projects, when the layout
 * maps atoms to drawings.
 */
export function drawingSourceOrder(
  layout: InlineDrawingLayoutContext | undefined,
  order: ReadonlyMap<string, number> | undefined
): (drawingNodeId: string) => number | undefined {
  return (drawingNodeId) =>
    order?.get(layout?.projectionForAtom?.(drawingNodeId)?.drawingNodeId ?? drawingNodeId);
}

/**
 * Adds `drawings` to the page once each, with their source order, then moves them off one
 * another. A drawing pushed off the page waits for the next one, until it has waited
 * `MAX_ANCHOR_PAGE_DEFERRALS` times and stays with a layout fallback. `frame` is absent when
 * no drawing layout is available, and then nothing moves.
 */
export function collectAnchoredDrawings(
  drawings: readonly AnchoredDrawingRecord[],
  into: AnchoredDrawingCollection,
  sourceOrderOf: (drawingNodeId: string) => number | undefined,
  frame: (() => OverlapDisplacementOptions) | undefined
): void {
  if (drawings.length === 0) return;
  const { pending, deferred, deferCounts } = into;
  for (const drawing of drawings) {
    if (pending.some((existing) => existing.drawingNodeId === drawing.drawingNodeId)) continue;
    pending.push(
      drawing.sourceOrder === undefined && sourceOrderOf(drawing.drawingNodeId) !== undefined
        ? Object.freeze({ ...drawing, sourceOrder: sourceOrderOf(drawing.drawingNodeId) })
        : drawing
    );
  }
  if (!frame) return;
  const resolved = resolveOverlapDisplacement(pending, frame());
  pending.splice(0, pending.length, ...resolved.drawings);
  for (const drawing of resolved.deferred) {
    const count = (deferCounts.get(drawing.drawingNodeId) ?? 0) + 1;
    deferCounts.set(drawing.drawingNodeId, count);
    if (count >= MAX_ANCHOR_PAGE_DEFERRALS)
      pending.push(withAnchoredDrawingLayoutFallback(drawing, 'page-defer-exhausted'));
    else deferred.push(drawing);
  }
}
