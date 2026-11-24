import type { Editor } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { hostDocumentOf, hostWindowOf, isElementNode } from './host-realm.ts';
import { armGroupMemberPress } from './group-member-selection.ts';

/**
 * Where a press on the selected drawing's frame belongs: to the frame itself (a move), to the
 * text under it, or to another drawing under it.
 * @public
 */
export type DrawingFramePress = 'frame' | 'text' | { readonly drawingNodeId: string };

/** How long a frame lets a tap through to the text under it, in milliseconds. */
const TAP_PASS_THROUGH_MS = 800;

/**
 * Hands a press on the selected drawing's frame to the text or the drawing under it.
 *
 * A drawing behind the text paints under it, and its frame covers that text. Where the press
 * lands in a line of text, the text takes it and places the caret, as it does while the
 * drawing is not selected. Elsewhere the frame keeps the press, to move the drawing. Adapters
 * call this first in the frame's `pointerdown` handler.
 *
 * Another drawing under the frame takes the press the same way, so it selects and can move.
 *
 * A mouse or pen press goes on to the element under the frame. A touch press is not taken:
 * the frame lets the tap through for its duration, so the browser's own tap reaches the text.
 *
 * @returns Where the press went, never a boolean. `'frame'` (a non-empty string, so truthy)
 * means nothing was passed: the frame keeps the press and may start a move. `'text'` or a
 * drawing means the press was passed on: start no move, and give the keyboard to the editor
 * (`'text'`) or to that drawing. Compare with `'frame'`; never test the result for truth.
 * @public
 */
export function passDrawingFramePress(editor: Editor, event: PointerEvent): DrawingFramePress {
  const surface = (editor as DocxEditorInstance).surface;
  const target = surface ? drawingFramePressTarget(editor, event) : 'frame';
  const frame = isElementNode(event.target) ? event.target : null;
  // A press on a selected group's frame that comes up without a drag selects the shape
  // under it, as a second press on a group does; a drag still moves the group.
  if (surface && target === 'frame' && frame) armGroupMemberPress(surface, event, frame);
  if (!surface || target === 'frame' || !frame) return 'frame';
  if (event.pointerType === 'touch') {
    letTapThrough(frame);
    return target;
  }
  const overlay = frame.closest('.docx-image-selection-overlay') ?? frame;
  const pages = surface.hostElement().querySelector<HTMLElement>(':scope > .docx-pages');
  if (!pages) return 'frame';
  // The element under the frame, so the pointer's own target checks (furniture, note
  // references, control widgets) see the press as if the frame were not there.
  const under =
    hostDocumentOf(frame)
      .elementsFromPoint?.(event.clientX, event.clientY)
      .find((element) => !overlay.contains(element) && pages.contains(element)) ?? pages;
  event.preventDefault();
  event.stopPropagation();
  const PointerEventOfHost = hostWindowOf(under).PointerEvent;
  under.dispatchEvent(
    new PointerEventOfHost('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: event.button,
      buttons: event.buttons,
      detail: event.detail,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    })
  );
  return target;
}

/**
 * Where a press on the selected drawing's frame belongs, without acting on it. For a drawing
 * behind the text, a press in a line of text belongs to the text, and a press that another
 * drawing wins belongs to that drawing. Every other press is the frame's. Adapters call it only
 * for presses on the selected drawing's frame, to give the keyboard to what takes the press.
 * @public
 */
export function drawingFramePressTarget(editor: Editor, event: PointerEvent): DrawingFramePress {
  const surface = (editor as DocxEditorInstance).surface;
  if (!surface || event.button !== 0 || event.shiftKey) return 'frame';
  const record = resolveSelectedDrawingRecord(surface);
  if (!record || record.kind !== 'anchoredDrawing' || !record.behindDocument) return 'frame';
  const point = surface.pointAt(event.clientX, event.clientY);
  // Off the body text, as in a page margin, or where the drawing wins the hit: a move.
  if (!point) return 'frame';
  const drawing = point.hit.drawing?.drawingNodeId;
  if (drawing == null) return 'text';
  return drawing === record.drawingNodeId ? 'frame' : { drawingNodeId: drawing };
}

/** Let the rest of this tap (its compatibility mouse events and click) pass the frame. */
function letTapThrough(frame: Element): void {
  if (!(frame as HTMLElement).style) return;
  const style = (frame as HTMLElement).style;
  const previous = style.pointerEvents;
  style.pointerEvents = 'none';
  const view = hostWindowOf(frame);
  const restore = () => {
    style.pointerEvents = previous;
    view.removeEventListener('click', restore, true);
  };
  view.addEventListener('click', restore, true);
  view.setTimeout(restore, TAP_PASS_THROUGH_MS);
}
