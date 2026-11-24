// Absolutely positioned sheets over the painted pages.
//
// Each sheet is a SIBLING of the pages, never a child: the page painter sweeps anything it did
// not paint out of its own subtree, and a stray child of a contenteditable is editable content
// a keystroke could land in. Sheets never take pointer events, so the pages keep the caret.

import type { SemanticLayout, TextMeasurer } from '../layout/semantic-records.ts';

/** A non-editable, pointer-transparent sheet at the surface origin. */
export function overlaySheet(
  document: Document,
  className: string,
  ariaHidden = true
): HTMLDivElement {
  const sheet = document.createElement('div');
  sheet.className = className;
  sheet.contentEditable = 'false';
  if (ariaHidden) sheet.setAttribute('aria-hidden', 'true');
  sheet.style.position = 'absolute';
  sheet.style.left = '0';
  sheet.style.top = '0';
  sheet.style.pointerEvents = 'none';
  return sheet;
}

/** Size every sheet to the painted surface extent. */
export function sizeOverlaySheets(sheets: readonly HTMLElement[], width: string, height: string) {
  for (const sheet of sheets) {
    sheet.style.width = width;
    sheet.style.height = height;
  }
}

/**
 * Everything an overlay needs to paint over one rendered frame of the surface.
 *
 * `pages` is the materialized page set (absent when every page is built), and `scale` and
 * `pageOffsetX` are the values the page painter used, so overlay geometry lands on the text.
 */
export interface SurfaceOverlayFrame {
  readonly layer: HTMLElement;
  readonly layout: SemanticLayout;
  readonly revision: number;
  readonly scale: number;
  readonly pages?: ReadonlySet<number>;
  readonly pageOffsetX?: ReadonlyMap<number, number>;
  readonly measurer?: TextMeasurer;
}

/** A painter the surface calls after every render, and on request. */
export type SurfaceOverlayPainter = (frame: SurfaceOverlayFrame) => void;
