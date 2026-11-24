import { isElementNode } from './host-realm.ts';

/**
 * Dismiss a widget menu on an outside press or Escape.
 *
 * `pointerdown`, not `mousedown`: the surface prevents the default on every page press,
 * which suppresses the compatibility `mousedown` — a `mousedown` listener never fires for
 * document clicks and the menu stands. The opening press cannot self-dismiss: it already
 * passed document capture before this attached. A press on the owning widget is left for
 * the opener, which toggles instead. Stale listeners (the menu closed through a commit)
 * clean up silently so a later Escape still reaches the rest of the UI.
 */
export function armContentControlMenuDismiss(
  menu: HTMLElement,
  onOutsidePress: () => void
): () => void {
  const document = menu.ownerDocument;
  const controlId = menu.dataset.docxCcId;
  const cleanup = (): void => {
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (event: Event): void => {
    // `parentNode`, not `isConnected`: a surface mounted in a detached container (tests,
    // off-screen hosts) is live; a menu the surface closed or tore down has no parent.
    if (menu.parentNode === null) {
      cleanup();
      return;
    }
    const target = event.target as Element | null;
    const widget = isElementNode(target) ? target.closest('[data-docx-cc-widget]') : null;
    if (target && (menu.contains(target) || widget?.getAttribute('data-docx-cc-id') === controlId))
      return;
    cleanup();
    onOutsidePress();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    cleanup();
    if (menu.parentNode === null) return;
    event.stopPropagation();
    onOutsidePress();
  };
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  return cleanup;
}
