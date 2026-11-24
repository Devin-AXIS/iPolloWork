import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { PNG_1X1 } from './image-decode-harness.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const cleaners: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleaners.splice(0)) clean();
});

/** A picture whose `a:` prefix is bound only on `a:graphic`, as DOCX applications write it. */
function pictureDocx(): Uint8Array {
  const graphic =
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">` +
    '<pic:nvPicPr><pic:cNvPr id="0" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId5"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}"><w:body><w:p><w:r><w:drawing>` +
    '<wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/>' +
    `<wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing></w:r></w:p></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId5" Type="${R}/image" Target="media/p.png"/></Relationships>`
    ),
    'word/media/p.png': PNG_1X1,
    'word/document.xml': strToU8(document),
  });
}

function mount(bytes: Uint8Array): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  cleaners.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

function selectPicture(editor: DocxEditorInstance): void {
  const surface = editor.surface!;
  const ids: string[] = [];
  const walk = (node: { kind: string; id: string; children?: readonly unknown[] }) => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'drawing') ids.push(node.id);
    for (const child of (node.children ?? []) as (typeof node)[]) walk(child);
  };
  walk(surface.session.part().root as never);
  surface.selectDrawing(ids[0]!, surface.session.paragraphIds()[0]!);
}

test('a picture whose a: prefix is bound on a:graphic takes a hyperlink that survives reopen', async () => {
  const editor = mount(pictureDocx());
  selectPicture(editor);
  const result = editor.exec({ type: 'setImageProperties', hyperlink: 'https://example.com/' });
  expect(result.ok).toBe(true);
  const reopened = mount(new Uint8Array(await editor.save()));
  selectPicture(reopened);
  expect(reopened.getSelectedImage()?.hyperlink).toBe('https://example.com/');
});
