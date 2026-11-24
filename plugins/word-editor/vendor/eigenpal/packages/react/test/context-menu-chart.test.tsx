// The context menu's Edit chart row: present only while a chart is selected, and a press
// asks for the Chart pane, as a double press on the chart does.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { takePaneRequest, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';
import { usePaneRequest } from '../src/editor/panes/SidePanel.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
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

/** A host that shows its side panel on request, as the charts guide shows. */
function PaneHost() {
  usePaneRequest(() => {});
  return null;
}

function insertChart(editor: DocxEditorInstance): void {
  const paragraph = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 5 },
      head: { paragraphId: paragraph, offset: 5 },
    });
    expect(editor.exec({ type: 'insertChart', chartType: 'pie' }).ok).toBe(true);
  });
}

afterEach(cleanup);

function mount(withPane = true) {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <ContextMenu t={t} />
      </DocxEditorViewport>
      {withPane ? <PaneHost /> : null}
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function openMenu(view: ReturnType<typeof render>): void {
  const scroller = view.container.querySelector<HTMLElement>('.docx-editor__scroll-container');
  if (!scroller) throw new Error('no scroll container');
  act(() => {
    fireEvent.contextMenu(scroller, { clientX: 120, clientY: 140, button: 2 });
  });
}

const editChartRow = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLElement>('.docx-contextmenu [data-slot="image.editChart"]');

test('Edit chart shows only for a selected chart and asks for the Chart pane', () => {
  const { view, editor } = mount();
  openMenu(view);
  expect(editChartRow(view)).toBeNull();
  act(() => {
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  insertChart(editor());
  expect(editor().snapshot().chart).not.toBeNull();
  takePaneRequest(editor());

  openMenu(view);
  const row = editChartRow(view);
  expect(row?.textContent).toContain('chart.edit');
  act(() => {
    row!.click();
  });
  expect(takePaneRequest(editor())?.pane).toBe('chart');
});

test('Edit chart stays out of the menu when the host shows no chart pane', () => {
  const { view, editor } = mount(false);
  insertChart(editor());
  expect(editor().snapshot().chart).not.toBeNull();
  openMenu(view);
  expect(view.container.querySelector('.docx-contextmenu')).not.toBeNull();
  expect(editChartRow(view)).toBeNull();
});
