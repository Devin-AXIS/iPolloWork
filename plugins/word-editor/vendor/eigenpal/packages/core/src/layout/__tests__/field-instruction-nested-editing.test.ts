import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

// Editing around a field whose instruction holds nested simple fields. The nested results
// paint nothing and Find does not match them, but every model unit stays addressable: the
// caret, selection, typing, undo, and save/reopen all see the offsets the store assigns, and a
// retained layout equals a fresh one.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, strFromU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';
import { caretAt } from '../semantic-interaction.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const run = (content: string) => `<w:r>${content}</w:r>`;
const text = (value: string) => run(`<w:t xml:space="preserve">${value}</w:t>`);
const instr = (value: string) => run(`<w:instrText xml:space="preserve">${value}</w:instrText>`);
const marker = (type: string) => run(`<w:fldChar w:fldCharType="${type}"/>`);
const styleRef = (result: string) =>
  `<w:fldSimple w:instr=" STYLEREF Heading ">${result}</w:fldSimple>`;
const FIELD =
  marker('begin') +
  instr(' IF ') +
  styleRef(run('<w:t>nested</w:t><w:cr/>')) +
  instr(' &lt;&gt; "x" ') +
  styleRef(run('<w:cr/>')) +
  marker('separate') +
  text('shown') +
  marker('end');
/** The same conditional as the saved result of a simple field. */
const SIMPLE_FIELD = `<w:fldSimple w:instr=" QUOTE x ">${FIELD}</w:fldSimple>`;

function docx(field = FIELD): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>` +
        `<w:p>${text('Before ')}${field}${text(' after')}</w:p>` +
        '<w:p><w:r><w:t>Next</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
  });
}

const open: DocxEditorInstance[] = [];

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy();
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: bytes });
  open.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const fragments = (editor: DocxEditorInstance) =>
  editor
    .surface!.layout()
    .pages.flatMap((page) => page.fragments)
    .filter((fragment) => fragment.kind === 'paragraph');
const lines = (editor: DocxEditorInstance) =>
  fragments(editor).map((fragment) =>
    fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
  );
const geometry = (editor: DocxEditorInstance) =>
  fragments(editor).map((fragment) => ({
    box: fragment.box,
    lines: fragment.lines.map((line) => ({
      box: line.box,
      spans: line.spans.map((span) => [span.text, span.start, span.end]),
    })),
  }));

function placeCaret(editor: DocxEditorInstance, offset: number): void {
  const surface = editor.surface!;
  const point = { paragraphId: surface.session.paragraphIds()[0]!, offset };
  surface.setSelection({ anchor: point, head: point });
}

describe('editing around nested instruction fields', () => {
  test('the field paragraph lays out as one line of displayed text', () => {
    const editor = mount(docx());
    expect(lines(editor)).toEqual([['Before shown after'], ['Next']]);
  });

  test('the caret places after the field at the store offset', () => {
    const editor = mount(docx());
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    // "Before " (7) + the field atom (1) + two nested simple atoms (2) + " after" (6).
    const end = 16;
    const caret = caretAt(editor.surface!.layout(), { paragraphId, offset: end });
    expect(caret).not.toBeNull();
    placeCaret(editor, end);
    editor.surface!.type('!');
    expect(lines(editor)[0]).toEqual(['Before shown after!']);
  });

  test('typing, undo, redo, and save/reopen keep the nested fields', async () => {
    const editor = mount(docx());
    const original = geometry(editor);
    placeCaret(editor, 3);
    editor.surface!.type('X');
    expect(lines(editor)[0]).toEqual(['BefXore shown after']);

    const saved = new Uint8Array(await editor.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(xml.match(/<w:fldSimple w:instr=" STYLEREF Heading ">/g)?.length).toBe(2);
    // The reopened (fresh) layout equals the edited (retained) one.
    expect(geometry(mount(saved))).toEqual(geometry(editor));

    editor.surface!.undo();
    expect(geometry(editor)).toEqual(original);
    editor.surface!.redo();
    expect(lines(editor)[0]).toEqual(['BefXore shown after']);
  });

  test('Find skips nested results and selects the matched model range', () => {
    const editor = mount(docx());
    expect(editor.findMatches('nested')).toEqual([]);
    const [match] = editor.findMatches('shown after');
    // The match covers the field atom, both nested atoms, and " after".
    expect(match).toMatchObject({ start: 7, length: 9, text: 'shown after' });
    expect(editor.selectMatch(match!).ok).toBe(true);
    const { anchor, head } = editor.surface!.state().selection;
    expect([anchor.offset, head.offset].sort((left, right) => left - right)).toEqual([7, 16]);
    // The Find context shows displayed text only.
    expect(editor.findMatches('after')[0]?.contextBefore).toBe('Before shown ');
  });
});

describe('editing around a simple field whose saved result holds the same field', () => {
  test('the paragraph lays out as one line of displayed text', () => {
    const editor = mount(docx(SIMPLE_FIELD));
    expect(lines(editor)).toEqual([['Before shown after'], ['Next']]);
    expect(editor.findMatches('nested')).toEqual([]);
  });

  test('typing after the field, undo, and save/reopen keep the source', async () => {
    const editor = mount(docx(SIMPLE_FIELD));
    const original = geometry(editor);
    // "Before " (7) + the simple field (1) + " after" (6).
    placeCaret(editor, 14);
    editor.surface!.type('!');
    expect(lines(editor)[0]).toEqual(['Before shown after!']);

    const saved = new Uint8Array(await editor.save());
    const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
    expect(xml.match(/<w:fldSimple w:instr=" STYLEREF Heading ">/g)?.length).toBe(2);
    expect(xml).toContain('nested');
    expect(geometry(mount(saved))).toEqual(geometry(editor));

    editor.surface!.undo();
    expect(geometry(editor)).toEqual(original);
  });
});
