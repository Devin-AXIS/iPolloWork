// Moving a mounted surface's DOM from one host element to another.
//
// The surface owns every child of its host element and writes a few things on the element
// itself: its size, `position: relative`, and the mode classes and attributes its stylesheet
// keys on. A move carries the children and leaves the element it left exactly as a host would
// expect an empty mount point, so a second editor attached there later starts clean.

import { hostTimers, isDomNode, isElementNode, isHTMLElementNode } from './host-realm.ts';
import type { SurfaceHostListenerRegistry } from './surface-host-listeners.ts';
import { inlineScrollOffset, setInlineScrollOffset, surfaceScroller } from './surface-pages.ts';
import type { SurfaceViewportBinding } from './surface-viewport-binding.ts';

/** Host-element classes the surface toggles. */
const SURFACE_HOST_CLASSES = [
  'docx-paginated-surface--viewing',
  'docx-paginated-surface--hf-editing',
] as const;

/** Host-element attributes the surface sets. */
const SURFACE_HOST_ATTRIBUTES = ['data-docx-layout-pending', 'data-docx-opening-preview'] as const;

/**
 * Move every child of `from` into `to`, then clear what the surface wrote on `from`.
 *
 * `to` may belong to another document: appending adopts the nodes, and listeners registered
 * on them travel with them.
 */
export function moveSurfaceNodes(from: HTMLElement, to: HTMLElement): void {
  if (from === to) return;
  to.style.position = 'relative';
  const nodes = Array.from(from.childNodes);
  to.replaceChildren();
  for (const node of nodes) to.appendChild(node);
  for (const name of SURFACE_HOST_CLASSES) {
    if (from.classList.contains(name)) {
      from.classList.remove(name);
      to.classList.add(name);
    }
  }
  for (const name of SURFACE_HOST_ATTRIBUTES) {
    const value = from.getAttribute(name);
    if (value === null) continue;
    from.removeAttribute(name);
    to.setAttribute(name, value);
  }
  from.style.removeProperty('position');
  from.style.removeProperty('width');
  from.style.removeProperty('height');
}

/** What the hosting controller needs from its surface. */
export interface SurfaceHostingDeps {
  readonly pagesLayer: HTMLElement;
  readonly listeners: SurfaceHostListenerRegistry;
  viewport(): SurfaceViewportBinding | null;
  container(): HTMLElement;
  setContainer(next: HTMLElement): void;
  destroyed(): boolean;
  /** CSS pixels per layout point: the reading position is kept in layout points. */
  scale(): number;
  /**
   * Land pending work and close what belongs to the document being left: background layout,
   * menus, pickers and drags are all tied to the old window.
   */
  settle(): void;
  repaint(): void;
  /** The pages turned up in another document without `moveTo`. */
  onHostMoved?(document: Document): void;
}

/** How a move treats keyboard focus. */
export interface SurfaceMoveOptions {
  /**
   * Focus the pages in the new window. Default: they get focus back when they had it before
   * the move (or the detach), so typing continues where it stopped.
   */
  readonly focus?: boolean;
}

/** Where a surface's pages live: mounted, parked, or moved under it. */
export interface SurfaceHosting {
  moveTo(next: HTMLElement, options?: SurfaceMoveOptions): void;
  park(): void;
  parked(): boolean;
  /** Re-bind when a host moved the pages to another document without `moveTo`. */
  heal(): void;
  /** Stop watching the pages for an unannounced move. */
  destroy(): void;
}

/**
 * What can reach the pages first after a host moved them without `moveTo`: focus, a press, the
 * pointer arriving, a wheel. Each one checks, cheaply, whether the pages changed document.
 */
const HEAL_EVENTS = ['focusin', 'pointerdown', 'pointerenter', 'wheel'] as const;

/** Frames to wait for a scroller to appear around moved pages before giving up the position. */
const READING_RETRY_FRAMES = 5;

/** How recently the pages may have lost focus and still count as focused for a move. */
const RECENT_FOCUS_MS = 2000;

/** An input, text area, select or editable element: somewhere the reader chose to type. */
function isTextEntry(node: unknown): boolean {
  if (!isElementNode(node)) return false;
  return (
    node.localName === 'input' ||
    node.localName === 'textarea' ||
    node.localName === 'select' ||
    (isHTMLElementNode(node) && node.isContentEditable)
  );
}

