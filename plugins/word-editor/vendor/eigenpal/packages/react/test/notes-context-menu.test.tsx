// One right-click opens one menu, and the note menu closes when the user moves on.
//
// Mounted through the packaged `<DocxEditor>`, where the document context menu and the note
// chrome both listen on the scroller. A press in the note being edited opens the document menu
// only. A press on another note, or on a reference mark in the body, opens the note menu only.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const note = (id: number, text: string) =>
  `<w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote>`;

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="${WML}.footnotes+xml"/></Types>`
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Body</w:t></w:r>` +
      `<w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>` +
      `<w:sectPr/></w:body></w:document>`
  ),
  'word/footnotes.xml': strToU8(
    `<w:footnotes xmlns:w="${W}">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `${note(1, 'First note.')}${note(2, 'Second note.')}</w:footnotes>`
  ),
});

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
  return { view, editor: () => instance! };
}

const noteArea = (view: ReturnType<typeof render>, scopeId: string) =>
  view.container.querySelector<HTMLElement>(`[data-docx-note][data-docx-note-scope="${scopeId}"]`)!;

const noteMenu = (view: ReturnType<typeof render>) => view.queryByTestId('docx-notes-menu');
const documentMenu = (view: ReturnType<typeof render>) =>
  view.baseElement.querySelector('.docx-contextmenu');

async function rightClick(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 40, clientY: 40 });
  });
}

test('a right-click in the note being edited opens the document menu only', async () => {
  const { view, editor } = await mount();
  await act(async () => {
    editor().setActiveScope({ kind: 'note', id: 'footnote:1' });
  });
  await rightClick(noteArea(view, 'footnote:1'));
  expect(noteMenu(view)).toBeNull();
  expect(documentMenu(view)).not.toBeNull();
});

test('a right-click on a note that is not being edited opens the note menu only', async () => {
  const { view, editor } = await mount();
  await act(async () => {
    editor().setActiveScope({ kind: 'note', id: 'footnote:1' });
  });
  await rightClick(noteArea(view, 'footnote:2'));
  expect(noteMenu(view)).not.toBeNull();
  expect(documentMenu(view)).toBeNull();
});

test('a right-click on a reference mark in the body opens the note menu only', async () => {
  const { view } = await mount();
  await rightClick(view.container.querySelector<HTMLElement>('[data-docx-note-ref]')!);
  expect(noteMenu(view)).not.toBeNull();
  expect(documentMenu(view)).toBeNull();
  // The chrome that holds the menu is not hidden from assistive technology while it is open.
  expect(noteMenu(view)!.closest('[aria-hidden="true"]')).toBeNull();
});

test('the note menu closes on a press outside, on Escape, and on a scroll', async () => {
  const { view } = await mount();
  const area = noteArea(view, 'footnote:1');

  await rightClick(area);
  expect(noteMenu(view)).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(view.container.querySelector('.docx-pages')!);
  });
  expect(noteMenu(view)).toBeNull();

  await rightClick(area);
  await act(async () => {
    fireEvent.keyDown(view.baseElement.ownerDocument.body, { key: 'Escape' });
  });
  expect(noteMenu(view)).toBeNull();

  await rightClick(area);
  await act(async () => {
    fireEvent.scroll(view.container.querySelector('.docx-editor__scroll-container')!);
  });
  expect(noteMenu(view)).toBeNull();
});

test('the note menu is a styled, keyboard-operable list that closes when it opens a dialog', async () => {
  const { view } = await mount();
  await rightClick(noteArea(view, 'footnote:1'));
  const menu = noteMenu(view)!;
  expect(menu.classList.contains('docx-notes-menu')).toBe(true);
  expect(menu.getAttribute('aria-label')).toBe('Note actions');
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(items.every((item) => item.classList.contains('docx-hf-chrome__menu-item'))).toBe(true);

  // The first enabled row has focus, and the arrow keys move between rows.
  const enabled = items.filter((item) => !item.disabled);
  expect(menu.ownerDocument.activeElement).toBe(enabled[0]!);
  await act(async () => {
    fireEvent.keyDown(menu, { key: 'End' });
  });
  expect(menu.ownerDocument.activeElement).toBe(enabled.at(-1)!);

  await act(async () => {
    fireEvent.click(view.getByTestId('docx-notes-menu-properties'));
  });
  expect(noteMenu(view)).toBeNull();
});
