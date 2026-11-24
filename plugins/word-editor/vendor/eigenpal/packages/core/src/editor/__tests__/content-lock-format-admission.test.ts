// `can` answers a formatting command over a content lock before the write, and agrees with it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { ContentLockPolicy } from '../../store/package/ooxml-edit.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** A free paragraph, then a paragraph inside a `contentLocked` block control. */
const BODY =
  '<w:p><w:r><w:t>free text</w:t></w:r></w:p>' +
  '<w:sdt><w:sdtPr><w:tag w:val="block"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>' +
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>locked text</w:t></w:r></w:p>' +
  '</w:sdtContent></w:sdt>';

/** "ab" [2,5) "PIL" "cd": an inline `contentLocked` pill. */
const PILL =
  '<w:p><w:r><w:t>ab</w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="pill"/>' +
  '<w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>PIL</w:t></w:r>' +
  '</w:sdtContent></w:sdt><w:r><w:t>cd</w:t></w:r></w:p>';

function mount(
  contentLockPolicy?: ContentLockPolicy,
  body = BODY,
  extra: { readonly mode?: 'suggesting'; readonly author?: string } = {}
): DocxEditorInstance {
  const bytes = zipSync({
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
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    ...(contentLockPolicy ? { contentLockPolicy } : {}),
    ...extra,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

const at = (editor: DocxEditorInstance, index: number, offset: number) => ({
  paragraphId: editor.surface!.session.paragraphIds()[index]!,
  offset,
});

test('a range that ends at the start of a locked paragraph formats the free text', () => {
  const editor = mount();
  editor.surface!.setSelection({ anchor: at(editor, 0, 0), head: at(editor, 1, 0) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  editor.destroy();
});

test('a range into the locked paragraph is refused before the write', () => {
  const editor = mount();
  editor.surface!.setSelection({ anchor: at(editor, 0, 0), head: at(editor, 1, 3) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  editor.destroy();
});

test('the eraser at a caret in a locked paragraph is refused before the write', () => {
  const editor = mount();
  const caret = at(editor, 1, 2);
  editor.surface!.setSelection({ anchor: caret, head: caret });
  expect(editor.can({ type: 'clearFormatting' })).toMatchObject({ ok: false, code: 'locked' });
  // Typing is refused here too, so arming a run format for it is refused as well.
  expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: false });
  editor.destroy();
});

test('the formatting policy lets run formats through, but not the paragraph eraser', () => {
  const editor = mount({ allowFormattingInLockedContent: true });
  editor.surface!.setSelection({ anchor: at(editor, 1, 0), head: at(editor, 1, 6) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  expect(editor.can({ type: 'clearFormatting' })).toMatchObject({ ok: false, code: 'locked' });
  editor.destroy();
});

test('a caret inside a locked pill refuses run formats; a caret at its edge does not', () => {
  const editor = mount(undefined, PILL);
  const inside = at(editor, 0, 3);
  editor.surface!.setSelection({ anchor: inside, head: inside });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: false });
  const edge = at(editor, 0, 5);
  editor.surface!.setSelection({ anchor: edge, head: edge });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  editor.destroy();
});

test('the formatting policy does not arm a format at a caret inside a locked pill', () => {
  const editor = mount({ allowFormattingInLockedContent: true }, PILL);
  const inside = at(editor, 0, 3);
  editor.surface!.setSelection({ anchor: inside, head: inside });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: false });
  editor.surface!.setSelection({ anchor: at(editor, 0, 0), head: at(editor, 0, 7) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' }).ok).toBe(true);
  editor.destroy();
});

test('in suggesting mode the formatting policy does not pass a tracked restyle', () => {
  const editor = mount({ allowFormattingInLockedContent: true }, PILL, { author: 'Reviewer' });
  editor.surface!.setEditingMode('suggest');
  expect(editor.surface!.editingMode()).toBe('suggest');
  editor.surface!.setSelection({ anchor: at(editor, 0, 0), head: at(editor, 0, 7) });
  expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toMatchObject({
    ok: false,
    code: 'locked',
  });
  editor.destroy();
});
