// Which content control the pointer is over, published as `data-hover` on its chrome.
//
// The chrome layer lets pointer events through to the text it outlines, so CSS `:hover` on
// the chrome only fires over its button — and the button now waits for the hover to paint.
// The pointer's position is compared with the painted boundary boxes instead, on the one
// page under the pointer, so hovering a control's text (or the gap where its button sits)
// lights the chrome the way Word shows a control's tab under the pointer. TOC chrome keeps
// its own hover projection and is left alone here.
import { hostTimers } from './host-realm.ts';

/** How far past a boundary box the hover still counts, in CSS pixels: the button's gap. */
const HOVER_SLACK_X = 22;
const HOVER_SLACK_Y = 3;

export interface ContentControlHover {
  destroy(): void;
}

function chromeUnder(layer: HTMLElement, x: number, y: number): HTMLElement | null {
  const view = layer.ownerDocument;
  if (typeof view.elementFromPoint !== 'function') return null;
  const page = view.elementFromPoint(x, y)?.closest<HTMLElement>('.docx-page');
  if (!page) return null;
  for (const chrome of page.querySelectorAll<HTMLElement>(
    '[data-docx-content-control]:not([data-docx-toc])'
  )) {
    for (const box of chrome.querySelectorAll<HTMLElement>('.docx-content-control-boundary')) {
      const rect = box.getBoundingClientRect();
      if (
        x >= rect.left - HOVER_SLACK_Y &&
        x <= rect.right + HOVER_SLACK_X &&
        y >= rect.top - HOVER_SLACK_Y &&
        y <= rect.bottom + HOVER_SLACK_Y
      ) {
        return chrome;
      }
    }
  }
  return null;
}

/** Track pointer hover over content-control chrome on `layer` until `destroy()`. */
export function createContentControlHover(layer: HTMLElement): ContentControlHover {
  let hovered: HTMLElement | null = null;
  // The pages' own window, and a frame pending in a closing pop-out moves to a live one.
  const frames = hostTimers(() => layer);
  let frame = 0;
  let last: { x: number; y: number } | null = null;
  const set = (next: HTMLElement | null): void => {
    if (next === hovered) return;
    if (hovered?.isConnected) delete hovered.dataset.hover;
    hovered = next;
    if (next) next.dataset.hover = '';
  };
  const settle = (): void => {
    frame = 0;
    if (last) set(chromeUnder(layer, last.x, last.y));
  };
  const onMove = (event: PointerEvent): void => {
    last = { x: event.clientX, y: event.clientY };
    // One box scan per frame, not per event: a pointer sends many moves between paints.
    // A frame pending in a window the layer has left (a hidden opener) moves here first.
    frames.migrate();
    if (frame === 0) frame = frames.requestAnimationFrame(settle);
  };
  const onLeave = (): void => {
    last = null;
    set(null);
  };
  layer.addEventListener('pointermove', onMove);
  layer.addEventListener('pointerleave', onLeave);
  return {
    destroy() {
      layer.removeEventListener('pointermove', onMove);
      layer.removeEventListener('pointerleave', onLeave);
      frames.cancelAnimationFrame(frame);
      set(null);
    },
  };
}
