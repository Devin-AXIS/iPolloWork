// The engine's own insertion point for the paginated surface.
//
// The painted pages are contenteditable, so the browser draws the caret itself — one DEVICE
// pixel, which on a 2x display is a hairline that reads as a rendering artefact rather than
// a cursor. Every desktop word processor draws a two-pixel insertion point, so the engine
// paints its own and suppresses the native one for exactly as long as it does.
//
// It also appears where the native caret does not. An EMPTY paragraph paints no text span,
// so the browser has no inline box to size an insertion point against and pressing Enter
// left the user with no visible cursor at all; `caretAt` resolves against the LINE record,
// which layout publishes whether or not any run landed on it.
//
// GEOMETRY COMES FROM LAYOUT, never from the DOM. `caretAt` answers where a model position
// sits, and the painter positions every fragment, row, cell and line by subtracting its
// parent's box from that SAME page-content coordinate space — so the caret can be placed
// inside `.docx-page-content` with no remeasurement and no per-nesting arithmetic, and it
// lands correctly inside a table cell for the same reason body text does.
//
// The element is FURNITURE, not model text. It carries `data-docx-marker`, the attribute
// `positionFromDomPoint` already refuses for painted non-model content: without it a
// selection endpoint resolved through the caret would map into the adjacent run and every
// offset after it would come back wrong. It is `contenteditable=false`, `aria-hidden` and
// pointer/selection inert for the same reason, and it is appended to the page CONTENT box
// rather than to a line or a fragment, because those are the elements whose CHILD INDICES
// dom-selection reads — adding a child to one of them would shift them.
//
// Everything here fails soft. A range selection, an unfocused surface, an active IME
// composition, a position layout does not place, or a page that is not materialized all
// leave the native caret alone rather than leaving the user with no caret at all.

import {
  caretAt,
  type SemanticLayout,
  type SemanticSelection,
  type TextMeasurer,
} from '@docx-editor.dev/core/layout';
import { isBottomToTopCaret } from '../layout/table-cell-text-direction.ts';
import {
  baselineShiftPtOf,
  DEFAULT_RUN_STYLE,
  type ResolvedRunStyle,
} from '../layout/run-style.ts';
import { paragraphLinesFor } from '../layout/paragraph-lines.ts';
import { clipParagraphBox } from '../layout/paragraph-frame-clip.ts';
import { selectionRunStyle } from './surface-formatting.ts';
import { hostTimers } from './host-realm.ts';
import type { HighlightRect } from '../contracts/editor-highlights.ts';

/** Where the insertion point paints: its host and its offset there, in CSS pixels. */
interface CaretPlacement {
  readonly host: HTMLElement;
  readonly left: number;
  readonly top: number;
  readonly height: number;
  readonly bottomToTop: boolean;
  /** Identifies the placement, so a repaint in place is told from a real move. */
  readonly key: string;
}

/** What the caret reads at paint time. Both move independently of the caret itself. */
export interface SurfaceCaretInput {
  readonly layout: SemanticLayout;
  readonly selection: SemanticSelection;
  /**
   * The port the layout was measured with.
   *
   * Without it the caret's x is interpolated across a span's advance, which only lands on a
   * glyph edge in a monospaced face — in any proportional one the caret is drawn through a
   * letter rather than beside it.
   */
  readonly measurer?: TextMeasurer;
  /** Font metrics for an armed typing format that has no painted run yet. */
  readonly typingStyle?: () => Pick<
    ResolvedRunStyle,
    'fontSizePt' | 'fontFamily' | 'bold' | 'italic' | 'verticalAlign'
  > | null;
  /** When true, hide the engine caret (range selection / IME still take precedence). */
  readonly suppress?: boolean;
  /**
   * Prefer this sheet when the same paragraph paints on multiple pages (open shared HF).
   */
  readonly preferredPageIndex?: number;
  /** The visual line chosen by the most recent pointer gesture. */
  readonly preferredLineId?: string;
  /** Host for an open header/footer or note whose caret geometry is story-relative. */
  readonly scopedHost?: HTMLElement | null;
  /** Distinguishes stable placement keys for the two scoped story kinds. */
  readonly scopedHostKind?: 'headerFooter' | 'note' | 'textbox';
  /** Layout origin of a scoped host when geometry remains page-content-relative. */
  readonly scopedOrigin?: { readonly x: number; readonly y: number };
}

