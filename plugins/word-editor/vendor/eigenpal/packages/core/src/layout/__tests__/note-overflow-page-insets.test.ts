// A note-overflow sheet resolves the content box its OWN index gets.
//
// `cloneEmptyOverflowPage` mints a blank sheet from an existing one. Copying that page's
// content box was right while every page in a section shared one; once each page derives its
// own, a sheet cloned from a title page inherits a box its own `default` variant never
// resolves to, and lays its notes against it.
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
import { SHEET_GUTTER_PT } from '../section-page-furniture.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

describe('note overflow sheets on a title-page section', () => {
  test('a drain sheet uses its own variant box, not the title page it was cloned from', () => {
    const noteParas = Array.from(
      { length: 60 },
      (_, i) => `<w:p><w:r><w:t>Footnote drain ${i} ${'x'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}">` +
          '<w:p><w:r><w:t>H one</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>H two</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>H three</w:t></w:r></w:p>' +
          '</w:hdr>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          `<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>` +
          `<w:sectPr><w:headerReference w:type="default" r:id="rId7"/>` +
          `<w:pgSz w:w="12240" w:h="7200"/>` +
          `<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>` +
          `<w:titlePg/></w:sectPr>` +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
          `<w:footnote w:id="1">${noteParas}</w:footnote>` +
          '</w:footnotes>'
      ),
    });
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer,
      producer: 'probe',
    };
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    const geometry = geometryOfSection(sections[0]!.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const parts = bySection[0]!;
    const headers = new Map();
    for (const [variant, hfPart] of parts.headers) {
      headers.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'probe'));
    }
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes,
      producer: 'probe',
      sectionFurniture: [
        {
          titlePage: parts.titlePage,
          evenAndOddHeaders: parts.evenAndOddHeaders,
          headers,
          footers: new Map(),
        },
      ],
    });
    // Page 0 is the title page: no `first` header reference, so no header and no push-down.
    const first = layout.pages[0]!;
    expect(first.header).toBeUndefined();
    expect(first.contentBox.y - first.box.y).toBe(geometry.margin.top);

    // Every drain sheet shows the `default` variant's index, so it gets that variant's box.
    const headerFlow = headers.get('default')!.flowHeight;
    const defaultTop = Math.max(geometry.margin.top, (geometry.headerDistance ?? 36) + headerFlow);
    expect(defaultTop).toBeGreaterThan(geometry.margin.top);

    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    expect(drain.length).toBeGreaterThan(0);
    expect(new Set(layout.pages.map((page) => page.box.y)).size).toBe(layout.pages.length);
    for (let index = 1; index < layout.pages.length; index += 1) {
      const previous = layout.pages[index - 1]!;
      expect(layout.pages[index]!.box.y).toBeCloseTo(
        previous.box.y + previous.box.height + SHEET_GUTTER_PT,
        6
      );
    }
    for (const page of drain) {
      // The box AND the furniture come from the same variant. Taking one without the other
      // paints an empty band exactly a header high.
      expect(page.header?.variant).toBe('default');
      expect(page.header!.box.height).toBeCloseTo(headerFlow, 6);
      expect(page.header!.box.y - page.box.y).toBeCloseTo(geometry.headerDistance ?? 36, 6);
      expect(page.contentBox.y - page.box.y).toBeCloseTo(defaultTop, 6);
      expect(page.contentBox.height).toBeCloseTo(
        geometry.height - defaultTop - geometry.margin.bottom,
        6
      );
      // The notes it carries start inside that box, not in the band above it.
      expect(page.footnotes!.box.y).toBeGreaterThanOrEqual(page.contentBox.y - 0.001);
    }
  });
});

