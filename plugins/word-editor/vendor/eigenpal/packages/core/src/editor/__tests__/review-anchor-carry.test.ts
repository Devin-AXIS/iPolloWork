// A keystroke publishes a layout whose pages are the previous objects but the one it changed.
// The card anchors carry over from the previous index with that page's anchors swapped in, and
// must equal the index built from scratch, including a paragraph split across two pages, where
// the first page wins.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { createAnchorIndex } from '../docx-editor-anchors.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function docx(): Uint8Array {
  const body = [
    ...Array.from({ length: 40 }, (_, index) => paragraph(`Line ${index}`)),
    // Long enough to break across a page.
    paragraph(Array.from({ length: 400 }, (_, index) => `word${index}`).join(' ')),
    ...Array.from({ length: 40 }, (_, index) => paragraph(`After ${index}`)),
  ].join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

test('the anchors after a keystroke equal the ones built from scratch', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx() });
  try {
    const surface = editor.surface!;
    const anchors = createAnchorIndex();
    const ids = surface.session.paragraphIds();
    const first = surface.layout();
    expect(first.pages.length).toBeGreaterThan(2);
    let previous = anchors(first);
    // The split paragraph, then a paragraph on a later page, then one on the first page.
    for (const position of [40, 60, 3]) {
      const paragraphId = ids[position]!;
      const at = { paragraphId, offset: 2 };
      surface.setSelection({ anchor: at, head: at });
      surface.type('x');
      const layout = surface.layout();
      const carried = anchors(layout);
      expect(carried).not.toBe(previous);
      expect([...carried.entries()].sort()).toEqual(
        [...createAnchorIndex()(layout).entries()].sort()
      );
      previous = carried;
    }
  } finally {
    editor.destroy();
    container.remove();
  }
});
