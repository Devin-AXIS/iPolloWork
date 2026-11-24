// Which right-clicks the document context menu answers.
//
// The menu acts on the document selection, so only the document opens it: the painted pages
// and the canvas around them. Chrome keeps the browser's own menu, its focus, and its
// field's selection. Mounted through the packaged `<DocxEditor>`, because there the link
// popover and the dialogs render next to the pages, inside the content mount.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Visit example today</w:t></w:r></w:p>` +
      `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Color"/><w:enabled/><w:ddList><w:result w:val="1"/><w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/></w:ddList></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMDROPDOWN </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Green</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`
  ),
});
const PID = '/word/document.xml#0.0.0';
const SELECTION = {
  anchor: { paragraphId: PID, offset: 6 },
  head: { paragraphId: PID, offset: 13 },
};

afterEach(cleanup);

async function mount() {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditor
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    />
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  act(() => {
    instance!.surface!.setSelection(SELECTION);
  });
  return { view, editor: () => instance! };
}

const pages = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLElement>('.docx-pages')!;

/** Open the link popover over the selection, the way Ctrl/Cmd+K does. */
function openLinkPopover(view: ReturnType<typeof render>): HTMLInputElement {
  act(() => {
    fireEvent.keyDown(pages(view), { key: 'k', ctrlKey: true, metaKey: true });
  });
  const url = view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
  act(() => {
    url.focus();
    fireEvent.change(url, { target: { value: 'https://example.com' } });
  });
  url.setSelectionRange(0, 5);
  return url;
}

/** Dispatch a right-click, or the keyboard's context-menu key when `keyboard` is set. */
function rightClick(target: Element, keyboard = false): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: keyboard ? -1 : 2,
    clientX: keyboard ? 0 : 120,
    clientY: keyboard ? 0 : 140,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const menu = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLElement>('[role="menu"].docx-contextmenu');

test('the link popover renders inside the content mount, beside the pages', async () => {
  const { view } = await mount();
  const url = openLinkPopover(view);
  expect(url.closest('.docx-content-mount')).not.toBeNull();
  expect(url.closest('.docx-paginated-surface')).toBeNull();
});

test('a right-click in the link URL field keeps the browser menu, focus and selection', async () => {
  const { view, editor } = await mount();
  const url = openLinkPopover(view);
  const before = JSON.stringify(editor().surface!.session.part().root);
  const event = rightClick(url);
  expect(event.defaultPrevented).toBe(false);
  expect(menu(view)).toBeNull();
  expect(document.activeElement).toBe(url);
  expect(url.value).toBe('https://example.com');
  expect([url.selectionStart, url.selectionEnd]).toEqual([0, 5]);
  expect(view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
  expect(editor().surface!.state().selection).toEqual(SELECTION);
  expect(JSON.stringify(editor().surface!.session.part().root)).toBe(before);
});

test('the context-menu key in the URL field keeps the browser menu', async () => {
  const { view } = await mount();
  const url = openLinkPopover(view);
  expect(rightClick(url, true).defaultPrevented).toBe(false);
  expect(menu(view)).toBeNull();
  expect(document.activeElement).toBe(url);
});

test('the popover panel and its buttons keep the browser menu', async () => {
  const { view } = await mount();
  const url = openLinkPopover(view);
  for (const target of [
    view.getByTestId('hyperlink-popup'),
    view.getByTestId('hyperlink-popup-cancel'),
  ]) {
    expect(rightClick(target).defaultPrevented).toBe(false);
    expect(menu(view)).toBeNull();
    expect(document.activeElement).toBe(url);
  }
});

test('a dialog keeps the browser menu', async () => {
  const { view } = await mount();
  act(() => {
    fireEvent.keyDown(pages(view), { key: 'F5', ctrlKey: true, shiftKey: true });
  });
  const dialog = view.getByRole('dialog', { name: 'Bookmark' });
  expect(dialog.closest('.docx-content-mount')).not.toBeNull();
  const label = dialog.querySelector('label')!;
  expect(rightClick(label).defaultPrevented).toBe(false);
  expect(rightClick(dialog).defaultPrevented).toBe(false);
  expect(menu(view)).toBeNull();
});

test('the pages and the canvas around them still open the document menu', async () => {
  const { view } = await mount();
  expect(rightClick(pages(view)).defaultPrevented).toBe(true);
  expect(menu(view)).not.toBeNull();
  act(() => {
    fireEvent.keyDown(document, { key: 'Escape' });
  });
  expect(menu(view)).toBeNull();
  const canvas = view.getByTestId('docx-editor-scroll');
  expect(rightClick(canvas).defaultPrevented).toBe(true);
  expect(menu(view)).not.toBeNull();
});

test('painted text, a painted drop-down field, and the mount beside the page open it', async () => {
  const { view } = await mount();
  const select = view.container.querySelector('.docx-pages select[data-docx-form-dropdown]');
  expect(select).not.toBeNull();
  const targets = [
    view.container.querySelector('.docx-pages [data-start]')!,
    select!,
    view.container.querySelector('.docx-content-mount')!,
  ];
  for (const target of targets) {
    expect(rightClick(target).defaultPrevented).toBe(true);
    expect(menu(view)).not.toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
  }
});

test('a right-click on the open menu keeps it in place and suppresses the browser menu', async () => {
  const { view } = await mount();
  rightClick(pages(view));
  const panel = menu(view)!;
  const { left, top } = panel.style;
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 400,
    clientY: 300,
  });
  act(() => {
    panel.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(menu(view)).toBe(panel);
  expect([panel.style.left, panel.style.top]).toEqual([left, top]);
});
