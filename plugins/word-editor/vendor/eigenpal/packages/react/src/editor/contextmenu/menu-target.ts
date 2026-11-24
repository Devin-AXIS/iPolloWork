// Which right-clicks the document context menu answers, and where its panel opens.
//
// The menu acts on the document selection, so it answers only presses on the document: the
// painted pages, the handles of a selected picture, and the empty canvas around them.
// Everything else in the scroller is chrome, such as the link popover, dialogs, review
// cards, and host overlays, even where it mounts next to the pages. A press there keeps
// the browser's own menu, so a text field gets its native Cut, Copy, Paste and spelling
// rows, and focus and the field's selection stay where they were.

import { isElementNode } from '@docx-editor.dev/core/editor';

/** Form controls that own their text and selection, wherever they are mounted. */
const FORM_CONTROL = 'input, textarea, select';

/** A drop-down form field painted on the page: document text, not a control of its own. */
const PAINTED_FORM_FIELD = '[data-docx-form-dropdown]';

/** The element the engine paints the pages into. The loading placeholder shares its class. */
const SURFACE = '.docx-paginated-surface:not(.docx-editor__loading-surface)';

/** Document content painted beside the surface: the resize frame of a selected picture. */
const SURFACE_OVERLAY = '.docx-image-selection-overlay';

/**
 * Whether a `contextmenu` event inside `scroller` addresses the document.
 *
 * True on the pages, including drawings, painted form fields and other furniture, on a
 * selected picture's handles, and on the canvas around the pages. False on a form control
 * and on chrome, including popovers and dialogs that mount beside the pages.
 */
export function isDocumentContextMenuTarget(
  scroller: HTMLElement,
  target: EventTarget | null
): boolean {
  if (!isElementNode(target)) return false;
  const control = target.closest(FORM_CONTROL);
  if (control && !control.matches(PAINTED_FORM_FIELD)) return false;
  // Without `DocxEditor.Content` the scroller holds no chrome this can tell apart.
  const surface = scroller.querySelector(SURFACE);
  if (!surface) return true;
  return surface.contains(target) || target.contains(surface) || !!target.closest(SURFACE_OVERLAY);
}

/** What a keyboard-opened menu reads from the editor: where the caret is. */
interface CaretSource {
  getCaretRect(): { readonly left: number; readonly bottom: number } | null;
}

/**
 * Whether the menu was opened from the keyboard (Shift+F10 or the Menu key), which reports
 * no pointer position.
 */
export function isKeyboardContextMenu(event: MouseEvent): boolean {
  return event.button === -1 || (event.clientX === 0 && event.clientY === 0);
}

/**
 * Where the panel opens, in client coordinates.
 *
 * A pointer open uses the pointer. A keyboard open uses the bottom-left corner of the caret,
 * so the panel opens below the line being edited. When the caret has no painted position,
 * such as on a page outside the viewport, the panel opens at the scroller's top-left
 * instead. Either anchor is clamped to the window like any other.
 */
export function contextMenuAnchorOf(
  event: MouseEvent,
  keyboard: boolean,
  editor: CaretSource | null,
  scroller: HTMLElement
): { readonly x: number; readonly y: number; readonly trigger: 'pointer' | 'keyboard' } {
  if (!keyboard) return { x: event.clientX, y: event.clientY, trigger: 'pointer' };
  const caret = editor?.getCaretRect() ?? null;
  if (caret) return { x: caret.left, y: caret.bottom, trigger: 'keyboard' };
  const box = scroller.getBoundingClientRect();
  return { x: box.left + 16, y: box.top + 16, trigger: 'keyboard' };
}
