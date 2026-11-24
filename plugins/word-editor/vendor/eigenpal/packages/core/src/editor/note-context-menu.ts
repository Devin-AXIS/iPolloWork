// Which menu a right-click on a note opens, and when a floating menu closes.
//
// One right-click opens one menu. A press on a note that is not being edited, or on a body
// reference mark, opens the note menu (delete, convert, properties). A press in the note being
// edited is a press in editable text, so the document menu answers it with cut, copy, paste,
// and table actions. The note menu claims its press with `preventDefault()`, and the document
// menu leaves a press that is already handled alone.

import type { ViewScope } from '../contracts/editor.ts';
import { hostDocumentOf, hostWindowOf, isDomNode, isElementNode } from './host-realm.ts';

/** Elements that carry the scope of a note: its painted body, and its reference marks. */
const NOTE_SCOPE_SELECTOR = '[data-docx-note-scope]';

/**
 * The note scope id whose menu a context-menu press opens, or null when the press is not on a
 * note, or is in the note being edited.
 *
 * Shared adapter glue, not for hosts.
 *
 * @internal
 */
export function noteMenuScopeOf(
  target: EventTarget | null,
  activeScope: ViewScope | null
): string | null {
  if (!isElementNode(target)) return null;
  const note = target.closest<HTMLElement>(NOTE_SCOPE_SELECTOR);
  const scopeId = note?.dataset.docxNoteScope;
  if (!scopeId) return null;
  const editing =
    activeScope?.kind === 'note' &&
    activeScope.id === scopeId &&
    // A reference mark sits in the body. A press on it is never a press in the note's text.
    !note.matches('[data-docx-note-ref]');
  return editing ? null : scopeId;
}

/** Options for {@link listenForMenuDismiss}. */
export interface MenuDismissOptions {
  /** A node in the window the menu shows in. */
  readonly host: Node | null;
  /** Whether a node belongs to the menu. */
  contains(node: Node): boolean;
  /** Close the menu. `restoreFocus` is true when the menu closed from the keyboard. */
  close(restoreFocus: boolean): void;
}

/**
 * Close an open floating menu when the user moves on: a press outside it, Escape, Tab, a
 * scroll outside it, or the window losing focus or changing size. Returns the disposer.
 *
 * Shared adapter glue, not for hosts.
 *
 * @internal
 */
export function listenForMenuDismiss(options: MenuDismissOptions): () => void {
  const doc = hostDocumentOf(options.host);
  const win = hostWindowOf(options.host);
  const inside = (event: Event): boolean => {
    const path = event.composedPath();
    const nodes = path.length > 0 ? path : [event.target];
    return nodes.some((node) => isDomNode(node) && options.contains(node));
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!inside(event)) options.close(false);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      options.close(true);
    } else if (event.key === 'Tab') {
      // Tab moves focus out of the menu, and no outside press or window blur follows it.
      options.close(false);
    }
  };
  const onScroll = (event: Event): void => {
    // A long menu that scrolls inside itself is still in use.
    if (event.type === 'scroll' && inside(event)) return;
    options.close(false);
  };
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  win.addEventListener('blur', onScroll);
  win.addEventListener('resize', onScroll);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('blur', onScroll);
    win.removeEventListener('resize', onScroll);
  };
}

/** The enabled rows of a menu panel, in order. */
function enabledMenuItems(panel: Element): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (item) => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true'
  );
}

/**
 * Move focus between the rows of a menu panel for ArrowDown, ArrowUp, Home, and End, wrapping
 * at the ends. Answers whether the key moved focus, so the caller can prevent its default.
 *
 * Shared adapter glue, not for hosts.
 *
 * @internal
 */
export function focusMenuItemForKey(panel: Element | null, key: string): boolean {
  if (!panel) return false;
  const items = enabledMenuItems(panel);
  if (items.length === 0) return false;
  const current = items.findIndex((item) => item === hostDocumentOf(panel).activeElement);
  let next: number;
  if (key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else if (key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  else return false;
  items[next]!.focus({ preventScroll: true });
  return true;
}
