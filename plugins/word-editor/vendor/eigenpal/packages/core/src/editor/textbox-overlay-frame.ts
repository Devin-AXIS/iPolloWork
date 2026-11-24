// The painted frame of the text box being edited, for the selection overlay.
//
// A body box is a page drawing. A header or footer box repeats on every page its story shows
// on, and is edited on one of them, the page at the caret: its frame comes from that page's
// furniture, placed in the page's content coordinates like a body drawing's.

import type { ViewScope } from '../contracts/editor.ts';
import { furnitureTextboxDrawingsOnPage } from '../layout/furniture-textbox-records.ts';
import {
  findDrawingOverlayFrameInLayout,
  type DrawingOverlayFrame,
} from '../layout/semantic-hit-test.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import { textboxTakesCaret } from './textbox-caret-rules.ts';

/** The overlay frame of the text box `scope` edits, with the caret on page `caretPage`. */
export function editedTextboxOverlayFrame(
  layout: SemanticLayout,
  scope: Extract<ViewScope, { kind: 'frame' }>,
  caretPage: number
): DrawingOverlayFrame | null {
  if (!scope.owner) return findDrawingOverlayFrameInLayout(layout, scope.drawingNodeId);
  const at = layout.pages[caretPage];
  const pages = at?.index === caretPage ? [at, ...layout.pages] : layout.pages;
  for (const page of pages) {
    const found = furnitureTextboxDrawingsOnPage(page).find(
      (record) => record.drawing.drawingNodeId === scope.drawingNodeId
    );
    if (!found) continue;
    const { drawing, origin } = found;
    const bounds = drawing.paintBounds;
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return Object.freeze({
      pageIndex: page.index,
      x: origin.x + bounds.x - drawing.x,
      y: origin.y + bounds.y - drawing.y,
      width: bounds.width,
      height: bounds.height,
      record: drawing,
    });
  }
  return null;
}

/**
 * `{ textEditable }` for a text box drawing in `part`: whether its story takes a caret, by the
 * same rule entering the box applies. Nothing for any other drawing.
 */
export function textboxTextEditable(
  record: InlineDrawingRecord | AnchoredDrawingRecord,
  part: OoxmlPart
): { readonly textEditable?: boolean } {
  if (!record.textboxStory) return {};
  const story = textboxStoriesInPart(part).find(
    (candidate) => candidate.drawingNodeId === record.drawingNodeId
  );
  return { textEditable: !!story && textboxTakesCaret(part, story.root.id, record) };
}

/**
 * The message key saying why a selected text box frame takes no caret or offers no handles, or
 * null when it does both. Not in viewing mode: viewing refuses the edit itself, so the box
 * is not what stops it.
 *
 * @param target - The overlay target of the selected drawing.
 * @param editingMode - The surface's editing mode.
 * @returns `imageOverlay.textLocked`, `imageOverlay.locked`, or null.
 *
 * @example
 * ```ts
 * const key = textboxFrameReason(target, editor.surface!.editingMode());
 * const title = key ? t(key) : undefined;
 * ```
 *
 * @public
 */
export function textboxFrameReason(
  target: {
    readonly textbox?: boolean;
    readonly textEditable?: boolean;
    readonly canMove: boolean;
    readonly canResize: boolean;
  },
  editingMode: string
): 'imageOverlay.textLocked' | 'imageOverlay.locked' | null {
  if (!target.textbox || editingMode === 'view') return null;
  if (target.textEditable === false) return 'imageOverlay.textLocked';
  return !target.canMove && !target.canResize ? 'imageOverlay.locked' : null;
}
