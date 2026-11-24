// The composing text must be visible where the input method writes it.
//
// `insertCompositionText` cannot be prevented, so an input method writes its text straight
// into the painted run the browser's caret is in, and the model only hears of it at
// `compositionend` (surface-composition-readback.ts). Until then, what the reader sees of
// the syllable being composed is whatever that run's paint lets through.
//
// Some runs are painted to a fixed advance and clip whatever is past it:
//
//   - The whitespace that ends a line (`lineEndWhitespace`) is clipped to the width layout
//     gave it, so trailing spaces never paint past the margin.
//   - A tab is clipped to the advance it reserves, so the native tab glyph cannot spill.
//
// A caret at the end of a line that ends in a space sits at the end of that space's run,
// because no later run exists for the position to belong to. So the first word typed after
// a space — every word but the first on a line being written — was composed into a box one
// space wide: the input method's text was in the DOM and clipped out of sight, and each
// syllable appeared only when the next one committed it.
//
// The release is a paint-only change, made on the run the composition is in and put back
// at `compositionend` before anything repaints, so a retained run never keeps it. Layout
// and the readback are untouched: the readback reads text, not style.
//
// It is a preview, not a layout: composed text grows the run past its painted advance, into
// the margin at the end of a line, and a table cell still clips at its own edge. The commit
// at `compositionend` lays the text out where it belongs.

/** The inline style properties a release changes, as they were before it. */
interface SavedClip {
  readonly clipPath: string;
  readonly overflow: string;
  readonly width: string;
  readonly minWidth: string;
  readonly tabSize: string;
}

export interface CompositionPreview {
  /**
   * Release the clip on the run the browser's selection is in, if it has one.
   *
   * Called when a composition starts and after each composed change, because a repaint in
   * the middle of a composition (a collaborator's edit) replaces the run.
   */
  track(): void;
  /** Put every released style back. Idempotent. */
  restore(): void;
}

/** Whether the element's own paint clips its text horizontally. */
function clipsText(element: HTMLElement): boolean {
  const { style } = element;
  return (style.clipPath !== '' && style.clipPath !== 'none') || style.overflow === 'hidden';
}

function release(element: HTMLElement): SavedClip {
  const { style } = element;
  const saved: SavedClip = {
    clipPath: style.clipPath,
    overflow: style.overflow,
    width: style.width,
    minWidth: style.minWidth,
    tabSize: style.tabSize,
  };
  style.clipPath = 'none';
  style.overflow = 'visible';
  if (saved.width !== '') {
    // The run grows with what is composed into it, and never shrinks below its own advance.
    style.minWidth = saved.width;
    style.width = 'auto';
    // A tab keeps exactly its reserved advance, so the composed text starts where the next
    // character will be painted. In a box of its own a tab advances to the first stop, which
    // `tab-size` places.
    style.tabSize = saved.width;
  }
  return saved;
}

function put(element: HTMLElement, saved: SavedClip): void {
  const { style } = element;
  style.clipPath = saved.clipPath;
  style.overflow = saved.overflow;
  style.width = saved.width;
  style.minWidth = saved.minWidth;
  style.tabSize = saved.tabSize;
}

/** The element a DOM point sits in. */
function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

export function createCompositionPreview(pagesLayer: HTMLElement): CompositionPreview {
  const released = new Map<HTMLElement, SavedClip>();

  return {
    track(): void {
      const selection = pagesLayer.ownerDocument.getSelection();
      const anchor = elementOf(selection?.focusNode ?? null);
      if (!anchor || !pagesLayer.contains(anchor)) return;
      // From the text up to its run, and no further: the line, the paragraph and the page
      // clip on purpose (a table cell keeps its content inside its borders).
      for (
        let element: Element | null = anchor;
        element && element !== pagesLayer;
        element = element.parentElement
      ) {
        const html = element as HTMLElement;
        if (html.style && !released.has(html) && clipsText(html)) {
          released.set(html, release(html));
        }
        if (html.dataset?.start !== undefined || html.dataset?.lineId !== undefined) break;
      }
    },
    restore(): void {
      for (const [element, saved] of released) put(element, saved);
      released.clear();
    },
  };
}
