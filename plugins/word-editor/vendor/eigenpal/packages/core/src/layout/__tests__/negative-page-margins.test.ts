// Negative `w:pgMar/@w:top` and `@w:bottom` (ECMA-376 §17.6.11).
//
// A non-negative top margin is a minimum: a header taller than it pushes the body down. A
// negative one is exact: the body starts at its absolute value whatever the header's height,
// and the header overlaps the body. The bottom margin mirrors this against the footer. Before
// this, the signed value reached the inset arithmetic as a small number that any header beat,
// so a tall header (a column of line numbers down the page, say) pushed every page's body below
// the header and more than doubled the page count.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { applyTreeOp, readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type PageFurniture,
} from '../index.ts';
import { createLayoutSession } from '../layout-session.ts';
import type { NotesLayoutInput } from '../note-pagination.ts';
import { createPageContentInsets, type HeaderFooterVariantName } from '../page-furniture-insets.ts';
import type { HeaderFooterStoryLayout } from '../hf-layout.ts';
import { pageBorderFrame } from '../page-border-frame.ts';
import { bodyTableVerticalAnchorFrames } from '../table-float-position.ts';
import type { PageRecord, SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const measurer = createFixedMeasurer(6, 14);

/** Letter, 792pt tall; top -1296 twips = 64.8pt, bottom -1152 twips = 57.6pt. */
const PAGE_HEIGHT = 792;
const TOP = 64.8;
const BOTTOM = 57.6;
const HEADER_DISTANCE = 36;

interface DocOptions {
  readonly top: number;
  readonly bottom: number;
  readonly body: string;
  /** Extra sectPr children (for example `<w:titlePg/>`). */
  readonly sectExtra?: string;
  readonly footnote?: string;
  /** `w:type` of the final section. */
  readonly breakType?: string;
  /** `w:pgMar/@w:header` in twips; 720 when absent. */
  readonly header?: number;
}

function lines(count: number, label: string): string {
  return Array.from(
    { length: count },
    (_unused, index) => `<w:p><w:r><w:t>${label} ${index + 1}</w:t></w:r></w:p>`
  ).join('');
}

function sectPr(top: number, bottom: number, extra = '', breakType?: string, header = 720): string {
  return (
    '<w:sectPr>' +
    (breakType ? `<w:type w:val="${breakType}"/>` : '') +
    '<w:headerReference w:type="default" r:id="rIdH1"/>' +
    '<w:headerReference w:type="first" r:id="rIdH2"/>' +
    '<w:footerReference w:type="default" r:id="rIdF1"/>' +
    '<w:pgSz w:w="12240" w:h="15840"/>' +
    `<w:pgMar w:top="${top}" w:right="720" w:bottom="${bottom}" w:left="2160"` +
    ` w:header="${header}" w:footer="144" w:gutter="0"/>` +
    extra +
    '</w:sectPr>'
  );
}

/** A header of `count` one-line paragraphs, taller than any margin in these tests. */
const tallStory = (tag: 'hdr' | 'ftr', count: number): string =>
  `<w:${tag} xmlns:w="${W}">${lines(count, tag)}</w:${tag}>`;

function docBytes(options: DocOptions): Uint8Array {
  const footnotes = options.footnote !== undefined;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        (footnotes
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH1" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdH2" Type="${R}/header" Target="header2.xml"/>` +
        `<Relationship Id="rIdF1" Type="${R}/footer" Target="footer1.xml"/>` +
        (footnotes
          ? `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>`
          : '') +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(tallStory('hdr', 28)),
    'word/header2.xml': strToU8(tallStory('hdr', 28)),
    'word/footer1.xml': strToU8(tallStory('ftr', 12)),
    ...(footnotes
      ? {
          'word/footnotes.xml': strToU8(
            `<w:footnotes xmlns:w="${W}">` +
              '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
              '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
              `<w:footnote w:id="1">${options.footnote}</w:footnote>` +
              '</w:footnotes>'
          ),
        }
      : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${options.body}` +
        sectPr(options.top, options.bottom, options.sectExtra, options.breakType, options.header) +
        '</w:body></w:document>'
    ),
  });
}

function load(bytes: Uint8Array) {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { pkg: loaded.package, part };
}

