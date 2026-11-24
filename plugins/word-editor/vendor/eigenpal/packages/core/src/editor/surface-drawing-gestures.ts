import type { DrawingSelectionIntent } from './paginated-surface.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import type { SurfacePointHit } from './surface-pointer.ts';
import type { createTextboxEditing } from './surface-textbox-editing.ts';
import { resolveSelectedDrawingRecord, selectedImageStateOf } from './docx-editor-images.ts';
import { textboxDrawingOnPage } from '../layout/textbox-drawing-records.ts';
import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import { textboxPaintsPastFrame, textboxPressReaches } from '../layout/vector-shape-hit.ts';

/** A painted box thinner than this, in points, has no area a press can land on. */
const THIN_LINE_PT = 1;
import { isElementNode, isInputEvent, isKeyboardEvent, isPointerEvent } from './host-realm.ts';
import { MULTI_CLICK_MS, MULTI_CLICK_SLOP_PX } from './surface-multi-click.ts';
import { pressSelectsGroupMember, selectedGroupMember } from './group-member-selection.ts';

/** Ctrl or Command with C or X, and Ctrl or Shift with Insert or Delete: copy and cut. */
function isClipboardChord(event: KeyboardEvent): boolean {
  if (event.altKey) return false;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (key === 'c' || key === 'x'))
    return true;
  return (
    (event.ctrlKey && key === 'insert') || (event.shiftKey && !event.ctrlKey && key === 'delete')
  );
}

const NON_DESELECTING_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu',
]);

/**
 * Presses a text box took: the pointer must not read them as presses on the header or footer
 * under the box, because the box is found by geometry when its story paints inert.
 */
const textboxPresses = new WeakSet<Event>();

/** Whether the text box gesture already took this press. */
export function pressTakenByTextbox(event: Event): boolean {
  return textboxPresses.has(event);
}

