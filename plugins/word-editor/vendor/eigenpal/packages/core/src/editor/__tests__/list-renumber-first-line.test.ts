// A list ordinal is DERIVED state: inserting items above a numbered paragraph renumbers it
// while its own subtree stays byte-identical. When the wider ordinal overflows the hanging
// slot, the suffix tab moves the FIRST LINE to the next stop — so the renumbered paragraph
// must be re-broken, not served its pre-renumber first-line geometry.

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
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

// Starts at XXXVII so the LAST item sits at XL. — the widest ordinal that still fits the
// 360-twip hanging slot under the fixed measurer. Four insertions push it to XLIV., which
// overflows the slot and must move the first line to the next tab stop.
const NUMBERING =
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
  '<w:start w:val="37"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/>' +
  '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

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

interface ItemGeometry {
  readonly marker: string | undefined;
  readonly markerEnd: number | undefined;
  readonly contentX: number | undefined;
}

function geometryOf(surface: PaginatedSurface, paragraphId: string): ItemGeometry {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph' || fragment.paragraphId !== paragraphId) continue;
      return {
        marker: fragment.marker?.text,
        markerEnd: fragment.marker ? fragment.marker.box.x + fragment.marker.box.width : undefined,
        contentX: fragment.lines[0]?.contentX,
      };
    }
  }
  throw new Error(`no fragment for ${paragraphId}`);
}

/** By CONTENT, not position: save/reopen owes this test no promise about paragraph order. */
function paragraphIdByFirstLineText(surface: PaginatedSurface, text: string): string {
  for (const page of surface.layout().pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      const firstLine = fragment.lines[0]?.spans.map((span) => span.text).join('') ?? '';
      if (firstLine === text) return fragment.paragraphId;
    }
  }
  throw new Error(`no paragraph reading "${text}"`);
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

describe('a renumbered ordinal that overflows its slot moves the first line', () => {
  test('insertions above push the last item across the tab threshold', () => {
    withSurface(
      docx(item('Introduction') + item('Analysis') + item('Discussion') + item('Conclusions')),
      (surface) => {
        const ids = surface.session.paragraphIds();
        const conclusions = ids[3]!;
        const before = geometryOf(surface, conclusions);
        expect(before.marker).toBe('XL.');

        // Four Enters at the end of 'Discussion' insert four numbered items above 'Conclusions'.
        surface.setSelection({
          anchor: { paragraphId: ids[2]!, offset: 'Discussion'.length },
          head: { paragraphId: ids[2]!, offset: 'Discussion'.length },
        });
        for (let count = 0; count < 4; count += 1) surface.splitParagraph();

        const incremental = geometryOf(surface, conclusions);
        expect(incremental.marker).toBe('XLIV.');
        // The threshold must actually be crossed, or every assertion below holds trivially
        // and the regression this test pins could return unseen.
        expect(incremental.contentX!).toBeGreaterThan(before.contentX!);
        // The first line may never start under the marker that numbers it.
        expect(incremental.contentX!).toBeGreaterThanOrEqual(incremental.markerEnd!);

        // Cold oracle: the same bytes reopened have no warm caches to serve stale geometry.
        withSurface(surface.session.save(), (reopened) => {
          const cold = geometryOf(reopened, paragraphIdByFirstLineText(reopened, 'Conclusions'));
          expect(cold.marker).toBe('XLIV.');
          expect(incremental.contentX).toBe(cold.contentX!);
        });
      }
    );
  });
});