describe('note overflow sheets at a section boundary', () => {
  /**
   * Two sections that disagree about sheet height and header height, with section 1's
   * `sectEnd` endnotes long enough to need several overflow sheets.
   *
   * A `sectEnd` sheet is inserted at the first page of the NEXT section, so the index it lands
   * at names the wrong section, and the pass reindexes only at the end, so the second and later
   * insertions no longer line up with the layout's index space either. Both would hand a sheet
   * one section's page box and another's content box.
   */
  function boundaryDoc(): Uint8Array {
    const endParas = Array.from(
      { length: 90 },
      (_, i) => `<w:p><w:r><w:t>Sect endnote ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const sectOne =
      '<w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rIdH1"/>' +
      '<w:pgSz w:w="12240" w:h="7200"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>' +
      '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>' +
      '</w:sectPr>';
    const sectTwo =
      '<w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rIdH2"/>' +
      '<w:type w:val="nextPage"/>' +
      // A DIFFERENT sheet height and a taller header: picking this section for a sheet that
      // belongs to the one before it puts a content box on a page box that cannot hold it.
      '<w:pgSz w:w="12240" w:h="10800"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>' +
      '</w:sectPr>';
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rIdH1" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rIdH2" Type="${R}/header" Target="header2.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>One</w:t></w:r></w:p></w:hdr>`
      ),
      'word/header2.xml': strToU8(
        `<w:hdr xmlns:w="${W}">` +
          '<w:p><w:r><w:t>Two a</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Two b</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Two c</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Two d</w:t></w:r></w:p>' +
          '</w:hdr>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>Section one body</w:t><w:endnoteReference w:id="1"/></w:r></w:p>' +
          `<w:p><w:pPr>${sectOne}</w:pPr></w:p>` +
          '<w:p><w:r><w:t>Section two body</w:t></w:r></w:p>' +
          sectTwo +
          '</w:body></w:document>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
          '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
          `<w:endnote w:id="1">${endParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
  }

  test('an overflow sheet keeps its own section, at every insertion in the run', () => {
    const loaded = readOoxmlPackage(boundaryDoc());
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const notes: NotesLayoutInput = {
      footnotesPart: null,
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps, documentFootnoteProps],
      endnotePropsBySection: [sectEnd, sectEnd],
      documentFootnoteProps,
      documentEndnoteProps: sectEnd,
      measurer,
      producer: 'boundary',
    };
    const sections = enumerateDocumentSections(part);
    expect(sections.length).toBe(2);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    const furniture = sections.map((section, index) => {
      const parts = bySection[index]!;
      const geometry = geometryOfSection(section.properties);
      const width = geometry.width - geometry.margin.left - geometry.margin.right;
      const headers = new Map();
      for (const [variant, hfPart] of parts.headers) {
        headers.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'boundary'));
      }
      return {
        titlePage: parts.titlePage,
        evenAndOddHeaders: parts.evenAndOddHeaders,
        headers,
        footers: new Map(),
      };
    });
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes,
      producer: 'boundary',
      sectionFurniture: furniture,
    });

    const geometryOne = geometryOfSection(sections[0]!.properties);
    const geometryTwo = geometryOfSection(sections[1]!.properties);
    expect(geometryOne.height).not.toBe(geometryTwo.height);
    const headerOne = furniture[0]!.headers.get('default')!.flowHeight;
    const headerTwo = furniture[1]!.headers.get('default')!.flowHeight;
    expect(headerOne).not.toBe(headerTwo);
    const topOne = Math.max(geometryOne.margin.top, (geometryOne.headerDistance ?? 36) + headerOne);

    const overflow = layout.pages.filter((page) => page.noteStream === 'endnote-overflow');
    // Several insertions in one run: the second and later ones are where an index-space drift
    // shows up.
    expect(overflow.length).toBeGreaterThan(1);
    for (const page of overflow) {
      // Section 1's sheet, section 1's header, section 1's content box.
      expect(page.box.height).toBe(geometryOne.height);
      expect(page.header?.box.height).toBeCloseTo(headerOne, 6);
      expect(page.contentBox.y - page.box.y).toBeCloseTo(topOne, 6);
      expect(page.contentBox.height).toBeCloseTo(
        geometryOne.height - topOne - geometryOne.margin.bottom,
        6
      );
      // And whatever it resolved has to fit on the sheet it sits on.
      expect(page.contentBox.y).toBeGreaterThanOrEqual(page.box.y - 0.001);
      expect(page.contentBox.y + page.contentBox.height).toBeLessThanOrEqual(
        page.box.y + page.box.height + 0.001
      );
    }
  });
});

describe('note overflow sheets under even/odd headers', () => {
  /**
   * Drain sheets, then a doc-end endnote overflow sheet, with `w:evenAndOddHeaders`.
   *
   * The endnote run starts from the last page that can HOST endnotes, which deliberately skips
   * the drain sheets the footnote run just appended. So the sheet lands that many slots further
   * along than the run's anchor, and a shell resolved for the anchor's own neighbourhood picks
   * the variant — and with it the content box — of the wrong page number.
   */
  /**
   * `footnoteLines` is tuned to drain an ODD number of sheets, which is what makes the bug
   * visible: an even count shifts every endnote sheet by an even number of pages, and
   * even/odd parity survives that unchanged. The count depends on how much of the note the
   * reference page itself hosts (its reserve keeps the referencing line), so retune here
   * when reserve sizing changes.
   */
  function parityDoc(footnoteLines = 20): Uint8Array {
    const footnoteParas = Array.from(
      { length: footnoteLines },
      (_, i) => `<w:p><w:r><w:t>Footnote ${i} ${'x'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const endnoteParas = Array.from(
      { length: 40 },
      (_, i) => `<w:p><w:r><w:t>Endnote ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
    ).join('');
    const body = Array.from(
      { length: 8 },
      (_, i) => `<w:p><w:r><w:t>Body ${i}</w:t></w:r></w:p>`
    ).join('');
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
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
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/settings.xml': strToU8(
        `<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Odd</w:t></w:r></w:p></w:hdr>`
      ),
      // Four lines against one, so picking the wrong variant moves the content box visibly.
      'word/header2.xml': strToU8(
        `<w:hdr xmlns:w="${W}">` +
          '<w:p><w:r><w:t>Even a</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Even b</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Even c</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Even d</w:t></w:r></w:p>' +
          '</w:hdr>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          body +
          '<w:p><w:r><w:t>Refs</w:t>' +
          '<w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p>' +
          '<w:sectPr>' +
          `<w:headerReference w:type="default" r:id="rIdH1"/>` +
          `<w:headerReference w:type="even" r:id="rIdH2"/>` +
          '<w:pgSz w:w="12240" w:h="4320"/>' +
          '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>' +
          '</w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
          `<w:footnote w:id="1">${footnoteParas}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
          '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
          `<w:endnote w:id="1">${endnoteParas}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
  }

  test('every minted sheet shows the variant its own page number resolves', () => {
    const loaded = readOoxmlPackage(parityDoc());
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const docEnd = resolveEndnoteProperties({ pos: 'docEnd' });
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [docEnd],
      documentFootnoteProps,
      documentEndnoteProps: docEnd,
      measurer,
      producer: 'parity',
    };
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    const parts = bySection[0]!;
    expect(parts.evenAndOddHeaders).toBe(true);
    const geometry = geometryOfSection(sections[0]!.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const headers = new Map();
    for (const [variant, hfPart] of parts.headers) {
      headers.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'parity'));
    }
    expect(headers.get('default')!.flowHeight).not.toBe(headers.get('even')!.flowHeight);
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes,
      producer: 'parity',
      sectionFurniture: [
        {
          titlePage: parts.titlePage,
          evenAndOddHeaders: parts.evenAndOddHeaders,
          headers,
          footers: new Map(),
        },
      ],
    });

    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    const overflow = layout.pages.filter((page) => page.noteStream === 'endnote-overflow');
    // An ODD number of drain sheets between the endnote run's anchor and where it inserts is
    // exactly what an offset counting only this run's own sheets gets wrong.
    expect(drain.length % 2).toBe(1);
    expect(overflow.length).toBeGreaterThan(0);

    for (const page of layout.pages) {
      // `w:evenAndOddHeaders` alternates on the page's number in the DOCUMENT, so the variant
      // a sheet shows is decided by where it finally lands — drain sheets in front of it
      // included.
      const expected = (page.index + 1) % 2 === 0 ? 'even' : 'default';
      expect(page.header?.variant).toBe(expected);
      const flow = headers.get(expected)!.flowHeight;
      const top = Math.max(geometry.margin.top, (geometry.headerDistance ?? 36) + flow);
      expect(page.contentBox.y - page.box.y).toBeCloseTo(top, 6);
      expect(page.contentBox.height).toBeCloseTo(geometry.height - top - geometry.margin.bottom, 6);
    }
  });
});

describe('note overflow across several runs', () => {
  /**
   * Three sections: two with `sectEnd` endnotes that overflow, one with `docEnd` endnotes that
   * also overflow, under `w:evenAndOddHeaders`.
   *
   * The doc-end run starts from the last page that can HOST endnotes, and an endnote overflow
   * sheet is one of those — `isEndnoteHostEligible` turns away only footnote drain sheets. A
   * minted sheet carries an insertion POSITION in its `index`, so anchoring on one resolves the
   * shell against a layout index that page never had.
   */
  /**
   * `midLines` is tuned so the MIDDLE section overflows by exactly one sheet. An odd number of
   * sheets between the doc-end run's anchor and the section it belongs to is what makes the
   * defect visible; an even number shifts every page by an even count and parity survives it.
   */
  function multiRunDoc(sectEndLines: number, docEndLines: number, midLines: number): Uint8Array {
    const notes = (label: string, count: number) =>
      Array.from(
        { length: count },
        (_, i) => `<w:p><w:r><w:t>${label} ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
      ).join('');
    const sectPr = (extra: string) =>
      '<w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rIdH1"/>' +
      '<w:headerReference w:type="even" r:id="rIdH2"/>' +
      '<w:pgSz w:w="12240" w:h="4320"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"' +
      ' w:header="360" w:footer="360"/>' +
      extra +
      '</w:sectPr>';
    const sectEnd = '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>';
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
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
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/settings.xml': strToU8(
        `<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Odd</w:t></w:r></w:p></w:hdr>`
      ),
      'word/header2.xml': strToU8(
        `<w:hdr xmlns:w="${W}">` +
          '<w:p><w:r><w:t>Even a</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Even b</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Even c</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>Even d</w:t></w:r></w:p>' +
          '</w:hdr>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>One</w:t><w:endnoteReference w:id="1"/></w:r></w:p>' +
          `<w:p><w:pPr>${sectPr('')}</w:pPr></w:p>` +
          '<w:p><w:r><w:t>Two</w:t><w:endnoteReference w:id="2"/></w:r></w:p>' +
          `<w:p><w:pPr>${sectPr(sectEnd)}</w:pPr></w:p>` +
          '<w:p><w:r><w:t>Three</w:t><w:endnoteReference w:id="3"/></w:r></w:p>' +
          sectPr(sectEnd) +
          '</w:body></w:document>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
          '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
          `<w:endnote w:id="1">${notes('S1', sectEndLines)}</w:endnote>` +
          `<w:endnote w:id="2">${notes('S2', midLines)}</w:endnote>` +
          `<w:endnote w:id="3">${notes('D', docEndLines)}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
  }

  test('a doc-end sheet anchored behind an earlier run keeps its own page number', () => {
    const loaded = readOoxmlPackage(multiRunDoc(20, 20, 8));
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEndProps = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const docEndProps = resolveEndnoteProperties({ pos: 'docEnd' });
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    const notesInput: NotesLayoutInput = {
      footnotesPart: null,
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: sections.map(() => documentFootnoteProps),
      endnotePropsBySection: [docEndProps, sectEndProps, sectEndProps],
      documentFootnoteProps,
      documentEndnoteProps: docEndProps,
      measurer,
      producer: 'multirun',
    };
    const furniture = sections.map((section, index) => {
      const parts = bySection[index]!;
      const geometry = geometryOfSection(section.properties);
      const width = geometry.width - geometry.margin.left - geometry.margin.right;
      const headers = new Map();
      for (const [variant, hfPart] of parts.headers) {
        headers.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'multirun'));
      }
      return {
        titlePage: parts.titlePage,
        evenAndOddHeaders: parts.evenAndOddHeaders,
        headers,
        footers: new Map(),
      };
    });
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes: notesInput,
      producer: 'multirun',
      sectionFurniture: furniture,
    });
    const geometry = geometryOfSection(sections[0]!.properties);
    const headers = furniture[0]!.headers;
    const minted = layout.pages.filter((page) => page.noteStream !== undefined);
    expect(minted.length).toBeGreaterThan(2);
    // The doc-end run starts behind sheets an earlier sectEnd run minted, and there is an ODD
    // number of them — the arrangement that inverts parity when the anchor is one of those
    // sheets rather than a page the body pass produced.
    expect(minted.some((page) => page.index > 3)).toBe(true);

    for (const page of minted) {
      // `w:evenAndOddHeaders` alternates on the page's number in the DOCUMENT, so a minted
      // sheet's variant follows where it finally lands — every sheet in front of it included.
      const expected = (page.index + 1) % 2 === 0 ? 'even' : 'default';
      expect(page.header?.variant).toBe(expected);
      const flow = headers.get(expected)!.flowHeight;
      const top = Math.max(geometry.margin.top, (geometry.headerDistance ?? 36) + flow);
      expect(page.contentBox.y - page.box.y).toBeCloseTo(top, 6);
      expect(page.contentBox.height).toBeCloseTo(geometry.height - top - geometry.margin.bottom, 6);
    }
    // Body pages are NOT asserted here. Nothing re-picks a body page's variant after an
    // insertion shifts its page number, which predates per-page insets and is out of scope.
  });
});

describe('drain sheets behind a later insertion', () => {
  /**
   * Three sections under `w:evenAndOddHeaders`: section 1 has `sectEnd` endnotes that overflow,
   * and the last body page carries a footnote that drains.
   *
   * The drain runs FIRST and appends at the end, then the section loop inserts section 1's
   * sheets in front of them. An odd number of those moves every drain sheet one page along,
   * and its variant — resolved when it was minted — no longer matches where it sits.
   */
  function drainShiftDoc(
    sectEndLines: number,
    footnoteLines: number,
    shape: { readonly evenHeaderLines?: number; readonly footers?: boolean } = {}
  ): Uint8Array {
    const story = (tag: string, label: string, count: number) =>
      `<w:${tag} xmlns:w="${W}">` +
      Array.from(
        { length: count },
        (_u, i) => `<w:p><w:r><w:t>${label} ${i}</w:t></w:r></w:p>`
      ).join('') +
      `</w:${tag}>`;
    const footerRefs = shape.footers
      ? '<w:footerReference w:type="default" r:id="rIdF1"/>' +
        '<w:footerReference w:type="even" r:id="rIdF2"/>'
      : '';
    const notes = (label: string, count: number) =>
      Array.from(
        { length: count },
        (_, i) => `<w:p><w:r><w:t>${label} ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
      ).join('');
    const sectPr = (extra: string) =>
      '<w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rIdH1"/>' +
      '<w:headerReference w:type="even" r:id="rIdH2"/>' +
      footerRefs +
      '<w:pgSz w:w="12240" w:h="4320"/>' +
      '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"' +
      ' w:header="360" w:footer="360"/>' +
      extra +
      '</w:sectPr>';
    const sectEnd = '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>';
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          (shape.footers
            ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
              '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
            : '') +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
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
          (shape.footers
            ? `<Relationship Id="rIdF1" Type="${R}/footer" Target="footer1.xml"/>` +
              `<Relationship Id="rIdF2" Type="${R}/footer" Target="footer2.xml"/>`
            : '') +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/settings.xml': strToU8(
        `<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`
      ),
      'word/header1.xml': strToU8(
        `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Odd</w:t></w:r></w:p></w:hdr>`
      ),
      'word/header2.xml': strToU8(story('hdr', 'Even', shape.evenHeaderLines ?? 4)),
      ...(shape.footers
        ? {
            'word/footer1.xml': strToU8(story('ftr', 'Odd foot', 1)),
            // Three lines against one, so the even variant moves the content box's BOTTOM.
            'word/footer2.xml': strToU8(story('ftr', 'Even foot', 3)),
          }
        : {}),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>One</w:t></w:r></w:p>' +
          `<w:p><w:pPr>${sectPr('')}</w:pPr></w:p>` +
          '<w:p><w:r><w:t>Two</w:t><w:endnoteReference w:id="1"/></w:r></w:p>' +
          `<w:p><w:pPr>${sectPr(sectEnd)}</w:pPr></w:p>` +
          '<w:p><w:r><w:t>Three</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
          sectPr('') +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
          `<w:footnote w:id="1">${notes('F', footnoteLines)}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
          '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
          `<w:endnote w:id="1">${notes('E', sectEndLines)}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
  }

  /** Lay the fixture out with per-section furniture, and hand back what the tests assert on. */
  function layoutDrainShift(bytes: Uint8Array) {
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEndProps = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const docEndProps = resolveEndnoteProperties({ pos: 'docEnd' });
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(loaded.package);
    const notesInput: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
      endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
      footnotePropsBySection: sections.map(() => documentFootnoteProps),
      endnotePropsBySection: [docEndProps, sectEndProps, docEndProps],
      documentFootnoteProps,
      documentEndnoteProps: docEndProps,
      measurer,
      producer: 'drainshift',
    };
    const furniture = sections.map((section, index) => {
      const parts = bySection[index]!;
      const geometry = geometryOfSection(section.properties);
      const width = geometry.width - geometry.margin.left - geometry.margin.right;
      const stories = (source: typeof parts.headers) => {
        const laid = new Map();
        for (const [variant, hfPart] of source) {
          laid.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'drainshift'));
        }
        return laid;
      };
      return {
        titlePage: parts.titlePage,
        evenAndOddHeaders: parts.evenAndOddHeaders,
        headers: stories(parts.headers),
        footers: stories(parts.footers),
      };
    });
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      notes: notesInput,
      producer: 'drainshift',
      sectionFurniture: furniture,
    });
    return {
      layout,
      geometry: geometryOfSection(sections[0]!.properties),
      headers: furniture[0]!.headers,
      footers: furniture[0]!.footers,
      drain: layout.pages.filter((page) => page.noteStream === 'footnote-drain'),
      inserted: layout.pages.filter((page) => page.noteStream === 'endnote-overflow'),
    };
  }

  test('a drain sheet keeps its own page number behind an earlier section insertion', () => {
    // Tuned so section 1 overflows by exactly ONE sheet: an odd number in front of the drain
    // run is what flips parity. An even one slides it by two pages and hides the defect.
    const { layout, geometry, headers, drain, inserted } = layoutDrainShift(drainShiftDoc(8, 10));
    expect(drain.length).toBeGreaterThan(0);
    // An ODD number of sheets inserted in front of the drain run: the arrangement that moves
    // every drain sheet onto the opposite parity.
    expect(inserted.length % 2).toBe(1);
    expect(Math.min(...drain.map((page) => page.index))).toBeGreaterThan(
      Math.max(...inserted.map((page) => page.index))
    );

    for (const page of drain) {
      // ONE page after the sheet it was cloned from. Deriving this from the difference between
      // an array position and a layout index counts the insertions in front of the template
      // instead, which inflates it by one per sheet an earlier section added.
      const before = layout.pages[page.index - 1]!;
      expect(page.pageFieldSource?.pageNumber).toBe((before.pageFieldSource?.pageNumber ?? 0) + 1);
    }

    for (const page of [...drain, ...inserted]) {
      const expected = (page.index + 1) % 2 === 0 ? 'even' : 'default';
      expect(page.header?.variant).toBe(expected);
      const flow = headers.get(expected)!.flowHeight;
      const top = Math.max(geometry.margin.top, (geometry.headerDistance ?? 36) + flow);
      expect(page.contentBox.y - page.box.y).toBeCloseTo(top, 6);
      expect(page.contentBox.height).toBeCloseTo(geometry.height - top - geometry.margin.bottom, 6);
    }
  });

  test('a shifted sheet re-picks its variant even when both are the same height', () => {
    // Two ONE-LINE header variants. The insets a shifted sheet resolves are then identical to
    // the ones it carries, so anything that compares only the box sees nothing to do and leaves
    // the sheet showing the other variant's story — the common shape, not an exotic one.
    const { geometry, headers, drain, inserted } = layoutDrainShift(
      drainShiftDoc(14, 10, { evenHeaderLines: 1 })
    );
    expect(headers.get('default')!.flowHeight).toBe(headers.get('even')!.flowHeight);
    expect(drain.length).toBeGreaterThan(0);
    expect(inserted.length % 2).toBe(1);

    for (const page of [...drain, ...inserted]) {
      const expected = (page.index + 1) % 2 === 0 ? 'even' : 'default';
      expect(page.header?.variant).toBe(expected);
      // Same height either way, so the box alone can never tell these two apart.
      const top = Math.max(
        geometry.margin.top,
        (geometry.headerDistance ?? 36) + headers.get(expected)!.flowHeight
      );
      expect(page.contentBox.y - page.box.y).toBeCloseTo(top, 6);
    }
  });

  test('a shifted sheet keeps its notes inside the box its footer variant resolves', () => {
    // Equal-height HEADERS so the content top never moves, and a taller `even` FOOTER so the
    // bottom does. A `pageBottom` note area hangs from that bottom: left where it was when the
    // box shrinks under it, the notes paint over the footer band. Checking only the new top
    // waves that through, because the top is exactly what did not change.
    const { geometry, footers, drain, inserted } = layoutDrainShift(
      drainShiftDoc(14, 24, { evenHeaderLines: 1, footers: true })
    );
    expect(footers.get('even')!.flowHeight).toBeGreaterThan(footers.get('default')!.flowHeight);
    expect(drain.length).toBeGreaterThan(0);
    expect(inserted.length % 2).toBe(1);

    for (const page of [...drain, ...inserted]) {
      const expected = (page.index + 1) % 2 === 0 ? 'even' : 'default';
      expect(page.footer?.variant).toBe(expected);
      const bottom = page.contentBox.y + page.contentBox.height;
      for (const area of [page.footnotes, page.endnotes]) {
        if (!area) continue;
        expect(area.box.y).toBeGreaterThanOrEqual(page.contentBox.y - 0.001);
        expect(area.box.y + area.box.height).toBeLessThanOrEqual(bottom + 0.001);
        // And clear of the footer the sheet actually shows.
        expect(bottom).toBeLessThanOrEqual(page.footer!.box.y + 0.001);
      }
      // The box itself still agrees with the variant it shows.
      const footerDistance = geometry.footerDistance ?? 36;
      const resolved = Math.max(
        geometry.margin.bottom,
        footerDistance + footers.get(expected)!.flowHeight
      );
      expect(geometry.height - (bottom - page.box.y)).toBeCloseTo(resolved, 6);
    }
  });
});

