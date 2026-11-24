// Hyperlink relationship scope for note stories, end to end over a mounted editor.
//
// A `w:hyperlink` inside `/word/footnotes.xml` declares its `r:id` in
// `footnotes.xml.rels`, not the body part's relationships. When both parts assign the
// same id to different targets, the painted footnote anchor must carry the footnote
// part's target — resolving through the body's relationships handed it the body's.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** One rId, two targets: `rId7` means one thing in the body and another in the footnote. */
function conflictingRelsDoc(): Uint8Array {
  const body =
    '<w:p><w:r><w:t>Ref</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
    '<w:p><w:hyperlink r:id="rId7"><w:r><w:t>BodyLink</w:t></w:r></w:hyperlink></w:p>';
  const footnotes =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:id="1"><w:p>' +
    '<w:hyperlink r:id="rId7"><w:r><w:t>NoteLink</w:t></w:r></w:hyperlink>' +
    '</w:p></w:footnote>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rId7" Type="${R}/hyperlink" Target="https://body.example/" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/_rels/footnotes.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId7" Type="${R}/hyperlink" Target="https://note.example/" TargetMode="External"/>` +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}" xmlns:r="${R}">${footnotes}</w:footnotes>`
    ),
  });
}

describe('note hyperlink relationship scope', () => {
  test('a footnote link resolves its r:id against footnotes.xml.rels, not the body rels', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: conflictingRelsDoc() });
    try {
      expect(editor.surface).not.toBeNull();

      const anchors = [...container.querySelectorAll('a.docx-hyperlink')] as HTMLElement[];
      const hrefFor = (text: string) =>
        anchors.find((anchor) => anchor.textContent === text)?.getAttribute('href');

      expect(hrefFor('BodyLink')).toBe('https://body.example/');
      expect(hrefFor('NoteLink')).toBe('https://note.example/');
    } finally {
      // A failed expect must not leave the mounted editor on the shared document.
      editor.destroy();
      container.remove();
    }
  });
});
