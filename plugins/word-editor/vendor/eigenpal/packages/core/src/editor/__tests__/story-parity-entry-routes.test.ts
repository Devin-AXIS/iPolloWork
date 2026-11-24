// Two ways into the same header land in the same place.
//
// A furniture story opened WITHOUT a page is opened without a section, and the section is what
// the ruler clamps to and what a new table's grid is divided from. One header part can be the
// default header of several sections, so "the first section that names this rId" is a different
// page's geometry. The pointer seam forwards the page it clicked; `setSelection` forwarded
// nothing, so the same header reached two ways gave two answers about the same paragraph.
//
// Also pinned here: reading a control's part must not spend a story-store slot. The store holds
// 64 open editable stories and never evicts one while its part is in the package, so a pure
// READ that opens a store turns an enumeration into an exhaustion.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { paragraphFragmentsOfBlocks } from '@docx-editor.dev/core/layout';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { partOfNodeId } from '../surface-scope.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const SHARED_R_ID = 'rId10';
const PORTRAIT_WIDTH = 12240;
const LANDSCAPE_WIDTH = 15840;

/**
 * Two sections of different paper, sharing one header part.
 *
 * The FIRST section carries `w:titlePg` with no first-page header, so the shared part paints
 * only on the second section's page. "The first section that names this rId" is therefore a
 * page the header never appears on — which is what makes the two entry routes disagree.
 */
function sharedHeaderDocx(): Uint8Array {
  const section = (widthTwips: number, height: number, extra = ''): string =>
    `<w:sectPr>${extra}<w:headerReference w:type="default" r:id="${SHARED_R_ID}"/>` +
    `<w:pgSz w:w="${widthTwips}" w:h="${height}"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>';
  const body =
    `<w:p><w:pPr>${section(PORTRAIT_WIDTH, 15840, '<w:titlePg/>')}</w:pPr>` +
    '<w:r><w:t>First section</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Second section</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${SHARED_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Shared letterhead</w:t></w:r></w:p></w:hdr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        `${section(LANDSCAPE_WIDTH, 12240)}</w:body></w:document>`
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: bytes, author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return editor;
}

/** The header paragraph, and the page it is painted on. */
function paintedHeader(editor: DocxEditorInstance): {
  readonly paragraphId: string;
  readonly pageIndex: number;
} {
  const pages = editor.surface!.layout().pages;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const [fragment] = paragraphFragmentsOfBlocks(pages[pageIndex]!.header?.fragments ?? []);
    if (fragment) return { paragraphId: fragment.paragraphId, pageIndex };
  }
  throw new Error('the shared header was never painted');
}

describe('a header opened by anchor lands where the pointer would put it', () => {
  test('the section follows the painted page, not the first section that names the rId', () => {
    const editor = mount(sharedHeaderDocx());
    const surface = editor.surface!;
    const { paragraphId, pageIndex } = paintedHeader(editor);

    // The pointer route: it forwards the page it clicked, so the section is that page's.
    surface.enterHeaderFooter({
      rId: SHARED_R_ID,
      pageIndex,
      sectionIndex: surface.sectionAtPage(pageIndex).sectionIndex,
    });
    const viaPointer = surface.sectionPropertiesAt(paragraphId).pageSize.widthTwips;
    surface.exitHeaderFooter();

    // The anchor route: same header, same paragraph, and it must agree.
    const paraId = surface.session.paragraphAnchors().paraIdByNode.get(paragraphId)!;
    const result = editor.exec({ type: 'setSelection', anchor: { paraId } });
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    const viaAnchor = surface.sectionPropertiesAt(paragraphId).pageSize.widthTwips;

    expect(viaAnchor, 'the two entry routes disagree about the same header').toBe(viaPointer);
    // And it is the section the header is actually painted in, not the first that names it.
    expect(viaAnchor).toBe(LANDSCAPE_WIDTH);
  });
});

describe('reading a control’s part does not open a story store', () => {
  test('partOfNodeId answers from the package', () => {
    const editor = mount(sharedHeaderDocx());
    const session = editor.surface!.session;
    const { paragraphId } = paintedHeader(editor);

    // The anchor index is memoized on the package revision AND the open-story token, so its
    // reference survives a pure read and moves the moment a store opens. That makes it the
    // signal here: the store holds 64 open editable stories and never evicts one while its
    // part is in the package, so a READ that opens one turns an enumeration into exhaustion.
    const before = session.paragraphAnchors();
    const part = partOfNodeId(session, paragraphId);
    expect(session.paragraphAnchors(), 'a read opened a story store').toBe(before);
    expect(part?.name).toBe('/word/header1.xml');

    // The signal is real: entering the story DOES move it.
    expect(editor.surface!.enterHeaderFooter({ rId: SHARED_R_ID })).toBe(true);
    expect(session.paragraphAnchors()).not.toBe(before);
  });
});
