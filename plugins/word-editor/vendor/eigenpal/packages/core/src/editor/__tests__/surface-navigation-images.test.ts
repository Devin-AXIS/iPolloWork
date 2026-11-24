// Drawing hyperlink navigation (typed-drawings-and-images task 10 / OpenSpec 2.6).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createSurfaceNavigation, type HyperlinkActivation } from '../surface-navigation.ts';
import type { SurfaceHyperlink } from '../surface-hyperlinks.ts';

function mountNavigation(options: {
  readonly drawingLinkById?: (id: string) => SurfaceHyperlink | null;
  readonly onPopover?: (activation: HyperlinkActivation) => void;
}) {
  const pagesLayer = document.createElement('div');
  const container = document.createElement('div');
  container.className = 'docx-editor__scroll-container';
  container.append(pagesLayer);
  document.body.append(container);

  const opened: string[] = [];
  const nav = createSurfaceNavigation({
    pagesLayer,
    container,
    scale: 1,
    layout: () => ({ revision: 0, pages: [] }),
    bookmarks: () => new Map(),
    linkById: () => null,
    ...(options.drawingLinkById ? { drawingLinkById: options.drawingLinkById } : {}),
    setSelection: () => {},
    isCollapsedSelection: () => true,
    ...(options.onPopover ? { onPopover: options.onPopover } : {}),
  });
  const originalOpen = window.open;
  window.open = ((href: string) => {
    opened.push(href);
    return null;
  }) as typeof window.open;

  return {
    pagesLayer,
    container,
    nav,
    opened,
    cleanup() {
      nav.destroy();
      container.remove();
      window.open = originalOpen;
    },
  };
}

describe('drawing hyperlink gestures', () => {
  test('does not activate on load — only explicit click routes popover', () => {
    let popover = 0;
    const { pagesLayer, cleanup } = mountNavigation({
      drawingLinkById: () => ({
        id: 'drawing-1',
        paragraphId: 'p1',
        start: 0,
        end: 1,
        text: '',
        kind: 'external',
        href: 'https://example.com/safe',
        authored: 'https://example.com/safe',
      }),
      onPopover: () => {
        popover += 1;
      },
    });
    const drawing = document.createElement('div');
    drawing.className = 'docx-drawing-ready';
    drawing.dataset.docxDrawingLink = 'drawing-1';
    drawing.dataset.docxDrawingLinkHref = 'https://example.com/safe';
    pagesLayer.append(drawing);
    expect(popover).toBe(0);
    cleanup();
  });

  test('trusted click on ready drawing produces HyperlinkActivation', () => {
    let activation: HyperlinkActivation | null = null;
    const { pagesLayer, cleanup } = mountNavigation({
      drawingLinkById: () => ({
        id: 'drawing-1',
        paragraphId: 'p1',
        start: 0,
        end: 1,
        text: '',
        kind: 'external',
        href: 'https://example.com/safe',
        authored: 'https://example.com/safe',
      }),
      onPopover: (value) => {
        activation = value;
      },
    });
    const drawing = document.createElement('div');
    drawing.className = 'docx-drawing-ready';
    drawing.dataset.docxDrawingLink = 'drawing-1';
    pagesLayer.append(drawing);
    drawing.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    drawing.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activation?.link.href).toBe('https://example.com/safe');
    cleanup();
  });

  test('unsafe scheme href stays inert — no popover and no window.open', () => {
    let popover = 0;
    const { pagesLayer, opened, cleanup } = mountNavigation({
      drawingLinkById: () => ({
        id: 'drawing-2',
        paragraphId: 'p1',
        start: 0,
        end: 1,
        text: '',
        kind: 'unresolved',
        href: null,
        authored: 'javascript:alert(1)',
      }),
      onPopover: () => {
        popover += 1;
      },
    });
    const drawing = document.createElement('div');
    drawing.className = 'docx-drawing-placeholder';
    drawing.dataset.docxDrawingLink = 'drawing-2';
    pagesLayer.append(drawing);
    drawing.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    drawing.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    expect(popover).toBe(0);
    expect(opened).toHaveLength(0);
    cleanup();
  });
});
