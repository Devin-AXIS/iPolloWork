import { placeOrdinaryCellLine } from './ordinary-cell-line.ts';
// Placing and aligning one cell line in its line box.
//
// Shared by cell placement and row geometry reuse, so a reused line goes through exactly the
// arithmetic a fresh placement would.

import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { InlineDrawingRecord } from './drawing-layout.ts';
import { alignLineWithPictures } from './line-picture-alignment.ts';
import {
  alignSpans,
  boxLineSetsLikeLastLine,
  paragraphDistributedSpacing,
  lineAlignmentMeasure,
  lineAlignOffset,
  type Alignment,
} from './paragraph-alignment.ts';
import type { PendingLine } from './pending-line.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** What a paragraph's lines share when they are aligned. */
export interface CellLineAlignment {
  readonly measurer: TextMeasurer;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly props: readonly OoxmlProperty[];
  readonly alignment: Alignment;
  readonly rtl: boolean;
  readonly inTableCell: boolean;
}

/** Place `pendingLine`'s spans at `penX` and `y`, then align them with the line's pictures. */
export function alignCellLine(
  pendingLine: PendingLine,
  paragraphId: string,
  penX: number,
  y: number,
  placedDrawings: readonly InlineDrawingRecord[],
  lineIndent: number,
  lineAvailableWidth: number,
  isLastLine: boolean,
  shared: CellLineAlignment
): ReturnType<typeof alignLineWithPictures> {
  const { alignment } = shared;
  const ordinary =
    !shared.rtl && placedDrawings.length === 0
      ? placeOrdinaryCellLine(
          pendingLine,
          paragraphId,
          penX,
          y,
          lineIndent,
          lineAvailableWidth,
          alignment
        )
      : null;
  if (ordinary) return { spans: ordinary.spans, offset: ordinary.offset, drawings: placedDrawings };
  const placedSpans = pendingLine.spans.map((span) => ({
    ...span,
    // A cell paragraph breaks under its own id, so its spans share the broken range.
    range: span.range.paragraphId === paragraphId ? span.range : { ...span.range, paragraphId },
    box: { ...span.box, x: span.box.x + penX, y },
  }));
  // A float in the cell leaves the line passages; the line aligns inside them, as in the body.
  // A right-to-left line maps its mirrored passages back through the pen origin.
  const measure = lineAlignmentMeasure(pendingLine, penX, lineIndent, lineAvailableWidth);
  return alignLineWithPictures(
    placedSpans,
    placedDrawings,
    shared.rtl,
    (spans) =>
      alignSpans(
        spans,
        shared.measurer,
        measure.indent,
        measure.available,
        alignment,
        boxLineSetsLikeLastLine(shared.props, pendingLine, isLastLine, shared.styleCascade),
        alignment === 'center' || alignment === 'right' ? measure.used : undefined,
        shared.rtl,
        shared.inTableCell,
        pendingLine.spaceShrink === true,
        measure.passages,
        paragraphDistributedSpacing(shared.props, shared.styleCascade),
        shared.styleCascade?.typography?.eastAsianSpacing !== false,
        pendingLine,
        shared.styleCascade?.typography?.balancedSpaceShrink === true
      ),
    (aligned) => lineAlignOffset(placedSpans, aligned, alignment, measure.available, measure.used)
  );
}
