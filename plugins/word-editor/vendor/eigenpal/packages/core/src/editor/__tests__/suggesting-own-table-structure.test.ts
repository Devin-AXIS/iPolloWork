// Merge and split while suggesting: they track inside the author's own proposed table, where the
// new structure joins that insertion, and stay refused in any other table.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { SUGGESTING_CELL_STRUCTURE_REFUSAL } from '../table-cell-structure-plan.ts';
import { docx, selectCellRectangle } from './paginated-surface-fixtures.ts';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const PLAIN_TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('a')}</w:tc><w:tc>${p('b')}</w:tc></w:tr></w:tbl>${p('after')}`;

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function suggesting(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body), author: 'Writer' });
  if (!editor.surface) throw new Error('surface failed to mount');
  editors.push(editor);
  editor.surface.setEditingMode('suggest');
  return editor;
}

async function documentXml(editor: DocxEditorInstance): Promise<string> {
  return strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
}

test('merge and split track inside the author own proposed table', async () => {
  const editor = suggesting(p('after'));
  expect(editor.exec({ type: 'insertTable', rows: 2, cols: 2 }).ok).toBe(true);

  selectCellRectangle(editor.surface!, { row: 0, column: 0 }, { row: 0, column: 1 });
  expect(editor.can({ type: 'mergeCells' })).toEqual({ ok: true });
  expect(editor.exec({ type: 'mergeCells' }).ok).toBe(true);
  let xml = await documentXml(editor);
  expect(xml).toContain('<w:gridSpan w:val="2"/>');

  selectCellRectangle(editor.surface!, { row: 1, column: 0 }, { row: 1, column: 0 });
  expect(editor.exec({ type: 'splitCell', rows: 2, cols: 1 }).ok).toBe(true);
  xml = await documentXml(editor);
  const rows = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
  expect(rows).toHaveLength(3);
  // Every row, the split's new one too, is part of the author's proposed insertion.
  for (const row of rows) expect(row).toMatch(/<w:trPr><w:ins [^>]*w:author="Writer"/);
});

test('merge and split stay refused in a table that is not a proposal', () => {
  const editor = suggesting(PLAIN_TABLE);
  selectCellRectangle(editor.surface!, { row: 0, column: 0 }, { row: 0, column: 1 });
  expect(editor.can({ type: 'mergeCells' })).toMatchObject({
    ok: false,
    reason: SUGGESTING_CELL_STRUCTURE_REFUSAL,
  });
  expect(editor.exec({ type: 'mergeCells' }).ok).toBe(false);
});
