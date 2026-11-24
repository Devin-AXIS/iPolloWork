// Browser-only page viewport helpers. DOM-free document assembly lives in layout.

import {
  caretAt,
  createDocumentFurnitureSource,
  createDocumentNotesInput,
  createDocumentStyleDependencies,
  pagesToMaterialize,
  type CreateDocumentFurnitureSourceOptions,
  type CreateDocumentNotesInputOptions,
  type SemanticLayout,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { HeadlessDocumentView } from '@docx-editor.dev/core/store';
import { hostWindowOf } from './host-realm.ts';

export const createSurfaceStyleDeps = createDocumentStyleDependencies;

export function createFurnitureSource(
  options: Omit<CreateDocumentFurnitureSourceOptions, 'view'> & {
    readonly session: HeadlessDocumentView;
  }
) {
  const { session, ...rest } = options;
  return createDocumentFurnitureSource({ view: session, ...rest });
}

export function createNotesLayoutInput(
  options: Omit<CreateDocumentNotesInputOptions, 'view'> & {
    readonly session: HeadlessDocumentView;
  }
) {
  const { session, ...rest } = options;
  return createDocumentNotesInput({ view: session, ...rest });
}

export function surfaceScroller(container: HTMLElement): HTMLElement | null {
  return container.closest('.docx-editor__scroll-container') as HTMLElement | null;
}

/** The scroller's horizontal scroll range, or Infinity when it reports none. */
function inlineScrollRange(scroller: HTMLElement): number {
  return Number.isFinite(scroller.scrollWidth)
    ? Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    : Number.POSITIVE_INFINITY;
}

/** A right-to-left scroller: `scrollLeft` runs from 0 at its right end to negative values. */
function scrollsFromRight(scroller: HTMLElement): boolean {
  return hostWindowOf(scroller).getComputedStyle(scroller).direction === 'rtl';
}

/**
 * How far the scroller is scrolled from its left end, whatever its direction. An `offsetLeft`
 * inside `.docx-content-mount`, which is positioned and starts at the scroller's left padding
 * in both directions, then means the same thing in both. An `offsetLeft` against the scroller
 * itself does not: a right-to-left scroller reports it from its right-end origin.
 */
export function inlineScrollOffset(scroller: HTMLElement): number {
  const range = inlineScrollRange(scroller);
  return scrollsFromRight(scroller) && Number.isFinite(range)
    ? scroller.scrollLeft + range
    : scroller.scrollLeft;
}

/** Scroll to `offset` from the left end, clamped to the scroll range, whatever the direction. */
export function setInlineScrollOffset(scroller: HTMLElement, offset: number): void {
  const range = inlineScrollRange(scroller);
  const clamped = Math.min(Math.max(0, offset), range);
  scroller.scrollLeft =
    scrollsFromRight(scroller) && Number.isFinite(range) ? clamped - range : clamped;
}

/** Whether layout gave the container and scroller real boxes (a test DOM gives none). */
function hasBoxes(container: HTMLElement, scroller: HTMLElement): boolean {
  const containerRect = container.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  return containerRect.width !== 0 || scrollerRect.width !== 0;
}

/** The viewport's horizontal centre, in layout points from the container's left edge. */
export function viewportCentreX(
  container: HTMLElement,
  scroller: HTMLElement,
  scale: number
): number {
  const half = scroller.clientWidth / 2;
  if (!hasBoxes(container, scroller)) {
    return (inlineScrollOffset(scroller) - container.offsetLeft + half) / scale;
  }
  const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
  return (left + half - container.getBoundingClientRect().left) / scale;
}

/**
 * Scroll sideways so the viewport's centre is `x` layout points from the container's left
 * edge, as `viewportCentreX` measured it before a rescale. Boxes, not `offsetLeft`, so the
 * padding around the content and the scroller's direction need no special case.
 */
export function centreViewportOn(
  container: HTMLElement,
  scroller: HTMLElement,
  x: number,
  scale: number
): void {
  const half = scroller.clientWidth / 2;
  if (!hasBoxes(container, scroller)) {
    setInlineScrollOffset(scroller, x * scale + container.offsetLeft - half);
    return;
  }
  const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
  const drift = container.getBoundingClientRect().left + x * scale - (left + half);
  setInlineScrollOffset(scroller, inlineScrollOffset(scroller) + drift);
}

/**
 * Scroll the host's scroller back to the document start. A NEW document opens at its first
 * page: the scroller survives the remount, so the previous document's offset would otherwise
 * carry over, and a reader ten pages into one file opened the next file ten pages in.
 */
export function scrollToDocumentStart(container: HTMLElement): void {
  const scroller = surfaceScroller(container);
  if (!scroller) return;
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
}

function viewportInLayout(
  container: HTMLElement,
  scroller: HTMLElement,
  scale: number
): { top: number; height: number } {
  const containerRect = container.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const topPx =
    scroller.scrollTop !== 0 && containerRect.top === 0 && scrollerRect.top === 0
      ? scroller.scrollTop - container.offsetTop
      : scrollerRect.top + scroller.clientTop - containerRect.top;
  return { top: topPx / scale, height: scroller.clientHeight / scale };
}

export function viewportPage(
  container: HTMLElement,
  layout: SemanticLayout,
  scale: number
): number | null {
  const scroller = surfaceScroller(container);
  if (!scroller || scroller.clientHeight <= 0 || layout.pages.length === 0 || scale <= 0) {
    return null;
  }
  const viewport = viewportInLayout(container, scroller, scale);
  const centerY = viewport.top + viewport.height / 2;
  for (const page of layout.pages) {
    if (centerY < page.box.y + page.box.height) return page.index + 1;
  }
  return layout.pages.length;
}

export function visiblePageSet(
  container: HTMLElement,
  layout: SemanticLayout,
  selection: SemanticSelection,
  scale: number
): ReadonlySet<number> | undefined {
  const scroller = surfaceScroller(container);
  if (!scroller || scroller.clientHeight === 0) return undefined;
  const viewport = viewportInLayout(container, scroller, scale);
  const pinned: number[] = [];
  for (const position of [selection.anchor, selection.head]) {
    const caret = caretAt(layout, position);
    if (caret) pinned.push(caret.pageIndex);
  }
  return pagesToMaterialize({ layout, viewport, overscanPages: 1, pinnedPages: pinned });
}

export function equalPageSets(
  left: ReadonlySet<number> | undefined,
  right: ReadonlySet<number> | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right || left.size !== right.size) return false;
  for (const index of left) if (!right.has(index)) return false;
  return true;
}

