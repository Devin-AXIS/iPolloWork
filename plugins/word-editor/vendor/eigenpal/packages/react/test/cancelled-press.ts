/**
 * Press the painted pages the way the surface handles a press: it cancels `pointerdown` and
 * stops it, so the browser never sends the compatibility `mousedown`. Returns the event.
 */
export function pressCancelledPages(container: HTMLElement): PointerEvent {
  const target = container.ownerDocument.createElement('span');
  container.querySelector('.docx-pages')!.append(target);
  target.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  target.remove();
  return event;
}
