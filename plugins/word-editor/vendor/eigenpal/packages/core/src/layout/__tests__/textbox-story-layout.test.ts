// Textbox story layout: extent-bounded flow, per-page PAGE/NUMPAGES projection, bounds,
// and clipped furniture paint at the resolved anchor position.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  storyBlocks,
  type PageFurniture,
  type SemanticLayout,
} from '../index.ts';
import {
  layoutHeaderFooterStory,
  storyListMarkerToken,
  type HeaderFooterStoryLayout,
} from '../hf-layout.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createParagraphLayoutCache, type ParagraphLayoutCache } from '../layout-cache.ts';
import { flowBlocksInBox } from '../semantic-table-layout.ts';
import type { PendingLine } from '../paragraph-flow.ts';
import {
  hostedTextboxContents,
  hostedStoryFlowDeps,
  layoutTextboxStory,
  MAX_TEXTBOX_STORY_NESTING,
  type TextboxStoryLayout,
} from '../textbox-story-layout.ts';
import type { InlineDrawingLayoutContext } from '../drawing-layout.ts';
import {
  readOoxmlPackage,
  readOoxmlPart,
  resolveHeaderFooterPartsBySection,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const FIXTURES_DIR = resolve(import.meta.dir, '../../../../../e2e/fixtures');
const measurer = createFixedMeasurer(6, 14);

/** Anchored, page-positioned, wrap-none textbox drawing with the given story content. */
function textboxDrawing(
  content: string,
  options: {
    readonly cx?: number;
    readonly cy?: number;
    readonly bodyPr?: string;
    readonly posV?: number;
  } = {}
): string {
  const cx = options.cx ?? 914_400;
  const cy = options.cy ?? 457_200;
  const bodyPr = options.bodyPr ?? '<wps:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/>';
  const posV = options.posV ?? 9_000_000;
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ' relativeHeight="1" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>3600450</wp:posOffset></wp:positionH>' +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${posV}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="TB"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
    `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` +
    bodyPr +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

const PAGE_FIELD_PARAGRAPH =
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:r><w:t>99</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

function footerTextboxDoc(footerDrawing: string, bodyParagraphs = 30): Uint8Array {
  const body = Array.from(
    { length: bodyParagraphs },
    (_, i) => `<w:p><w:r><w:t>body line ${i} ${'word '.repeat(12)}</w:t></w:r></w:p>`
  ).join('');
  const ns = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(`<w:ftr ${ns}><w:p><w:r>${footerDrawing}</w:r></w:p></w:ftr>`),
    'word/document.xml': strToU8(
      `<w:document ${ns}><w:body>${body}` +
        '<w:sectPr><w:footerReference w:type="default" r:id="rId1"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
  });
}

function openPackage(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function drawingLayoutFor(part: OoxmlPart): InlineDrawingLayoutContext {
  const atomProjections = indexInlineDrawingProjectionsInPart(part);
  const ready = mockReadyImageResource({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  });
  return {
    ownerPartName: part.name,
    projectionForAtom: (atomId) => atomProjections.get(atomId) ?? null,
    project: (node) =>
      atomProjections.get(node.id) ??
      projectDrawing(node, {
        ownerPartName: part.name,
        limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
      }),
    resourceOf: () => ready,
  };
}

function layoutFooterStory(
  part: OoxmlPart,
  geometry: ReturnType<typeof geometryOfSection>,
  numberingIndex?: ReturnType<typeof buildNumberingIndex>,
  cache?: ParagraphLayoutCache<readonly PendingLine[]>
) {
  const width = geometry.width - geometry.margin.left - geometry.margin.right;
  return layoutHeaderFooterStory(
    part,
    width,
    measurer,
    'test',
    cache,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    drawingLayoutFor(part),
    undefined,
    undefined,
    {
      pageNumber: 1,
      pageWidth: geometry.width,
      pageHeight: geometry.height,
      marginLeft: geometry.margin.left,
      marginRight: geometry.margin.right,
      marginTop: geometry.margin.top,
      marginBottom: geometry.margin.bottom,
    },
    undefined,
    numberingIndex ? { numberingIndex } : undefined
  );
}

function furnitureWithDrawings(
  pkg: OoxmlPackage,
  part: OoxmlPart
): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source)
        laid.set(variant, layoutFooterStory(hfPart, geometry));
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

function storyOfRecord(story: HeaderFooterStoryLayout | undefined): TextboxStoryLayout {
  const record = story?.anchoredDrawings?.[0];
  if (!record?.textboxStory) throw new Error('no textbox story on record');
  return record.textboxStory;
}

function storyText(story: TextboxStoryLayout): string {
  return story.fragments
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.flatMap((line) => line.spans.map((span) => span.text))
        : []
    )
    .join('');
}

