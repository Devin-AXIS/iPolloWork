// Live edits inside merges that cover the same rows.
//
// Two heads that start and end in the same rows share one span. An edit that makes either
// head taller or shorter re-plans the span from the tree, so the incremental layout, undo and
// a cold reopen of the saved file all give the same rows.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { caretAt } from '../../layout/semantic-interaction.ts';
import type { TableFragmentRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const RESTART = '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>';
const CONTINUE = '<w:tcPr><w:vMerge/></w:tcPr>';

const SHARED_SPAN_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/>' +
  '</w:tblGrid>' +
  `<w:tr><w:tc>${p('S0')}</w:tc><w:tc>${RESTART}${p('A0')}${p('A1')}</w:tc>` +
  `<w:tc>${RESTART}${p('B0')}${p('B1')}${p('B2')}${p('B3')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('S1')}</w:tc><w:tc>${CONTINUE}<w:p/></w:tc>` +
  `<w:tc>${CONTINUE}<w:p/></w:tc></w:tr></w:tbl>${p('After')}`;

const liveEditors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  while (liveEditors.length > 0) liveEditors.pop()?.destroy();
  while (containers.length > 0) containers.pop()?.remove();
  document.getSelection()?.removeAllRanges();
});

function packageOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({ container, document: bytes });
  if (!editor.surface) throw new Error('surface failed to mount');
  liveEditors.push(editor);
  return editor;
}

function paragraphByText(editor: DocxEditorInstance, text: string): string {
  for (const id of editor.surface!.session.paragraphIds()) {
    if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
  }
  throw new Error(`paragraph ${text} not found`);
}

function tableOf(editor: DocxEditorInstance): TableFragmentRecord {
  const table = editor
    .surface!.layout()
    .pages[0]!.fragments.find((fragment) => fragment.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('no table fragment');
  return table;
}

const rowHeights = (table: TableFragmentRecord): number[] =>
  table.rows.map((row) => row.box.height);

describe('merges that cover the same rows, edited live', () => {
  test('an edit re-plans the shared span, and undo and reopen agree with it', () => {
    const editor = mount(packageOf(SHARED_SPAN_TABLE));
    const before = tableOf(editor);
    const initial = rowHeights(before);
    // The head row holds only its side cell; the four-line head is carried by both rows.
    expect(initial[0]!).toBeLessThan(initial[1]!);

    // Grow the SHORTER head past the taller one: it now decides the span.
    let last = paragraphByText(editor, 'A1');
    for (const text of ['A2', 'A3', 'A4', 'A5']) {
      editor.surface!.setSelection({
        head: { paragraphId: last, offset: 2 },
        anchor: { paragraphId: last, offset: 2 },
      });
      editor.surface!.splitParagraph();
      expect(editor.exec({ type: 'insertText', text }).ok).toBe(true);
      last = paragraphByText(editor, text);
    }
    const edited = tableOf(editor);
    const grown = rowHeights(edited);
    expect(grown[0]).toBe(initial[0]);
    expect(grown[1]!).toBeGreaterThan(initial[1]!);
    const head = edited.rows[0]!.cells[1]!;
    expect(head.rowSpan).toBe(2);
    expect(head.box.height).toBe(edited.box.height);

    // The caret at the end of the new last line paints inside the merged cell.
    const caret = caretAt(editor.surface!.layout(), { paragraphId: last, offset: 2 })!;
    expect(caret).not.toBeNull();
    expect(caret.y).toBeGreaterThanOrEqual(head.box.y);
    expect(caret.y + caret.height).toBeLessThanOrEqual(head.box.y + head.box.height + 0.001);

    // A cold open of the saved file plans the same rows as the incremental pass did.
    const reopened = mount(editor.surface!.session.save());
    expect(rowHeights(tableOf(reopened))).toEqual(grown);

    for (let step = 0; step < 20 && editor.can({ type: 'undo' }).ok; step += 1) {
      editor.exec({ type: 'undo' });
    }
    expect(rowHeights(tableOf(editor))).toEqual(initial);
  });
});
