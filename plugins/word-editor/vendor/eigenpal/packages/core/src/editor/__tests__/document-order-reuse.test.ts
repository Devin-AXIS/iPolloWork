// Every layout has a paragraph order, and a keystroke publishes a new layout. The order of a
// long document is kept while its pages list the same paragraphs, and is built again when an
// edit adds or removes one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { documentOrder, documentOrderIndex } from '../../layout/document-order.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(): Uint8Array {
  const body: string[] = [];
  for (let index = 0; index < 120; index += 1)
    body.push(`<w:p><w:r><w:t>Paragraph ${index} with some words to wrap.</w:t></w:r></w:p>`);
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body.join('')}</w:body></w:document>`
    ),
  });
}

test('a keystroke keeps the paragraph order, and a new paragraph rebuilds it', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx() });
  try {
    const surface = editor.surface!;
    const caret = (index: number, offset: number) => {
      const paragraphId = surface.session.paragraphIds()[index]!;
      surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
    };
    const first = surface.layout();
    const order = documentOrder(first);
    const index = documentOrderIndex(first);
    expect(order).toEqual([...surface.session.paragraphIds()]);

    caret(60, 3);
    surface.type('x');
    const typed = surface.layout();
    expect(typed).not.toBe(first);
    expect(documentOrder(typed)).toBe(order);
    expect(documentOrderIndex(typed)).toBe(index);

    caret(60, 5);
    surface.splitParagraph();
    const split = surface.layout();
    expect(documentOrder(split)).not.toBe(order);
    expect(documentOrder(split)).toEqual([...surface.session.paragraphIds()]);
    expect(documentOrderIndex(split).size).toBe(order.length + 1);
  } finally {
    editor.destroy();
    container.remove();
  }
});
