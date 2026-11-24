// Live insert-row inside a vertical merge (issue #57).
//
// The store repeats `w:vMerge`, so the painted grid keeps one cell per column on every row
// and the covering cell grows by one row instead of a phantom cell appearing.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import type { TableFragmentRecord } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const MERGED_COLUMN_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p('MERGED')}</w:tc>` +
  `<w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p('B2')}</w:tc></w:tr>` +
  `<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc>${p('B3')}</w:tc></w:tr></w:tbl>`;

const liveEditors: DocxEditorInstance[] = [];

afterEach(() => {
  while (liveEditors.length > 0) {
    liveEditors.pop()?.destroy();
  }
  document.getSelection()?.removeAllRanges();
  for (const node of [...document.body.children]) {
    if (node instanceof HTMLElement && node.querySelector('.docx-pages')) {
      node.remove();
    }
  }
});

function mount(body: string): DocxEditorInstance {
  const doc = zipSync({
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
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: doc });
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

function caret(editor: DocxEditorInstance, paragraphId: string): void {
  editor.surface!.setSelection({
    head: { paragraphId, offset: 1 },
    anchor: { paragraphId, offset: 1 },
  });
}

function tableOf(editor: DocxEditorInstance): TableFragmentRecord {
  for (const page of editor.surface!.layout().pages) {
    const table = page.fragments.find((fragment) => fragment.kind === 'table');
    if (table && table.kind === 'table') return table;
  }
  throw new Error('no table fragment');
}

/** Grid columns each painted row covers, so a phantom cell shows up as a changed shape. */
function gridShape(table: TableFragmentRecord): number[][] {
  return table.rows.map((row) => row.cells.map((cell) => cell.gridColumn));
}

function coveringRowSpan(table: TableFragmentRecord): number | undefined {
  return table.rows[0]!.cells[0]!.rowSpan;
}

describe('insertRow inside a vertical merge', () => {
  test('grows the covering cell instead of severing the merge', () => {
    const editor = mount(MERGED_COLUMN_TABLE);
    expect(gridShape(tableOf(editor))).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect(coveringRowSpan(tableOf(editor))).toBe(3);

    caret(editor, paragraphByText(editor, 'B2'));
    const command = { type: 'insertRow', where: 'below' } as const;
    expect(editor.can(command).ok).toBe(true);
    expect(editor.exec(command).ok).toBe(true);

    const after = tableOf(editor);
    expect(gridShape(after)).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect(coveringRowSpan(after)).toBe(4);
    expect(after.rows[2]!.cells[0]!.vMergeContinue).toBe(true);
    expect(after.rows[2]!.cells[1]!.vMergeContinue).toBe(false);
  });

  test('leaves the merge alone when the new row lands past its last row', () => {
    const editor = mount(MERGED_COLUMN_TABLE);
    caret(editor, paragraphByText(editor, 'B3'));
    const command = { type: 'insertRow', where: 'below' } as const;
    expect(editor.exec(command).ok).toBe(true);

    const after = tableOf(editor);
    expect(gridShape(after)).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect(coveringRowSpan(after)).toBe(3);
    expect(after.rows[3]!.cells[0]!.vMergeContinue).toBe(false);
  });
});
