// An inline content control in a header has geometry on EVERY page the header is drawn on.
//
// One header story is laid out once and attached to every page it applies to. The boundary
// pass indexes placed spans per paragraph id, so a header paragraph's span array is its
// ascending run REPEATED once per page — not one ascending run, which is what the body
// produces and what the lookup assumed.
//
// `fragmentsForInlineControl` binary-searched that array and stopped at the first span
// starting past the control's end. Against several runs the search lands arbitrarily and the
// break fires early: the control got geometry on page 1 and nowhere else, so its outline drew
// once and the hit test could not find it on any later page.
//
// Block controls were never affected. They resolve by block id with no ordering assumption,
// which is why this needs its own fixture rather than an assertion on the existing one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const HEADER_R_ID = 'rId10';
const INLINE_TAG = 'hdrInline';

/** An INLINE control: a `w:sdt` inside a paragraph, beside ordinary runs on both sides. */
const HEADER_PARAGRAPH =
  '<w:p><w:r><w:t>Before </w:t></w:r>' +
  `<w:sdt><w:sdtPr><w:tag w:val="${INLINE_TAG}"/><w:id w:val="21"/></w:sdtPr>` +
  '<w:sdtContent><w:r><w:t>INLINE</w:t></w:r></w:sdtContent></w:sdt>' +
  '<w:r><w:t> After</w:t></w:r></w:p>';

/** Enough body text to paginate, so the one header story is attached to several pages. */
const BODY = Array.from(
  { length: 120 },
  (_unused, index) => `<w:p><w:r><w:t>Body line ${index}</w:t></w:r></w:p>`
).join('');

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats` +
        '.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="${HEADER_R_ID}" Type="http://schemas.` +
        'openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}" xmlns:r="${R}">${HEADER_PARAGRAPH}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${BODY}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/>` +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: docx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

describe('an inline control in a repeated header', () => {
  test('has geometry on every page the header is drawn on', () => {
    const editor = mount();
    const layout = editor.surface!.layout();

    const pagesWithHeader = layout.pages.filter((page) => page.header).length;
    // The whole point of the fixture. One page proves nothing about a repeated run.
    expect(pagesWithHeader, 'the fixture did not paginate').toBeGreaterThan(1);

    const control = layout.contentControls?.find((each) => each.tag === INLINE_TAG);
    expect(control, 'the header inline control has no boundary record').toBeDefined();

    const pages = new Set(control!.fragments.map((fragment) => fragment.pageIndex));
    expect(
      pages.size,
      'the inline control has geometry on fewer pages than the header is drawn on'
    ).toBe(pagesWithHeader);
    // Every fragment carries a real box, not a collapsed one standing in for a miss.
    for (const fragment of control!.fragments) {
      expect(fragment.box.height).toBeGreaterThan(0);
    }
  });
});
