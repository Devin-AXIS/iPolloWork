// How a preview fork is painted over the live editor, and taken away again.
//
// OVER, NOT INSTEAD. The live container stays in the layout with `visibility: hidden`, and the
// preview's view-only surface is laid on top of it in an absolutely positioned holder, a sibling
// of the container. So the scroll extent, the scroll position and every geometry read of the
// live pages stay exactly what they were: the review rail stays anchored to the live document's
// text (it describes the live document, which is what a commit changes), and nothing jumps when
// the preview ends. The holder is a `docx-preview-surface`, never a `docx-paginated-surface`, so
// a lookup for the editor surface still finds the live one.
//
// Focus leaves the hidden pages while the preview shows, and returns when it ends.

import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { hostTimers } from './host-realm.ts';
import { continueProgressiveOpen, progressiveOpenPending } from './surface-progressive-open.ts';

/** Work per opening slice of a preview, in milliseconds: the editor's own opening budget. */
const OPENING_SLICE_MS = 40;

/** The class the preview holder carries, which the surface stylesheet styles like the live one. */
export const PREVIEW_SURFACE_CLASS = 'docx-preview-surface';
/** Set on the editor root while a preview shows; the stylesheet hides the live chrome under it. */
const PREVIEWING_ATTRIBUTE = 'data-docx-previewing';

/** The nearest ancestor that scrolls, if any: its offsets are what a preview must not move. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  const view = element.ownerDocument.defaultView;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    const overflow = `${style?.overflowY ?? ''} ${style?.overflowX ?? ''}`;
    if (/(auto|scroll|overlay)/.test(overflow)) return node;
  }
  return null;
}

/** One painted preview: the holder, the surface in it, and what to put back. */
export interface PreviewDisplay {
  readonly surface: PaginatedSurface;
  /** Put the holder back over the live container, after the container moved or resized. */
  place(): void;
  /** Lay out the rest of a long preview now, so geometry anywhere in it can be read. */
  finishOpening(): void;
  /** Remove the preview and show the live pages as they were. */
  remove(): void;
}

/**
 * Lay `mount(holder)`'s surface over `container`. `null`, with nothing changed, when the
 * container is not in a document or the surface does not mount.
 */