export interface SurfaceExtent {
  readonly width: number;
  readonly height: number;
  readonly pageOffsetX: ReadonlyMap<number, number>;
}

export function surfaceExtent(
  layout: SemanticLayout,
  materialize: ReadonlySet<number> | undefined
): SurfaceExtent {
  const last = layout.pages[layout.pages.length - 1];
  const height = last ? last.box.y + last.box.height : 0;
  const widthPages = materialize
    ? layout.pages.filter((page) => materialize.has(page.index))
    : layout.pages;
  let width = 0;
  for (const page of widthPages) width = Math.max(width, page.box.x + page.box.width);
  const pageOffsetX = new Map<number, number>();
  if (new Set(widthPages.map((page) => page.box.width)).size > 1) {
    for (const page of layout.pages) {
      pageOffsetX.set(page.index, (width - page.box.width) / 2 - page.box.x);
    }
  }
  return { width, height, pageOffsetX };
}

export function equalSurfaceExtents(left: SurfaceExtent, right: SurfaceExtent): boolean {
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.pageOffsetX.size !== right.pageOffsetX.size
  ) {
    return false;
  }
  for (const [index, offset] of left.pageOffsetX) {
    if (right.pageOffsetX.get(index) !== offset) return false;
  }
  return true;
}

/**
 * Place each built page horizontally inside the extent.
 *
 * The painter reconciles page children in record order, including virtual shells, so indexing
 * that retained list is O(1); a selector here used to make one DOM query for every page on
 * every keystroke (hundreds of queries in a long document).
 */
export function applyPageOffsets(
  pagesLayer: HTMLElement,
  layout: SemanticLayout,
  extent: SurfaceExtent,
  scale: number
): void {
  for (const page of layout.pages) {
    const element = pagesLayer.children.item(page.index) as HTMLElement | null;
    if (element?.dataset.pageIndex !== String(page.index)) continue;
    const offsetX = extent.pageOffsetX.get(page.index) ?? 0;
    element.style.left = `${(page.box.x + offsetX) * scale}px`;
  }
}
