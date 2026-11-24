import { useCallback, useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefCallback } from 'react';
import type { DocxEditorRefCallback } from '../docx-editor-ref-callback';
import { absolutePointInScroller } from './scroller-geometry.ts';
import { hostWindowOf, storyLabelTop } from '@docx-editor.dev/core/editor';

/** Where a scoped chrome anchor sits relative to its story: before it, after it, or on its label. */
export type ScopedChromeAnchorPlacement = 'before' | 'after' | 'story-label';

export interface ScopedChromeAnchor {
  readonly ref: DocxEditorRefCallback<HTMLDivElement>;
  readonly style: CSSProperties;
}

/**
 * Attach contextual chrome to a painted story instead of the top of the editor viewport.
 *
 * The engine owns and may replace everything inside the paginated surface, so React cannot
 * portal controls into a header, footer, or note node. This hook keeps the controls as a
 * sibling overlay and derives only their screen placement from the current painted host.
 */
export function useScopedChromeAnchor(
  findAnchor: (viewport: HTMLElement) => HTMLElement | null,
  placement: ScopedChromeAnchorPlacement
): ScopedChromeAnchor {
  const [chrome, setChrome] = useState<HTMLDivElement | null>(null);
  const ref = useCallback<RefCallback<HTMLDivElement>>((node) => setChrome(node), []);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const containingViewport = chrome?.closest<HTMLElement>('.docx-editor__scroll-container');
    const viewport =
      containingViewport ??
      chrome?.parentElement?.querySelector<HTMLElement>('.docx-editor__scroll-container');
    if (!chrome || !viewport) return undefined;

    // The viewport's own window: a pop-out editor has its own observers, frames and resizes.
    const view = hostWindowOf(viewport);
    let frame = 0;
    let observedAnchor: HTMLElement | null = null;
    const resizeObserver = new view.ResizeObserver(() => schedule());

    // Frames, scrolls and repaints call this constantly; most of them move nothing.
    const place = (next: CSSProperties) =>
      setStyle((previous) => (sameStyle(previous, next) ? previous : next));

    const update = () => {
      frame = 0;
      const anchor = findAnchor(viewport);
      if (anchor !== observedAnchor) {
        resizeObserver.disconnect();
        resizeObserver.observe(viewport);
        resizeObserver.observe(chrome);
        if (anchor) resizeObserver.observe(anchor);
        observedAnchor = anchor;
      }
      if (!anchor || !anchor.isConnected) {
        place({ visibility: 'hidden' });
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const chromeHeight =
        placement === 'story-label' ? Math.max(chrome.offsetHeight, 28) : chrome.offsetHeight;
      const clearance = placement === 'story-label' ? 6 : 4;
      const attachedInsideViewport = containingViewport === viewport;
      // Header/footer AND footnote/endnote chrome both use this hook (`story-label`).
      // A story label goes above its story, or below it when the sheet has no room above.
      const anchorTop =
        placement === 'after'
          ? anchorRect.bottom + 6
          : placement === 'story-label'
            ? storyLabelTop(
                anchorRect,
                anchor.closest('.docx-page')?.getBoundingClientRect().top,
                chromeHeight,
                clearance
              )
            : anchorRect.top - chromeHeight - clearance;
      const documentPoint = attachedInsideViewport
        ? absolutePointInScroller(viewport, anchorRect.left, anchorTop)
        : { left: anchorRect.left, top: anchorTop };
      const documentLeft = documentPoint.left;
      const documentTop = documentPoint.top;
      const viewportEdge = attachedInsideViewport ? viewport.scrollLeft + 8 : 8;

      place({
        position: attachedInsideViewport ? 'absolute' : 'fixed',
        left: placement === 'story-label' ? documentLeft : Math.max(viewportEdge, documentLeft + 8),
        top:
          placement === 'story-label'
            ? documentTop
            : Math.max(attachedInsideViewport ? viewport.scrollTop + 8 : 8, documentTop),
        ...(placement === 'story-label'
          ? { width: Math.max(240, Math.min(anchorRect.width, viewport.clientWidth - 16)) }
          : {
              maxWidth: Math.max(240, Math.min(anchorRect.width - 16, viewport.clientWidth - 16)),
            }),
        visibility: 'visible',
      });
    };

    const schedule = () => {
      if (frame) return;
      frame = view.requestAnimationFrame(update);
    };

    resizeObserver.observe(viewport);
    resizeObserver.observe(chrome);
    const mutationObserver = new view.MutationObserver(schedule);
    mutationObserver.observe(viewport, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-docx-hf-active', 'data-docx-note-scope'],
    });
    viewport.addEventListener('scroll', schedule, { passive: true });
    view.addEventListener('resize', schedule);
    update();

    return () => {
      if (frame) view.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener('scroll', schedule);
      view.removeEventListener('resize', schedule);
    };
  }, [chrome, findAnchor, placement]);

  return { ref, style };
}

/** Whether two placement styles hold the same values, so an unchanged frame renders nothing. */
function sameStyle(a: CSSProperties, b: CSSProperties): boolean {
  const keys = Object.keys(a) as (keyof CSSProperties)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}
