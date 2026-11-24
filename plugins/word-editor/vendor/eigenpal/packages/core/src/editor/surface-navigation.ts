// Hyperlink navigation over the painted pages (paginated-surface seam).
//
// THE HOST PAGE NEVER NAVIGATES. Painted links carry a real `href` so they announce as links,
// copy as links and print as links — which also means a browser left to itself would follow
// one and unload the editor, taking every unsaved edit with it. Every click on an anchor
// inside the pages is prevented here, unconditionally and regardless of pointer mode, and
// what happens next is a decision this module makes.
//
// THREE OUTCOMES, and only three:
//
//   internal link  -> scroll to the bookmark and put the caret there. Never leaves the page.
//   external link  -> hand the host a popover request. Ctrl/Cmd+Click activates directly.
//   anything else  -> nothing. A drag that ENDED on a link is a selection, not a click on it;
//                     an inert link (refused scheme, dangling relationship) has no target;
//                     a furniture link in a header is read-only in this slice.
//
// `window.open` is called from ONE place in the whole engine — `openExternal` below — and
// only ever with the sanitized projection, never with an authored target.

import { isUnsupportedComponentTarget } from '../output/unsupported-elements.ts';
import { caretAt, type SemanticLayout } from '@docx-editor.dev/core/layout';
import { storyContentBox } from './surface-story-geometry.ts';
import { pastLeadingBreaks } from '../layout/paragraph-start-page.ts';
import { sanitizeHref } from '../store/package/sinks.ts';
import type { BookmarkIndex } from '@docx-editor.dev/core/store';
import type { SurfaceHyperlink } from './surface-hyperlinks.ts';

/** A click on a painted link, after native navigation was refused. */
export interface HyperlinkActivation {
  readonly link: SurfaceHyperlink;
  /** The clicked line fragment's viewport rect, so a popover can be placed under it. */
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
    readonly right: number;
  };
}

export interface NavigationDeps {
  readonly pagesLayer: HTMLElement;
  readonly container: HTMLElement;
  readonly scale: () => number;
  readonly layout: () => SemanticLayout;
  readonly bookmarks: () => BookmarkIndex;
  readonly linkById: (linkId: string) => SurfaceHyperlink | null;
  /** Sanitized `a:hlinkClick` on a painted drawing, keyed by drawing node id. */
  readonly drawingLinkById?: (drawingNodeId: string) => SurfaceHyperlink | null;
  readonly setSelection: (position: { paragraphId: string; offset: number }) => void;
  /** Start of every jump: a newer jump replaces one still waiting for its page. */
  readonly beginJump?: () => void;
  /**
   * During a large open, wait for a target the layout has not reached and `retry` the jump
   * once it has. False when there is nothing to wait for.
   */
  readonly whenLaidOut?: (
    position: { paragraphId: string; offset: number },
    retry: () => void
  ) => boolean;
  /**
   * Put the surface in the story a jump target is in, before the caret moves there.
   *
   * A bookmark, and now an internal link, can name a paragraph in a header, a footer or a
   * note. Moving the caret there while the scope stayed on the body left the two disagreeing:
   * `activeScope` said body, the caret sat on a paragraph the body store has never heard of,
   * and every keystroke after it was refused with nothing said. Returns false when the story
   * cannot be opened, which is a refusal the caller must honour rather than jump anyway.
   */
  readonly enterStoryFor?: (paragraphId: string) => boolean;
  readonly isCollapsedSelection: () => boolean;
  /** Reconcile virtualization immediately after a programmatic jump. */
  readonly onScrolled?: () => void;
  /**
   * Show the hyperlink popover for an external link. Absent means a plain click on an
   * external link does nothing — which is the honest behaviour for a host that has not
   * mounted a popover, rather than opening a tab the user did not ask for.
   */
  readonly onPopover?: (activation: HyperlinkActivation) => void;
}

/**
 * Moving the caret and the viewport: to a position, to a bookmark, or out to an external target.
 *
 * {@link SurfaceNavigation.openExternal} is THE external-activation call site, and it refuses
 * anything but an already-sanitized href. Routing an authored target through some other path is
 * how a document gets to choose where a click goes.
 */
export interface SurfaceNavigation {
  /** Snap to a semantic position using layout geometry, then place the caret there. */
  /**
   * With `orShow`, a story that cannot be opened is scrolled to without moving the caret into
   * it, and the answer is `'shown'`. With `center`, the target is centered in the viewport
   * unless it is already well inside it, so it never lands under chrome at the top edge.
   */
  goToPosition(
    position: { paragraphId: string; offset: number },
    options?: { readonly orShow?: boolean; readonly center?: boolean }
  ): boolean | 'shown';
  /**
   * Scroll a bookmark into view and place the caret at it. Answers false for a name no
   * bookmark declares — an inert click, which is what Word does with a dangling anchor.
   */
  goToBookmark(name: string): boolean;
  /**
   * THE external-activation call site. Refuses anything but a sanitized projection, so a
   * caller cannot route an authored target through it by mistake.
   */
  openExternal(href: string | null): boolean;
  destroy(): void;
}