function layoutDocumentWithFooters(
  bytes: Uint8Array,
  session?: ReturnType<typeof createLayoutSession>
) {
  const pkg = openPackage(bytes);
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  return {
    pkg,
    part,
    layout: layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furnitureWithDrawings(pkg, part),
      ...(session ? { session } : {}),
    }),
  };
}

describe('textbox story flow inside the extent', () => {
  test('lines break at extent width minus insets, honouring explicit zero insets', () => {
    // 914400 EMU = 72pt wide with zero insets; 6pt/char fixed measurer → 12 chars per line.
    const pkg = openPackage(
      footerTextboxDoc(
        textboxDrawing('<w:p><w:r><w:t>aaaa bbbb cccc dddd eeee</w:t></w:r></w:p>', {
          cy: 2_000_000,
        }),
        1
      )
    );
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const section = enumerateDocumentSections(pkg.parts.get(pkg.mainDocumentPart)!)[0]!;
    const story = storyOfRecord(layoutFooterStory(footer, geometryOfSection(section.properties)));
    const paragraph = story.fragments[0]!;
    if (paragraph.kind !== 'paragraph') throw new Error('expected paragraph fragment');
    expect(paragraph.lines.length).toBeGreaterThan(1);
    for (const line of paragraph.lines) {
      for (const span of line.spans) {
        expect(span.box.x + span.box.width).toBeLessThanOrEqual(story.contentWidth + 0.001);
      }
    }
    expect(story.fallbackReason).toBeUndefined();
  });

  test('default OOXML insets apply when bodyPr declares none', () => {
    const pkg = openPackage(
      footerTextboxDoc(
        textboxDrawing('<w:p><w:r><w:t>x</w:t></w:r></w:p>', { bodyPr: '<wps:bodyPr/>' }),
        1
      )
    );
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const section = enumerateDocumentSections(pkg.parts.get(pkg.mainDocumentPart)!)[0]!;
    const story = storyOfRecord(layoutFooterStory(footer, geometryOfSection(section.properties)));
    // 91440 EMU = 7.2pt left/right, 45720 EMU = 3.6pt top/bottom.
    expect(story.contentOffset.x).toBeCloseTo(7.2, 3);
    expect(story.contentOffset.y).toBeCloseTo(3.6, 3);
    expect(story.contentWidth).toBeCloseTo(72 - 14.4, 3);
  });

  test('overflow clips with a recorded fallback reason, never grows the extent', () => {
    const many = Array.from(
      { length: 40 },
      (_, i) => `<w:p><w:r><w:t>overflow line ${i}</w:t></w:r></w:p>`
    ).join('');
    const pkg = openPackage(footerTextboxDoc(textboxDrawing(many, { cy: 228_600 }), 1));
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const section = enumerateDocumentSections(pkg.parts.get(pkg.mainDocumentPart)!)[0]!;
    const story = storyOfRecord(layoutFooterStory(footer, geometryOfSection(section.properties)));
    expect(story.fallbackReason).toBe('textbox-height-clip');
    expect(story.fragments.length).toBeLessThan(40);
    for (const fragment of story.fragments) {
      expect(fragment.box.y).toBeLessThan(story.contentHeight);
    }
  });

  test('nesting past the cap lays out nothing, with the named reason', () => {
    const pkg = openPackage(
      footerTextboxDoc(textboxDrawing('<w:p><w:r><w:t>deep</w:t></w:r></w:p>'), 1)
    );
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const projection = [...indexInlineDrawingProjectionsInPart(footer).values()][0]!;
    const layout = layoutTextboxStory(projection, {
      measurer,
      producer: 'test',
      depth: MAX_TEXTBOX_STORY_NESTING,
    });
    expect(layout).not.toBeNull();
    expect(layout!.fragments).toHaveLength(0);
    expect(layout!.fallbackReason).toBe('textbox-nesting-limit');
  });
});

