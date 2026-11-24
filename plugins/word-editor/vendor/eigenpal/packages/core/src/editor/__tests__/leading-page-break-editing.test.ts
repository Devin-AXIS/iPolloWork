// A paragraph that opens with a page break, on a full page: one sheet per break through edits,
// undo, and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { caretAt } from '../../layout/semantic-interaction.ts';
import type { SemanticLayout } from '../../layout/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

// A 648pt content box holds thirty-two 20pt lines and leaves 8pt.
const SECTION =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';
const EXACT =
  '<w:pPr><w:spacing w:before="0" w:after="0" w:line="400" w:lineRule="exact"/></w:pPr>';
const FILL = Array.from(
  { length: 32 },
  (_, line) => `<w:p>${EXACT}<w:r><w:t>line${line}</w:t></w:r></w:p>`
).join('');
const BODY =
  FILL +
  `<w:p>${EXACT}<w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>` +
  `<w:sectPr>${SECTION}</w:sectPr>`;
const BREAK_AT = 32;

function docx(body: string): Uint8Array {
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

function mount(bytes: Uint8Array): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: bytes, mode: 'edit' });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

/** Every fragment as page, box, flow flag and text: comparable across sessions. */
const geometry = (layout: SemanticLayout) =>
  layout.pages.map((page) =>
    page.fragments.map((fragment) => ({
      box: fragment.box,
      outOfFlow: 'outOfFlow' in fragment ? fragment.outOfFlow : undefined,
      text:
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
          : fragment.kind,
    }))
  );

const breakParagraph = (editor: DocxEditorInstance): string =>
  editor.surface!.session.paragraphIds()[BREAK_AT]!;
const pageOf = (editor: DocxEditorInstance, offset: number): number | undefined =>
  caretAt(editor.surface!.layout(), { paragraphId: breakParagraph(editor), offset })?.pageIndex;
const placeCaret = (editor: DocxEditorInstance, offset: number): void => {
  const paragraphId = breakParagraph(editor);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
};

describe('a leading page break on a full page in the editor', () => {
  test('advances one sheet and keeps the caret before the break on the first sheet', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      expect(editor.surface!.layout().pages).toHaveLength(2);
      expect(pageOf(editor, 0)).toBe(0);
      expect(pageOf(editor, 1)).toBe(1);
      placeCaret(editor, 0);
      expect(editor.surface!.state().selection.head).toMatchObject({
        paragraphId: breakParagraph(editor),
        offset: 0,
      });
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('text typed before the break moves with its line, and undo restores one sheet', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      placeCaret(editor, 0);
      expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({ ok: true });
      expect(editor.surface!.layout().pages).toHaveLength(3);
      expect(pageOf(editor, 0)).toBe(1);
      editor.exec({ type: 'undo' });
      expect(editor.surface!.layout().pages).toHaveLength(2);
      expect(pageOf(editor, 0)).toBe(0);
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('edited layout matches a reopened copy of the saved document', () => {
    const { editor, container } = mount(docx(BODY));
    let saved: Uint8Array;
    let retained: ReturnType<typeof geometry>;
    try {
      placeCaret(editor, 1);
      editor.exec({ type: 'insertText', text: 'more ' });
      placeCaret(editor, 0);
      editor.exec({ type: 'insertText', text: 'x' });
      editor.exec({ type: 'undo' });
      retained = geometry(editor.surface!.layout());
      saved = editor.surface!.save();
    } finally {
      editor.destroy();
      container.remove();
    }
    expect(retained).toHaveLength(2);
    const xml = new TextDecoder().decode(unzipSync(saved)['word/document.xml']!);
    // The break stays first in its paragraph, ahead of the typed text.
    expect(xml).toMatch(/<w:br w:type="page"\/><w:t[^>]*>more <\/w:t>/);
    const reopened = mount(saved);
    try {
      expect(geometry(reopened.editor.surface!.layout())).toEqual(retained);
    } finally {
      reopened.editor.destroy();
      reopened.container.remove();
    }
  });
});
