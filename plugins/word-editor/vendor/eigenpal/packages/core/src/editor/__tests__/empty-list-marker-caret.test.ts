// A list level with empty marker text paints nothing, but its suffix still moves the first
// line. The caret in an empty item has to sit where the first typed character lands, through
// the editor's own layout options and after a save and reopen.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { caretAt } from '../../layout/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

// numId 1: empty marker with a tab suffix on a first-line indent, which moves the first line
// to the next default stop at 72pt. numId 2: the same level with no suffix.
const level = (suffix: string) =>
  `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="none"/><w:lvlText w:val=""/>` +
  `<w:suff w:val="${suffix}"/><w:pPr><w:ind w:left="0" w:firstLine="720"/></w:pPr></w:lvl>`;
const NUMBERING =
  `<w:numbering xmlns:w="${W}">` +
  `<w:abstractNum w:abstractNumId="0">${level('tab')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="1">${level('nothing')}</w:abstractNum>` +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

const paragraph = (numId: number | undefined, text: string, bidi = false) =>
  '<w:p><w:pPr>' +
  (numId === undefined ? '' : `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`) +
  (bidi ? '<w:bidi/>' : '') +
  '</w:pPr>' +
  (text ? `<w:r><w:t>${text}</w:t></w:r>` : '') +
  '</w:p>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/>` +
        `<Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${FORMAT_DOC_DEFAULTS}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function withSurface(bytes: Uint8Array, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  try {
    const opened = mountPaginatedSurface(container, bytes);
    if (!opened.ok) throw new Error(opened.reason);
    try {
      run(opened.surface);
    } finally {
      opened.surface.destroy();
    }
  } finally {
    container.remove();
  }
}

/** Caret x at the paragraph start, relative to the caret of an unindented plain paragraph. */
function startX(surface: PaginatedSurface, index: number): number {
  const ids = surface.session.paragraphIds();
  const layout = surface.layout();
  const origin = caretAt(layout, { paragraphId: ids[0]!, offset: 0 })!.x;
  return caretAt(layout, { paragraphId: ids[index]!, offset: 0 })!.x - origin;
}

describe('the caret in an empty list item with an empty marker', () => {
  test('sits at the suffix destination and stays there when text is typed', () => {
    withSurface(
      docx(paragraph(undefined, 'Plain') + paragraph(1, '') + paragraph(2, '')),
      (surface) => {
        expect(startX(surface, 1)).toBe(72);
        expect(startX(surface, 2)).toBe(36);

        const id = surface.session.paragraphIds()[1]!;
        surface.setSelection({
          anchor: { paragraphId: id, offset: 0 },
          head: { paragraphId: id, offset: 0 },
        });
        surface.type('Typed');
        expect(startX(surface, 1)).toBe(72);

        withSurface(surface.session.save(), (reopened) => {
          expect(startX(reopened, 1)).toBe(72);
          expect(startX(reopened, 2)).toBe(36);
        });
      }
    );
  });

  test('mirrors to the right edge in a right-to-left item', () => {
    withSurface(
      docx(paragraph(undefined, '', true) + paragraph(1, '', true) + paragraph(2, '', true)),
      (surface) => {
        // Relative to an unindented right-to-left paragraph, whose caret is at the right edge.
        expect(startX(surface, 1)).toBe(-72);
        expect(startX(surface, 2)).toBe(-36);

        withSurface(surface.session.save(), (reopened) => {
          expect(startX(reopened, 1)).toBe(-72);
          expect(startX(reopened, 2)).toBe(-36);
        });
      }
    );
  });
});