describe('page fields inside textbox stories', () => {
  test('sanitized multi-section fixture: PAGE / NUMPAGES evaluate per page, never cached text', () => {
    const pkg = openPackage(
      new Uint8Array(readFileSync(resolve(FIXTURES_DIR, 'footer-textbox-page-fields.docx')))
    );
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const section = enumerateDocumentSections(main)[0]!;
    const baseline = layoutFooterStory(footer, geometryOfSection(section.properties));
    // Detection sees the instructions nested inside the anchored textbox.
    expect(baseline.pageFieldNeeds.hasPage).toBe(true);
    expect(baseline.pageFieldNeeds.hasNumPages).toBe(true);

    const page3 = baseline.withPageContext({ pageNumber: 3, pageCount: 47 });
    expect(storyText(storyOfRecord(page3))).toBe('3/47');
    const page9 = baseline.withPageContext({ pageNumber: 9, pageCount: 47 });
    expect(storyText(storyOfRecord(page9))).toBe('9/47');
    // The file's stale cached result ("10") is never painted.
    expect(storyText(storyOfRecord(page3))).not.toContain('10');
  });

  test('document layout carries per-page values through footer textboxes on every page', () => {
    const { layout } = layoutDocumentWithFooters(
      footerTextboxDoc(textboxDrawing(PAGE_FIELD_PARAGRAPH), 60)
    );
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      const record = page.footer?.anchoredDrawings?.[0];
      if (!record?.textboxStory) throw new Error(`page ${page.index}: no footer textbox story`);
      expect(storyText(record.textboxStory)).toBe(String(page.index + 1));
    }
  });

  test('field-free textbox: needs stay empty and content is page-independent', () => {
    const pkg = openPackage(
      footerTextboxDoc(textboxDrawing('<w:p><w:r><w:t>static</w:t></w:r></w:p>'), 1)
    );
    const footer = pkg.parts.get('/word/footer1.xml')!;
    const section = enumerateDocumentSections(pkg.parts.get(pkg.mainDocumentPart)!)[0]!;
    const baseline = layoutFooterStory(footer, geometryOfSection(section.properties));
    expect(baseline.pageFieldNeeds).toEqual({
      hasPage: false,
      hasNumPages: false,
      hasSectionPages: false,
    });
    const a = baseline.withPageContext({ pageNumber: 2, pageCount: 40 });
    const b = baseline.withPageContext({ pageNumber: 31, pageCount: 40 });
    expect(storyText(storyOfRecord(a))).toBe('static');
    expect(storyText(storyOfRecord(b))).toBe('static');
  });
});

