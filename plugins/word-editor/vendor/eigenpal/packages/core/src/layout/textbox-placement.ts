// Placement of a text box whose story sizes the box: an unwrapped story sets its width, and
// a story that fits its shape sets its height.

import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { InlineDrawingLayoutInput } from './drawing-layout.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import type { TextboxStoryLayout } from './textbox-story-layout.ts';

const EMU_PER_POINT = 12_700;

/**
 * The projection that places a text box whose unwrapped story sized its own width.
 *
 * Only the extent width changes, so frame alignment (center, right, inside, outside) resolves
 * against the box the text actually occupies. Returns the input unchanged otherwise.
 */
export function textboxPlacementProjection(
  projection: DrawingProjection,
  story: TextboxStoryLayout | null | undefined
): DrawingProjection {
  if (story?.extentWidth === undefined && story?.extentHeight === undefined) return projection;
  const cx =
    story.extentWidth === undefined
      ? projection.extentEmu.cx
      : Math.round(story.extentWidth * EMU_PER_POINT);
  const cy =
    story.extentHeight === undefined
      ? projection.extentEmu.cy
      : Math.round(story.extentHeight * EMU_PER_POINT);
  if (cx === projection.extentEmu.cx && cy === projection.extentEmu.cy) return projection;
  return Object.freeze({
    ...projection,
    extentEmu: Object.freeze({ cx, cy }),
  });
}

/** Placed inline projections per layouter: one layout pass reuses each fitted box. */
const fittedByLayouter = new WeakMap<
  TextboxStoryLayouter,
  WeakMap<DrawingProjection, DrawingProjection>
>();

/**
 * `pieces` with each inline DrawingML text box that fits its text sized to that text, so its
 * line reserves the fitted box. The same array when no piece holds such a box.
 */
export function withFittedInlineTextboxes<
  P extends { readonly inlineDrawing?: InlineDrawingLayoutInput },
>(pieces: P[], layoutTextboxStory: TextboxStoryLayouter | undefined): P[] {
  const fits = (piece: P) => piece.inlineDrawing?.projection.textboxStory?.drawingFit === true;
  if (!layoutTextboxStory || !pieces.some(fits)) return pieces;
  let placed = fittedByLayouter.get(layoutTextboxStory);
  if (!placed) {
    placed = new WeakMap();
    fittedByLayouter.set(layoutTextboxStory, placed);
  }
  const cache = placed;
  return pieces.map((piece) => {
    const drawing = piece.inlineDrawing;
    if (!drawing || !fits(piece)) return piece;
    let projection = cache.get(drawing.projection);
    if (!projection) {
      projection = textboxPlacementProjection(
        drawing.projection,
        layoutTextboxStory(drawing.projection)
      );
      cache.set(drawing.projection, projection);
    }
    return projection === drawing.projection
      ? piece
      : { ...piece, inlineDrawing: Object.freeze({ ...drawing, projection }) };
  });
}
