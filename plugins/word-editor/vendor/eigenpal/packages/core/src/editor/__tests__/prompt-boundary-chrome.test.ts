import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const prompt =
  '<w:sdt><w:sdtPr><w:tag w:val="prompt"/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
  '<w:sdtContent><w:r><w:t>Click here to enter text.</w:t></w:r></w:sdtContent></w:sdt>';
const paragraph = '<w:p><w:r><w:t>A </w:t></w:r>' + prompt + '<w:r><w:t> B</w:t></w:r></w:p>';
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
function mount(body: string) {
  const document = zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
  const editor = createDocxEditor({
    document,
    container: globalThis.document.createElement('div'),
  });
  editors.push(editor);
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[0]!;
  surface.setSelection({ anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 10 } });
  surface.type('Z');
  return surface;
}

test('typing outside a preserved prompt leaves its control inactive', () => {
  const surface = mount(paragraph);
  expect(surface.state().contentControls.activeControlId).toBeNull();
  surface.type('Y');
  expect(surface.state().contentControls.activeControlId).toBeNull();
  const position = surface.state().selection.head;
  surface.setSelection({ anchor: position, head: position });
  expect(surface.state().contentControls.activeControlId).toBe(
    surface.layout().contentControls!.find((control) => control.tag === 'prompt')!.id
  );
});

test('an enclosing control stays active while its nested prompt stays inactive', () => {
  const surface = mount(
    '<w:sdt><w:sdtPr><w:tag w:val="outer"/><w:richText/></w:sdtPr><w:sdtContent>' +
      paragraph +
      '</w:sdtContent></w:sdt>'
  );
  const outer = surface.layout().contentControls!.find((control) => control.tag === 'outer')!;
  expect(surface.state().contentControls.activeControlId).toBe(outer.id);
  surface.type('Y');
  expect(surface.state().contentControls.activeControlId).toBe(outer.id);
});
