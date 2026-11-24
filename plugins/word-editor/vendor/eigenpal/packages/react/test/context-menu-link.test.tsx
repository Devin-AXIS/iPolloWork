// The context menu's Insert link row: it opens the same popover as the toolbar button and
// Ctrl/Cmd+K, because a link needs a target and only the popover can supply one.

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
import { DocxEditorHyperLink } from '../src/editor/DocxEditorHyperLink.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';

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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Visit example today</w:t></w:r></w:p></w:body></w:document>`
  ),
});
const LINKED = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Visit </w:t></w:r>` +
      '<w:hyperlink w:anchor="target"><w:r><w:t>example</w:t></w:r></w:hyperlink>' +
      '<w:r><w:t xml:space="preserve"> today</w:t></w:r></w:p></w:body></w:document>'
  ),
});
const PID = '/word/document.xml#0.0.0';
const t = (key: string): string => key;

afterEach(cleanup);

function mount(source: Uint8Array = SOURCE, menuChildren?: ReactNode) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorHyperLink />
        <ContextMenu t={t}>{menuChildren}</ContextMenu>
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function selectAndRightClick(mounted: ReturnType<typeof mount>): void {
  act(() => {
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId: PID, offset: 6 },
      head: { paragraphId: PID, offset: 13 },
    });
  });
  act(() => {
    const surface = mounted.view.container.querySelector('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
}

const linkRow = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLElement>('[role="menu"] [data-slot="text.link"]');

test('the row is enabled and opens the link popover for the selection', () => {
  const mounted = mount();
  selectAndRightClick(mounted);
  const row = linkRow(mounted.view)!;
  expect(row).not.toBeNull();
  expect(row.getAttribute('aria-disabled')).toBeNull();
  act(() => {
    fireEvent.click(row);
  });
  expect(mounted.view.container.querySelector('[role="menu"]')).toBeNull();
  expect(mounted.view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
  const text = mounted.view.getByTestId('hyperlink-popup-text') as HTMLInputElement;
  expect(text.value).toBe('example');
});

test('in viewing mode the row is disabled, with the translated engine reason', () => {
  const mounted = mount();
  act(() => {
    mounted.editor().exec({ type: 'setEditingMode', mode: 'viewing' });
  });
  selectAndRightClick(mounted);
  const row = linkRow(mounted.view)!;
  expect(row.getAttribute('aria-disabled')).toBe('true');
  expect(row.getAttribute('title')).toBe('disabledReason.viewing');
  act(() => {
    fireEvent.click(row);
  });
  expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
});

test('ContextMenu.Slot for text.link replaces the packaged row with the same working row', () => {
  const mounted = mount(SOURCE, <ContextMenu.Slot slotId="text.link" className="host-link-row" />);
  selectAndRightClick(mounted);
  const rows = mounted.view.container.querySelectorAll<HTMLElement>(
    '[role="menu"] [data-slot="text.link"]'
  );
  expect(rows.length).toBe(1);
  const row = rows[0]!;
  expect(row.classList.contains('host-link-row')).toBe(true);
  expect(row.getAttribute('aria-disabled')).toBeNull();
  expect(row.textContent).toContain('formattingBar.insertLink');
  act(() => {
    fireEvent.click(row);
  });
  expect(mounted.view.getByTestId('hyperlink-popup').dataset.mode).toBe('editing');
});

test('on an existing link the row says Edit link and opens the edit panel', () => {
  const mounted = mount(LINKED);
  act(() => {
    mounted.editor().surface!.setSelection({
      anchor: { paragraphId: PID, offset: 8 },
      head: { paragraphId: PID, offset: 8 },
    });
  });
  act(() => {
    const surface = mounted.view.container.querySelector('.docx-paginated-surface')!;
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  const row = linkRow(mounted.view)!;
  expect(row.textContent).toContain('hyperlinkPopup.editLink');
  expect(row.textContent).not.toContain('formattingBar.insertLink');
  act(() => {
    fireEvent.click(row);
  });
  const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
  expect(url.value).toBe('#target');
});

describe('closing the popover returns focus to the document', () => {
  function openFromMenu() {
    const mounted = mount();
    selectAndRightClick(mounted);
    act(() => {
      fireEvent.click(linkRow(mounted.view)!);
    });
    const url = mounted.view.getByTestId('hyperlink-popup-url-input') as HTMLInputElement;
    expect(document.activeElement).toBe(url);
    const pages = mounted.view.container.querySelector<HTMLElement>('.docx-pages')!;
    return { mounted, url, pages };
  }

  test('Escape: focus goes back to the pages, and the selection stays', () => {
    const { mounted, url, pages } = openFromMenu();
    const before = mounted.editor().surface!.state().selection;
    act(() => {
      fireEvent.keyDown(url, { key: 'Escape' });
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
    expect(document.activeElement).toBe(pages);
    expect(mounted.editor().surface!.state().selection).toEqual(before);
  });

  test('Enter applies the link and focus goes back to the pages', () => {
    const { mounted, url, pages } = openFromMenu();
    act(() => {
      fireEvent.change(url, { target: { value: 'https://example.com/a' } });
    });
    act(() => {
      fireEvent.keyDown(url, { key: 'Enter' });
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
    expect(document.activeElement).toBe(pages);
    expect(mounted.editor().surface!.hyperlinks.linkAtCaret()?.href).toBe('https://example.com/a');
  });

  test('Cancel: focus goes back to the pages', () => {
    const { mounted, pages } = openFromMenu();
    act(() => {
      fireEvent.click(mounted.view.getByTestId('hyperlink-popup-cancel'));
    });
    expect(mounted.view.queryByTestId('hyperlink-popup')).toBeNull();
    expect(document.activeElement).toBe(pages);
  });

  test('a refused target keeps the panel open with focus in the field', () => {
    const { mounted, url } = openFromMenu();
    act(() => {
      fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });
    });
    act(() => {
      fireEvent.keyDown(url, { key: 'Enter' });
    });
    expect(mounted.view.getByTestId('hyperlink-popup-error')).not.toBeNull();
    expect(document.activeElement).toBe(url);
  });
});
