// A block content control wrapping a TABLE holds the paragraphs inside its cells.
//
// `blockIds` carries a table's own id and stops there — it does not descend into rows and
// cells. So "which control holds this paragraph" answered nothing for a caret in such a cell.
//
// `contentControlRecordsInPart` was given `paragraphsUnder` when the roster hit this, with a
// comment saying a block control wrapping a table "dropped out of the roster entirely".
// `contentControlHoldingParagraph` was not, and every scope except the body resolves through
// it: with the caret in a cell of a header's wrapped table, the control had no outline,
// `remove()` answered `notFound`, and `navigate` stepped straight over it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextFromLayout } from '@docx-editor.dev/core/layout';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';

const HEADER_R_ID = 'rId10';
const HEADER_TAG = 'hdrWrapped';
const BODY_TAG = 'bodyWrapped';

const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

/** A block control whose only content is a table, so no paragraph is a direct child. */
const wrapped = (tag: string, id: string, prefix: string) =>
  `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:id w:val="${id}"/></w:sdtPr><w:sdtContent>` +
  '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  `<w:tr>${cell(`${prefix}A1`)}${cell(`${prefix}B1`)}</w:tr></w:tbl>` +
  '</w:sdtContent></w:sdt>';

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
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}" xmlns:r="${R}">${wrapped(HEADER_TAG, '31', 'H')}` +
        '<w:p><w:r><w:t>header tail</w:t></w:r></w:p></w:hdr>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `${wrapped(BODY_TAG, '32', 'B')}<w:p><w:r><w:t>body tail</w:t></w:r></w:p>` +
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

/** The id of the paragraph reading `text`, from whatever story is open. */
function paragraphReading(editor: DocxEditorInstance, text: string): string {
  const surface = editor.surface!;
  const layout = surface.publishedLayout();
  for (const id of surface.session.paragraphIdsIn(surface.storyScope())) {
    if (paragraphTextFromLayout(layout, id) === text) return id;
  }
  throw new Error(`no paragraph reading "${text}"`);
}

describe('a control wrapping a table holds the paragraphs in its cells', () => {
  test('the caret in a header cell reports the wrapping control', () => {
    const editor = mount();
    expect(editor.surface!.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);

    const paragraphId = paragraphReading(editor, 'HA1');
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });

    const at = editor.surface!.contentControls.atCaret();
    expect(at, 'no control reported for a caret inside the wrapped header table').not.toBeNull();
    expect(at!.tag).toBe(HEADER_TAG);
    // The state the chrome reads, not only the resolver. Both were blank before, so the
    // outline never drew and `contentControls.remove()` with no id answered `notFound`.
    expect(editor.surface!.state().contentControls.activeControlId).toBe(at!.id);
  });

  test('the body answer is unchanged', () => {
    const editor = mount();
    const paragraphId = paragraphReading(editor, 'BA1');
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });

    const at = editor.surface!.contentControls.atCaret();
    expect(at, 'the body regressed').not.toBeNull();
    expect(at!.tag).toBe(BODY_TAG);
  });
});
