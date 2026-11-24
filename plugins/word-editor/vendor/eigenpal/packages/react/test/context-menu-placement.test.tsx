// The context menu stays inside the window and above the host's chrome.
//
// The panel is measured in a layout effect, so these tests give it a size through a stubbed
// `getBoundingClientRect` and a small window through `innerWidth`/`innerHeight`. What they pin
// down: a press near the bottom or the top keeps the whole panel on screen; a menu taller than
// the window is capped to it and scrolls; the panel's own scroll does not close it; the arrow
// keys scroll the focused row into view; and the panel opens in the top layer, where a host
// stacking context cannot paint over it.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello world</w:t></w:r></w:p></w:body></w:document>`
  ),
});

const t = (key: string): string => key;

/** The window the panel is placed in. */
const VIEW = { width: 1000, height: 600 };
/** The size the panel reports when it is measured. */
let panelSize = { width: 240, height: 300 };

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalSize = { width: window.innerWidth, height: window.innerHeight };

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  panelSize = { width: 240, height: 300 };
  Object.defineProperty(window, 'innerWidth', { value: VIEW.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VIEW.height, configurable: true });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('docx-contextmenu')) {
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      const cap = Number.parseFloat(this.style.maxHeight) || Infinity;
      return rectOf(left, top, panelSize.width, Math.min(panelSize.height, cap));
    }
    return originalRect.call(this);
  };
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  Object.defineProperty(window, 'innerWidth', { value: originalSize.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalSize.height, configurable: true });
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
});

