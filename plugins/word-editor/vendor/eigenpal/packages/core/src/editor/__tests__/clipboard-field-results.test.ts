// Copying a selection that holds a computed field (issue #1245).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

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

let mounted: { editor: DocxEditorInstance; container: HTMLElement } | null = null;
afterEach(() => {
  mounted?.editor.destroy();
  mounted?.container.remove();
  mounted = null;
});

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  mounted = { editor, container };
  return editor;
}

const complexDate =
  '<w:p><w:r><w:t xml:space="preserve">On </w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> DATE \\@ "MMMM d, yyyy" </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>January 2, 2020</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  '<w:r><w:t xml:space="preserve"> ok</w:t></w:r></w:p>';

/** Select the first paragraph whole; the surface clamps the head to its end. */
function selectAll(editor: DocxEditorInstance): void {
  const paragraphId = paragraphIdAt(editor, 0);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 1e6 },
  });
}

function paragraphIdAt(editor: DocxEditorInstance, index: number): string {
  const ids: string[] = [];
  for (const page of editor.surface!.layout().pages)
    for (const fragment of page.fragments)
      if (fragment.kind === 'paragraph' && !ids.includes(fragment.paragraphId))
        ids.push(fragment.paragraphId);
  return ids[index]!;
}

test('a selected complex field copies its whole result', () => {
  const editor = mount(complexDate);
  selectAll(editor);
  expect(editor.surface!.copyFlavours().text).toBe('On January 2, 2020 ok');
  expect(editor.surface!.selectedText()).toBe('On January 2, 2020 ok');
});

test('a range that stops before the field copies none of it', () => {
  const editor = mount(complexDate);
  const paragraphId = paragraphIdAt(editor, 0);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 3 },
  });
  expect(editor.surface!.copyFlavours().text).toBe('On ');
});

test('a simple field copies its whole result', () => {
  const editor = mount(
    '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r>' +
      '<w:fldSimple w:instr=" REF target "><w:r><w:t>Section 12</w:t></w:r></w:fldSimple>' +
      '<w:r><w:t>.</w:t></w:r></w:p>'
  );
  selectAll(editor);
  expect(editor.surface!.copyFlavours().text).toBe('See Section 12.');
});

test('a result that wraps onto the next line copies once, in order', () => {
  const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa '.repeat(4).trim();
  const editor = mount(
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> REF target </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      `<w:r><w:t>${long}</w:t></w:r>` +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
  );
  selectAll(editor);
  expect(editor.surface!.copyFlavours().text).toBe(long);
});

test('a repeated footer copies one field result occurrence', () => {
  const body =
    '<w:p><w:r><w:t>One</w:t><w:br w:type="page"/>' +
    '<w:t>Two</w:t><w:br w:type="page"/><w:t>Three</w:t></w:r></w:p>';
  const entries = unzipSync(docx(body));
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  entries['[Content_Types].xml'] = strToU8(
    new TextDecoder()
      .decode(entries['[Content_Types].xml'])
      .replace(
        '</Types>',
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
      )
  );
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
      '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>' +
      '</w:body></w:document>'
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdFooter" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
  );
  entries['word/footer1.xml'] = strToU8(
    `<w:ftr xmlns:w="${W}"><w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>` +
      '<w:r><w:t xml:space="preserve"> of </w:t></w:r>' +
      '<w:fldSimple w:instr="NUMPAGES"><w:r><w:t>3</w:t></w:r></w:fldSimple></w:p></w:ftr>'
  );
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: zipSync(entries) });
  mounted = { editor, container };
  const surface = editor.surface!;
  expect(surface.layout().pages).toHaveLength(3);
  expect(surface.enterHeaderFooter({ rId: 'rIdFooter', pageIndex: 0 })).toBe(true);
  surface.selectAll();
  expect(surface.copyFlavours().text).toBe('1 of 3');
  expect(surface.selectedText()).toBe('1 of 3');
});
