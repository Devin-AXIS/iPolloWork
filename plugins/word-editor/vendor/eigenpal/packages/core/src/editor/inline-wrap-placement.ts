import type { BlockFragmentRecord, SemanticLayout } from '../layout/semantic-records.ts';
import type { DrawingPositionInput } from '../store/package/drawing-projection.ts';

const EMU_PER_POINT = 12_700;

/**
 * Where an inline picture goes when a wrap change makes it float: the place it occupies now.
 *
 * The horizontal offset is measured from the left margin and the vertical offset from the top
 * of the picture's paragraph, so the floating picture still moves with its text. Returns null
 * when the picture is not in a top-level body paragraph that starts on its page, such as a
 * picture in a table cell, a header, a text frame, or a paragraph continued from the previous
 * page. The conversion then keeps its default place at the start of the column and paragraph.
 */
export function inlineToFloatingPosition(
  layout: SemanticLayout,
  drawingNodeId: string
): DrawingPositionInput | null {
  for (const page of layout.pages) {
    const found = findInBody(page.fragments, drawingNodeId);
    if (found !== undefined) return found;
  }
  return null;
}

function findInBody(
  fragments: readonly BlockFragmentRecord[],
  drawingNodeId: string
): DrawingPositionInput | null | undefined {
  for (const fragment of fragments) {
    if (fragment.kind !== 'paragraph') continue;
    for (const line of fragment.lines) {
      for (const drawing of line.drawings ?? []) {
        if (drawing.drawingNodeId !== drawingNodeId) continue;
        if (fragment.fragmentIndex !== 0 || fragment.positionedFrame || fragment.outOfFlow) {
          return null;
        }
        const horizontal = Math.round(drawing.x * EMU_PER_POINT);
        const vertical = Math.round((drawing.y - fragment.box.y) * EMU_PER_POINT);
        if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return null;
        return Object.freeze({
          mode: 'frame' as const,
          horizontalEmu: horizontal,
          verticalEmu: vertical,
          relativeToH: 'margin' as const,
          relativeToV: 'paragraph' as const,
        });
      }
    }
  }
  return undefined;
}
