// What tells a mounted surface that its window moved under it: the browser selection
// changing, the scroller scrolling, and the viewport changing size.
//
// All three are reported by the document or the window the pages live in, never by the
// pages themselves, so they are bound through the surface's host listener registry and
// follow the pages when the surface moves to another window.

import { frameCoalescer } from './frame-coalescer.ts';
import { hostWindowOf } from './host-realm.ts';
import { surfaceScroller } from './surface-pages.ts';
import type { SurfaceHostListeners } from './surface-host-listeners.ts';

export interface SurfaceViewportBindingDeps {
  readonly pagesLayer: HTMLElement;
  /** The element the pages are mounted in now. */
  container(): HTMLElement;
  readonly listeners: SurfaceHostListeners;
  onSelectionChange(): void;
  /** Repaint for a new viewport, coalesced to a frame here. */
  rematerialize(): void;
}

export interface SurfaceViewportBinding {
  /** Repaint for the viewport on the next frame, coalesced. */
  schedule(): void;
  /** Re-resolve the scroller whose size is watched: the host may wrap the surface late. */
  watchScrollerSize(): void;
  /**
   * Follow the pages to the window they live in now. The owner rebinds the listener registry
   * itself, since other modules share it.
   */
  rebind(): void;
  /** Stop watching the viewport's size while the surface is parked; `rebind` resumes. */
  suspend(): void;
  destroy(): void;
}

export function bindSurfaceViewport(deps: SurfaceViewportBindingDeps): SurfaceViewportBinding {
  const { pagesLayer, listeners } = deps;
  // Selection lives on the document, so this is where the browser reports it changing —
  // whatever produced it: a drag, a double-click, Select All, or a caret move.
  const unlistenSelection = listeners.onDocument('selectionchange', deps.onSelectionChange);

  // Coalesced to a frame: a wheel fires far more scroll events than there are frames, and
  // each repaint costs the same whether one event asked for it or twenty.
  // BOUND TO THE DOCUMENT, RESOLVED PER EVENT. `scroll` does not bubble, but it does fire in
  // the CAPTURE phase on every ancestor, and that is the only binding that survives the mount
  // order: a host attaches the surface and only then wraps it in its viewport, so a scroller
  // captured with `closest` at mount time is routinely null — and a null one meant no listener
  // at all, so scrolling never built the pages it revealed. Also covers StrictMode /
  // provider-first attach before the Content node sits under the scroll container.
  const scheduleRematerialize = frameCoalescer(pagesLayer, deps.rematerialize);
  const unlistenScroll = listeners.onDocument(
    'scroll',
    (event) => {
      const scroller = surfaceScroller(deps.container());
      if (!scroller || event.target !== scroller) return;
      scheduleRematerialize();
    },
    { capture: true, passive: true }
  );

  // WHICH PAGES ARE VISIBLE DEPENDS ON THE VIEWPORT'S SIZE, NOT ONLY ON ITS SCROLL OFFSET.
  //
  // `visiblePageSet` reads `clientHeight`, so a viewport that grows reveals pages the last
  // paint had no reason to build — and a resize fires no `scroll`. The window event covers a
  // resized window; an observer covers everything that changes the scroller WITHOUT one — a
  // collapsing panel, a wrapping toolbar, a CSS change. The observer is the pages' own
  // window's: an observer from another window never reports this document's boxes.
  const unlistenResize = listeners.onWindow('resize', scheduleRematerialize, { passive: true });
  let observer: ResizeObserver | null = null;
  let observerWindow: Window | null = null;
  let observedScroller: HTMLElement | null = null;
  let suspended = false;

  function disconnect(): void {
    observer?.disconnect();
    observer = null;
    observerWindow = null;
    observedScroller = null;
  }

  function watchScrollerSize(): void {
    if (suspended) return;
    const view = hostWindowOf(pagesLayer);
    if (view !== observerWindow) {
      disconnect();
      observerWindow = view;
      observer =
        typeof view.ResizeObserver === 'function'
          ? new view.ResizeObserver(scheduleRematerialize)
          : null;
    }
    if (!observer) return;
    const scroller = surfaceScroller(deps.container());
    if (scroller === observedScroller) return;
    observer.disconnect();
    observedScroller = scroller;
    if (scroller) observer.observe(scroller);
  }
  watchScrollerSize();

  return {
    schedule: scheduleRematerialize,
    watchScrollerSize,
    rebind() {
      suspended = false;
      watchScrollerSize();
      scheduleRematerialize();
    },
    suspend() {
      suspended = true;
      disconnect();
    },
    destroy() {
      unlistenSelection();
      unlistenScroll();
      unlistenResize();
      disconnect();
    },
  };
}