describe('textbox story paint', () => {
  test('page-relative footer textbox paints on the page sheet as clipped furniture', () => {
    const { layout } = layoutDocumentWithFooters(
      footerTextboxDoc(textboxDrawing(PAGE_FIELD_PARAGRAPH), 60)
    );
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });

    const boxes = container.querySelectorAll<HTMLElement>('.docx-drawing-textbox');
    expect(boxes.length).toBe(layout.pages.length);
    const first = boxes[0]!;
    // Painted on the page sheet (page-relative anchor), not inside the clipped hf band.
    expect(first.closest('.docx-hf')).toBeNull();
    // At the anchor's page position: posOffset 9000000 EMU = 708.66pt from the page top —
    // never re-based by the footer story's own Y (which would land it a page lower).
    expect(parseFloat(first.style.top)).toBeCloseTo(9_000_000 / 12_700, 0);
    expect(parseFloat(first.style.left)).toBeCloseTo(3_600_450 / 12_700, 0);
    expect(first.getAttribute('contenteditable')).toBe('false');
    expect(first.style.overflow).toBe('hidden');
    // Furniture: no selection bindings inside, and no placeholder card for this drawing.
    expect(first.querySelectorAll('[data-paragraph-id]').length).toBe(0);
    expect(container.querySelectorAll('.docx-drawing-placeholder').length).toBe(0);
    // Per-page values landed in the painted text.
    expect(boxes[0]!.textContent).toBe('1');
    expect(boxes[1]!.textContent).toBe('2');
  });

  test('no HTML-from-string sinks: hostile story text paints inert', () => {
    const hostile = '<w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt;</w:t></w:r></w:p>';
    const { layout } = layoutDocumentWithFooters(footerTextboxDoc(textboxDrawing(hostile), 1));
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const box = container.querySelector<HTMLElement>('.docx-drawing-textbox');
    expect(box).not.toBeNull();
    expect(box!.querySelector('img')).toBeNull();
    expect(box!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('real-word textbox fixtures', () => {
  test('header-footer-textbox.docx renders body, header, and footer textbox stories', () => {
    const pkg = openPackage(
      new Uint8Array(readFileSync(resolve(FIXTURES_DIR, 'header-footer-textbox.docx')))
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      inlineDrawingLayout: drawingLayoutFor(part),
      sectionFurniture: furnitureWithDrawings(pkg, part),
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const texts = [...container.querySelectorAll<HTMLElement>('.docx-drawing-textbox')].map(
      (box) => box.textContent ?? ''
    );
    expect(texts.some((text) => text.includes('BODY TEXT BOX'))).toBe(true);
    expect(texts.some((text) => text.includes('HEADER TEXT BOX'))).toBe(true);
    expect(texts.some((text) => text.includes('FOOTER TEXT BOX'))).toBe(true);
  });

  test('alternatecontent-textbox.docx renders the MC-wrapped card once, without a placeholder', () => {
    const pkg = openPackage(
      new Uint8Array(readFileSync(resolve(FIXTURES_DIR, 'alternatecontent-textbox.docx')))
    );
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      inlineDrawingLayout: drawingLayoutFor(part),
    });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const boxes = container.querySelectorAll<HTMLElement>('.docx-drawing-textbox');
    expect(boxes.length).toBe(1);
    expect(boxes[0]!.textContent).toContain('Card Title');
    expect(container.querySelectorAll('.docx-drawing-placeholder').length).toBe(0);
  });
});

describe('active footer edit band', () => {
  function stampRId(story: HeaderFooterStoryLayout, rId: string): HeaderFooterStoryLayout {
    return {
      ...story,
      rId,
      withPageContext: (ctx) => stampRId(story.withPageContext(ctx), rId),
    };
  }

  test('editing a hairline footer extends the band to the sheet edge, viewing does not', () => {
    const pkg = openPackage(footerTextboxDoc(textboxDrawing(PAGE_FIELD_PARAGRAPH), 10));
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const sections = enumerateDocumentSections(part);
    const bySection = resolveHeaderFooterPartsBySection(pkg);
    const furniture = sections.map((section, index) => {
      const parts = bySection[index];
      if (!parts) return undefined;
      const geometry = geometryOfSection(section.properties);
      const mapStories = (source: typeof parts.footers) => {
        const laid = new Map();
        for (const [variant, hfPart] of source) {
          laid.set(variant, stampRId(layoutFooterStory(hfPart, geometry), 'rId1'));
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
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      sectionFurniture: furniture,
    });
    const page = layout.pages[0]!;
    const storyBox = page.footer!.box;
    // The footer's only direct content is the empty anchor-host paragraph — a sliver.
    expect(storyBox.height).toBeLessThan(page.box.height / 8);

    const viewing = document.createElement('div');
    paintSemanticLayout(viewing, layout, { scale: 1 });
    const viewingBand = viewing.querySelector<HTMLElement>('[data-docx-hf="footer"]')!;
    expect(parseFloat(viewingBand.style.height)).toBeCloseTo(storyBox.height, 1);

    const editing = document.createElement('div');
    paintSemanticLayout(editing, layout, {
      scale: 1,
      activeHeaderFooterRId: 'rId1',
      activeHeaderFooterPageIndex: 0,
    });
    const activeBand = editing.querySelector<HTMLElement>('[data-docx-hf-active]')!;
    expect(activeBand.dataset['docxHf']).toBe('footer');
    // Band reaches the sheet edge so the edit region is visible and clickable; origin is
    // unchanged, so fragment and caret geometry stay put.
    expect(parseFloat(activeBand.style.top) + parseFloat(activeBand.style.height)).toBeCloseTo(
      page.box.height,
      1
    );
  });
});

describe('incremental relayout with footer textboxes', () => {
  test('an unchanged document re-lays out to the identical shape', () => {
    const bytes = footerTextboxDoc(textboxDrawing(PAGE_FIELD_PARAGRAPH), 60);
    const session = createLayoutSession();
    const pkg = openPackage(bytes);
    const part = pkg.parts.get(pkg.mainDocumentPart)!;
    const furniture = furnitureWithDrawings(pkg, part);
    const lay = (revision: number): SemanticLayout =>
      layoutSemanticDocument(part, revision, {
        measurer,
        producer: 'test',
        sectionFurniture: furniture,
        session,
      });
    const shapeOf = (layout: SemanticLayout): string =>
      JSON.stringify(
        layout.pages.map((page) => ({
          index: page.index,
          box: page.box,
          footerDrawings: page.footer?.anchoredDrawings?.map((record) => ({
            bounds: record.paintBounds,
            text: record.textboxStory ? storyText(record.textboxStory) : null,
          })),
          fragments: page.fragments.map((fragment) => ({ id: fragment.id, box: fragment.box })),
        }))
      );
    const first = lay(1);
    const second = lay(2);
    expect(shapeOf(second)).toBe(shapeOf(first));
  });
});

describe('list markers inside textbox stories', () => {
  const numberingIndexFor = (lvlText: string) => {
    const num = readOoxmlPart(
      `<w:numbering xmlns:w="${W}">` +
        '<w:abstractNum w:abstractNumId="7">' +
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
        `<w:lvlText w:val="${lvlText}"/><w:lvlJc w:val="left"/>` +
        '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
        '</w:abstractNum>' +
        '<w:num w:numId="7"><w:abstractNumId w:val="7"/></w:num>' +
        '</w:numbering>',
      { name: '/word/numbering.xml', contentType: 'app/xml' }
    );
    if (!num.ok) throw new Error(num.reason);
    return buildNumberingIndex(num.part.root);
  };

  const numberedParagraph = (text: string) =>
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>' +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`;

  function markerTexts(story: TextboxStoryLayout): string[] {
    return story.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
    );
  }

  function footerStoryWithNumbering(lvlText: string): HeaderFooterStoryLayout {
    const bytes = footerTextboxDoc(
      textboxDrawing(numberedParagraph('alpha') + numberedParagraph('beta')),
      5
    );
    const pkg = openPackage(bytes);
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const geometry = geometryOfSection(enumerateDocumentSections(main)[0]!.properties);
    const footerPart = [...resolveHeaderFooterPartsBySection(pkg)[0]!.footers.values()][0]!;
    return layoutFooterStory(footerPart, geometry, numberingIndexFor(lvlText));
  }

  test('a numbered paragraph inside a footer text box paints a marker (fixes #466)', () => {
    const story = footerStoryWithNumbering('%1.');
    expect(markerTexts(storyOfRecord(story))).toEqual(['1.', '2.']);
  });

  test('storyListMarkerToken descends into the text-box story', () => {
    const decimal = footerStoryWithNumbering('%1.');
    const wrapped = footerStoryWithNumbering('(%1)');
    const token = storyListMarkerToken(decimal);
    expect(token).toContain('1.');
    expect(token).toContain('2.');
    expect(storyListMarkerToken(wrapped)).not.toBe(token);
  });

  const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;

  function documentPart(bodyXml: string): OoxmlPart {
    const doc = readOoxmlPart(`<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`, {
      name: '/word/document.xml',
      contentType: 'app/xml',
    });
    if (!doc.ok) throw new Error(doc.reason);
    return doc.part;
  }

  function bodyTextboxPart(): OoxmlPart {
    return documentPart(
      `<w:p><w:r>${textboxDrawing(numberedParagraph('alpha') + numberedParagraph('beta'))}</w:r></w:p>` +
        '<w:p><w:r><w:t>after the box</w:t></w:r></w:p>'
    );
  }

  test('a numbered paragraph inside a body text box paints a marker (fixes #466)', () => {
    const part = bodyTextboxPart();
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      producer: 'test',
      inlineDrawingLayout: drawingLayoutFor(part),
      numberingIndex: numberingIndexFor('%1.'),
    });
    const record = layout.pages[0]!.anchoredDrawings?.[0];
    if (!record?.textboxStory) throw new Error('no textbox story on record');
    expect(markerTexts(record.textboxStory)).toEqual(['1.', '2.']);
  });

  test('a numbering change reaches a body text box through the flow keys', () => {
    const part = bodyTextboxPart();
    const session = createLayoutSession();
    const drawingLayout = drawingLayoutFor(part);
    const lay = (revision: number, lvlText: string): SemanticLayout =>
      layoutSemanticDocument(part, revision, {
        measurer,
        producer: 'test',
        inlineDrawingLayout: drawingLayout,
        numberingIndex: numberingIndexFor(lvlText),
        session,
      });
    const boxMarkers = (layout: SemanticLayout): string[] => {
      const record = layout.pages[0]!.anchoredDrawings?.[0];
      if (!record?.textboxStory) throw new Error('no textbox story on record');
      return markerTexts(record.textboxStory);
    };
    expect(boxMarkers(lay(1, '%1.'))).toEqual(['1.', '2.']);
    // The host paragraph carries no numbering of its own, so without the hosted-story token
    // in its flow key the previous pages are reused by identity and keep the old markers.
    expect(boxMarkers(lay(2, '(%1)'))).toEqual(['(1)', '(2)']);
  });

  test('body text boxes do not render without a drawing context', () => {
    const layout = layoutSemanticDocument(bodyTextboxPart(), 1, {
      measurer,
      producer: 'test',
      numberingIndex: numberingIndexFor('%1.'),
    });
    expect(layout.pages[0]!.anchoredDrawings).toBeUndefined();
  });

  /** A one-cell table whose paragraph hosts a text box with a two-item numbered list. */
  function cellTextboxPart(): OoxmlPart {
    return documentPart(
      '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/></w:tcPr>' +
        `<w:p><w:r>${textboxDrawing(numberedParagraph('alpha') + numberedParagraph('beta'))}</w:r></w:p>` +
        '</w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>after the table</w:t></w:r></w:p>'
    );
  }

  /**
   * Keys move with the numbering state, and only with it: distinct states never share a
   * key list, identical states re-key identically (no gratuitous invalidation).
   */
  function expectKeysTrackNumbering(keysFor: (lvlText: string) => string[]): void {
    const decimal = keysFor('%1.');
    expect(decimal.length).toBeGreaterThan(0);
    expect(keysFor('(%1)')).not.toEqual(decimal);
    expect(keysFor('%1.')).toEqual(decimal);
  }

  /**
   * HOST keys only: the box's own story breaks under a `|txbx:`-namespaced producer and
   * its keys move with the numbering regardless of the host fold under test.
   */
  const hostKeysOnly = (keys: string[]): string[] => keys.filter((key) => !key.includes('|txbx:'));

  test('a numbering change reaches a text box hosted in a table cell', () => {
    const part = cellTextboxPart();
    const session = createLayoutSession();
    const drawingLayout = drawingLayoutFor(part);
    const boxMarkers = (revision: number, lvlText: string): string[] => {
      const layout = layoutSemanticDocument(part, revision, {
        measurer,
        producer: 'test',
        inlineDrawingLayout: drawingLayout,
        numberingIndex: numberingIndexFor(lvlText),
        session,
      });
      const record = layout.pages[0]!.anchoredDrawings?.[0];
      if (!record?.textboxStory) throw new Error('no textbox story on record');
      return markerTexts(record.textboxStory);
    };
    expect(boxMarkers(1, '%1.')).toEqual(['1.', '2.']);
    // The TABLE block's flow key must move too: its cell paragraphs carry no numbering of
    // their own, so only the hosted-story token distinguishes the two numbering states.
    expect(boxMarkers(2, '(%1)')).toEqual(['(1)', '(2)']);
  });

  test('the cell paragraph break key folds the hosted text-box list state (fixes #622)', () => {
    // `flowBlocksInBox` is the cell/header lane. The host paragraph's subtree, list item,
    // and drawing token are byte-identical across a numbering edit, so this token is the
    // only key input that can move: the cell lane's break cache and retention must key the
    // same inputs the body lane keys, or the lanes drift.
    const host = storyBlocks(bodyTextboxPart())[0]!;
    const keysFor = (lvlText: string): string[] => {
      const numberingIndex = numberingIndexFor(lvlText);
      const keys: string[] = [];
      flowBlocksInBox([host], 0, 400, 0, 0, {
        measurer,
        cache: createParagraphLayoutCache(),
        producer: 'test',
        nextLineId: (paragraphId, start, lineIndex) => `${paragraphId}-${start}-${lineIndex}`,
        hostedStory: hostedStoryFlowDeps(() => null, numberingIndex, undefined, 'all-markup'),
        onCellBreakKey: (key) => keys.push(key),
      });
      return keys;
    };
    expectKeysTrackNumbering(keysFor);
  });

  /** A cache that records every key the flow asks for, so tests can watch keys move. */
  function recordingCache(keys: string[]): ParagraphLayoutCache<readonly PendingLine[]> {
    const inner = createParagraphLayoutCache<readonly PendingLine[]>();
    return {
      ...inner,
      get(key) {
        keys.push(key);
        return inner.get(key);
      },
      // The spread SNAPSHOTS accessor results; stats must keep reading the live counters.
      get stats() {
        return inner.stats;
      },
    };
  }

  test('the body flow wires hosted list state into cell break keys', () => {
    // The production wiring, not a hand-built provider: dropping the `hostedStory` bundle
    // from the body flow's table deps must fail this test.
    const part = cellTextboxPart();
    const keysFor = (lvlText: string): string[] => {
      const keys: string[] = [];
      layoutSemanticDocument(part, 1, {
        measurer,
        producer: 'test',
        cache: recordingCache(keys),
        inlineDrawingLayout: drawingLayoutFor(part),
        numberingIndex: numberingIndexFor(lvlText),
      });
      return hostKeysOnly(keys);
    };
    expectKeysTrackNumbering(keysFor);
  });

  test('the hosted-story dependency bundle makes the no-numbering state explicit', () => {
    const layoutTextboxStoryFor = () => null;
    const hostedStory = hostedStoryFlowDeps(layoutTextboxStoryFor, undefined, undefined);
    expect(hostedStory.layoutTextboxStoryFor).toBe(layoutTextboxStoryFor);
    expect(hostedStory.hostedListTokenForParagraph).toBeNull();
    expect(Object.isFrozen(hostedStory)).toBe(true);
  });

  test('a truncated table scan seeds only fully visited descendant paragraphs', () => {
    const generic = (id: string, children: readonly OoxmlNode[] = []): OoxmlNode =>
      ({
        id,
        kind: 'generic',
        namespaceUri: W,
        localName: 'probe',
        namespaceBindings: [],
        attributes: [],
        children,
      }) as OoxmlNode;
    const observedParagraph = (id: string, children: readonly OoxmlNode[]) => {
      let childReads = 0;
      const paragraph = new Proxy(
        {
          id,
          kind: 'paragraph' as const,
          namespaceUri: W,
          localName: 'p' as const,
          namespaceBindings: [],
          attributes: [],
          children,
        },
        {
          get(target, property, receiver) {
            if (property === 'children') childReads += 1;
            return Reflect.get(target, property, receiver);
          },
        }
      ) as OoxmlNode;
      return { paragraph, childReads: () => childReads };
    };
    const textboxContent = {
      ...generic('textbox-content'),
      localName: 'txbxContent',
    } as OoxmlNode;
    const complete = observedParagraph('complete', [textboxContent]);
    const incomplete = observedParagraph(
      'incomplete',
      Array.from({ length: 20_050 }, (_, index) => generic(`padding-${index}`))
    );
    const table = {
      ...generic('table', [complete.paragraph, incomplete.paragraph]),
      kind: 'table',
      localName: 'tbl',
    } as OoxmlNode;

    expect(hostedTextboxContents(table).truncated).toBe(true);
    const completeReads = complete.childReads();
    const incompleteReads = incomplete.childReads();
    expect(hostedTextboxContents(complete.paragraph).contents).toEqual([textboxContent]);
    expect(complete.childReads()).toBe(completeReads);
    expect(hostedTextboxContents(incomplete.paragraph).truncated).toBe(true);
    expect(incomplete.childReads()).toBeGreaterThan(incompleteReads);
  });

  test('the header/footer drawing branch wires hosted list state into break keys', () => {
    const bytes = footerTextboxDoc(textboxDrawing(numberedParagraph('alpha')), 5);
    const pkg = openPackage(bytes);
    const main = pkg.parts.get(pkg.mainDocumentPart)!;
    const geometry = geometryOfSection(enumerateDocumentSections(main)[0]!.properties);
    const footerPart = [...resolveHeaderFooterPartsBySection(pkg)[0]!.footers.values()][0]!;
    const keysFor = (lvlText: string): string[] => {
      const keys: string[] = [];
      layoutFooterStory(footerPart, geometry, numberingIndexFor(lvlText), recordingCache(keys));
      return hostKeysOnly(keys);
    };
    expectKeysTrackNumbering(keysFor);
  });

  test('a text-box list restarts at w:start, independent of the host story', () => {
    const doc = readOoxmlPart(
      `<w:document ${NS}><w:body>` +
        numberedParagraph('host one') +
        numberedParagraph('host two') +
        `<w:p><w:r>${textboxDrawing(numberedParagraph('alpha') + numberedParagraph('beta'))}</w:r></w:p>` +
        '</w:body></w:document>',
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!doc.ok) throw new Error(doc.reason);
    const layout = layoutSemanticDocument(doc.part, 1, {
      measurer,
      producer: 'test',
      inlineDrawingLayout: drawingLayoutFor(doc.part),
      numberingIndex: numberingIndexFor('%1.'),
    });
    const bodyMarkers = layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
    );
    // The host story numbers on its own counters; the box is its own story root and
    // restarts at w:start with the same numId, like a header's or a note's list does.
    expect(bodyMarkers).toEqual(['1.', '2.']);
    const record = layout.pages[0]!.anchoredDrawings?.[0];
    if (!record?.textboxStory) throw new Error('no textbox story on record');
    expect(markerTexts(record.textboxStory)).toEqual(['1.', '2.']);
  });
});

