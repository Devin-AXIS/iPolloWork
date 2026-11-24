// The image overlay asks for the selected drawing after every change and selection change,
// which means after every keystroke. Typing defers the layout pass so a burst of keys lands
// once; the overlay's question must not land it per key when no drawing is selected.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedDrawingOverlayTargetOf } from '../drawing-overlay-target.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Some text</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

test('asking for the selected drawing while typing leaves the layout pass deferred', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx() });
  try {
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset: 4 }, head: { paragraphId, offset: 4 } });
    surface.type('x');
    const layout = surface.layout.bind(surface);
    let landed = 0;
    surface.layout = () => {
      landed += 1;
      return layout();
    };
    expect(selectedDrawingOverlayTargetOf(surface)).toBeNull();
    expect(landed).toBe(0);
  } finally {
    editor.destroy();
    container.remove();
  }
});
