/** Shared focus and placement for engine and host value pop-ups. */

/** Place a popup against an anchor, within the viewport or its visible sheet. @public */
export function positionContentControlPopup(panel: HTMLElement, anchor: HTMLElement): void {
  const view = panel.ownerDocument.defaultView;
  if (!view) return;
  // Fixed palettes escape scrolling dialog bodies without changing their layout.
  if (view.getComputedStyle(panel).position === 'fixed') {
    const gap = 4;
    const margin = 8;
    const control = anchor.getBoundingClientRect();
    panel.style.maxHeight = '';
    const configured = Number.parseFloat(view.getComputedStyle(panel).maxHeight);
    const cap = Number.isFinite(configured) ? configured : view.innerHeight;
    panel.style.maxWidth = `${Math.max(0, view.innerWidth - margin * 2)}px`;
    panel.style.maxHeight = `${Math.max(0, Math.min(cap, view.innerHeight - margin * 2))}px`;
    const size = panel.getBoundingClientRect();
    const below = Math.max(0, view.innerHeight - margin - control.bottom - gap);
    const above = Math.max(0, control.top - margin - gap);
    const flip = size.height > below && above > below;
    const height = Math.min(size.height, flip ? above : below);
    panel.style.maxHeight = `${height}px`;
    panel.style.left = `${Math.max(margin, Math.min(control.left, view.innerWidth - margin - size.width))}px`;
    const preferredTop = flip ? control.top - gap - height : control.bottom + gap;
    panel.style.top = `${Math.max(margin, Math.min(preferredTop, view.innerHeight - margin - height))}px`;
    panel.dataset.placement = flip ? 'top' : 'bottom';
    return;
  }
  const parent = panel.offsetParent as HTMLElement | null;
  if (!parent) return;
  const control = anchor.getBoundingClientRect();
  const sheet = anchor.closest('.docx-page')?.getBoundingClientRect();
  const scroller = anchor.closest('.docx-editor__scroll-container')?.getBoundingClientRect();
  const leftLimit = Math.max(0, sheet?.left ?? 0, scroller?.left ?? 0);
  const rightLimit = Math.min(
    view.innerWidth,
    sheet?.right ?? view.innerWidth,
    scroller?.right ?? view.innerWidth
  );
  const topLimit = Math.max(0, scroller?.top ?? 0);
  const bottomLimit = Math.min(view.innerHeight, scroller?.bottom ?? view.innerHeight);
  panel.style.maxWidth = `${Math.max(0, rightLimit - leftLimit)}px`;
  panel.style.maxHeight = `${Math.max(0, bottomLimit - topLimit)}px`;
  const size = panel.getBoundingClientRect();
  const below = bottomLimit - control.bottom;
  const above = control.top - topLimit;
  const flip = size.height > below && above > below;
  const available = Math.max(0, flip ? above : below);
  panel.style.maxHeight = `${Math.max(0, Math.min(bottomLimit - topLimit, available))}px`;
  const height = Math.min(size.height, available);
  const x = Math.max(leftLimit, Math.min(control.left, rightLimit - size.width));
  const y = Math.max(topLimit, flip ? control.top - height : control.bottom);
  const box = parent.getBoundingClientRect();
  // Account for a scaled containing block as well as editor zoom and reserved scroll gutters.
  const scaleX = parent.offsetWidth ? box.width / parent.offsetWidth : 1;
  const scaleY = parent.offsetHeight ? box.height / parent.offsetHeight : 1;
  panel.style.left = `${(x - box.left) / scaleX - parent.clientLeft + parent.scrollLeft}px`;
  panel.style.top = `${(y - box.top) / scaleY - parent.clientTop + parent.scrollTop}px`;
  panel.dataset.placement = flip ? 'top' : 'bottom';
}

/** Follow scrolling, zoom, and size changes. Call the returned cleanup when the popup closes. @public */
export function observeContentControlPopup(panel: HTMLElement, anchor: HTMLElement): () => void {
  const view = panel.ownerDocument.defaultView;
  const layer =
    anchor.closest('.docx-pages') ?? panel.closest('.docx-editor')?.querySelector('.docx-pages');
  const controlId = anchor.closest<HTMLElement>('[data-docx-content-control]')?.dataset
    .docxContentControl;
  let current = anchor;
  const update = () => {
    if (!current.isConnected && layer && controlId) {
      const replacement = [...layer.querySelectorAll<HTMLElement>('[data-docx-content-control]')]
        .find((node) => node.dataset.docxContentControl === controlId)
        ?.querySelector<HTMLElement>('.docx-content-control-boundary');
      if (replacement) {
        observer?.unobserve(current);
        current = replacement;
        observer?.observe(current);
      }
    }
    if (current.isConnected) positionContentControlPopup(panel, current);
  };
  // The panel's own window: an observer from another one never reports this document's boxes.
  const observer =
    typeof view?.ResizeObserver === 'function' ? new view.ResizeObserver(update) : null;
  observer?.observe(panel);
  observer?.observe(current);
  const mutation =
    typeof view?.MutationObserver === 'function' ? new view.MutationObserver(update) : null;
  if (layer) mutation?.observe(layer, { childList: true, subtree: true });
  update();
  view?.addEventListener('resize', update);
  panel.ownerDocument.addEventListener('scroll', update, true);
  return () => {
    observer?.disconnect();
    mutation?.disconnect();
    view?.removeEventListener('resize', update);
    panel.ownerDocument.removeEventListener('scroll', update, true);
  };
}

/** Keep keyboard input inside a popup; Escape cancels and Tab wraps visible controls. @public */
export function contentControlPopupKeyDown(
  panel: HTMLElement,
  event: KeyboardEvent,
  cancel: () => void
): void {
  event.stopPropagation();
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
  }
  if (event.key !== 'Tab') return;
  const nodes = [
    ...panel.querySelectorAll<HTMLElement>('button,input,select,textarea,[href],[tabindex]'),
  ].filter(
    (node) =>
      node.tabIndex >= 0 &&
      !node.hasAttribute('disabled') &&
      !node.closest('[hidden]') &&
      panel.ownerDocument.defaultView?.getComputedStyle(node).display !== 'none'
  );
  if (!nodes.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const active = panel.ownerDocument.activeElement;
  const target =
    event.shiftKey && (active === nodes[0] || active === panel)
      ? nodes.at(-1)
      : !event.shiftKey && (active === nodes.at(-1) || active === panel)
        ? nodes[0]
        : null;
  if (target) {
    event.preventDefault();
    target.focus();
  }
}

/** Capture a popup's opener, with the editable pages as fallback when no control had focus. @public */
export function contentControlPopupOpener(anchor: HTMLElement | null): HTMLElement | null {
  const owner =
    anchor?.ownerDocument ??
    (typeof globalThis.document === 'undefined' ? null : globalThis.document);
  const active = owner?.activeElement as HTMLElement | null;
  return active && active !== owner?.body
    ? active
    : (anchor?.closest<HTMLElement>('.docx-pages') ?? null);
}
