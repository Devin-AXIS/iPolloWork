// A context menu opened from the keyboard (Shift+F10 or the Menu key) opens at the caret.
//
// The keyboard event reports no pointer position. The menu reads the caret rectangle from
// the editor instead, so it opens below the line being edited, not at a corner of the
// document area. Rows in `ContextMenu.Start` learn how the menu was opened.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { useDocxEditor } from '../src/editor/context.ts';
import {
  ContextMenu,
  useContextMenuAnchor,
  useContextMenuTarget,
} from '../src/editor/contextmenu/index.ts';

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
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.classList.contains('docx-contextmenu')) {
      const left = Number.parseFloat(this.style.left) || 0;
      const top = Number.parseFloat(this.style.top) || 0;
      return rectOf(left, top, 200, 240);
    }
    // The page content box the caret is placed in, as if the page were scrolled into view.
    if (this.classList.contains('docx-page-content')) return rectOf(300, 120, 600, 800);
    if (this.classList.contains('docx-editor__scroll-container')) return rectOf(0, 0, 1200, 900);
    return originalRect.call(this);
  };
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  Object.defineProperty(window, 'innerWidth', { value: originalSize.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: originalSize.height, configurable: true });
});

let editor: DocxEditorInstance | null = null;
function Probe() {
  editor = useDocxEditor();
  return null;
}

const seen: { trigger: string | null; target: HTMLElement | null }[] = [];
function OpenedBy() {
  const anchor = useContextMenuAnchor();
  const target = useContextMenuTarget();
  seen.push({ trigger: anchor?.trigger ?? null, target });
  return <span data-opened-by="">{anchor?.trigger ?? 'closed'}</span>;
}

function mount(): ReturnType<typeof render> {
  seen.length = 0;
  return render(
    <DocxEditorRoot document={SOURCE}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <Probe />
        <ContextMenu t={t}>
          <ContextMenu.Start>
            <OpenedBy />
          </ContextMenu.Start>
        </ContextMenu>
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

function open(view: ReturnType<typeof render>, init: MouseEventInit): HTMLElement {
  const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface');
  if (!surface) throw new Error('no painted surface');
  act(() => {
    fireEvent.contextMenu(surface, init);
  });
  const panel = view.container.querySelector<HTMLElement>('.docx-contextmenu');
  if (!panel) throw new Error('the menu did not open');
  return panel;
}

/** Move the caret, then let the deferred state notifications land inside `act`. */
async function placeCaret(offset: number): Promise<void> {
  const paragraphId = editor!.surface!.session.paragraphIds()[0]!;
  const at = { blockId: paragraphId, offset };
  await act(async () => {
    expect(editor!.exec({ type: 'setSelection', range: { anchor: at, head: at } }).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test('a keyboard-opened menu opens below the caret', async () => {
  const view = mount();
  await placeCaret(5);
  const caret = editor!.getCaretRect();
  expect(caret).not.toBeNull();
  expect(caret!.left).toBeGreaterThan(300);
  const panel = open(view, { button: -1, clientX: 0, clientY: 0 });
  expect(Number.parseFloat(panel.style.left)).toBeCloseTo(caret!.left, 5);
  expect(Number.parseFloat(panel.style.top)).toBeCloseTo(caret!.bottom, 5);
  expect(seen.at(-1)).toEqual({ trigger: 'keyboard', target: null });
});

test('a keyboard-opened menu follows the caret to another position', async () => {
  const view = mount();
  await placeCaret(0);
  const start = editor!.getCaretRect()!;
  await placeCaret(11);
  const end = editor!.getCaretRect()!;
  expect(end.left).toBeGreaterThan(start.left);
  const panel = open(view, { button: -1, clientX: 0, clientY: 0 });
  expect(Number.parseFloat(panel.style.left)).toBeCloseTo(end.left, 5);
});

test('a right-click opens at the pointer and names its target', () => {
  const view = mount();
  const panel = open(view, { button: 2, clientX: 420, clientY: 260 });
  expect(Number.parseFloat(panel.style.left)).toBe(420);
  expect(Number.parseFloat(panel.style.top)).toBe(260);
  expect(seen.at(-1)?.trigger).toBe('pointer');
  expect(seen.at(-1)?.target).not.toBeNull();
});

test('a row that stays mounted follows a keyboard reopen of an open menu', async () => {
  const view = mount();
  await placeCaret(4);
  open(view, { button: 2, clientX: 420, clientY: 260 });
  const row = () => view.container.querySelector('[data-opened-by]')!.textContent;
  expect(row()).toBe('pointer');
  const panel = open(view, { button: -1, clientX: 0, clientY: 0 });
  expect(row()).toBe('keyboard');
  expect(Number.parseFloat(panel.style.left)).toBeCloseTo(editor!.getCaretRect()!.left, 5);
});

test('a keyboard-opened menu with no painted caret opens at the document corner', async () => {
  const view = mount();
  await placeCaret(3);
  for (const page of view.container.querySelectorAll('.docx-page-content')) {
    page.classList.remove('docx-page-content');
  }
  expect(editor!.getCaretRect()).toBeNull();
  const panel = open(view, { button: -1, clientX: 0, clientY: 0 });
  expect(Number.parseFloat(panel.style.left)).toBe(16);
  expect(Number.parseFloat(panel.style.top)).toBe(16);
  expect(seen.at(-1)?.trigger).toBe('keyboard');
});