describe('sheet order in a last section that both drains and overflows', () => {
  /**
   * One section whose last body page carries a footnote that drains AND whose `sectEnd`
   * endnotes overflow.
   *
   * Footnote continuation is the section's running content, so it comes first; the section's
   * endnotes come after all of it. `sectionEndInsertBound` returns `pages.length` for a last
   * section, so its endnote sheets append at the document's end — which only lands after the
   * continuation while the drain has already run.
   */
  function lastSectionDoc(): Uint8Array {
    const notes = (label: string, count: number) =>
      Array.from(
        { length: count },
        (_, i) => `<w:p><w:r><w:t>${label} ${i} ${'z'.repeat(60)}</w:t></w:r></w:p>`
      ).join('');
    return zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
          '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' +
          '</Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}">` +
          `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
          '</Relationships>'
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
          '<w:p><w:r><w:t>Body</w:t>' +
          '<w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p>' +
          '<w:sectPr>' +
          '<w:pgSz w:w="12240" w:h="4320"/>' +
          '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"' +
          ' w:header="360" w:footer="360"/>' +
          '<w:endnotePr><w:pos w:val="sectEnd"/></w:endnotePr>' +
          '</w:sectPr>' +
          '</w:body></w:document>'
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
          `<w:footnote w:id="1">${notes('F', 30)}</w:footnote>` +
          '</w:footnotes>'
      ),
      'word/endnotes.xml': strToU8(
        `<w:endnotes xmlns:w="${W}">` +
          '<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>' +
          '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
          `<w:endnote w:id="1">${notes('E', 30)}</w:endnote>` +
          '</w:endnotes>'
      ),
    });
  }

  test('footnote continuation comes before the section endnotes', () => {
    const loaded = readOoxmlPackage(lastSectionDoc());
    if (!loaded.ok) throw new Error(loaded.reason);
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const sectEnd = resolveEndnoteProperties(undefined, { pos: 'sectEnd' });
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'order',
      notes: {
        footnotesPart: resolveNotesPart(loaded.package, 'footnote'),
        endnotesPart: resolveNotesPart(loaded.package, 'endnote'),
        footnotePropsBySection: [documentFootnoteProps],
        endnotePropsBySection: [sectEnd],
        documentFootnoteProps,
        documentEndnoteProps: sectEnd,
        measurer,
        producer: 'order',
      },
    });

    const drain = layout.pages.filter((page) => page.noteStream === 'footnote-drain');
    const overflow = layout.pages.filter((page) => page.noteStream === 'endnote-overflow');
    expect(drain.length).toBeGreaterThan(0);
    expect(overflow.length).toBeGreaterThan(0);
    // Continuation first, endnotes after — every one of them.
    expect(Math.max(...drain.map((page) => page.index))).toBeLessThan(
      Math.min(...overflow.map((page) => page.index))
    );
  });
});
