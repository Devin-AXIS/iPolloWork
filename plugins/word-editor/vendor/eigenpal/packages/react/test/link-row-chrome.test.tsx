// The Insert link row and the toolbar Link button need a link UI to open.
//
// A link needs a target, and only a link UI can supply one: the packaged popover, or a host's
// own through `setHyperlinkChrome`. With none registered, both controls are disabled with a
// reason, rather than enabled and doing nothing. With a host's own UI, both open that UI,
// exactly as Ctrl/Cmd+K does.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { useHyperlinkPopup } from '../src/editor/useHyperlinkPopup.ts';

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
const PID = '/word/document.xml#0.0.0';

afterEach(cleanup);

async function mount(hyperlinkPopup: boolean) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditor
      document={SOURCE}
      hyperlinkPopup={hyperlinkPopup}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    />
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  act(() => {
    instance!.surface!.setSelection({
      anchor: { paragraphId: PID, offset: 6 },
      head: { paragraphId: PID, offset: 13 },
    });
  });
  return { view, editor: () => instance! };
}

function openContextMenu(view: ReturnType<typeof render>): HTMLElement {
  act(() => {
    fireEvent.contextMenu(view.container.querySelector('.docx-paginated-surface')!, {
      clientX: 120,
      clientY: 140,
      button: 2,
    });
  });
  return view.container.querySelector<HTMLElement>('[role="menu"] [data-slot="text.link"]')!;
}

const toolbarLink = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLButtonElement>('button[data-slot="text.link"]')!;

test('with the packaged popover, the row and the button are enabled', async () => {
  const { view } = await mount(true);
  expect(toolbarLink(view).disabled).toBe(false);
  expect(openContextMenu(view).getAttribute('aria-disabled')).toBeNull();
});

test('without a link UI, the row and the button are disabled with a reason', async () => {
  const { view } = await mount(false);
  const button = toolbarLink(view);
  expect(button.disabled).toBe(true);
  expect(button.title).toBe("Links can't be added here");
  const row = openContextMenu(view);
  expect(row.getAttribute('aria-disabled')).toBe('true');
  expect(row.title).toBe("Links can't be added here");
  act(() => {
    fireEvent.click(row);
  });
  expect(view.queryByTestId('hyperlink-popup')).toBeNull();
  // Nothing could open, so Ctrl/Cmd+K is left to the browser.
  const key = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    view.container.querySelector('.docx-pages')!.dispatchEvent(key);
  });
  expect(key.defaultPrevented).toBe(false);
});

test("a host's own link UI enables both controls, and they open it", async () => {
  const { view, editor } = await mount(false);
  let requests = 0;
  let unregister: () => void = () => undefined;
  act(() => {
    unregister = editor().setHyperlinkChrome({ onRequest: () => (requests += 1) });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  const button = toolbarLink(view);
  expect(button.disabled).toBe(false);
  act(() => {
    fireEvent.click(button);
  });
  expect(requests).toBe(1);
  const row = openContextMenu(view);
  expect(row.getAttribute('aria-disabled')).toBeNull();
  act(() => {
    fireEvent.click(row);
  });
  expect(requests).toBe(2);
  expect(view.container.querySelector('[role="menu"].docx-contextmenu')).toBeNull();
  expect(view.queryByTestId('hyperlink-popup')).toBeNull();

  act(() => unregister());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(toolbarLink(view).disabled).toBe(true);
});

function HostLinkPanel() {
  const { state } = useHyperlinkPopup();
  return <output data-testid="host-link-panel">{state.mode}</output>;
}

test('a host panel that reads useHyperlinkPopup() keeps the controls working', async () => {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.Link />
      </DocxEditorToolbar>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  // No link panel yet: nothing could show the link, so the button is disabled.
  expect(toolbarLink(view).disabled).toBe(true);
  view.rerender(
    <DocxEditorRoot document={SOURCE}>
      <DocxEditorToolbar preset={false} overflow={false}>
        <DocxEditorToolbar.Link />
      </DocxEditorToolbar>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      <HostLinkPanel />
    </DocxEditorRoot>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  act(() => {
    instance!.surface!.setSelection({
      anchor: { paragraphId: PID, offset: 6 },
      head: { paragraphId: PID, offset: 13 },
    });
  });
  const button = toolbarLink(view);
  expect(button.disabled).toBe(false);
  act(() => {
    fireEvent.click(button);
  });
  expect(view.getByTestId('host-link-panel').textContent).toBe('editing');
});
