// DocxEditor.BookmarkDialog against the real engine: the Insert menu opens it, the list sorts
// by name or location and shows hidden bookmarks on request, Add bookmarks the selection and
// closes, Delete removes the named bookmark, Go To selects it, and invalid names explain why.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';
import { DocxEditorBookmarkDialog } from '../src/editor/DocxEditorBookmark.tsx';
import type { DocxEditorPopups } from '../src/editor/popup-config.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
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
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx(
  '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r><w:bookmarkStart w:id="1" w:name="Zeta"/>' +
    '<w:r><w:t>beta</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
    '<w:p><w:bookmarkStart w:id="2" w:name="_Toc1"/><w:r><w:t>Delta</w:t></w:r>' +
    '<w:bookmarkEnd w:id="2"/><w:bookmarkStart w:id="3" w:name="alpha"/><w:bookmarkEnd w:id="3"/></w:p>'
);

function mount(
  children: ReactNode,
  options: { popups?: DocxEditorPopups; document?: Uint8Array } = {}
) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={options.document ?? SOURCE}
      {...(options.popups ? { popups: options.popups } : {})}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {children}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

async function click(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function type(element: Element, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

const names = (editor: DocxEditorInstance) =>
  editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.name);

function listOptions(view: ReturnType<typeof render>): string[] {
  const list = view.getByLabelText('Bookmarks') as HTMLSelectElement;
  return [...list.options].map((option) => option.value);
}

afterEach(() => cleanup());

describe('DocxEditor.BookmarkDialog', () => {
  test('the Insert menu opens the dialog, and Add bookmarks the selection and closes', async () => {
    const { view, editor } = mount(<DocxEditorMenu />);
    await settle();
    const trigger = [
      ...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
    ].find((button) => button.textContent === 'Insert')!;
    await click(trigger);
    const row = view.container.querySelector<HTMLElement>('[data-slot="insert.bookmark"]')!;
    expect(row.getAttribute('aria-disabled')).not.toBe('true');
    expect(row.textContent).toContain('Bookmark');
    await act(async () => {
      const surface = editor().surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 0 },
        head: { paragraphId, offset: 5 },
      });
    });
    await click(row);
    const dialog = view.getByRole('dialog', { name: 'Bookmark' });
    expect(dialog.getAttribute('data-docx-dialog')).toBe('bookmark');
    await type(view.getByLabelText('Bookmark name'), 'Intro');
    await click(view.getByText('Add'));
    expect(view.queryByRole('dialog', { name: 'Bookmark' })).toBeNull();
    expect(names(editor())).toEqual(['Intro', 'Zeta', '_Toc1', 'alpha']);
  });

  test('the list sorts by name or location and shows hidden bookmarks on request', async () => {
    const { view } = mount(<DocxEditorBookmarkDialog open onClose={() => {}} />);
    await settle();
    expect(listOptions(view)).toEqual(['alpha', 'Zeta']);
    await click(view.getByLabelText('Location'));
    expect(listOptions(view)).toEqual(['Zeta', 'alpha']);
    await click(view.getByLabelText('Hidden bookmarks'));
    expect(listOptions(view)).toEqual(['Zeta', '_Toc1', 'alpha']);
  });

  test('invalid names disable Add and say why; an existing name explains the move', async () => {
    const { view } = mount(<DocxEditorBookmarkDialog open onClose={() => {}} />);
    await settle();
    const add = view.getByText('Add') as HTMLButtonElement;
    const input = view.getByLabelText('Bookmark name');
    await type(input, '1st');
    expect(add.disabled).toBe(true);
    expect(view.getByText('A bookmark name starts with a letter.')).toBeTruthy();
    await type(input, 'two words');
    expect(view.getByText('Use only letters, digits, and underscores.')).toBeTruthy();
    await type(input, '_hidden');
    expect(add.disabled).toBe(true);
    await type(input, 'ZETA');
    expect(add.disabled).toBe(false);
    expect(
      view.getByText('A bookmark with this name exists. Add moves it to the selection.')
    ).toBeTruthy();
    expect((input as HTMLInputElement).maxLength).toBe(40);
  });

  test('Delete removes the picked bookmark, and Go To selects one and keeps the dialog', async () => {
    let closed = 0;
    const { view, editor } = mount(<DocxEditorBookmarkDialog open onClose={() => (closed += 1)} />);
    await settle();
    const list = view.getByLabelText('Bookmarks');
    await type(list, 'Zeta');
    expect((view.getByLabelText('Bookmark name') as HTMLInputElement).value).toBe('Zeta');
    await click(view.getByText('Go To'));
    const selection = editor().surface!.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 10]);
    expect(closed).toBe(0);
    expect(view.getByText('Close')).toBeTruthy();
    await click(view.getByText('Delete'));
    expect(names(editor())).toEqual(['_Toc1', 'alpha']);
    expect(listOptions(view)).toEqual(['alpha']);
  });

  test('Ctrl+Shift+F5 opens the dialog where the editor hosts its dialogs', async () => {
    const { view, editor } = mount(<DocxEditorMenu />);
    await settle();
    const pages = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!;
    await act(async () => {
      const surface = editor().surface!;
      const paragraphId = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId, offset: 7 },
        head: { paragraphId, offset: 7 },
      });
    });
    await act(async () => {
      fireEvent.keyDown(pages, { key: 'F5', ctrlKey: true, shiftKey: true });
    });
    expect(view.getByRole('dialog', { name: 'Bookmark' })).toBeTruthy();
    // Opened inside a bookmark, the dialog names it.
    expect((view.getByLabelText('Bookmark name') as HTMLInputElement).value).toBe('Zeta');
  });
  test('the bookmark popup is replaceable, can be turned off, and opens by command', async () => {
    const custom = mount(<DocxEditorMenu />, {
      popups: {
        bookmark: ({ onClose }) => <div role="dialog" aria-label="Mine" onClick={onClose} />,
      },
    });
    await settle();
    await act(async () => {
      expect(custom.editor().exec({ type: 'openBookmarkDialog' }).ok).toBe(true);
    });
    expect(custom.view.getByRole('dialog', { name: 'Mine' })).toBeTruthy();
    expect(custom.view.queryByRole('dialog', { name: 'Bookmark' })).toBeNull();
    cleanup();

    const off = mount(<DocxEditorMenu />, { popups: { bookmark: false } });
    await settle();
    expect(off.editor().can({ type: 'openBookmarkDialog' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    const trigger = [
      ...off.view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger'),
    ].find((button) => button.textContent === 'Insert')!;
    await click(trigger);
    const row = off.view.container.querySelector<HTMLElement>('[data-slot="insert.bookmark"]')!;
    expect(row.getAttribute('aria-disabled')).toBe('true');
  });

  test('a name with copies says so, and Keep first removes them', async () => {
    const copies = docx(
      '<w:p><w:bookmarkStart w:id="1" w:name="Same"/><w:r><w:t>one</w:t></w:r>' +
        '<w:bookmarkEnd w:id="1"/><w:r><w:t xml:space="preserve"> </w:t></w:r>' +
        '<w:bookmarkStart w:id="2" w:name="SAME"/><w:r><w:t>two</w:t></w:r>' +
        '<w:bookmarkEnd w:id="2"/></w:p>'
    );
    const { view, editor } = mount(<DocxEditorBookmarkDialog open onClose={() => {}} />, {
      document: copies,
    });
    await settle();
    await type(view.getByLabelText('Bookmarks'), 'Same');
    expect(
      view.getByText('1 other place uses this name. Links and Go To use the first.')
    ).toBeTruthy();
    await click(view.getByText('Keep first'));
    expect(editor().query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 0 }]);
    expect(view.queryByText('Keep first')).toBeNull();
  });
});
