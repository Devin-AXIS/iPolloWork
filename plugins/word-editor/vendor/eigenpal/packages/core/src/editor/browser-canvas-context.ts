// Browser canvas context for the editor composition root.
//
// Layout stays DOM-free: it only accepts an injected text context. Creating the canvas
// element is an editor-seam responsibility — this is that seam.

/**
 * Build a 2d canvas text context from a document, or null when the host cannot.
 *
 * Happy-dom and SSR typically fail here and keep the deterministic fixed measurer.
 */
export function tryCreateBrowserCanvasContext(
  ownerDocument: Document
): CanvasRenderingContext2D | null {
  try {
    return ownerDocument.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
}
