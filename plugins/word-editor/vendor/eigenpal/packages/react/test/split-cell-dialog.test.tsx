// The Split cells dialog: opened from the table context menu, checked live against the
// engine, applied as one split, and dismissed with Escape.

import './dom-setup.ts';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';

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

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const TABLE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr></w:tbl><w:p/>`
);

// A1 is merged over three rows, so it splits only into one or three rows.
const THREE_ROW_MERGE = docx(
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p('B2')}</w:tc></w:tr>` +
    `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p('B3')}</w:tc></w:tr></w:tbl><w:p/>`
);

function mount(source: Uint8Array): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
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
        <ContextMenu t={(key: string) => key} />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function caretInFirstCell(editor: DocxEditorInstance): void {
  act(() => {
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
  });
}

function openDialog(view: ReturnType<typeof render>): HTMLDialogElement {
  const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface')!;
  act(() => {
    fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
  });
  const row = view.container.querySelector<HTMLElement>(
    '.docx-contextmenu [data-slot="table.splitCell"]'
  );
  expect(row).not.toBeNull();
  expect(row!.getAttribute('aria-disabled')).not.toBe('true');
  act(() => {
    fireEvent.click(row!);
  });
  const dialog = view.container.querySelector<HTMLDialogElement>('[data-docx-dialog="splitCell"]');
  expect(dialog).not.toBeNull();
  return dialog!;
}

function field(dialog: HTMLElement, name: 'columns' | 'rows'): HTMLInputElement {
  return dialog.querySelector<HTMLInputElement>(`[data-docx-field="${name}"] input`)!;
}

function apply(dialog: HTMLElement): HTMLButtonElement {
  return dialog.querySelector<HTMLButtonElement>('[data-docx-part="apply"]')!;
}

/** How many cells the table's first row holds. */
function firstRowCells(editor: DocxEditorInstance): number {
  const body = editor.surface!.session.part().root;
  const find = (node: OoxmlNode, kind: string): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === kind) return node;
    for (const child of node.children) {
      const found = find(child, kind);
      if (found) return found;
    }
    return null;
  };
  const row = find(body, 'tableRow');
  if (!row || row.kind === 'textValue') return 0;
  return row.children.filter((child) => child.kind === 'tableCell').length;
}

afterEach(cleanup);

describe('Split cells dialog', () => {
  test('at a caret, Merge cells is disabled and says it needs a cell selection', () => {
    const { view, editor } = mount(TABLE);
    caretInFirstCell(editor());
    const surface = view.container.querySelector<HTMLElement>('.docx-paginated-surface')!;
    act(() => {
      fireEvent.contextMenu(surface, { clientX: 120, clientY: 140, button: 2 });
    });
    const merge = view.container.querySelector<HTMLElement>(
      '.docx-contextmenu [data-slot="table.mergeCells"]'
    )!;
    expect(merge.getAttribute('aria-disabled')).toBe('true');
    expect(merge.getAttribute('title')).toBe(
      'Select two or more cells to merge them'
    );
  });

  test('opens from the table context menu and splits into the typed columns', () => {
    const { view, editor } = mount(TABLE);
    caretInFirstCell(editor());
    const dialog = openDialog(view);
    expect(field(dialog, 'columns').value).toBe('2');
    expect(field(dialog, 'rows').value).toBe('1');
    expect(apply(dialog).disabled).toBe(false);
    act(() => {
      fireEvent.change(field(dialog, 'columns'), { target: { value: '3' } });
    });
    act(() => {
      fireEvent.click(apply(dialog));
    });
    expect(view.container.querySelector('[data-docx-dialog="splitCell"]')).toBeNull();
    expect(firstRowCells(editor())).toBe(4);
  });

  test('shows the engine reason and disables Split for a count the cell refuses', () => {
    const { view, editor } = mount(THREE_ROW_MERGE);
    caretInFirstCell(editor());
    const dialog = openDialog(view);
    act(() => {
      fireEvent.change(field(dialog, 'columns'), { target: { value: '1' } });
      fireEvent.change(field(dialog, 'rows'), { target: { value: '2' } });
    });
    expect(apply(dialog).disabled).toBe(true);
    expect(dialog.querySelector('[data-docx-part="error"]')!.textContent).toBe(
      'A merged cell splits only into a number of rows that divides evenly into its rows'
    );
    act(() => {
      fireEvent.change(field(dialog, 'rows'), { target: { value: '3' } });
    });
    expect(apply(dialog).disabled).toBe(false);
    expect(dialog.querySelector('[data-docx-part="error"]')!.textContent).toBe('');
  });

  test('a count outside the limits disables Split', () => {
    const { view, editor } = mount(TABLE);
    caretInFirstCell(editor());
    const dialog = openDialog(view);
    act(() => {
      fireEvent.change(field(dialog, 'columns'), { target: { value: '0' } });
    });
    expect(apply(dialog).disabled).toBe(true);
    expect(dialog.querySelector('[data-docx-part="error"]')!.textContent).toBe(
      'Enter a whole number from 1 to 8'
    );
    // Only the field that is out of range reads as invalid.
    expect(field(dialog, 'columns').getAttribute('aria-invalid')).toBe('true');
    expect(field(dialog, 'rows').getAttribute('aria-invalid')).toBeNull();
  });

  test('Escape closes the dialog without splitting', () => {
    const { view, editor } = mount(TABLE);
    caretInFirstCell(editor());
    const dialog = openDialog(view);
    act(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(view.container.querySelector('[data-docx-dialog="splitCell"]')).toBeNull();
    expect(firstRowCells(editor())).toBe(2);
  });
});
