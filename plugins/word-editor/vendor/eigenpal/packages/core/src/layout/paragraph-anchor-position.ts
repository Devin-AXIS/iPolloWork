// Where a drawing anchored in a body paragraph resolves, when its anchor line is known.
//
// Shared by the paragraph's own wrap zones and by the bands a clearing break finds for the
// paragraph's own floats, so both place a drawing at the same X and Y.

import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { resolveAnchoredDrawingPosition } from './drawing-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

/**
 * Resolve a paragraph-anchored drawing against its anchor line at `lineY`.
 *
 * With a frame base, the page and margin frames come from it, so a page- or margin-relative
 * position resolves against the sheet. Without one, the scaffold below stands in: the column
 * is the content box and the page frames are placeholders, which is only exact for frames the
 * paragraph itself defines.
 */
export function resolveParagraphAnchorPosition(
  projection: DrawingProjection,
  options: {
    readonly frameBase?: BodyAnchorFrameBase;
    readonly contentLeft: number;
    readonly contentRight: number;
    readonly lineY: number;
    readonly ownerPartName: string;
    readonly cellBox?: LayoutBox | null;
  }
): ReturnType<typeof resolveAnchoredDrawingPosition> {
  const contentWidth = Math.max(1, options.contentRight - options.contentLeft);
  const lineBox = Object.freeze({
    x: options.contentLeft,
    y: options.lineY,
    width: contentWidth,
    height: 14,
  });
  const layoutInCell = options.cellBox != null;
  return resolveAnchoredDrawingPosition(projection, {
    pageNumber: 1,
    pageWidth: options.contentRight + options.contentLeft + contentWidth,
    pageHeight: 792,
    marginLeft: options.contentLeft,
    marginRight: 0,
    marginBottom: 0,
    contentInsetTop: 0,
    contentInsetBottom: 0,
    contentWidth,
    contentHeight: 648,
    contentBandHeight: 648,
    paragraphBox: lineBox,
    anchorLineBox: lineBox,
    anchorCharacterX: options.contentLeft,
    columnBox: lineBox,
    cellBox: layoutInCell ? options.cellBox! : null,
    layoutInCell,
    ownerPartName: options.ownerPartName,
    storyKind: 'body',
    ...options.frameBase,
  });
}
