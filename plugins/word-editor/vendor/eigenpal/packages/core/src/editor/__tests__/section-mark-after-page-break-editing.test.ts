// An empty section mark after a page break: kept on the break's sheet, still editable, and
// derived again after every edit, undo, and reopen.

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

const SECTION =
  '<w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>';

const BODY =
  '<w:p><w:r><w:t>First</w:t></w:r></w:p>' +
  '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
  `<w:p><w:pPr><w:sectPr>${SECTION}</w:sectPr></w:pPr></w:p>` +
  '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
  `<w:sectPr>${SECTION}</w:sectPr>`;

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

/** Every paragraph fragment as page, box, and text: comparable across sessions. */
const geometry = (layout: SemanticLayout) =>
  layout.pages.map((page) =>
    page.fragments.map((fragment) => ({
      box: fragment.box,
      text:
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text)).join('')
          : fragment.kind,
    }))
  );

const markPage = (editor: DocxEditorInstance): number | undefined => {
  const mark = editor.surface!.session.paragraphIds()[2]!;
  return caretAt(editor.surface!.layout(), { paragraphId: mark, offset: 0 })?.pageIndex;
};

const placeCaretInMark = (editor: DocxEditorInstance): void => {
  const mark = editor.surface!.session.paragraphIds()[2]!;
  editor.surface!.setSelection({
    anchor: { paragraphId: mark, offset: 0 },
    head: { paragraphId: mark, offset: 0 },
  });
};

describe('an empty section mark after a page break in the editor', () => {
  test('stays on the sheet the break closed and remains a caret target', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      expect(editor.surface!.layout().pages).toHaveLength(2);
      expect(markPage(editor)).toBe(0);
      placeCaretInMark(editor);
      expect(editor.surface!.state().selection.head.paragraphId).toBe(
        editor.surface!.session.paragraphIds()[2]
      );
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('typing into the mark gives it its own sheet, and undo removes that sheet', () => {
    const { editor, container } = mount(docx(BODY));
    try {
      placeCaretInMark(editor);
      expect(editor.exec({ type: 'insertText', text: 'x' })).toMatchObject({ ok: true });
      expect(editor.surface!.layout().pages).toHaveLength(3);
      expect(markPage(editor)).toBe(1);
      editor.exec({ type: 'undo' });
      expect(editor.surface!.layout().pages).toHaveLength(2);
      expect(markPage(editor)).toBe(0);
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
      placeCaretInMark(editor);
      editor.exec({ type: 'insertText', text: 'x' });
      editor.exec({ type: 'undo' });
      retained = geometry(editor.surface!.layout());
      saved = editor.surface!.save();
    } finally {
      editor.destroy();
      container.remove();
    }
    const xml = new TextDecoder().decode(unzipSync(saved)['word/document.xml']!);
    // The mark paragraph and the break both survive the save.
    expect(xml.match(/<w:p[ >]/g)?.length).toBe(4);
    expect(xml.match(/<w:sectPr[ >]/g)?.length).toBe(2);
    expect(xml).toContain('w:type="page"');
    const reopened = mount(saved);
    try {
      expect(geometry(reopened.editor.surface!.layout())).toEqual(retained);
      expect(markPage(reopened.editor)).toBe(0);
    } finally {
      reopened.editor.destroy();
      reopened.container.remove();
    }
  });
});
