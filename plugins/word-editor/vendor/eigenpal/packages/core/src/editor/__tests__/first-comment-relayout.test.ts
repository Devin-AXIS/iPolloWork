// The first comment in a document adds a comments part and a relationship to the body. That
// package change resets the drawing bundle, and it must not change the layout key of every
// paragraph that holds no drawing and no picture bullet.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(paragraphs: number): Uint8Array {
  const body = Array.from(
    { length: paragraphs },
    (_, index) => `<w:p><w:r><w:t>Paragraph ${index} with a few words of text.</w:t></w:r></w:p>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

test('the first comment lays out only the paragraph it anchors in', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: docx(60),
    author: 'Grace Hopper',
    modules: [stubReviewModule()],
  });
  try {
    const surface = editor.surface;
    if (!surface) throw new Error('surface failed to mount');
    const paragraphId = surface.session.paragraphIds()[30]!;
    surface.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 9 },
    });
    const before = surface.state().perf.fullPasses;
    expect(editor.addComment('First comment').ok).toBe(true);
    surface.layout();
    const perf = surface.state().perf;
    expect(perf.fullPasses).toBe(before);
    expect(perf.placed).toBeLessThan(perf.total / 2);
  } finally {
    editor.destroy();
  }
});
