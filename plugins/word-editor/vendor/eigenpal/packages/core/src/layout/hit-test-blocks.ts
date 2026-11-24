// Block-level measures the hit test ranks candidate blocks by.
import { paragraphContentBounds } from './paragraph-content-bounds.ts';
import type { BlockFragmentRecord, LayoutBox } from './semantic-records.ts';

/** A page-relative point, in points. */
interface PointPt {
  readonly x: number;
  readonly y: number;
}

/** Distance from a point to a box, with the vertical axis weighted. Zero means inside. */
export function weightedDistance(box: LayoutBox, point: PointPt, verticalWeight: number): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return dx + dy * verticalWeight;
}

/**
 * How far a point is from a BLOCK, which is not the same question as how far it is from the
 * block's box.
 *
 * A table owns its whole horizontal band. Its box is only as wide as its columns, so the
 * blank strip beside a narrow table sits outside every box on the page, and plain
 * nearest-box hands that strip to whichever PARAGRAPH above or below happens to be closer —
 * a click level with row three lands two paragraphs up. Place the caret in the nearest
 * cell of that row, so a table level with the point is at distance zero
 * horizontally and the row resolution below picks the cell.
 *
 * Paragraphs keep the plain measure: their boxes start at the left indent, and the indent
 * strip must stay reachable by real proximity. The measure is taken to the paragraph's
 * painted content, not only its box: a hanging first line — a hanging indent, or a numbered
 * paragraph whose suffix tab stops before the indent — paints text left of the box (right of
 * it in a right-to-left paragraph), and a press on that text is on this paragraph.
 */
export function blockDistance(
  block: BlockFragmentRecord,
  point: PointPt,
  verticalWeight: number
): number {
  if (block.kind !== 'table') {
    return weightedDistance(paragraphContentBounds(block), point, verticalWeight);
  }
  const dy = Math.max(block.box.y - point.y, 0, point.y - (block.box.y + block.box.height));
  if (dy > 0) return weightedDistance(block.box, point, verticalWeight);
  return 0;
}

/**
 * Out-of-flow paragraphs are text frames, which carry their placement, or collapsed marks: an
 * empty section mark, or the empty line before a leading page break on a full page.
 */
export function isCollapsedSectionMark(block: BlockFragmentRecord): boolean {
  return block.kind === 'paragraph' && block.outOfFlow === true && !block.positionedFrame;
}