/** Lay the header/footer parts out once, the same way for every section. */
function furnitureOf(
  pkg: ReturnType<typeof load>['pkg'],
  part: OoxmlPart,
  flags: { readonly titlePage: boolean; readonly evenAndOddHeaders?: boolean }
): readonly PageFurniture[] {
  const sections = enumerateDocumentSections(part);
  const story = (name: string) => {
    const geometry = geometryOfSection(sections[0]!.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    return layoutHeaderFooterStory(pkg.parts.get(name)!, width, measurer, 'test');
  };
  const headers = new Map<HeaderFooterVariantName, HeaderFooterStoryLayout>([
    ['default', story('/word/header1.xml')],
    ['first', story('/word/header2.xml')],
  ]);
  if (flags.evenAndOddHeaders) headers.set('even', story('/word/header2.xml'));
  const footers = new Map<HeaderFooterVariantName, HeaderFooterStoryLayout>([
    ['default', story('/word/footer1.xml')],
  ]);
  return sections.map(() => ({
    titlePage: flags.titlePage,
    evenAndOddHeaders: flags.evenAndOddHeaders ?? false,
    headers,
    footers,
  }));
}

function layoutDoc(
  options: DocOptions,
  flags: { readonly titlePage: boolean; readonly evenAndOddHeaders?: boolean } = {
    titlePage: false,
  }
): SemanticLayout {
  const { pkg, part } = load(docBytes(options));
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    sectionFurniture: furnitureOf(pkg, part, flags),
  });
}

const topInset = (page: PageRecord) => page.contentBox.y - page.box.y;
/** Where the page's header ends, measured from the sheet top (§17.10). */
const headerBottom = (page: PageRecord) =>
  page.header!.box.y + page.header!.box.height - page.box.y;
const bottomInset = (page: PageRecord) =>
  page.box.y + page.box.height - (page.contentBox.y + page.contentBox.height);

