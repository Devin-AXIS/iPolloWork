// Body pages after a `sectEnd` note sheet move along with it.
//
// The sheet is inserted in front of the next section's pages after the body pass. Every
// later page then has a new place in the document: an unrestarted PAGE number one higher,
// and under `w:evenAndOddHeaders` the header and footer variant of its new page number.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, resolveHeaderFooterPartsBySection } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { enumerateDocumentSections, geometryOfSection } from '../index.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

const HEADER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';

const lines = (count: number, label: string) =>
  Array.from(
    { length: count },
    (_, i) => `<w:p><w:r><w:t>${label} ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
  ).join('');

/** One-line odd and even headers and footers, so both variants share one content box. */
function furnitureDoc(options: {
  readonly endnoteLines: number;
  readonly restartSectionTwo?: boolean;
  readonly evenFooterLines?: number;
  /** Section two has a title page with no first-page header or footer: a blank cover. */
  readonly coverSectionTwo?: boolean;
  /** A4 with margins and header distances that are not whole points. */
  readonly fractionalGeometry?: boolean;
}): Uint8Array {
  const story = (tag: 'hdr' | 'ftr', text: string, count = 1) =>
    strToU8(
      `<w:${tag} xmlns:w="${W}">` +
        Array.from({ length: count }, () => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('') +
        `</w:${tag}>`
    );
  const refs =
    '<w:headerReference w:type="default" r:id="rIdH1"/>' +
    '<w:headerReference w:type="even" r:id="rIdH2"/>' +
    '<w:footerReference w:type="default" r:id="rIdF1"/>' +
    '<w:footerReference w:type="even" r:id="rIdF2"/>';
  const geometry = options.fractionalGeometry
    ? '<w:pgSz w:w="11906" w:h="7203"/>' +
      '<w:pgMar w:top="1087" w:right="719" w:bottom="1083" w:left="721" w:header="367" w:footer="363"/>'
    : '<w:pgSz w:w="12240" w:h="7200"/>' +
      '<w:pgMar w:top="1080" w:right="720" w:bottom="1080" w:left="720" w:header="360" w:footer="360"/>';
  const sectOne = `<w:sectPr>${refs}${geometry}<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr></w:sectPr>`;
  const sectTwo =
    `<w:sectPr>${refs}<w:type w:val="nextPage"/>${geometry}` +
    (options.restartSectionTwo ? '<w:pgNumType w:start="1"/>' : '') +
    (options.coverSectionTwo ? '<w:titlePg/>' : '') +
    '</w:sectPr>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        `<Override PartName="/word/header1.xml" ContentType="${HEADER_CT}"/>` +
        `<Override PartName="/word/header2.xml" ContentType="${HEADER_CT}"/>` +
        `<Override PartName="/word/footer1.xml" ContentType="${FOOTER_CT}"/>` +
        `<Override PartName="/word/footer2.xml" ContentType="${FOOTER_CT}"/>` +
        '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/>` +
        `<Relationship Id="rIdH1" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdH2" Type="${R}/header" Target="header2.xml"/>` +
        `<Relationship Id="rIdF1" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rIdF2" Type="${R}/footer" Target="footer2.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        '</Relationships>'
    ),
    'word/settings.xml': strToU8(`<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`),
    'word/header1.xml': story('hdr', 'Odd header'),
    'word/header2.xml': story('hdr', 'Even header'),
    'word/footer1.xml': story('ftr', 'Odd footer'),
    'word/footer2.xml': story('ftr', 'Even footer', options.evenFooterLines ?? 1),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>Section one body</w:t><w:endnoteReference w:id="1"/></w:r></w:p>' +
        `<w:p><w:pPr>${sectOne}</w:pPr></w:p>` +
        lines(30, 'Section two body') +
        sectTwo +
        '</w:body></w:document>'
    ),
    'word/endnotes.xml': strToU8(
      `<w:endnotes xmlns:w="${W}">` +
        '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
        '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
        `<w:endnote w:id="1">${lines(options.endnoteLines, 'Sect endnote')}</w:endnote>` +
        '</w:endnotes>'
    ),
  });
}

function layoutOf(bytes: Uint8Array): SemanticLayout {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
  const notes: NotesLayoutInput = {
    footnotesPart: null,
    endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
    footnotePropsBySection: [footnoteProps, footnoteProps],
    endnotePropsBySection: [sectEnd, sectEnd],
    documentFootnoteProps: footnoteProps,
    documentEndnoteProps: sectEnd,
    measurer,
    producer: 'later-body',
  };
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(loaded.package);
  const sectionFurniture = sections.map((section, index) => {
    const parts = bySection[index]!;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const story = (map: ReadonlyMap<string, never>) => {
      const laid = new Map();
      for (const [variant, hfPart] of map)
        laid.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'later-body'));
      return laid;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: story(parts.headers as never),
      footers: story(parts.footers as never),
    };
  });
  return layoutSemanticDocument(part, 1, {
    measurer,
    notes,
    producer: 'later-body',
    sectionFurniture,
  });
}

/** Endnote lines that make section one end on an odd number of overflow sheets. */
function oddOverflowLayout(
  options: Omit<Parameters<typeof furnitureDoc>[0], 'endnoteLines'> = {}
): SemanticLayout {
  for (let endnoteLines = 6; endnoteLines < 60; endnoteLines += 3) {
    const layout = layoutOf(furnitureDoc({ ...options, endnoteLines }));
    const sheets = layout.pages.filter((page) => page.noteStream === 'endnote-overflow').length;
    if (sheets % 2 === 1) return layout;
  }
  throw new Error('no endnote length gave an odd number of overflow sheets');
}

/** The variant a page number picks under `w:evenAndOddHeaders`, with no title page. */
const variantFor = (pageNumber: number) => (pageNumber % 2 === 0 ? 'even' : 'default');

describe('body pages after a sectEnd note sheet', () => {
  test('take the next page number and the variant of their new place', () => {
    const layout = oddOverflowLayout();
    const firstLater = layout.pages.findIndex(
      (page, index) =>
        index > 0 &&
        page.noteStream === undefined &&
        layout.pages[index - 1]!.noteStream === 'endnote-overflow'
    );
    expect(firstLater).toBeGreaterThan(0);
    expect(layout.pages.length - firstLater).toBeGreaterThan(1);
    layout.pages.forEach((page, index) => {
      expect(page.index).toBe(index);
      expect(page.pageFieldSource?.pageNumber ?? index + 1).toBe(index + 1);
      expect(page.header?.variant).toBe(variantFor(index + 1));
      expect(page.footer?.variant).toBe(variantFor(index + 1));
    });
  });

  test('a page box that is not whole points still takes the variant of its new place', () => {
    const layout = oddOverflowLayout({ fractionalGeometry: true });
    layout.pages.forEach((page, index) => {
      if (page.noteStream !== undefined) return;
      expect(page.header?.variant).toBe(variantFor(index + 1));
      expect(page.footer?.variant).toBe(variantFor(index + 1));
    });
  });

  test('a restarted section keeps its own numbers and variants', () => {
    const layout = oddOverflowLayout({ restartSectionTwo: true });
    const firstLater = layout.pages.findIndex(
      (page, index) =>
        index > 0 &&
        page.noteStream === undefined &&
        layout.pages[index - 1]!.noteStream === 'endnote-overflow'
    );
    expect(firstLater).toBeGreaterThan(0);
    for (let index = firstLater; index < layout.pages.length; index += 1) {
      const page = layout.pages[index]!;
      expect(page.pageFieldSource?.pageNumber).toBe(index - firstLater + 1);
      expect(page.header?.variant).toBe(variantFor(index - firstLater + 1));
    }
  });

  test('a page whose new variant moves its content box keeps its body inside the box', () => {
    // A taller even footer: the new variant would shrink a body laid out for the other one.
    const layout = oddOverflowLayout({ evenFooterLines: 3 });
    for (const page of layout.pages) {
      if (page.noteStream !== undefined) continue;
      const bottom = page.contentBox.y + page.contentBox.height;
      for (const fragment of page.fragments) {
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(bottom + 0.001);
      }
    }
  });

  test('a blank cover page keeps showing no header or footer', () => {
    const layout = oddOverflowLayout({ coverSectionTwo: true });
    const cover = layout.pages.findIndex(
      (page, index) =>
        index > 0 &&
        page.noteStream === undefined &&
        layout.pages[index - 1]!.noteStream === 'endnote-overflow'
    );
    expect(cover).toBeGreaterThan(0);
    expect(layout.pages[cover]!.header).toBeUndefined();
    expect(layout.pages[cover]!.footer).toBeUndefined();
    // The pages after it still take the variant of their number.
    for (let index = cover + 1; index < layout.pages.length; index += 1) {
      expect(layout.pages[index]!.header?.variant).toBe(variantFor(index + 1));
    }
  });
});
