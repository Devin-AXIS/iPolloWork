// The pages layer's editable chrome.
//
// `contenteditable` / `aria-readonly` follow the host's wish AND the mode. These were two
// independent writes of one state, reconciled only by the facade calling both. A host driving
// `mountPaginatedSurface` itself and switching to viewing kept a writable pages layer — a
// blinking caret, an IME that opens on composition, and a screen reader told the document
// accepts input, on a document that refuses every write.

/**
 * Write the pages layer's editable chrome.
 *
 * Pages that are not editable still take the reader's selection, so they stay focusable. A
 * contenteditable element is focusable on its own and a plain one is not: Chromium dropped
 * focus from pages that stopped being editable, so Shift with the caret keys, Ctrl/Cmd+A and
 * Ctrl/Cmd+C never reached them.
 */
export function applyPagesEditableChrome(pagesLayer: HTMLElement, editable: boolean): void {
  pagesLayer.contentEditable = editable ? 'true' : 'false';
  pagesLayer.setAttribute('aria-readonly', editable ? 'false' : 'true');
  if (editable) pagesLayer.removeAttribute('tabindex');
  else pagesLayer.tabIndex = 0;
}
