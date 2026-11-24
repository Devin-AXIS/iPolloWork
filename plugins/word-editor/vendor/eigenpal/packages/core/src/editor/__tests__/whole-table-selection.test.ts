// Whole-table deletion: Backspace on a whole-table selection, and the suggesting-mode routes
// that used to remove a table without a tracked change.

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import type { EditorCommand } from '../../contracts/editor.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { SUGGESTING_TABLE_DELETE_REFUSAL } from '../surface-suggesting-structure.ts';
import { docx, selectCellRectangle } from './paginated-surface-fixtures.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const BODY =
  '<w:p><w:r><w:t>before</w:t></w:r></w:p>' +
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell('a1')}${cell('a2')}</w:tr><w:tr>${cell('b1')}${cell('b2')}</w:tr></w:tbl>` +
  '<w:p><w:r><w:t>after</w:t></w:r></w:p>';

function mount(mode: 'editing' | 'suggesting') {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(BODY),
    author: 'Reviewer',
    modules: [reviewModule()],
  });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  expect(editor.setEditingMode(mode)).toMatchObject({ ok: true });
  const surface = editor.surface!;
  const caretIn = (index: number) => {
    const paragraphId = surface.session.paragraphIds()[index]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
  };
  const body = async () => {
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    return xml.replace(/.*<w:body>/s, '').replace(/<w:sectPr.*/s, '');
  };
  return { editor, surface, caretIn, body };
}

describe('Backspace on a whole-table selection', () => {
  test('deletes the table, and Delete only empties it', async () => {
    const backspace = mount('editing');
    selectCellRectangle(backspace.surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    backspace.surface.deleteBackward();
    const removed = await backspace.body();
    expect(removed).not.toContain('<w:tbl>');
    expect(removed).toContain('before');
    expect(removed).toContain('after');

    const del = mount('editing');
    selectCellRectangle(del.surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    del.surface.deleteForward();
    const emptied = await del.body();
    expect(emptied).toContain('<w:tbl>');
    expect(emptied).not.toContain('a1');
  });

  test('a partial rectangle still only empties its cells', async () => {
    const { surface, body } = mount('editing');
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 0 });
    surface.deleteBackward();
    const xml = await body();
    expect(xml).toContain('<w:tbl>');
    expect(xml).not.toContain('a1');
    expect(xml).toContain('a2');
  });

  test('suggesting strikes the cell text and keeps the table', async () => {
    const { surface, body } = mount('suggesting');
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    surface.deleteBackward();
    const xml = await body();
    expect(xml).toContain('<w:tbl>');
    for (const text of ['a1', 'a2', 'b1', 'b2'])
      expect(xml).toMatch(new RegExp(`<w:del [^>]*><w:r><w:delText>${text}</w:delText>`));
  });
});

describe('suggesting mode never deletes a whole table untracked', () => {
  const refused: readonly { name: string; command: EditorCommand; wholeRect: boolean }[] = [
    { name: 'deleteTable', command: { type: 'deleteTable' }, wholeRect: false },
    { name: 'deleteRow with every row', command: { type: 'deleteRow' }, wholeRect: true },
    { name: 'deleteColumn with every column', command: { type: 'deleteColumn' }, wholeRect: true },
  ];
  for (const { name, command, wholeRect } of refused) {
    test(`${name} is refused with a reason`, async () => {
      const { editor, surface, caretIn, body } = mount('suggesting');
      const before = await body();
      caretIn(1);
      if (wholeRect) selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      expect(editor.can(command)).toEqual({
        ok: false,
        code: 'unsupported',
        reason: SUGGESTING_TABLE_DELETE_REFUSAL,
      });
      expect(editor.exec(command)).toMatchObject({ ok: false });
      expect(await body()).toBe(before);
    });
  }

  test('deleteTable still deletes the table outside suggesting mode', async () => {
    const { editor, caretIn, body } = mount('editing');
    caretIn(1);
    expect(editor.exec({ type: 'deleteTable' })).toMatchObject({ ok: true });
    expect(await body()).not.toContain('<w:tbl>');
  });

  test('a range that encloses the table strikes its text and keeps the table', async () => {
    const { surface, body } = mount('suggesting');
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[0]!, offset: 'before'.length },
      head: { paragraphId: ids.at(-1)!, offset: 0 },
    });
    surface.deleteBackward();
    const xml = await body();
    expect(xml).toContain('<w:tbl>');
    for (const text of ['a1', 'a2', 'b1', 'b2'])
      expect(xml).toMatch(new RegExp(`<w:del [^>]*><w:r><w:delText>${text}</w:delText>`));
    expect(xml).toContain('<w:t>before</w:t>');
    expect(xml).toContain('<w:t>after</w:t>');
  });
});

describe('selectTableRegion', () => {
  test("'table' selects every cell and changes nothing", async () => {
    const { editor, surface, caretIn, body } = mount('editing');
    const before = await body();
    caretIn(1);
    expect(editor.can({ type: 'selectTableRegion', region: 'table' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'selectTableRegion', region: 'table' })).toEqual({
      ok: true,
      changed: false,
    });
    expect(surface.state().cellSelection?.cellIds).toHaveLength(4);
    expect(await body()).toBe(before);
  });

  test('works in view and suggesting modes', () => {
    for (const mode of ['viewing', 'suggesting'] as const) {
      const { editor, surface, caretIn } = mount('editing');
      caretIn(1);
      editor.setEditingMode(mode);
      expect(editor.exec({ type: 'selectTableRegion', region: 'table' })).toMatchObject({
        ok: true,
      });
      expect(surface.state().cellSelection?.cellIds).toHaveLength(4);
    }
  });

  test("'row' and 'column' stay refused, and so does a caret outside a table", () => {
    const { editor, caretIn } = mount('editing');
    caretIn(1);
    for (const region of ['row', 'column'] as const)
      expect(editor.can({ type: 'selectTableRegion', region })).toMatchObject({
        ok: false,
        code: 'unsupported',
      });
    caretIn(0);
    expect(editor.exec({ type: 'selectTableRegion', region: 'table' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
  });
});