/** The index of the first page whose bottom is below the scroll container's top. */
function pageInView(layout: SemanticLayout, element: HTMLElement | null, scale: number): number {
  if (!element) return 0;
  const top = element.scrollTop;
  const page = layout.pages.find((entry) => (entry.box.y + entry.box.height) * scale > top);
  return page?.index ?? 0;
}

/** How much room to leave above a jump target, so it does not land flush against the edge. */
const JUMP_MARGIN_PX = 24;

/** Options of {@link SurfaceNavigation.goToPosition}. */
type GoToPositionOptions = { readonly orShow?: boolean; readonly center?: boolean };

/**
 * The scroll offset that shows a target at `y` (scroll-container pixels). Centered, a target
 * already in the middle band of the viewport stays put; otherwise it lands in the middle.
 * Not centered, it lands one margin below the top edge, as a link jump does.
 */
function jumpScrollTop(element: HTMLElement, y: number, center: boolean): number {
  if (!center) return Math.max(0, y - JUMP_MARGIN_PX);
  const view = element.clientHeight;
  const top = element.scrollTop;
  if (y >= top + view * 0.2 && y <= top + view * 0.8) return top;
  return Math.max(0, y - view / 2);
}

export function createSurfaceNavigation(deps: NavigationDeps): SurfaceNavigation {
  const { pagesLayer } = deps;

  /** The scroll container this surface sits in, looked up live (chrome can mount later). */
  function scroller(): HTMLElement | null {
    return deps.container.closest('.docx-editor__scroll-container');
  }

  const openExternal = (href: string | null): boolean => {
    if (!href || href.length === 0 || href.startsWith('#')) return false;
    const projection = sanitizeHref(href);
    if (!projection.ok || !projection.href) return false;
    // The pages' window now: the surface can have moved since it was created.
    const view = pagesLayer.ownerDocument.defaultView;
    if (!view) return false;
    // `noopener` is what stops the opened page reaching back through `window.opener` into
    // the editor; `noreferrer` keeps the document's own URL out of the request.
    view.open(projection.href, '_blank', 'noopener,noreferrer');
    return true;
  };

  const goToPosition = (
    position: { paragraphId: string; offset: number },
    options?: GoToPositionOptions
  ): boolean | 'shown' => {
    // Geometry from the LAYOUT, not the DOM. The target of a cross-document jump is normally
    // on a virtualized page with no DOM at all, so `scrollIntoView` would resolve exactly the
    // jumps that did not need it and fail every one that did.
    // BEFORE the geometry is read: entering re-scopes the layout this resolves against, so
    // doing it afterwards would measure the target against the story the reader was leaving.
    // A story that cannot be opened (a header in a read-only document) is shown without
    // moving the caret into it, when the caller asks for that.
    deps.beginJump?.();
    const entered = !deps.enterStoryFor || deps.enterStoryFor(position.paragraphId);
    if (!entered && !options?.orShow) return false;
    const layout = deps.layout();
    const element = scroller();
    // A header or footer repeats on every page: show the copy on the page in view, not the
    // first one, when the story was not opened.
    const caret = caretAt(
      layout,
      position,
      entered ? undefined : { preferredPageIndex: pageInView(layout, element, deps.scale()) }
    );
    if (!caret) {
      // A body target past the pages laid out so far: the caret moves now, the view follows.
      if (!entered || !deps.whenLaidOut?.(position, () => goToPosition(position, options)))
        return false;
      deps.setSelection(position);
      return true;
    }
    const page = layout.pages[caret.pageIndex];
    if (!page) return false;

    // The caret is published relative to its story's box: the content box for the body, the
    // header, footer or note box otherwise. The scroll container measures the whole sheet stack.
    const sheetY = storyContentBox(page, position.paragraphId).y + caret.y;
    if (element) {
      element.scrollTop = jumpScrollTop(element, sheetY * deps.scale(), options?.center === true);
      deps.onScrolled?.();
    }
    if (!entered) return 'shown';
    // The caret moves whether or not there was anywhere to scroll: the jump's POINT is that
    // the user is now editing at the target, and a document short enough to need no scroll
    // must still move the caret.
    deps.setSelection(position);
    return true;
  };

  const goToBookmark = (name: string): boolean => {
    const anchor = deps.bookmarks().get(name);
    if (!anchor) return false;
    // A bookmark in front of a leading page break lands on the text after the break. Only the
    // position goes on: the bookmark record also carries its name, which a caret must not.
    const { paragraphId, offset } = anchor;
    return goToPosition(pastLeadingBreaks(deps.layout().pages, { paragraphId, offset })) === true;
  };

  /**
   * The link under the pointer at PRESS time, and where it was.
   *
   * A press on the surface commits a selection, and a commit can repaint the pages — which
   * detaches the very span the press landed on. The browser then has no live target to
   * compute the `click` event from and reports the nearest surviving ancestor, the pages
   * layer: the click arrived with every trace of the link gone from it. Remembering what was
   * under the pointer before any of that happens is the only reading that survives a
   * repaint, and it is the reading the user meant.
   */
  let pressed: {
    readonly linkId: string;
    readonly rect: HyperlinkActivation['rect'];
    readonly drawing: boolean;
  } | null = null;

  function linkTargetFrom(element: HTMLElement | null): {
    readonly linkId: string;
    readonly drawing: boolean;
  } | null {
    if (!element || element.closest('[data-docx-hf]')) return null;
    const anchor = element.closest('a.docx-hyperlink') as HTMLElement | null;
    if (anchor) {
      const linkId = anchor.dataset.docxLink;
      return linkId ? { linkId, drawing: false } : null;
    }
    const drawingEl = element.closest('[data-docx-drawing-link]') as HTMLElement | null;
    if (drawingEl) {
      const linkId = drawingEl.dataset.docxDrawingLink;
      return linkId ? { linkId, drawing: true } : null;
    }
    return null;
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (isUnsupportedComponentTarget(event.target)) return;
    pressed = null;
    const target = event.target as Element | null;
    const resolved = linkTargetFrom(target as HTMLElement | null);
    if (!resolved) return;
    const rectHost = (target as Element).closest(
      '[data-docx-drawing-link], a.docx-hyperlink'
    ) as HTMLElement;
    const rect = rectHost.getBoundingClientRect();
    pressed = {
      linkId: resolved.linkId,
      drawing: resolved.drawing,
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
    };
  };

  const onClick = (event: MouseEvent): void => {
    if (isUnsupportedComponentTarget(event.target)) return;
    const target = event.target as Element | null;
    const live = linkTargetFrom(target as HTMLElement | null);
    if (!live) {
      const remembered = pressed;
      pressed = null;
      if (!remembered) return;
      event.preventDefault();
      classify(remembered.linkId, remembered.rect, event, remembered.drawing);
      return;
    }
    pressed = null;
    event.preventDefault();
    const rectHost = (target as Element).closest(
      '[data-docx-drawing-link], a.docx-hyperlink'
    ) as HTMLElement;
    const rect = rectHost.getBoundingClientRect();
    classify(
      live.linkId,
      { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right },
      event,
      live.drawing
    );
  };

  /** What a click on `linkId` means, once the link and its position are known. */
  function classify(
    linkId: string,
    rect: HyperlinkActivation['rect'],
    event: MouseEvent,
    drawing: boolean
  ): void {
    const link = drawing ? (deps.drawingLinkById?.(linkId) ?? null) : deps.linkById(linkId);
    if (!link) return;

    const accel = event.metaKey || event.ctrlKey;
    // Ctrl/Cmd+Click follows Word: open now, no popover. Through the same single gate.
    if (accel) {
      if (link.kind === 'external') openExternal(link.href);
      else if (link.anchor) goToBookmark(link.anchor);
      return;
    }
    // A click that ended a DRAG is a selection, not an activation. Popping a panel over the
    // text someone just selected is the most annoying possible response to that gesture.
    if (!deps.isCollapsedSelection()) return;

    if (link.kind === 'internal') {
      if (link.anchor) goToBookmark(link.anchor);
      return;
    }
    // External and unresolved both go to the popover: an inert link is still a link the user
    // may want to see, fix or remove, and the popover is where those live. What it must not
    // do is open — which `openExternal` refuses for a null href regardless.
    deps.onPopover?.({ link, rect });
  }

  // Capture phase on the press: the surface's own pointerdown handler prevents the
  // default and commits a selection, and this must read the DOM before any of that.
  pagesLayer.addEventListener('pointerdown', onPointerDown, true);
  pagesLayer.addEventListener('click', onClick);

  return {
    goToPosition,
    goToBookmark,
    openExternal,
    destroy() {
      pagesLayer.removeEventListener('pointerdown', onPointerDown, true);
      pagesLayer.removeEventListener('click', onClick);
    },
  };
}
