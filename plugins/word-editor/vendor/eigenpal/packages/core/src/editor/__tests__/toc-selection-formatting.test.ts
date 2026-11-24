// Formatting a selection that covers a generated table of contents (issue #1223).
//
// The table stays read-only: its generated rows are not formatted. The rest of the selection
// is, so Select All followed by a highlight changes the ordinary text.

import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { detectBodyTocs, serializeOoxmlPart } from '@docx-editor.dev/core/store';

const run = (s: string) => `<w:r><w:t>${s}</w:t></w:r>`;
const begin =
  '<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC \\o "1-1" \\h</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>';
const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const BODY =
  `<w:p>${begin}${run('Entry 1')}</w:p><w:p>${run('Entry 2')}</w:p><w:p>${end}</w:p>` +
  `<w:p>${run('Body text one')}</w:p><w:p>${run('Body text two')}</w:p>`;

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
function mount() {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(BODY) });
  editors.push(editor);
  return { editor, surface: editor.surface! };
}

/** The serialized XML of each paragraph, in document order. */
function paragraphXml(editor: DocxEditorInstance): string[] {
  return serializeOoxmlPart(editor.surface!.session.part()).match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
}

test('a highlight over a selection with a table of contents formats only the other text', () => {
  const { editor, surface } = mount();
  const before = paragraphXml(editor);
  surface.selectAll();
  expect(
    editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' })
  ).toMatchObject({ ok: true });
  const after = paragraphXml(editor);
  // The generated rows are unchanged; the ordinary paragraphs carry the highlight.
  expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
  expect(after[3]).toContain('w:highlight');
  expect(after[4]).toContain('w:highlight');
  expect(detectBodyTocs(surface.session.part())).toHaveLength(1);
  // One undo step removes the whole highlight.
  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  expect(paragraphXml(editor)).toEqual(before);
});

test('a selection inside the table of contents still refuses formatting', () => {
  const { editor, surface } = mount();
  const before = serializeOoxmlPart(surface.session.part());
  const paragraphId = surface.session.paragraphIds()[1]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 5 } });
  editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' });
  expect(surface.state().lastRejection).toBe('the table of contents is generated and read-only');
  expect(serializeOoxmlPart(surface.session.part())).toBe(before);
});
