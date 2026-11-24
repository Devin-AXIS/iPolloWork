// A list item the reader is standing in reads as a list item.
//
// A resolved display mode publishes a merged run as ONE fragment named after the survivor.
// The list readers looked the caret's paragraph up by that name, found nothing for the
// absorbed half, and answered "not a list item" — so the toolbar greyed its list controls out
// while the reader's caret sat in a numbered line, and Tab inserted a tab instead of
// demoting.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';

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
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${NUMREL}" Target="numbering.xml"/></Relationships>`
    ),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const numPr = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
/** Two list items the reader sees as one: the first one's paragraph mark is struck. */
const MERGED_ITEMS =
  `<w:p><w:pPr>${numPr}<w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>` +
  '<w:r><w:t xml:space="preserve">first </w:t></w:r></w:p>' +
  `<w:p><w:pPr>${numPr}</w:pPr><w:r><w:t>second</w:t></w:r></w:p>`;

function withMerged(run: (surface: PaginatedSurface) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(MERGED_ITEMS), {
    revisionDisplayMode: 'proposed',
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    run(opened.surface);
  } finally {
    opened.surface.destroy();
    container.remove();
  }
}

describe('the list readers see the item the reader sees', () => {
  test('the two items are drawn as one', () => {
    withMerged((surface) => {
      const fragments = surface
        .layout()
        .pages.flatMap((page) => page.fragments.filter((block) => block.kind === 'paragraph'));
      expect(fragments).toHaveLength(1);
      expect(fragments[0]!.marker).toBeTruthy();
      expect(surface.session.paragraphIds()).toHaveLength(2);
    });
  });

  test('the caret in the absorbed half is in a list item', () => {
    withMerged((surface) => {
      const [absorbed] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: absorbed!, offset: 1 },
        head: { paragraphId: absorbed!, offset: 1 },
      });
      // What the toolbar asks. It answered false, so the list buttons went inactive when
      // the caret crossed an invisible break in the middle of a line.
      expect(surface.isListParagraph()).toBe(true);
      expect(surface.isListActive('ordered')).toBe(true);
      expect(surface.isListActive('bullet')).toBe(false);
    });
  });

  test('a paragraph that is genuinely not a list still says so', () => {
    // The fix widens the lookup, not the answer: an ordinary paragraph is unchanged.
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(
      container,
      docx('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'),
      { revisionDisplayMode: 'proposed' }
    );
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const [only] = opened.surface.session.paragraphIds();
      opened.surface.setSelection({
        anchor: { paragraphId: only!, offset: 0 },
        head: { paragraphId: only!, offset: 0 },
      });
      expect(opened.surface.isListParagraph()).toBe(false);
    } finally {
      opened.surface.destroy();
      container.remove();
    }
  });
});