/** Capture object selection before the text keymap receives the same gesture. */
export function createDrawingGestures(deps: {
  surface: PaginatedSurface;
  textbox(): ReturnType<typeof createTextboxEditing> | null;
  intent(): DrawingSelectionIntent;
  setIntent(intent: DrawingSelectionIntent): void;
  /**
   * Move the open header or footer's edit to another page that shows it, as a press on that
   * page's band does: no scroll, so the page under the pointer stays put.
   */
  enterStoryPage(pageIndex: number): void;
  /**
   * The body drawing a press at a client point reaches by geometry, if any: one behind the
   * text, or a turned shape on what it paints, page margins included.
   */
  behindDrawingAt(
    clientX: number,
    clientY: number
  ): {
    readonly drawingNodeId: string;
    readonly paragraphId: string;
    /** The page the drawing is on, for a drawing of an open header or footer. */
    readonly pageIndex?: number;
  } | null;
}) {
  /** The last press, for telling a double press: a pointer press carries no click count. */
  let lastPress: { time: number; x: number; y: number } | null = null;
  const pressOf = (event: Event) => {
    if (!isPointerEvent(event)) return undefined;
    const { clientX: x, clientY: y } = event;
    // Wall-clock time, as the pointer counts clicks: event time stamps are not one clock.
    const time = Date.now();
    const since = lastPress === null ? -1 : time - lastPress.time;
    const double =
      lastPress !== null &&
      since >= 0 &&
      since <= MULTI_CLICK_MS &&
      Math.abs(x - lastPress.x) <= MULTI_CLICK_SLOP_PX &&
      Math.abs(y - lastPress.y) <= MULTI_CLICK_SLOP_PX;
    lastPress = double ? null : { time, x, y };
    return { clientX: x, clientY: y, double };
  };
  /** Select a drawing as an object, as a press on its border does. */
  const selectObject = (drawingNodeId: string, paragraphId: string): boolean => {
    if (!deps.surface.selectDrawing(drawingNodeId, paragraphId)) return false;
    deps.setIntent({ kind: 'pointer', drawingNodeId });
    return true;
  };
  const pointOf = (event: PointerEvent) => deps.surface.pointAt(event.clientX, event.clientY);
  /**
   * An open header or footer repeats on every page it heads. A press on its drawing on another
   * page moves the edit to that page, as a press on that page's band does, so the frame shows
   * where the press landed. A drawing that does not select (select-locked) moves nothing.
   */
  const followPage = (drawingNodeId: string, paragraphId: string, pageIndex?: number) => {
    if (deps.surface.activeScope().kind !== 'headerFooter' || pageIndex === undefined) return;
    if (pageIndex === deps.surface.currentPage('caret') - 1) return;
    // `selectDrawing` takes a locked drawing too; the lock applies in the selected state.
    if (!deps.surface.selectDrawing(drawingNodeId, paragraphId)) return;
    if (!selectedImageStateOf(deps.surface)) return;
    deps.enterStoryPage(pageIndex);
  };
  /** The straight line in front of the text a press reaches by geometry, if any. */
  const thinLineAt = (event: Event) => {
    if (!isPointerEvent(event) || event.shiftKey) return null;
    const drawing = pointOf(event)?.hit.drawing;
    if (!drawing) return null;
    const frame = findDrawingOverlayFrameInLayout(deps.surface.layout(), drawing.drawingNodeId);
    const record = frame?.record;
    if (!frame || !record?.vectorShape) return null;
    if ('behindDocument' in record && record.behindDocument) return null;
    return Math.min(frame.width, frame.height) < THIN_LINE_PT ? drawing : null;
  };
  /** The behind-text drawing, or the turned shape, a press reaches by geometry, if any. */
  const behindDrawingAt = (event: Event) =>
    isPointerEvent(event) && !event.shiftKey
      ? deps.behindDrawingAt(event.clientX, event.clientY)
      : null;
  return {
    onDrawingPointerGesture(event: Event): void {
      if (isPointerEvent(event) && event.button !== 0) return;
      // Viewing selects no object, exactly as it places no caret.
      if (deps.surface.editingMode() === 'view') return;
      const element = isElementNode(event.target) ? event.target : null;
      const editingTextbox = deps.textbox()?.preparePointer(element, pressOf(event));
      if (editingTextbox) textboxPresses.add(event);
      // A header or footer box whose text takes no caret is selected as an object instead, so
      // the press shows which box it reached rather than opening its story somewhere else.
      const refused = editingTextbox ? null : deps.textbox()?.takeRefusedPress();
      if (refused && selectObject(refused.drawingNodeId, refused.hostParagraphId)) {
        textboxPresses.add(event);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const pressedId =
        !editingTextbox &&
        element
          ?.closest<HTMLElement>('[data-drawing-node-id]')
          ?.getAttribute('data-drawing-node-id');
      // A press beside what a text box paints past its frame passes through its painted box.
      let passedThrough = false;
      if (pressedId && element?.closest('.docx-drawing-textbox')) {
        // Body boxes only: a header or footer box selects through its own story scope.
        let drawing;
        for (const page of deps.surface.layout().pages) {
          drawing = textboxDrawingOnPage(page, pressedId);
          if (drawing) break;
        }
        // A textbox can extend outside the body column. Its border selects its anchor,
        // even when ordinary text hit testing would land on a nearby body paragraph. Past its
        // frame, only the shape it paints there, such as a callout's tail, takes the press.
        // Its painted box spans that shape, so a press beside the shape lands on it too.
        const box = drawing && element.closest('.docx-drawing-textbox');
        const missed =
          drawing && box && textboxPaintsPastFrame(drawing) && isPointerEvent(event)
            ? missesTextboxShape(drawing, box, event, () => pointOf(event))
            : false;
        if (drawing && !missed && selectObject(pressedId, drawing.paragraphId)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        passedThrough = !!missed;
      }
      // A press that passed through a text box goes on as a press on the page under it: a
      // drawing behind the text there takes it, else the text does.
      const drawingId = passedThrough ? null : pressedId;
      // A drawing behind the text paints under it, so the press reaches the text layer. Where
      // no glyph lies under the press, the drawing takes it, as hit testing decides. A turned
      // shape, or a callout's tail, paints past its box, so a press on that part reaches the
      // page, the margins too.
      // One the selection model refuses (hidden, select-locked) leaves the press to the text.
      const behind = !editingTextbox && !drawingId ? behindDrawingAt(event) : null;
      if (behind) followPage(behind.drawingNodeId, behind.paragraphId, behind.pageIndex);
      if (behind && selectObject(behind.drawingNodeId, behind.paragraphId)) {
        if (selectedImageStateOf(deps.surface)) {
          deps.surface.focus();
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }
      // A straight line paints a box with no height or width, so no press lands on it: within
      // reach of its path, the hit test that already reaches past the path selects it.
      const line = !editingTextbox && !drawingId && !behind ? thinLineAt(event) : null;
      if (line && selectObject(line.drawingNodeId, line.paragraphId)) {
        deps.surface.focus();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // The painted box of a shape is wider than what it paints: a press beside a line, or
      // inside a shape with no fill, is on the text, as hit testing decides.
      const point = drawingId && isPointerEvent(event) ? pointOf(event) : null;
      const reached = !point || point.hit.drawing?.drawingNodeId === drawingId;
      if (drawingId && reached && point?.hit.drawing) {
        followPage(drawingId, point.hit.drawing.paragraphId, point.hit.pageIndex);
      }
      // A second press on a selected group selects the shape under the pointer, or the group
      // again where no shape lies; the press then places the same anchor caret.
      const painted = drawingId && reached ? element?.closest('[data-drawing-node-id]') : null;
      if (
        painted &&
        isPointerEvent(event) &&
        pressSelectsGroupMember(
          deps.surface,
          drawingId as string,
          painted,
          event.clientX,
          event.clientY
        ) !== null
      )
        return;
      deps.setIntent(
        drawingId && reached ? { kind: 'pointer', drawingNodeId: drawingId } : { kind: 'none' }
      );
    },
    onDrawingKeyGesture(event: Event): void {
      if (isKeyboardEvent(event) && NON_DESELECTING_KEYS.has(event.key)) return;
      // Copy and cut act on the selected object: the clipboard event that follows the chord
      // needs the object still selected to copy or cut it.
      if (isKeyboardEvent(event) && isClipboardChord(event)) return;
      const textbox = deps.textbox();
      const editing = textbox?.active();
      // Escape leaves the box with the box selected as an object, so Delete or a drag acts on
      // it next; a second Escape then leaves the header or footer the box is in.
      if (isKeyboardEvent(event) && event.key === 'Escape' && editing) {
        textbox!.exit();
        selectObject(editing.drawingNodeId, editing.hostParagraphId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // Enter on a selected text box enters its text, the keyboard way into a box.
      const plainEnter =
        isKeyboardEvent(event) &&
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey;
      // A shape that a remote edit removed is no longer selected: the keys act on the group.
      const stale = deps.intent();
      if (
        stale.kind === 'pointer' &&
        stale.memberNodeId &&
        !selectedGroupMember(deps.surface, stale.drawingNodeId)
      )
        deps.surface.selectDrawingMember(null);
      const selected = deps.intent();
      // Escape on a shape inside a group selects the group again.
      if (
        isKeyboardEvent(event) &&
        event.key === 'Escape' &&
        !editing &&
        selected.kind === 'pointer' &&
        selected.memberNodeId &&
        deps.surface.selectDrawingMember(null)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        plainEnter &&
        !editing &&
        selected.kind === 'pointer' &&
        textbox?.enterDrawing(selected.drawingNodeId)
      ) {
        deps.setIntent({ kind: 'none' });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const deleteKey =
        (isKeyboardEvent(event) &&
          (event.key === 'Delete' || event.key === 'Backspace') &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey) ||
        (isInputEvent(event) &&
          (event.inputType === 'deleteContentBackward' ||
            event.inputType === 'deleteContentForward'));
      if (deleteKey && deps.intent().kind === 'pointer') {
        // A shape inside a group does not delete on its own (`groupMemberRefusal`).
        if (selected.kind === 'pointer' && selected.memberNodeId) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        const target = resolveSelectedDrawingRecord(deps.surface);
        if (target !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          deps.setIntent({ kind: 'none' });
          deps.surface.deleteImage(target.drawingNodeId);
          return;
        }
      }
      deps.setIntent({ kind: 'none' });
    },
  };
}

/**
 * Whether a press on the painted box `box` of a text box that paints past its frame misses
 * what it paints (see `textboxPressReaches`), such as beside a callout's tail. The browser
 * already found nothing in front of the box at the press. The press maps from client pixels
 * onto the box's paint bounds: paint sizes the box to them and widens only its clip for ink
 * reach. Where the box has no client size to map the press through,
 * the layout hit test decides. A DOM without layout, as in unit tests, always takes that
 * fallback: a test of the client mapping must give the box a client rectangle.
 */
function missesTextboxShape(
  drawing: NonNullable<ReturnType<typeof textboxDrawingOnPage>>,
  box: Element,
  event: PointerEvent,
  hitAt: () => SurfacePointHit | null
): boolean {
  const rect = box.getBoundingClientRect();
  const paint = drawing.paintBounds;
  if (!(rect.width > 0) || !(rect.height > 0) || !(paint.width > 0) || !(paint.height > 0)) {
    return hitAt()?.hit.drawing?.drawingNodeId !== drawing.drawingNodeId;
  }
  return !textboxPressReaches(drawing, {
    x: paint.x + ((event.clientX - rect.left) / rect.width) * paint.width,
    y: paint.y + ((event.clientY - rect.top) / rect.height) * paint.height,
  });
}
