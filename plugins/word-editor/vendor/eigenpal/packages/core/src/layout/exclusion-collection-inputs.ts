// The inputs every exclusion zone collection of one flow shares.
//
// The reflow loop collects each pass's zones with these, and live zones
// (`live-exclusion-zones.ts`) rebuild a placed picture's zone with them. Both must read the
// same column layout and source order, or a record's live zone would differ from the zone the
// pass collects for it, and the passes would never reach a fixed point.

import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { ExclusionColumnLayout } from './drawing-exclusion.ts';
import type { ResolvedSectionColumns } from './section-columns.ts';

export function exclusionColumnLayoutOf(
  columns: ResolvedSectionColumns,
  contentWidth: number
): ExclusionColumnLayout {
  return Object.freeze({
    columnCount: columns.count,
    columnGapPt: columns.gaps[0] ?? 0,
    contentWidth,
    columnLefts: columns.lefts,
    columnWidths: columns.widths,
  });
}

/** A drawing's place in source order, read through its projection when it has one. */
export function exclusionSourceOrderOf(options: {
  readonly inlineDrawingLayout?: InlineDrawingLayoutContext;
  readonly drawingSourceOrder?: ReadonlyMap<string, number>;
}): (drawingNodeId: string) => number | undefined {
  return (drawingNodeId) =>
    options.drawingSourceOrder?.get(
      options.inlineDrawingLayout?.projectionForAtom?.(drawingNodeId)?.drawingNodeId ??
        drawingNodeId
    );
}
