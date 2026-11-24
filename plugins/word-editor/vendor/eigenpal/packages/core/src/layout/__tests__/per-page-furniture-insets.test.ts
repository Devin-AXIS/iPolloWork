// Per-page header/footer variant resolution, and the content box each page derives from it.
//
// The fixture's section sets `w:titlePg`, references a DEFAULT header and a FIRST-page footer,
// and declares neither of the opposite pair. So the two pages disagree: page 1 has a footer and
// no header, page 2 has a header and no footer. Word derives each page's content box from the
// variant THAT page shows; a worst case over the variants starts page 1's body a whole header
// below where Word puts it and pushes content onto a sheet Word does not have.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import { convergenceTailShiftAllowed } from '../page-reuse-guards.ts';
import { readOoxmlPackage, resolveHeaderFooterPartsBySection } from '@docx-editor.dev/core/store';
import type { OoxmlPackage, OoxmlPart } from '@docx-editor.dev/core/store';
import type { PageRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const FIXTURE = resolve(import.meta.dir, '../../../../../e2e/fixtures/title-page-furniture.docx');

const measurer = createFixedMeasurer(6, 14);

/** `w:pgSz`/`w:pgMar` of the fixture's section, in points. */
const PAGE_HEIGHT_PT = 15840 / 20;
const MARGIN_TOP_PT = 1080 / 20;
const MARGIN_BOTTOM_PT = 2880 / 20;
const FOOTER_DISTANCE_PT = 720 / 20;

function furnitureFromPackage(
  pkg: OoxmlPackage,
  part: OoxmlPart
): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source) {
        laid.set(variant, layoutHeaderFooterStory(hfPart, width, measurer, 'test'));
      }
      return laid;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  });
}

function layoutOf(bytes: Uint8Array): ReturnType<typeof layoutSemanticDocument> {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error('fixture failed to load');
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    sectionFurniture: furnitureFromPackage(loaded.package, part),
  });
}

function storyTextOf(story: PageRecord['header']): string {
  return (
    story?.fragments
      .flatMap((fragment) =>
        fragment.kind === 'paragraph'
          ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
          : []
      )
      .join('') ?? ''
  );
}

/** The fixture's `w:sectPr`, optionally with a break type of its own. */
function sectPr(breakType?: string): string {
  return (
    '<w:sectPr>' +
    (breakType ? `<w:type w:val="${breakType}"/>` : '') +
    '<w:headerReference w:type="default" r:id="rId7"/>' +
    '<w:footerReference w:type="first" r:id="rId8"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1080" w:right="720" w:bottom="2880" w:left="720"' +
    ' w:header="1080" w:footer="720"/>' +
    '<w:titlePg/>' +
    '</w:sectPr>'
  );
}

function lines(count: number, label: string): string {
  return Array.from(
    { length: count },
    (_unused, index) => `<w:p><w:r><w:t>${label} ${index + 1}</w:t></w:r></w:p>`
  ).join('');
}

/**
 * The fixture's section shape with a body of `paragraphs` lines.
 *
 * Same references and same `w:pgMar` as the fixture; only the amount of body changes, so a
 * test can put content in the band that fits page 1's taller box and not the section-wide one.
 * `continuedParagraphs` appends a second section that resumes the first one's sheet.
 */
function titlePageDoc(paragraphs: number, continuedParagraphs = 0): Uint8Array {
  const body =
    continuedParagraphs > 0
      ? `${lines(paragraphs, 'Line')}<w:p><w:pPr>${sectPr()}</w:pPr></w:p>` +
        lines(continuedParagraphs, 'Continued')
      : lines(paragraphs, 'Line');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId8" Type="${R}/footer" Target="footer1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}">` +
        '<w:p><w:r><w:t>Header line one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Header line two</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Header line three</w:t></w:r></w:p>' +
        '</w:hdr>'
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer line</w:t></w:r></w:p></w:ftr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        sectPr(continuedParagraphs > 0 ? 'continuous' : undefined) +
        '</w:body></w:document>'
    ),
  });
}

