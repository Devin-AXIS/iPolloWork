// A section write from a header reaches the section the reader is looking at.
//
// A trailing body-level `w:sectPr` is minted as an EMPTY final section, which is ordinary in a
// multi-section package — and it is a section whose header a reader stands in. It holds no
// paragraph, so it has no anchor, and an anchor borrowed from elsewhere is not a smaller
// mistake than none: `targetSectionNodes` resolves an anchor to the first `w:sectPr` at or
// after it, so the first paragraph of the body pins the write to SECTION 0. An omitted anchor
// writes every section — broader than asked, but it does include the one the caller means.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const FIRST_R_ID = 'rId10';
const TAIL_R_ID = 'rId11';
const START_RIGHT = 2000;
const APPLIED_RIGHT = 4321;

/**
 * Two sections, the second EMPTY — every paragraph closes the first, and the body-level
 * `w:sectPr` mints the second with nothing in it. Each has its own header, so entering one
 * names the section unambiguously.
 */
function emptyTailSectionDocx(): Uint8Array {
  const margins = `<w:pgMar w:top="1440" w:right="${START_RIGHT}" w:bottom="1440" w:left="1440"/>`;
  const body =
    '<w:p><w:pPr><w:sectPr>' +
    `<w:headerReference w:type="default" r:id="${FIRST_R_ID}"/>${margins}` +
    '</w:sectPr></w:pPr><w:r><w:t>Only paragraph</w:t></w:r></w:p>';
  const override = (name: string): string =>
    `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.header+xml"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        override('header1.xml') +
        override('header2.xml') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${FIRST_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="${TAIL_R_ID}" Type="${R}/header" Target="header2.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>First</w:t></w:r></w:p></w:hdr>`
    ),
    'word/header2.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Tail</w:t></w:r></w:p></w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${TAIL_R_ID}"/>${margins}` +
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
  const editor = createDocxEditor({ document: emptyTailSectionDocx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

describe('an empty section refuses a section write rather than widening it', () => {
  test('the tail section cannot be addressed, and says so', async () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: TAIL_R_ID })).toBe(true);

    const before = await documentXml(editor);
    const result = editor.exec({
      type: 'setPageSetup',
      scope: 'section',
      marginRight: APPLIED_RIGHT,
    });

    // Two wrong answers were available and both were taken in turn. Borrowing the body's first
    // paragraph as an anchor pinned the write to SECTION 0 — the wrong section. Omitting the
    // anchor writes EVERY section, which is what `scope: 'document'` already means, so it
    // changes pages nobody asked about, quietly, because page geometry does not announce
    // itself. The refusal is the only true answer.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('this section holds no paragraph to address it by');
    // Nothing moved. Not one section, and not both.
    expect(await documentXml(editor)).toBe(before);
  });

  test('the section that does hold a paragraph still takes a section write', async () => {
    const editor = mount();
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: FIRST_R_ID })).toBe(true);

    const result = editor.exec({
      type: 'setPageSetup',
      scope: 'section',
      marginRight: APPLIED_RIGHT,
    });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);

    // Exactly one `w:right` moved: the refusal above is about an unaddressable section, not a
    // blanket retreat from section writes in furniture.
    const rights = [...(await documentXml(editor)).matchAll(/w:right="(\d+)"/g)].map((m) => m[1]);
    expect(rights).toEqual([String(APPLIED_RIGHT), String(START_RIGHT)]);
  });
});

/** The saved `word/document.xml`, where `w:sectPr` lives. */
async function documentXml(editor: DocxEditorInstance): Promise<string> {
  const entries = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(entries['word/document.xml']!);
}