test('text-box tables follow compatibility mode with a shared paragraph cache', () => {
  // Author the traditional side margins so this isolates compatibility-dependent
  // percentage widths rather than depending on an omitted-margin fallback.
  const table =
    '<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="5000"/><w:tblInd w:type="dxa" w:w="0"/><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4216"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const pkg = openPackage(
    footerTextboxDoc(textboxDrawing(table, { cx: 200 * 12700, cy: 100 * 12700 }), 1)
  );
  const footer = pkg.parts.get('/word/footer1.xml')!;
  const projection = [...indexInlineDrawingProjectionsInPart(footer).values()][0]!;
  const cache = createParagraphLayoutCache<readonly PendingLine[]>();
  for (const mode of [14, 15, 14]) {
    const result = layoutTextboxStory(projection, {
      measurer,
      producer: 'compatibility',
      cache,
      compatibilityMode: mode,
    });
    const found = result?.fragments.find((fragment) => fragment.kind === 'table');
    // Mode 14: the box, its outer cell margins, and the text-box share's extra 0.75pt.
    expect(found?.box.width).toBeCloseTo(mode === 14 ? 211.55 : 200, 7);
    expect(found?.box.x).toBeCloseTo(mode === 14 ? -5.4 : 0, 7);
  }
});

test('a text-box table with a percentage above 100 extends past the box', () => {
  const table =
    '<w:tbl><w:tblPr><w:tblW w:type="pct" w:w="7500"/><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const pkg = openPackage(
    footerTextboxDoc(textboxDrawing(table, { cx: 200 * 12700, cy: 100 * 12700 }), 1)
  );
  const footer = pkg.parts.get('/word/footer1.xml')!;
  const projection = [...indexInlineDrawingProjectionsInPart(footer).values()][0]!;
  const result = layoutTextboxStory(projection, {
    measurer,
    producer: 'compatibility',
    compatibilityMode: 15,
  });
  const found = result?.fragments.find((fragment) => fragment.kind === 'table');
  expect(found?.box.width).toBeCloseTo(300, 7);
  expect(found?.box.x).toBeCloseTo(0, 7);
});
