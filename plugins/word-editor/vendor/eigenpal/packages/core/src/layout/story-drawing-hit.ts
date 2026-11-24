// Which header or footer drawing a point on the page reaches. Each drawing maps into its own
// record space as the furniture layer paints it: a page-relative axis against the page, a
// story-relative one against the story box.

import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import { hitAnchoredDrawingAtPoint, type SemanticHit } from './semantic-hit-test.ts';

type Point = Readonly<{ x: number; y: number }>;

/** Which drawings a story hit test reads: those in front of the text, behind it, or all. */
export type StoryDrawingLayer = 'front' | 'behind' | 'any';

/**
 * The story drawing at `point`, given in the space `storyBox` and `pageBox` share (page
 * sheet points), topmost first: drawings in front of the text, then those behind it, each
 * band by `relativeHeight`.
 */
export function hitStoryDrawingAtPoint(
  drawings: readonly AnchoredDrawingRecord[] | undefined,
  storyBox: Point,
  pageBox: Point,
  point: Point,
  pageIndex: number,
  layer: StoryDrawingLayer
): SemanticHit | null {
  if (!drawings || drawings.length === 0) return null;
  const ordered = [...drawings].sort((left, right) =>
    left.behindDocument !== right.behindDocument
      ? left.behindDocument
        ? 1
        : -1
      : right.relativeHeight - left.relativeHeight
  );
  for (const drawing of ordered) {
    if (layer === 'front' && drawing.behindDocument) continue;
    if (layer === 'behind' && !drawing.behindDocument) continue;
    const origin = headerFooterAnchoredDrawingOrigin(drawing, storyBox, pageBox);
    const local = { x: point.x - (origin.x - drawing.x), y: point.y - (origin.y - drawing.y) };
    const hit = hitAnchoredDrawingAtPoint([drawing], local, pageIndex);
    if (hit) return hit;
  }
  return null;
}