export function createSurfaceHosting(deps: SurfaceHostingDeps): SurfaceHosting {
  /** The private holder a parked surface's DOM waits in; `null` while mounted. */
  let holder: HTMLElement | null = null;
  /** Where the reader was, in layout points, when the pages left their scroller. */
  let reading: { readonly x: number; readonly y: number } | null = null;
  /** Whether the pages had keyboard focus when they left. */
  let hadFocus = false;
  /**
   * When the pages last gave focus to something that is not a text field. The control that
   * starts a move (a "Pop out" or "Bring back" button) takes focus a moment before it, and the
   * reader was still typing in the document; focus moving into another field is a choice.
   */
  let leftFocusAt = Number.NEGATIVE_INFINITY;
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (isDomNode(next) && deps.pagesLayer.contains(next)) return;
    leftFocusAt = isTextEntry(next) ? Number.NEGATIVE_INFINITY : Date.now();
  };
  deps.pagesLayer.addEventListener('focusout', onFocusOut);
  const frames = hostTimers(() => deps.pagesLayer);

  /** Remember the reading position and focus of the pages about to leave `from`. */
  function remember(from: HTMLElement): void {
    // A parked holder has no scroller and no focus: keep what was remembered at the park.
    if (holder !== null) return;
    const scroller = surfaceScroller(from);
    const scale = deps.scale();
    reading = scroller
      ? {
          x: (inlineScrollOffset(scroller) - from.offsetLeft) / scale,
          y: (scroller.scrollTop - from.offsetTop) / scale,
        }
      : null;
    const active = deps.pagesLayer.ownerDocument.activeElement;
    hadFocus =
      (!!active && deps.pagesLayer.contains(active)) || Date.now() - leftFocusAt < RECENT_FOCUS_MS;
  }

  /** Scroll the new viewport back to the remembered position; the scroller may come later. */
  function restoreReading(): void {
    const at = reading;
    reading = null;
    if (!at) return;
    const apply = (): boolean => {
      const into = deps.container();
      const scroller = surfaceScroller(into);
      if (!scroller) return false;
      const scale = deps.scale();
      scroller.scrollTop = Math.max(0, at.y * scale + into.offsetTop);
      setInlineScrollOffset(scroller, at.x * scale + into.offsetLeft);
      return true;
    };
    apply();
    // Once more after the move settles: the owner refits the zoom to the new window right after
    // `moveTo` returns, and a position kept in layout points has to be scaled again with it.
    // Without a scroller yet (the host wraps the content in its viewport later), keep trying
    // for a few frames.
    let frameTries = 0;
    const retry = (): void => {
      if (holder !== null || apply() || ++frameTries > READING_RETRY_FRAMES) return;
      frames.requestAnimationFrame(retry);
    };
    queueMicrotask(retry);
  }

  /** Carry the painted DOM into `next`, leaving the element it left as the host found it. */
  function rehome(next: HTMLElement): void {
    remember(deps.container());
    deps.settle();
    deps.listeners.suspend();
    deps.viewport()?.suspend();
    moveSurfaceNodes(deps.container(), next);
    deps.setContainer(next);
  }

  let healing = false;
  function heal(): void {
    if (healing || holder !== null || deps.destroyed() || !deps.listeners.stale()) return;
    healing = true;
    try {
      // Re-bind FIRST: `settle` can paint, and a paint checks for a move again.
      deps.listeners.rebind();
      deps.viewport()?.rebind();
      // The same hand-over as `moveTo`: a drag or a menu started in the old window ends there.
      deps.settle();
      deps.onHostMoved?.(deps.pagesLayer.ownerDocument);
    } finally {
      healing = false;
    }
  }
  for (const type of HEAL_EVENTS) {
    deps.pagesLayer.addEventListener(type, heal, { capture: true, passive: true });
  }

  return {
    moveTo(next, options) {
      if (deps.destroyed()) return;
      // The same element may itself have moved to another window: re-bind if it did.
      if (next === deps.container() && holder === null) return heal();
      rehome(next);
      holder = null;
      deps.listeners.rebind();
      deps.viewport()?.rebind();
      // Focus BEFORE the paint, which mirrors the selection into the focused pages: the caret
      // shows and typing continues without a click that could move it.
      if (options?.focus ?? hadFocus) deps.pagesLayer.focus({ preventScroll: true });
      deps.repaint();
      restoreReading();
    },
    park() {
      if (deps.destroyed() || holder !== null) return;
      const next = deps.pagesLayer.ownerDocument.createElement('div');
      rehome(next);
      holder = next;
    },
    parked: () => holder !== null,
    heal,
    destroy() {
      for (const type of HEAL_EVENTS) {
        deps.pagesLayer.removeEventListener(type, heal, { capture: true });
      }
      deps.pagesLayer.removeEventListener('focusout', onFocusOut);
    },
  };
}