describe('signed vertical page margins in section geometry', () => {
  function geometryOf(pgMar: string) {
    const sectPrXml =
      `<w:document xmlns:w="${W}"><w:body><w:p/>` +
      `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${pgMar}</w:sectPr></w:body></w:document>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(sectPrXml),
    });
    const doc = load(bytes).part;
    const sections = enumerateDocumentSections(doc);
    return geometryOfSection(sections[sections.length - 1]!.properties);
  }

  test('keeps the authored sign so cache keys tell exact margins from minimums', () => {
    const geometry = geometryOf(
      '<w:pgMar w:top="-1296" w:right="720" w:bottom="-1152" w:left="2160" w:header="720" w:footer="144" w:gutter="0"/>'
    );
    expect(geometry.margin.top).toBeCloseTo(-TOP, 6);
    expect(geometry.margin.bottom).toBeCloseTo(-BOTTOM, 6);
  });

  test('keeps top and bottom margins that together pass the sheet height', () => {
    // 8000 + 8000 twips is taller than the 15840-twip sheet. The margins stay as authored;
    // the content box keeps one point of column at the top margin instead.
    const geometry = geometryOf(
      '<w:pgMar w:top="8000" w:right="720" w:bottom="8000" w:left="720" w:header="720" w:footer="720" w:gutter="0"/>'
    );
    expect(geometry.margin.top).toBe(400);
    expect(geometry.margin.bottom).toBe(400);
  });

  test('still falls back when the side margins leave no content width', () => {
    const geometry = geometryOf(
      '<w:pgMar w:top="1440" w:right="6200" w:bottom="1440" w:left="6200" w:header="720" w:footer="720" w:gutter="0"/>'
    );
    expect(geometry.margin.left).toBe(72);
    expect(geometry.margin.right).toBe(72);
  });
});

describe('page content insets for a negative margin', () => {
  const story = { flowHeight: 400 } as HeaderFooterStoryLayout;
  const furniture: PageFurniture = {
    titlePage: false,
    evenAndOddHeaders: false,
    headers: new Map<HeaderFooterVariantName, HeaderFooterStoryLayout>([['default', story]]),
    footers: new Map<HeaderFooterVariantName, HeaderFooterStoryLayout>([['default', story]]),
  };
  const inputs = {
    furniture,
    pageHeight: PAGE_HEIGHT,
    headerDistance: HEADER_DISTANCE,
    footerDistance: 7.2,
    pageIndexStart: 0,
  };

  test('a negative margin is the exact inset, not moved by a taller header or footer', () => {
    const insets = createPageContentInsets({ ...inputs, marginTop: -TOP, marginBottom: -BOTTOM })(
      0
    );
    expect(insets.top).toBeCloseTo(TOP, 6);
    expect(insets.bottom).toBeCloseTo(BOTTOM, 6);
    expect(insets.height).toBeCloseTo(PAGE_HEIGHT - TOP - BOTTOM, 6);
  });

  test('a positive margin of the same size is still a minimum the furniture pushes', () => {
    const insets = createPageContentInsets({ ...inputs, marginTop: TOP, marginBottom: BOTTOM })(0);
    // The header takes its full 36 + 400. The footer wants 7.2 + 400 but stops where one
    // point of column is left, so pagination still has a box to flow into.
    expect(insets.top).toBeCloseTo(HEADER_DISTANCE + 400, 6);
    expect(insets.height).toBeCloseTo(1, 6);
  });

  test('a negative margin past two fifths of the sheet stays exact (§17.6.11)', () => {
    const insets = createPageContentInsets({
      ...inputs,
      marginTop: -500,
      marginBottom: 72,
    })(0);
    expect(insets.top).toBeCloseTo(500, 6);
    // The positive bottom lets the footer push up to the one-point column floor.
    expect(insets.height).toBeCloseTo(1, 6);
  });
});

describe('body flow with negative vertical margins and tall furniture', () => {
  const body = lines(160, 'Body line');

  test('every page starts the body at |top| and ends it at |bottom|, first page included', () => {
    const layout = layoutDoc(
      { top: -1296, bottom: -1152, body, sectExtra: '<w:titlePg/>' },
      { titlePage: true }
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      expect(topInset(page)).toBeCloseTo(TOP, 6);
      expect(bottomInset(page)).toBeCloseTo(BOTTOM, 6);
      // The header keeps its own position and full height: it overlaps the body.
      expect(page.header).toBeDefined();
      expect(page.header!.box.y - page.box.y).toBeCloseTo(HEADER_DISTANCE, 6);
      expect(page.header!.box.y + page.header!.box.height).toBeGreaterThan(page.contentBox.y);
      for (const fragment of page.fragments) {
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(
          page.contentBox.height + 0.001
        );
      }
    }
    expect(layout.pages[0]!.header!.variant).toBe('first');
  });

  test('the same magnitudes, positive, still let the tall header push the body down', () => {
    const negative = layoutDoc({ top: -1296, bottom: -1152, body });
    const positive = layoutDoc({ top: 1296, bottom: 1152, body });
    expect(topInset(positive.pages[0]!)).toBeCloseTo(headerBottom(positive.pages[0]!), 6);
    expect(topInset(positive.pages[0]!)).toBeGreaterThan(PAGE_HEIGHT * 0.4);
    expect(positive.pages.length).toBeGreaterThan(negative.pages.length);
  });

  test('with no header or footer, the body still starts at |top| and ends at |bottom|', () => {
    const { part } = load(docBytes({ top: -1296, bottom: -1152, body }));
    const layout = layoutSemanticDocument(part, 1, { measurer, producer: 'test' });
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      expect(page.header).toBeUndefined();
      expect(topInset(page)).toBeCloseTo(TOP, 6);
      expect(bottomInset(page)).toBeCloseTo(BOTTOM, 6);
    }
  });

  test('top -720 with header 1440 puts the text at 36pt and the header at 72pt', () => {
    // The worked example of ECMA-376 Part 1, 17.6.11: the header sits below the text top.
    const layout = layoutDoc({ top: -720, bottom: -1152, body, header: 1440 });
    for (const page of layout.pages) {
      expect(topInset(page)).toBeCloseTo(36, 6);
      expect(page.header!.box.y - page.box.y).toBeCloseTo(72, 6);
    }
  });

  test('an even-page header does not push the body either', () => {
    const layout = layoutDoc(
      { top: -1296, bottom: -1152, body },
      { titlePage: false, evenAndOddHeaders: true }
    );
    expect(layout.pages.length).toBeGreaterThan(2);
    expect(layout.pages[1]!.header!.variant).toBe('even');
    for (const page of layout.pages) expect(topInset(page)).toBeCloseTo(TOP, 6);
  });

  test('a continuous negative-margin section keeps the host sheet box, then its own', () => {
    // Section 1: positive margins, so its tall header pushes its body below the header.
    // Section 2: continuous and negative, so its own later sheets start at |top|.
    const docBody =
      lines(10, 'Host') +
      `<w:p><w:pPr>${sectPr(1296, 1152)}</w:pPr></w:p>` +
      lines(160, 'Continued');
    const { pkg, part } = load(
      docBytes({ top: -1296, bottom: -1152, body: docBody, breakType: 'continuous' })
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureOf(pkg, part, { titlePage: false }),
    });
    expect(topInset(layout.pages[0]!)).toBeCloseTo(headerBottom(layout.pages[0]!), 6);
    const later = layout.pages.slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const page of later) expect(topInset(page)).toBeCloseTo(TOP, 6);
  });

  test('a page border measured from the text reads the margin magnitudes', () => {
    const edge = { val: 'single', color: null, widthPt: 1, spacePt: 4 } as const;
    const borders = {
      offsetFrom: 'text',
      display: 'allPages',
      zOrder: 'front',
      top: edge,
      bottom: edge,
      left: edge,
      right: edge,
    } as const;
    const geometry = (sign: number) => ({
      width: 612,
      height: PAGE_HEIGHT,
      margin: { top: sign * TOP, right: 36, bottom: sign * BOTTOM, left: 108 },
    });
    const negative = pageBorderFrame(borders, geometry(-1), true);
    expect(negative).toBeDefined();
    expect(negative).toEqual(pageBorderFrame(borders, geometry(1), true)!);
  });

  test('a margin-relative table frame starts at the margin magnitude', () => {
    const input = {
      pageHeight: PAGE_HEIGHT,
      contentInsetTop: TOP,
      contentHeight: 600,
      marginBottom: BOTTOM,
    };
    expect(bodyTableVerticalAnchorFrames(input, 0, -TOP).margin).toEqual(
      bodyTableVerticalAnchorFrames(input, 0, TOP).margin
    );
  });
});

describe('notes and incremental reuse under negative vertical margins', () => {
  test('footnotes stay inside the exact content box, drain sheets included', () => {
    const noteParas = lines(90, 'Footnote text');
    const bytes = docBytes({
      top: -1296,
      bottom: -1152,
      body: '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>',
      footnote: noteParas,
    });
    const { pkg, part } = load(bytes);
    const documentFootnoteProps = resolveFootnoteProperties(undefined, undefined);
    const documentEndnoteProps = resolveEndnoteProperties(undefined);
    const notes: NotesLayoutInput = {
      footnotesPart: resolveNotesPart(pkg, 'footnote'),
      endnotesPart: null,
      footnotePropsBySection: [documentFootnoteProps],
      endnotePropsBySection: [documentEndnoteProps],
      documentFootnoteProps,
      documentEndnoteProps,
      measurer,
      producer: 'test',
    };
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      notes,
      sectionFurniture: furnitureOf(pkg, part, { titlePage: false }),
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      expect(topInset(page)).toBeCloseTo(TOP, 6);
      expect(bottomInset(page)).toBeCloseTo(BOTTOM, 6);
      if (!page.footnotes) continue;
      expect(page.footnotes.box.y).toBeGreaterThanOrEqual(page.contentBox.y - 0.001);
      expect(page.footnotes.box.y + page.footnotes.box.height).toBeLessThanOrEqual(
        page.contentBox.y + page.contentBox.height + 0.001
      );
    }
  });

  test('flipping the sign of the top margin invalidates a warm session', () => {
    const body = lines(120, 'Body line');
    const positive = load(docBytes({ top: 1296, bottom: 1152, body }));
    const negative = load(docBytes({ top: -1296, bottom: -1152, body }));
    const session = createLayoutSession();
    const run = (doc: typeof positive, revision: number) =>
      layoutSemanticDocument(doc.part, revision, {
        measurer,
        producer: 'test',
        session,
        sectionFurniture: furnitureOf(doc.pkg, doc.part, { titlePage: false }),
      });
    const warm = run(positive, 1).pages[1]!;
    expect(topInset(warm)).toBeCloseTo(headerBottom(warm), 6);
    const flipped = run(negative, 2);
    for (const page of flipped.pages) expect(topInset(page)).toBeCloseTo(TOP, 6);
    const rewarmed = run(positive, 3).pages[1]!;
    expect(topInset(rewarmed)).toBeCloseTo(headerBottom(rewarmed), 6);
  });
});

describe('page setup writes over an authored negative margin', () => {
  test('keeps the signed top and refuses a write the read side would fall back on', () => {
    const kept = load(docBytes({ top: -1296, bottom: -1152, body: '<w:p/>' })).part;
    const result = applyTreeOp(kept, { op: 'setSectionProperties', marginLeftTwips: 1440 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(serializeOoxmlPart(result.part)).toContain('w:top="-1296"');

    const swallowed = load(docBytes({ top: -8000, bottom: -8000, body: '<w:p/>' })).part;
    const refused = applyTreeOp(swallowed, { op: 'setSectionProperties', marginLeftTwips: 1440 });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('invalid-property-value');
  });
});