describe('per-page header/footer variant insets', () => {
  test('a title page with no first-page header starts its body at w:pgMar/@w:top', () => {
    const layout = layoutOf(new Uint8Array(readFileSync(FIXTURE)));
    expect(layout.pages.length).toBe(2);
    const [first, second] = layout.pages as readonly [PageRecord, PageRecord];

    // Page 1 resolves to the first-page variants: no header reference, so no header at all.
    expect(first.header).toBeUndefined();
    expect(first.contentBox.y - first.box.y).toBe(MARGIN_TOP_PT);

    // Page 2 resolves to the default variants, and its header pushes its own content box down.
    expect(second.header?.variant).toBe('default');
    const headerHeight = second.header!.box.height;
    expect(headerHeight).toBeGreaterThan(0);
    expect(second.contentBox.y - second.box.y).toBeCloseTo(MARGIN_TOP_PT + headerHeight, 6);

    // The page WITHOUT a header is the taller one, by exactly the header it does not show.
    expect(first.contentBox.height - second.contentBox.height).toBeCloseTo(headerHeight, 6);
  });

  test('the first-page footer sits w:footer above the bottom of its own page', () => {
    const layout = layoutOf(new Uint8Array(readFileSync(FIXTURE)));
    const [first, second] = layout.pages as readonly [PageRecord, PageRecord];

    expect(first.footer?.variant).toBe('first');
    const footer = first.footer!;
    expect(footer.box.y + footer.box.height - first.box.y).toBeCloseTo(
      PAGE_HEIGHT_PT - FOOTER_DISTANCE_PT,
      6
    );
    // The section declares no default footer, so page 2 shows none — and keeps `w:pgMar`.
    expect(second.footer).toBeUndefined();
    expect(second.box.y + PAGE_HEIGHT_PT - (second.contentBox.y + second.contentBox.height)).toBe(
      MARGIN_BOTTOM_PT
    );
  });

  test('a PAGE field renders its \\# numeric picture, not the cached result', () => {
    const layout = layoutOf(new Uint8Array(readFileSync(FIXTURE)));
    // The file caches `07`, a page this document does not have.
    expect(storyTextOf(layout.pages[1]!.header)).toContain('Pg. 02');
    expect(storyTextOf(layout.pages[1]!.header)).not.toContain('07');
  });

  test('the header-free first page holds more body than a default-header page would', () => {
    const headerHeight = layoutOf(titlePageDoc(200)).pages[1]!.header!.box.height;
    // What the whole section used to get: every sheet inset by the tallest variant.
    const sectionWideBox = PAGE_HEIGHT_PT - (MARGIN_TOP_PT + headerHeight) - MARGIN_BOTTOM_PT;

    // The most body that still lands on one page.
    let single = layoutOf(titlePageDoc(1));
    for (let lines = 2; lines <= 200; lines += 1) {
      const next = layoutOf(titlePageDoc(lines));
      if (next.pages.length > 1) break;
      single = next;
    }
    expect(single.pages.length).toBe(1);

    const used = Math.max(
      ...single.pages[0]!.fragments.map((fragment) => fragment.box.y + fragment.box.height)
    );
    expect(used).toBeGreaterThan(sectionWideBox);
  });

  test('a continuous section flows against the host sheet box, not its own first page', () => {
    // Both sections carry `w:titlePg` and the same references — the copied-`sectPr` shape.
    // Section 2's local page 0 IS section 1's last sheet, so it
    // must use that sheet's box: resolving its own `first` variant hands it a box taller by a
    // whole header and packs content past the host's content bottom into the bottom margin.
    const layout = layoutOf(titlePageDoc(60, 30));
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      const used = Math.max(
        0,
        ...page.fragments.map((fragment) => fragment.box.y + fragment.box.height)
      );
      expect(used).toBeLessThanOrEqual(page.contentBox.height + 0.001);
    }
  });
});

describe('convergence tail shift over a page-0 that differs from its neighbours', () => {
  const base = {
    titlePage: false,
    continuedInsets: false,
    firstPageBorders: false,
    evenAndOddHeaders: false,
    parityDependent: false,
    usedPageParity: false,
    hasNoteReserves: false,
    hasExclusionZones: false,
  };
  // The three reasons index 0 differs from its neighbours. The third is not a content box:
  // a `w:pgBorders` frame filtered by `w:display` is drawn — or not drawn — according to
  // whether the sheet IS page 0, so a remapped tail carries the wrong frame across it.
  const reasons = [
    ['a title-page variant', { titlePage: true }],
    ['a continued host sheet', { continuedInsets: true }],
    ['a first-page-filtered page border', { firstPageBorders: true }],
  ] as const;

  for (const [reason, special] of reasons) {
    test(`refuses a tail that would carry page 0, or land on it, with ${reason}`, () => {
      const inputs = { ...base, ...special };
      // The tail starts at page 0 and moves: the special sheet is IN it.
      expect(convergenceTailShiftAllowed({ ...inputs, delta: 1, markPageCount: 0 })).toBe(false);
      // The tail starts after page 0 but a negative delta lands it ON page 0, where
      // `remapPage` would keep a header record and a content box page 0 never resolves to.
      expect(convergenceTailShiftAllowed({ ...inputs, delta: -2, markPageCount: 2 })).toBe(false);
    });

    test(`allows a shift that keeps the tail clear of page 0, with ${reason}`, () => {
      const inputs = { ...base, ...special };
      expect(convergenceTailShiftAllowed({ ...inputs, delta: 2, markPageCount: 1 })).toBe(true);
      expect(convergenceTailShiftAllowed({ ...inputs, delta: -1, markPageCount: 2 })).toBe(true);
    });
  }

  test('a page 0 like every other page carries nothing a shift can invalidate', () => {
    // NEITHER reason: no title-page variant and not a continued sheet. Before per-page insets
    // every page in a section shared one box and this was true of any section at all.
    expect(convergenceTailShiftAllowed({ ...base, delta: -2, markPageCount: 2 })).toBe(true);
    expect(convergenceTailShiftAllowed({ ...base, delta: 1, markPageCount: 0 })).toBe(true);
  });
});
