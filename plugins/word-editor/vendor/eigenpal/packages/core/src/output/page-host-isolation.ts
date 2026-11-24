import { DEFAULT_CANVAS_FONT_STACK } from '../layout/canvas-measurer.ts';

/**
 * Keep the host page's inherited text settings out of a painted page. Layout measured and
 * placed everything already, so anything the page inherits can only move paint away from
 * the geometry every overlay (caret, selection, revision bands, strikes) is drawn from.
 */
export function isolatePageFromHost(element: HTMLElement): void {
  // The measurer's own fallback stack, so an unstyled run — or one whose declared family
  // the platform cannot resolve — RENDERS in the same face it was MEASURED in. Left to
  // inherit, the page picked up the host UI font, and every measured overlay drifted along
  // the line against the painted glyphs.
  element.style.fontFamily = DEFAULT_CANVAS_FONT_STACK;
  // Layout places each glyph at its unhinted advance. Chromium on Linux rounds a web font's
  // hinted advances to whole pixels, so painted text drifted along the line, up to several
  // pixels past the caret, selection and highlights. Geometric precision paints the advances
  // layout measured.
  element.style.textRendering = 'geometricPrecision';
  // Layout resolves bidi itself and paints each line as runs in visual order from its left
  // edge, so the page needs a left-to-right inline base whatever the host page declares.
  // An inherited `rtl` reversed every line's runs and shifted every mixed-direction offset.
  element.style.direction = 'ltr';
}