export interface SurfaceCaret {
  /** Repaint from the current layout and selection. Safe to call on every render. */
  update(): void;
  /** The insertion point at the selection head in client pixels, or null when unplaced. */
  clientRect(): HighlightRect | null;
  destroy(): void;
}

/** Appearance — width, colour, blink — lives in the stylesheet under these names. */
const CARET_CLASS = 'docx-editor-one-surface__caret';
const STEADY_CLASS = 'docx-editor-one-surface__caret--steady';

/**
 * How long a moved caret stays solid before it resumes blinking.
 *
 * Half the blink period. A caret that keeps blinking while it is being dragged or arrowed
 * across the page disappears under the user's own gesture, which is why every platform
 * holds it solid while it moves — and why the stylesheet ships a `--steady` modifier.
 * Dropping the class restarts the animation at 0%, so the blink resumes visible.
 */
const STEADY_MS = 530;

export function createSurfaceCaret(
  pagesLayer: HTMLElement,
  scale: () => number,
  read: () => SurfaceCaretInput
): SurfaceCaret {
  const element = pagesLayer.ownerDocument.createElement('div');
  element.className = CARET_CLASS;
  // Named for a host that wants to find it; the REFUSAL is the marker attribute below.
  element.dataset.docxCaret = '';
  // `data-docx-marker` is the exclusion attribute `positionFromDomPoint` already refuses
  // for painted furniture. Reusing it rather than minting a second one keeps one list of
  // things a selection endpoint may not resolve through.
  element.dataset.docxMarker = '';
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');
  // Dark mode inverts `.docx-page-content` wholesale to get Word's dark page. The caret is
  // painted inside that subtree, so it counter-inverts the way images and highlights
  // already do — otherwise the dark theme's light `--doc-caret` inverts to dark-on-dark.
  // The stylesheet's contrast ring rides through the same inversion as the core it rings,
  // so the two stay complementary in both themes.
  element.dataset.noColorInvert = '';
  // Inline, like every other painted canvas element: the document canvas is not themed and
  // is not covered by the library's scoped utilities, so anything load-bearing for the
  // picture is written on the element. The stylesheet still owns how it LOOKS.
  element.style.position = 'absolute';
  element.style.pointerEvents = 'none';
  element.style.userSelect = 'none';
  element.style.setProperty('-webkit-user-select', 'none');

  /** The browser needs its own caret while an input method is holding text. */
  let composing = false;
  // The pages' own window: an opener's timers are throttled while the opener is hidden.
  const timers = hostTimers(() => pagesLayer);
  let steadyTimer: number | null = null;
  /** The geometry last painted, so a repaint in place is told from a real move. */
  let placed: string | null = null;
  /** Last scoped host whose native caret was suppressed. */
  let suppressedHost: HTMLElement | null = null;

  function hasFocus(): boolean {
    const active = pagesLayer.ownerDocument.activeElement;
    return active === pagesLayer || (!!active && pagesLayer.contains(active));
  }

  function isCollapsed(selection: SemanticSelection): boolean {
    return (
      selection.anchor.paragraphId === selection.head.paragraphId &&
      selection.anchor.offset === selection.head.offset
    );
  }

  /** Stop painting and give the native caret back. */
  function hide(): void {
    placed = null;
    if (steadyTimer !== null) {
      timers.clearTimeout(steadyTimer);
      steadyTimer = null;
    }
    element.classList.remove(STEADY_CLASS);
    element.remove();
    pagesLayer.style.removeProperty('caret-color');
    suppressedHost?.style.removeProperty('caret-color');
    suppressedHost = null;
  }

  /** Hold the caret solid while it is moving, then let the blink resume. */
  function markMoving(): void {
    element.classList.add(STEADY_CLASS);
    if (steadyTimer !== null) timers.clearTimeout(steadyTimer);
    steadyTimer = timers.setTimeout(() => {
      steadyTimer = null;
      element.classList.remove(STEADY_CLASS);
    }, STEADY_MS);
  }

  /**
   * Where the insertion point at the selection head paints: the host it is placed in and its
   * offset there in CSS pixels. Null when layout does not place the head on a painted page.
   * `armed` applies the typing format's metrics, which only describe a collapsed caret.
   */
  function placement(input: SurfaceCaretInput, armed: boolean): CaretPlacement | null {
    const {
      layout,
      selection,
      scopedHost,
      scopedHostKind,
      scopedOrigin,
      preferredPageIndex,
      preferredLineId,
      measurer,
      typingStyle,
    } = input;
    const currentScale = scale();
    // Measured, not interpolated: the caret has to sit at a glyph edge, and a span's advance
    // divided by its character count only lands there in a monospaced face.
    let geometry = caretAt(layout, selection.head, {
      ...(measurer ? { measurer } : {}),
      ...(preferredPageIndex !== undefined ? { preferredPageIndex } : {}),
      ...(preferredLineId !== undefined ? { preferredLineId } : {}),
    });
    if (!geometry || !Number.isInteger(geometry.pageIndex)) return null;
    if (armed && typingStyle && measurer) {
      const { pageIndex, lineId } = geometry;
      const placedLine = paragraphLinesFor(layout, selection.head.paragraphId)?.find(
        (placed) => placed.pageIndex === pageIndex && placed.line.id === lineId
      );
      const line = placedLine?.line;
      // Stored marks describe the next glyph before any run carries that face.
      // Align nonempty lines to their baseline; empty lines retain their top. A collapsed
      // empty line has no box, and its layout caret already ends at the collapse point.
      if (
        line &&
        !line.drawings?.length &&
        !isBottomToTopCaret(geometry) &&
        (line.spans.length > 0 || line.box.height > 0)
      ) {
        const style = typingStyle();
        if (style) {
          const resolved = {
            ...(selectionRunStyle(layout, selection) ?? DEFAULT_RUN_STYLE),
            ...style,
          };
          const metrics = measurer.lineMetrics(resolved);
          if (metrics.height > 0) {
            const box = clipParagraphBox(
              {
                ...geometry,
                width: 0,
                y:
                  line.spans.length > 0
                    ? line.box.y + line.baseline - metrics.baseline - baselineShiftPtOf(resolved)
                    : geometry.y,
                height: metrics.height,
              },
              placedLine?.clipBox
            );
            if (!box) return null;
            geometry = box;
          }
        }
      }
    }
    // Open scoped story: parent into the story host (story-relative coords). Body: page
    // content box (content-relative coords). Never paint scoped geometry into the body box.
    const host =
      scopedHost ??
      pagesLayer.querySelector<HTMLElement>(
        `[data-page-index="${geometry.pageIndex}"] > .docx-page-content`
      );
    if (!host) return null;
    // A caret with no height is not a caret. The engine suppresses the native one for
    // exactly as long as it paints its own, so a zero-height geometry would leave the user
    // with no caret at all rather than a short one. Hand the native caret back instead —
    // the same fail-soft the surface already applies to a range selection or an unplaced
    // position.
    if (!(geometry.height > 0)) return null;
    const hostKind = host === scopedHost ? (scopedHostKind ?? 'scoped') : 'body';
    return {
      host,
      left: (geometry.x - (scopedOrigin?.x ?? 0)) * currentScale,
      top: (geometry.y - (scopedOrigin?.y ?? 0)) * currentScale,
      height: geometry.height * currentScale,
      bottomToTop: isBottomToTopCaret(geometry),
      key: `${geometry.pageIndex}:${hostKind}:${geometry.x}:${geometry.y}:${geometry.height}`,
    };
  }

  function update(): void {
    const input = read();
    // A range selection shows the browser's highlight; an insertion point inside it would
    // claim a position the selection does not have.
    if (composing || !hasFocus() || input.suppress || !isCollapsed(input.selection)) {
      hide();
      return;
    }
    const at = placement(input, true);
    if (!at) {
      hide();
      return;
    }
    const { host } = at;
    const { scopedHost } = input;
    element.style.left = `${at.left}px`;
    element.style.top = `${at.top}px`;
    element.style.height = `${at.height}px`;
    element.style.transformOrigin = at.bottomToTop ? '0 0' : '';
    element.style.transform = at.bottomToTop ? 'rotate(-90deg)' : '';
    if (element.parentNode !== host) host.append(element);
    // Suppress the native caret only while ours is up, and inline so it beats the
    // `[contenteditable='true']` rule in the stylesheet — pages layer AND scoped story.
    pagesLayer.style.caretColor = 'transparent';
    if (suppressedHost && suppressedHost !== scopedHost) {
      suppressedHost.style.removeProperty('caret-color');
    }
    suppressedHost = scopedHost ?? null;
    suppressedHost?.style.setProperty('caret-color', 'transparent');

    if (at.key !== placed) {
      placed = at.key;
      markMoving();
    }
  }

  /**
   * The insertion point at the selection head in client coordinates, from the same
   * placement the painted caret uses. Independent of focus, composition and viewing mode,
   * which only decide whether the caret PAINTS, not where it is.
   */
  function clientRect(): HighlightRect | null {
    if (!pagesLayer.isConnected || !(scale() > 0)) return null;
    const input = read();
    const at = placement(input, isCollapsed(input.selection));
    if (!at || !at.host.isConnected) return null;
    const origin = at.host.getBoundingClientRect();
    // The caret is absolutely positioned inside the host's padding box.
    const left = origin.left + at.host.clientLeft + at.left;
    const top = origin.top + at.host.clientTop + at.top;
    // A bottom-to-top caret is rotated a quarter turn about its top-left corner.
    const width = at.bottomToTop ? at.height : 0;
    const height = at.bottomToTop ? 0 : at.height;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  }

  // The caret's own state lives on these events, so the surface does not have to relay
  // them: composition is the IME's, focus is the browser's, and both flip the caret
  // between painted and native without the model moving at all.
  const onCompositionStart = (): void => {
    composing = true;
    update();
  };
  // The end does not place the caret here: the commit that follows does, through its paint.
  // Placed now, it stood against the layout from before the composed text, and its native
  // caret's restyle covered every painted page; an unpainted commit keeps the native caret.
  const onCompositionEnd = (): void => {
    composing = false;
  };
  const onFocusIn = (): void => update();
  const onFocusOut = (event: FocusEvent): void => {
    // `document.activeElement` is mid-transition here; the related target is what focus is
    // moving TO, and a move that stays inside the pages is not a blur.
    const next = event.relatedTarget as Node | null;
    if (next && pagesLayer.contains(next)) return;
    hide();
  };

  pagesLayer.addEventListener('compositionstart', onCompositionStart);
  pagesLayer.addEventListener('compositionend', onCompositionEnd);
  pagesLayer.addEventListener('focusin', onFocusIn);
  pagesLayer.addEventListener('focusout', onFocusOut);

  return {
    update,
    clientRect,
    destroy() {
      pagesLayer.removeEventListener('compositionstart', onCompositionStart);
      pagesLayer.removeEventListener('compositionend', onCompositionEnd);
      pagesLayer.removeEventListener('focusin', onFocusIn);
      pagesLayer.removeEventListener('focusout', onFocusOut);
      hide();
    },
  };
}
