// The drawing reconcile pass sees every story a page paints.
//
// `paintPageNoteAreas` paints note fragments through the same `paintFragment` the body uses, so
// a picture in a footnote gets a cached element and a blob URL like any other. The two collectors
// that decide what is still in use walked the body and the furniture stories and stopped — so a
// note's drawing was absent from both, and `reconcile` treated it as dead on every repaint:
// `revoke` on its resource, `removeAttribute('src')` on its element. Typing one character in the
// body blanked a picture in a footnote.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../../editor/docx-editor.ts';
import {
  collectUsedDrawingElementKeys,
  collectUsedDrawingResourceKeys,
} from '../semantic-paint-drawings.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const PIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

const HEADER_R_ID = 'rId10';

/** One inline picture. The relationship is deliberately unresolvable: the RECORD is the point. */
function picture(name: string): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="914400" cy="457200"/>' +
    `<wp:docPr id="1" name="${name}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic><a:graphicData uri="${PIC_URI}">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    '<pic:blipFill><a:blip r:embed="rId99"/><a:stretch/></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"`;

function docx(): Uint8Array {
  const withPicture = (name: string): string => `<w:p>${picture(name)}</w:p>`;
  const override = (part: string, type: string): string =>
    `<Override PartName="/word/${part}" ContentType="application/vnd.openxmlformats-` +
    `officedocument.wordprocessingml.${type}+xml"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        override('header1.xml', 'header') +
        override('footnotes.xml', 'footnotes') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId20" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr ${NS}>${withPicture('InHeader')}</w:hdr>`),
    'word/footnotes.xml': strToU8(
      `<w:footnotes ${NS}>` +
        '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p>' +
        '</w:footnote>' +
        `<w:footnote w:id="1">${withPicture('InFootnote')}</w:footnote></w:footnotes>`
    ),
    'word/document.xml': strToU8(
      `<w:document ${NS}><w:body>` +
        `<w:p>${picture('InBody')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(): { readonly editor: DocxEditorInstance; readonly host: HTMLElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({ document: docx(), author: 'Parity' });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  return { editor, host };
}

/** The node id of every drawing the layout published, per story. */
function drawingsByStory(editor: DocxEditorInstance): {
  readonly body: readonly string[];
  readonly header: readonly string[];
  readonly note: readonly string[];
} {
  const collect = (
    blocks: readonly { readonly kind: string; readonly lines?: readonly unknown[] }[]
  ): string[] => {
    const found: string[] = [];
    for (const block of blocks) {
      for (const line of (block.lines ?? []) as readonly {
        readonly drawings?: readonly { readonly drawingNodeId: string }[];
      }[]) {
        for (const drawing of line.drawings ?? []) found.push(drawing.drawingNodeId);
      }
    }
    return found;
  };
  const body: string[] = [];
  const header: string[] = [];
  const note: string[] = [];
  for (const page of editor.surface!.layout().pages) {
    body.push(...collect(page.fragments));
    if (page.header) header.push(...collect(page.header.fragments));
    for (const item of page.footnotes?.notes ?? []) note.push(...collect(item.fragments));
  }
  return { body, header, note };
}

describe('a drawing in a note is not reconciled away', () => {
  test('the element-key collector reaches the body, the header and the note', () => {
    const { editor } = mount();
    const layout = editor.surface!.layout();
    const { body, header, note } = drawingsByStory(editor);

    // The fixture is only meaningful if all three stories actually published a drawing.
    expect(body.length, 'no body drawing in the layout').toBeGreaterThan(0);
    expect(header.length, 'no header drawing in the layout').toBeGreaterThan(0);
    expect(note.length, 'no footnote drawing in the layout').toBeGreaterThan(0);

    // Both collectors share ONE walk (`forEachPaintedDrawing`), so this covers the resource
    // collector too. Asserting its output separately would prove nothing here: every
    // relationship in this fixture is unresolvable on purpose, so its set is empty whatever
    // the walk reaches.
    const keys = collectUsedDrawingElementKeys(layout);
    for (const [story, ids] of [
      ['body', body],
      ['header', header],
      ['note', note],
    ] as const) {
      for (const id of ids) {
        const reached = [...keys].some((key) => key.endsWith(`|${id}`));
        expect(reached, `${story} drawing ${id} is missing from the used set`).toBe(true);
      }
    }
  });
});
