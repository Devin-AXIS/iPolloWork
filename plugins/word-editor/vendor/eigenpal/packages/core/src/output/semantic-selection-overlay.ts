// The selection the browser cannot draw.
//
// A native selection is a run of characters, so it can highlight a text range and nothing
// else. A rectangle of table cells is not a run of characters — sweeping A1 to B2 selects four
// cells, and asking the DOM to show that would draw a band through every character between the
// first and the last instead.
//
// So it is painted, from the same records everything else is painted from. A pure sink like
// the page painter: geometry in, elements out, nothing measured back.

import type { SemanticLayout } from '../layout/semantic-records.ts';
import { REVIEW_AUTHOR_SLOTS, type ReviewAuthorInfo } from './revision-presentation.ts';

/** A rectangle in page-content coordinates, on a named page. */
export interface OverlayRect {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Class for THIS rectangle, overriding the layer's default.
   *
   * One layer draws bands that mean different things — every commented range, and the one the
   * caret is in — and splitting them into two layers would stack two absolutely positioned
   * sheets over the pages just to vary a colour.
   */
  readonly className?: string;
  /**
   * WHOSE band this is, as CSS hooks on the rectangle: `data-review-author`, `data-review-author-slot`, and
   * `--doc-review-author-current` set to the colour that author resolves to.
   *
   * The same three the review card carries, and deliberately so — a host restyling one
   * reviewer writes one selector that reaches both the card and the text it annotates. The
   * band's DEFAULT colour does not change with the author (Word keeps every comment yellow);
   * this only makes the author reachable from CSS.
   *
   * The SAME resolved author `getReviewAuthors` hands back, rather than a shape of this
   * layer's own: one person is one object everywhere the review surface describes them.
   */
  readonly reviewAuthor?: ReviewAuthorInfo;
  /**
   * Background for the OPEN revision's band, from the author's declared
   * `activeBackground`. Applied inline, so it outranks the kind tokens in the
   * stylesheet, and the kind-coloured rule under the band is cleared with it.
   *
   * Set ONLY on an active revision band. A pending band keeps its transparent
   * default, and comment bands keep their yellow — this field carries no opinion
   * about either.
   */
  readonly activeBackground?: string;
}

/**
 * How the selection overlay draws its rectangles over the painted pages.
 *
 * `scale` and `pageOffsetX` must match what the page painter used, or the highlight lands beside
 * the content it describes rather than on it.
 */
export interface SelectionOverlayOptions {
  /** Points to CSS pixels. */
  readonly scale: number;
  /**
   * Per-page horizontal offset the page painter applied, by page index.
   *
   * A document whose pages differ in width centres each one individually, so a page is drawn
   * at an x its record does not carry. Without the same offset here a highlight would sit
   * beside the cells it describes.
   */
  readonly pageOffsetX?: ReadonlyMap<number, number>;
  /**
   * Class for each painted rectangle. Defaults to the cell-selection class, because a cell
   * rectangle was the only thing this layer drew when it was written.
   *
   * A retained TEXT range is drawn here too and must not look like selected cells — one is
   * "these cells are chosen", the other is "your selection is still here while you type in
   * this panel". Same geometry, different meaning, so the caller names the class.
   */
  readonly className?: string;
}

/** What a painted rect shows, so an identical rect in the next pass keeps its element. */
const overlaySignatures = new WeakMap<Element, string>();

/**
 * Draw a set of rectangles over the pages.
 *
 * The layer is a SIBLING of the pages, never a child: the page painter sweeps anything it did
 * not paint out of its own subtree, and a stray child of a contenteditable is editable content
 * a keystroke could land in.
 */
export function paintSelectionOverlay(
  layer: HTMLElement,
  layout: SemanticLayout,
  rects: readonly OverlayRect[],
  options: SelectionOverlayOptions
): void {
  const document = layer.ownerDocument;
  const scale = options.scale;
  // Bands are repainted on every commit while almost all of them stay put. Rebuilding them
  // restyled the layer per keystroke; an unchanged band now keeps its element.
  const available = new Map<string, Element[]>();
  for (const child of layer.children) {
    const signature = overlaySignatures.get(child);
    if (signature === undefined) continue;
    const list = available.get(signature);
    if (list) list.push(child);
    else available.set(signature, [child]);
  }
  const painted: Element[] = [];
  for (const rect of rects) {
    const page = layout.pages[rect.pageIndex];
    if (!page) continue;
    const className = rect.className ?? options.className ?? 'docx-cell-selection-rect';
    // Page-content coordinates to the sheet space the layer is laid out in.
    const offsetX = options.pageOffsetX?.get(rect.pageIndex) ?? 0;
    const left = `${(page.contentBox.x + rect.x + offsetX) * scale}px`;
    const top = `${(page.contentBox.y + rect.y) * scale}px`;
    const width = `${rect.width * scale}px`;
    const height = `${rect.height * scale}px`;
    const author = rect.reviewAuthor;
    const signature = [
      className,
      left,
      top,
      width,
      height,
      author ? `${author.author}\u0000${author.slot}\u0000${author.color}` : '',
      rect.activeBackground ?? '',
    ].join('\u0001');
    const reused = available.get(signature)?.pop();
    if (reused) {
      painted.push(reused);
      continue;
    }
    const element = document.createElement('div');
    element.className = className;
    element.style.position = 'absolute';
    element.style.left = left;
    element.style.top = top;
    element.style.width = width;
    element.style.height = height;
    // Author hooks, when the rect carries them. `setAttribute`/`dataset` with the raw value —
    // never interpolated into markup — because `w:author` is attacker-controlled; the colour
    // is engine-resolved or host-declared, and `setProperty` drops a value it cannot parse.
    if (author) {
      element.dataset.reviewAuthor = author.author;
      // WRAPPED to the ramp width, as the card and the painted span both wrap it. The roster
      // slot is a raw index, so the ninth author is slot 8 — writing that here made the band
      // say `8` while the card beside it said `0`, and a rule keyed on the slot covered one
      // of them.
      element.dataset.reviewAuthorSlot = String(author.slot % REVIEW_AUTHOR_SLOTS);
      element.style.setProperty('--doc-review-author-current', author.color);
    }
    // The author's own active background, when the caller resolved one. Inline, so it beats
    // the kind tokens — and the rule with it, for the reason the style field's own comment
    // gives. A host value, but through `style`, so an unparsable one is dropped silently.
    if (rect.activeBackground !== undefined) {
      element.style.backgroundColor = rect.activeBackground;
      element.style.boxShadow = 'none';
    }
    overlaySignatures.set(element, signature);
    painted.push(element);
  }
  const children = layer.children;
  if (
    children.length === painted.length &&
    painted.every((element, index) => children[index] === element)
  ) {
    return;
  }
  layer.replaceChildren(...painted);
}
