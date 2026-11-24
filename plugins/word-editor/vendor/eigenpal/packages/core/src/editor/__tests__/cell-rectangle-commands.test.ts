// A CELL RECTANGLE IS NOT THE RANGE IT STANDS IN FOR.
//
// Read as a text range, a selected column runs through every cell between its corners in
// document order — which is how centring the left column of a 2x2 table also centred the
// column beside it. Read as one anchor, a two-row rectangle is one row — which is how Delete
// Rows removed one of them and answered `ok: true`. Every command that acts on a rectangle
// has to ask the rectangle what it covers.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { PaginatedSurface } from '../paginated-surface.ts';
import { selectCellRectangle } from './paginated-surface-fixtures.ts';
import { findNode, paragraphTextOf } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const tc = (c: string) => `<w:tc>${c}</w:tc>`;
const tr = (c: string) => `<w:tr>${c}</w:tr>`;
const GRID2 =
  '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>';
const GRID3 =
  '<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>';
const TABLE_2X2 = `<w:tbl>${GRID2}${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`;
const TABLE_3X2 =
  `<w:tbl>${GRID2}${tr(tc(p('A1')) + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}` +
  `${tr(tc(p('A3')) + tc(p('B3')))}</w:tbl>`;
const TABLE_2X3 =
  `<w:tbl>${GRID3}${tr(tc(p('A1')) + tc(p('B1')) + tc(p('C1')))}` +
  `${tr(tc(p('A2')) + tc(p('B2')) + tc(p('C2')))}</w:tbl>`;

function docxOf(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mountEditor(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docxOf(body), author: 'Grace Hopper' });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function allText(surface: PaginatedSurface): string[] {
  return surface.session.paragraphIds().map((id) => paragraphTextOf(surface.session.part(), id));
}

/** The `w:jc/@w:val` a paragraph authors itself, or null. */
function alignmentOf(surface: PaginatedSurface, text: string): string | null {
  const id = surface.session
    .paragraphIds()
    .find((candidate) => paragraphTextOf(surface.session.part(), candidate) === text);
  const node = id ? findNode(surface.session.part(), id) : null;
  if (!node || node.kind === 'textValue') return null;
  const named = (child: unknown, name: string): boolean =>
    (child as { localName?: string }).localName === name;
  const pPr = node.children.find((child) => child.kind !== 'textValue' && named(child, 'pPr'));
  if (!pPr || pPr.kind === 'textValue') return null;
  const jc = pPr.children.find((child) => child.kind !== 'textValue' && named(child, 'jc'));
  if (!jc || jc.kind === 'textValue') return null;
  const attributes = jc.attributes as readonly { localName: string; value: string }[];
  return attributes.find((attribute) => attribute.localName === 'val')?.value ?? null;
}

describe('a paragraph command over a cell rectangle', () => {
  test('centres the selected column and leaves the one beside it alone', () => {
    const editor = mountEditor(TABLE_2X2 + p('after'));
    try {
      const surface = editor.surface!;
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 0 });
      expect(surface.state().cellSelection?.cellIds).toHaveLength(2);
      surface.setParagraphProperty('jc', { val: 'center' });
      expect(alignmentOf(surface, 'A1')).toBe('center');
      expect(alignmentOf(surface, 'A2')).toBe('center');
      expect(alignmentOf(surface, 'B1')).toBeNull();
      expect(alignmentOf(surface, 'B2')).toBeNull();
      expect(alignmentOf(surface, 'after')).toBeNull();
      // Word keeps the cells selected afterwards, exactly as it does after Bold.
      expect(surface.state().cellSelection?.cellIds).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  });
});

describe('deleting over a cell rectangle', () => {
  test('Delete Rows removes every row the rectangle covers', () => {
    const editor = mountEditor(TABLE_3X2 + p('after'));
    try {
      const surface = editor.surface!;
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      expect(surface.state().cellSelection?.cellIds).toHaveLength(4);
      expect(editor.exec({ type: 'deleteRow' }).ok).toBe(true);
      expect(allText(surface)).toEqual(['A3', 'B3', 'after']);
    } finally {
      editor.destroy();
    }
  });

  test('Delete Columns removes every column the rectangle covers', () => {
    const editor = mountEditor(TABLE_2X3 + p('after'));
    try {
      const surface = editor.surface!;
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      expect(surface.state().cellSelection?.cellIds).toHaveLength(4);
      expect(editor.exec({ type: 'deleteColumn' }).ok).toBe(true);
      expect(allText(surface)).toEqual(['C1', 'C2', 'after']);
    } finally {
      editor.destroy();
    }
  });

  test('a rectangle over EVERY row deletes the table, as Word does', () => {
    // A table must keep one row, so the last `deleteTableRow` is refused — and a refusal
    // takes the whole transaction, which is how selecting every row came to delete nothing.
    const editor = mountEditor(TABLE_2X2 + p('after'));
    try {
      const surface = editor.surface!;
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      expect(editor.exec({ type: 'deleteRow' }).ok).toBe(true);
      expect(allText(surface)).toEqual(['after']);
    } finally {
      editor.destroy();
    }
  });

  test('and a rectangle over every COLUMN does the same', () => {
    const editor = mountEditor(TABLE_2X2 + p('after'));
    try {
      const surface = editor.surface!;
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
      expect(editor.exec({ type: 'deleteColumn' }).ok).toBe(true);
      expect(allText(surface)).toEqual(['after']);
    } finally {
      editor.destroy();
    }
  });

  test('a proposed replacement over a single EMPTY cell is accepted, as typing is', () => {
    // One empty cell mirrors a COLLAPSED text range, but the rectangle still covers a cell
    // the user selected — `can` and `exec` must both take it, exactly as the keyboard does.
    const table = `<w:tbl>${GRID2}${tr(tc('<w:p/>') + tc(p('B1')))}${tr(tc(p('A2')) + tc(p('B2')))}</w:tbl>`;
    const editor = mountEditor(table + p('after'));
    try {
      const surface = editor.surface!;
      selectCellRectangle(surface, { row: 0, column: 0 }, { row: 0, column: 0 });
      const command = { type: 'proposeReplacement' as const, replaceWith: 'X' };
      expect(editor.can(command)).toEqual({ ok: true });
      expect(editor.exec(command)).toMatchObject({ ok: true, changed: true });
      expect(allText(surface)).toEqual(['X', 'B1', 'A2', 'B2', 'after']);
    } finally {
      editor.destroy();
    }
  });

  test('and an ordinary caret still deletes exactly one row', () => {
    const editor = mountEditor(TABLE_3X2 + p('after'));
    try {
      const surface = editor.surface!;
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 0 },
      });
      expect(editor.exec({ type: 'deleteRow' }).ok).toBe(true);
      expect(allText(surface)).toEqual(['A2', 'B2', 'A3', 'B3', 'after']);
    } finally {
      editor.destroy();
    }
  });
});
