// A list marker inherits its face from the PARAGRAPH MARK (`w:pPr/w:rPr`).
//
// Marker resolution was already Word-faithful — level `w:rPr`, then the mark, then the
// style. What was missing was on the editing side: Word writes the same run properties
// onto the mark whenever formatting covers a whole paragraph, which is why the bullet
// grows with the text. Without it, sizing a bulleted paragraph left a tiny bullet beside
// large text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { DEFAULT_RUN_STYLE } from '../../layout/run-style.ts';

/** These fixtures author no `w:sz`, so an untouched marker sits at the terminal fallback. */
const UNSTYLED_PT = DEFAULT_RUN_STYLE.fontSizePt;

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

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

function withItem(body: string, run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body));
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

const item = (text: string, pPrExtra = '', rPr = '') =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' +
  `${pPrExtra}</w:pPr><w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`;

const sizes = (surface: PaginatedSurface) => {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph' || !fragment.marker) continue;
      return {
        marker: fragment.marker.style.fontSizePt,
        text: fragment.lines[0]?.spans[0]?.style.fontSizePt ?? null,
      };
    }
  }
  throw new Error('no marker');
};

const selectAllOf = (surface: PaginatedSurface, text: string) => {
  const id = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: text.length },
  });
};

describe('the marker follows the paragraph it numbers', () => {
  test('an authored paragraph mark already sizes the marker', () => {
    withItem(
      item('BIG', '<w:rPr><w:sz w:val="52"/></w:rPr>', '<w:rPr><w:sz w:val="52"/></w:rPr>'),
      (surface) => {
        expect(sizes(surface)).toEqual({ marker: 26, text: 26 });
      }
    );
  });

  test('sizing the whole paragraph moves the marker with it', () => {
    withItem(item('BIG'), (surface) => {
      expect(sizes(surface).marker).toBe(UNSTYLED_PT);
      selectAllOf(surface, 'BIG');
      surface.setRunProperty('sz', { val: '52' });
      expect(sizes(surface)).toEqual({ marker: 26, text: 26 });
    });
  });

  test('bolding the whole paragraph bolds its marker', () => {
    withItem(item('BIG'), (surface) => {
      selectAllOf(surface, 'BIG');
      surface.toggleRunProperty('b');
      for (const page of surface.layout().pages) {
        for (const fragment of page.fragments) {
          if (fragment.kind !== 'paragraph' || !fragment.marker) continue;
          expect(fragment.marker.style.bold).toBe(true);
          return;
        }
      }
      throw new Error('no marker');
    });
  });

  test('formatting PART of a paragraph leaves the marker alone', () => {
    // The pilcrow was not in the selection, so its formatting must not change — and
    // therefore neither must the marker's.
    withItem(item('BIGGER'), (surface) => {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 3 },
      });
      surface.setRunProperty('sz', { val: '52' });
      expect(sizes(surface).marker).toBe(UNSTYLED_PT);
    });
  });

  test('the mark survives a save and reopen', () => {
    withItem(item('BIG'), (surface) => {
      selectAllOf(surface, 'BIG');
      surface.setRunProperty('sz', { val: '52' });
      const container = document.createElement('div');
      document.body.append(container);
      const reopened = mountPaginatedSurface(container, surface.session.save());
      if (!reopened.ok) throw new Error(reopened.reason);
      try {
        expect(sizes(reopened.surface)).toEqual({ marker: 26, text: 26 });
      } finally {
        reopened.surface.destroy();
        container.remove();
      }
    });
  });

  test('the rest of w:pPr survives the mark being written', () => {
    withItem(item('BIG'), (surface) => {
      selectAllOf(surface, 'BIG');
      surface.setRunProperty('sz', { val: '52' });
      const xml = JSON.stringify(surface.session.part().root);
      expect(xml).toContain('numPr');
      expect(xml).toContain('numId');
    });
  });
});
