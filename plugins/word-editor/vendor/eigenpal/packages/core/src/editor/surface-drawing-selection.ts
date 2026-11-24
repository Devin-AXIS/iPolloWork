// Selecting one painted drawing: where the caret goes.
//
// Its own module because both callers sit at their line caps, and because "which offset does
// this drawing occupy" is a layout question, separate from the image command surface.

import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';

/**
 * Where selecting one painted drawing puts the caret, or null when the layout has no such
 * frame on that paragraph.
 *
 * A drawing is selected by collapsing the selection onto the offset its record occupies, the
 * same position a pointer press resolves to. Returning the position rather than performing
 * the selection keeps this out of the surface, which is at its line cap.
 */
export function drawingSelectionPosition(
  layout: SemanticLayout | null,
  drawingNodeId: string,
  hostParagraphId: string
): { readonly paragraphId: string; readonly offset: number } | null {
  if (!layout) return null;
  const found = findDrawingOverlayFrameInLayout(layout, drawingNodeId);
  if (!found || found.record.paragraphId !== hostParagraphId) return null;
  return { paragraphId: hostParagraphId, offset: found.record.start };
}