function mount(rows?: ReactNode): ReturnType<typeof render> {
  return render(
    <DocxEditorRoot document={SOURCE}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu t={t}>{rows}</ContextMenu>
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

function rightClick(view: ReturnType<typeof render>, x: number, y: number): HTMLElement {
  const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface');
  if (!surface) throw new Error('no painted surface');
  act(() => {
    fireEvent.contextMenu(surface, { clientX: x, clientY: y, button: 2 });
  });
  const panel = view.container.querySelector<HTMLElement>('.docx-contextmenu');
  if (!panel) throw new Error('the menu did not open');
  return panel;
}

/** The panel's box as placed, from its inline style and measured height. */
function placed(panel: HTMLElement): { top: number; bottom: number; maxHeight: number } {
  const top = Number.parseFloat(panel.style.top);
  const maxHeight = Number.parseFloat(panel.style.maxHeight);
  return { top, bottom: top + Math.min(panelSize.height, maxHeight), maxHeight };
}

describe('the menu stays inside the window', () => {
  test('a press near the bottom keeps a tall menu on screen, capped and scrolling', () => {
    panelSize = { width: 240, height: 900 };
    const view = mount();
    const box = placed(rightClick(view, 120, 560));
    expect(box.maxHeight).toBe(VIEW.height - 16);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(VIEW.height - 8);
  });

  test('a press near the top keeps a tall menu on screen, capped and scrolling', () => {
    panelSize = { width: 240, height: 900 };
    const view = mount();
    const box = placed(rightClick(view, 120, 40));
    expect(box.maxHeight).toBe(VIEW.height - 16);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.bottom).toBeLessThanOrEqual(VIEW.height - 8);
  });

  test('a menu that fits on neither side of the press moves up only as far as it must', () => {
    panelSize = { width: 240, height: 400 };
    const view = mount();
    const box = placed(rightClick(view, 120, 300));
    // Bottom-aligned to the window inset, not thrown to the top edge.
    expect(box.top).toBe(VIEW.height - 8 - 400);
    expect(box.bottom).toBe(VIEW.height - 8);
  });

  test('a short menu opens below the press, and flips above it near the bottom', () => {
    const view = mount();
    expect(placed(rightClick(view, 120, 100)).top).toBe(100);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(placed(rightClick(view, 120, 500)).top).toBe(200);
  });
});

describe('a menu taller than the window scrolls', () => {
  test('the panel scrolling inside itself does not close it', () => {
    panelSize = { width: 240, height: 900 };
    const view = mount();
    const panel = rightClick(view, 120, 300);
    act(() => {
      fireEvent.scroll(panel);
    });
    expect(view.container.querySelector('.docx-contextmenu')).not.toBeNull();
  });

  test('the arrow keys scroll the focused row into view', () => {
    panelSize = { width: 240, height: 900 };
    const view = mount();
    const panel = rightClick(view, 120, 300);
    Object.defineProperty(panel, 'clientTop', { value: 0, configurable: true });
    Object.defineProperty(panel, 'clientHeight', { value: VIEW.height - 16, configurable: true });
    // Rows 100 px tall, laid out from the panel's top and moved by its scroll, so the last
    // rows sit below the window.
    const items = [...panel.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter(
      (item) => item.closest('[role="menu"]') === panel
    );
    items.forEach((item, index) => {
      item.getBoundingClientRect = () => rectOf(0, 8 + index * 100 - panel.scrollTop, 240, 100);
    });
    const last = items.at(-1)!;
    expect(last.getBoundingClientRect().bottom).toBeGreaterThan(VIEW.height);

    act(() => {
      fireEvent.keyDown(panel, { key: 'End' });
    });
    expect(document.activeElement).toBe(last);
    const lastBox = last.getBoundingClientRect();
    expect(lastBox.bottom).toBeLessThanOrEqual(VIEW.height - 8);
    expect(lastBox.top).toBeGreaterThanOrEqual(8);

    act(() => {
      fireEvent.keyDown(panel, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(items[0]!);
    expect(panel.scrollTop).toBe(0);
  });
});

describe('stacking', () => {
  test('the panel opens in the top layer, above any host stacking context', () => {
    const shown: HTMLElement[] = [];
    (HTMLElement.prototype as { showPopover?: () => void }).showPopover = function (
      this: HTMLElement
    ) {
      shown.push(this);
    };
    const view = mount();
    const panel = rightClick(view, 120, 100);
    expect(panel.getAttribute('popover')).toBe('manual');
    expect(shown).toEqual([panel]);
  });
});

describe('a narrow window', () => {
  test('caps the menu width so its right edge stays in the window', () => {
    Object.defineProperty(window, 'innerWidth', { value: 200, configurable: true });
    const view = mount();
    const panel = rightClick(view, 150, 100);
    expect(Number.parseFloat(panel.style.left)).toBe(8);
    expect(Number.parseFloat(panel.style.maxWidth)).toBe(200 - 16);
  });
});

describe('a submenu in a scrolling menu', () => {
  test('follows its row when the menu scrolls', () => {
    panelSize = { width: 240, height: 900 };
    const view = mount(
      <ContextMenu.Submenu label="More">
        <ContextMenu.Item label="Inner" />
      </ContextMenu.Submenu>
    );
    const panel = rightClick(view, 120, 300);
    const wrapper = panel.querySelector<HTMLElement>('.docx-menubar__submenu')!;
    const row = wrapper.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;
    row.getBoundingClientRect = () => rectOf(0, 400 - panel.scrollTop, 240, 32);
    act(() => {
      fireEvent.mouseEnter(wrapper);
    });
    const submenu = () => panel.querySelector<HTMLElement>('.docx-menubar__submenu-panel')!;
    expect(Number.parseFloat(submenu().style.top)).toBe(396);

    act(() => {
      panel.scrollTop = 100;
      fireEvent.scroll(panel);
    });
    expect(Number.parseFloat(submenu().style.top)).toBe(296);
  });
});

describe('a host row that opens a dialog', () => {
  test('keeps the focus the dialog takes', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const view = mount(<ContextMenu.Item label="Edit" onSelect={() => input.focus()} />);
    const panel = rightClick(view, 120, 100);
    const row = [...panel.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Edit'
    )!;
    act(() => {
      fireEvent.click(row);
    });
    expect(view.container.querySelector('.docx-contextmenu')).toBeNull();
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