export function showPreviewOver(
  container: HTMLElement,
  label: string,
  mount: (holder: HTMLElement) => PaginatedSurface | null
): PreviewDisplay | null {
  const parent = container.parentElement;
  if (!parent) return null;
  const doc = container.ownerDocument;
  const scroller = scrollerOf(container);
  const scrollTop = scroller?.scrollTop ?? 0;
  const scrollLeft = scroller?.scrollLeft ?? 0;
  const holder = doc.createElement('div');
  holder.className = PREVIEW_SURFACE_CLASS;
  holder.setAttribute('data-docx-preview', '');
  // A landmark of its own, so assistive technology says the reader is looking at a preview.
  holder.setAttribute('role', 'region');
  holder.setAttribute('aria-label', label);
  holder.style.position = 'absolute';
  holder.style.margin = '0';
  // Inert to the live editor's chrome: its context menu would act on the hidden selection, and
  // a paste or a drop has no document to land in. The view-only surface refuses them itself.
  const inert = (event: Event) => {
    event.stopPropagation();
    if (event.type !== 'contextmenu') event.preventDefault();
  };
  for (const type of ['contextmenu', 'paste', 'cut', 'drop', 'dragover']) {
    holder.addEventListener(type, inert);
  }
  const place = () => {
    holder.style.top = `${container.offsetTop}px`;
    holder.style.left = `${container.offsetLeft}px`;
    holder.style.width = `${container.offsetWidth}px`;
    holder.style.minHeight = `${container.offsetHeight}px`;
  };
  place();
  parent.insertBefore(holder, container.nextSibling);
  const surface = mount(holder);
  if (!surface) {
    holder.remove();
    return null;
  }
  // The surface makes its container the containing block of its overlays with
  // `position: relative`, which would drop the holder into the flow after the live pages.
  // Absolute again, so it lies over them.
  holder.style.position = 'absolute';
  place();
  const active = doc.activeElement as HTMLElement | null;
  const refocus = active && container.contains(active) ? active : null;
  // A hidden element cannot keep focus, and a focused live page would take keys meant for no one.
  refocus?.blur();
  const hiddenVisibility = container.style.visibility;
  container.style.visibility = 'hidden';
  const restoreScroll = () => {
    if (!scroller) return;
    scroller.scrollTop = scrollTop;
    scroller.scrollLeft = scrollLeft;
  };
  restoreScroll();
  // The container can move without resizing, when the review pane opens or the window
  // narrows: the parent's box and the window's both put the holder back.
  const view = doc.defaultView;
  const Observer = view?.ResizeObserver;
  const resize = Observer ? new Observer(place) : null;
  resize?.observe(container);
  resize?.observe(parent);
  view?.addEventListener('resize', place);
  // The live editor's own chrome (picture handles, popups) describes the hidden pages.
  const root = container.closest<HTMLElement>('.docx-editor') ?? parent;
  root.setAttribute(PREVIEWING_ATTRIBUTE, '');
  // A long preview shows its first screen at once and lays the rest out in short tasks, the
  // way the editor opens a long document, so showing it never blocks the page for long.
  const timers = hostTimers(() => holder);
  let slice: number | null = null;
  const continueOpening = () => {
    slice = null;
    if (!continueProgressiveOpen(surface, OPENING_SLICE_MS)) {
      slice = timers.setTimeout(continueOpening, 0);
    }
  };
  if (progressiveOpenPending(surface)) slice = timers.setTimeout(continueOpening, 0);
  return {
    surface,
    place,
    finishOpening() {
      if (slice !== null) timers.clearTimeout(slice);
      slice = null;
      while (!continueProgressiveOpen(surface, Number.POSITIVE_INFINITY)) {
        /* each step lays out more; the last answers true */
      }
    },
    remove() {
      if (slice !== null) timers.clearTimeout(slice);
      slice = null;
      resize?.disconnect();
      view?.removeEventListener('resize', place);
      root.removeAttribute(PREVIEWING_ATTRIBUTE);
      const top = scroller?.scrollTop ?? 0;
      const left = scroller?.scrollLeft ?? 0;
      container.style.visibility = hiddenVisibility;
      surface.destroy();
      holder.remove();
      // The reader may have scrolled the preview; the live pages take the same position.
      if (scroller) {
        scroller.scrollTop = top;
        scroller.scrollLeft = left;
      }
      if (refocus?.isConnected) refocus.focus({ preventScroll: true });
    },
  };
}

/** The first paragraph id inside `node`, in document order, or null. */
function firstParagraph(node: OoxmlNode): string | null {
  if (node.kind === 'paragraph') return node.id;
  if (!('children' in node) || !Array.isArray(node.children)) return null;
  for (const child of node.children as readonly OoxmlNode[]) {
    const found = firstParagraph(child);
    if (found) return found;
  }
  return null;
}

/**
 * The first body paragraph the fork changed, or null when the body is unchanged.
 *
 * By node IDENTITY: the fork started from the live package, and a store edit replaces only the
 * nodes on the path to what it changed, so the first child that differs by reference leads to
 * the change without comparing any text.
 */
export function firstChangedParagraph(live: OoxmlPackage, fork: OoxmlPackage): string | null {
  const before = live.parts.get(live.mainDocumentPart)?.root;
  const after = fork.parts.get(fork.mainDocumentPart)?.root;
  if (!before || !after || before === after) return null;
  const walk = (a: OoxmlElement, b: OoxmlElement): string | null => {
    const left = a.children as readonly OoxmlNode[];
    const right = b.children as readonly OoxmlNode[];
    for (let index = 0; index < right.length; index += 1) {
      const next = right[index]!;
      const previous = left[index];
      if (previous === next) continue;
      if (next.kind === 'paragraph') return next.id;
      if (previous && previous.kind === next.kind && 'children' in previous && 'children' in next)
        return walk(previous as OoxmlElement, next as OoxmlElement) ?? firstParagraph(next);
      return firstParagraph(next);
    }
    // Only removals after the last kept child: the paragraph before them is where it shows.
    const last = right[right.length - 1];
    return last ? firstParagraph(last) : null;
  };
  const found = walk(before, after);
  return found && findNode(fork.parts.get(fork.mainDocumentPart)!, found) ? found : null;
}
