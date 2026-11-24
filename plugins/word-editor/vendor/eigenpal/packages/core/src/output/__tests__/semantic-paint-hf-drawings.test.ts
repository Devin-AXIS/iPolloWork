// Header/footer band ink OVERFLOWS instead of clipping.
//
// The band's GEOMETRY is the flow height of its text (#856) — anchored objects never grow
// it, and the body's effective top margin never moves for them. But Word paints header ink
// wherever it lands: a letterhead strip anchored past the content width sits in the right
// margin and reaches below the header's last line, and a negative indent hangs into the
// left margin. An `overflow: hidden` band silently deleted both, which read as "the engine
// dropped my header". Overflowing ink stays INERT while the band is not being edited, so a
// shape hanging over the body cannot swallow clicks meant for the document text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  createFixedMeasurer,
  enumerateDocumentSections,
  geometryOfSection,
  layoutSemanticDocument,
  type PageFurniture,
  type SemanticLayout,
} from '../../layout/index.ts';
import { layoutHeaderFooterStory, type HeaderFooterStoryLayout } from '../../layout/hf-layout.ts';
import type { InlineDrawingLayoutContext } from '../../layout/drawing-layout.ts';
import {
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

const measurer = createFixedMeasurer(6, 14);

// A narrow, TALL strip anchored 477pt from the column start — past an A4 content width of
// ~451pt — and reaching ~82pt below the header paragraph it is anchored to. The shape a
// letterhead rule takes.
const STRIP_X_EMU = 6_057_900; // 477pt
const STRIP_Y_EMU = 63_500; // 5pt
const STRIP_CX_EMU = 208_280; // ~16.4pt
const STRIP_CY_EMU = 976_630; // ~76.9pt

function headerStripDrawing(behindDoc: '0' | '1' = '0'): string {
  return (
    '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0"' +
    ` relativeHeight="1" behindDoc="${behindDoc}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${STRIP_X_EMU}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${STRIP_Y_EMU}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${STRIP_CX_EMU}" cy="${STRIP_CY_EMU}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="1" name="strip"/>' +
    `<a:graphic><a:graphicData uri="${WPS}"><wps:wsp>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${STRIP_CX_EMU}" cy="${STRIP_CY_EMU}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></wps:spPr>' +
    '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>'
  );
}

function headerDoc(behindDoc: '0' | '1' = '0'): Uint8Array {
  const ns = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:wps="${WPS}"`;
  // The header paragraph hangs 35.4pt into the left margin (w:ind left="-708" twips) and
  // carries the anchored strip.
  const headerParagraph =
    '<w:p><w:pPr><w:ind w:left="-708"/></w:pPr>' +
    '<w:r><w:t>Sample header line</w:t></w:r>' +
    `<w:r>${headerStripDrawing(behindDoc)}</w:r></w:p>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/header1.xml': strToU8(`<w:hdr ${ns}>${headerParagraph}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document ${ns}><w:body><w:p><w:r><w:t>body text</w:t></w:r></w:p>` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>' +
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
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const pageContext = {
      pageNumber: 1,
      pageWidth: geometry.width,
      pageHeight: geometry.height,
      marginLeft: geometry.margin.left,
      marginRight: geometry.margin.right,
      marginTop: geometry.margin.top,
      marginBottom: geometry.margin.bottom,
    };
    // The real pipeline stamps the slot's relationship id on the laid story; the
    // active-band paint keys on it. Recursive so a per-page relayout keeps the stamp.
    const stampRId = (story: HeaderFooterStoryLayout, rId: string): HeaderFooterStoryLayout => ({
      ...story,
      rId,
      withPageContext: (ctx) => stampRId(story.withPageContext(ctx), rId),
    });
    const mapStories = (source: typeof parts.headers) => {
      const laid = new Map();
      for (const [variant, hfPart] of source)
        laid.set(
          variant,
          stampRId(
            layoutHeaderFooterStory(
              hfPart,
              width,
              measurer,
              'test',
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              drawingLayoutFor(hfPart),
              undefined,
              undefined,
              pageContext
            ),
            'rId1'
          )
        );
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

function layoutHeaderDoc(behindDoc: '0' | '1' = '0'): SemanticLayout {
  const pkg = openPackage(headerDoc(behindDoc));
  const part = pkg.parts.get(pkg.mainDocumentPart)!;
  return layoutSemanticDocument(part, 1, {
    measurer,
    producer: 'test',
    sectionFurniture: furnitureWithDrawings(pkg, part),
  });
}

function paint(layout: SemanticLayout, activeHeaderFooterRId?: string): HTMLElement {
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, {
    scale: 1,
    ...(activeHeaderFooterRId ? { activeHeaderFooterRId, activeHeaderFooterPageIndex: 0 } : {}),
  });
  return container;
}

describe('header band ink overflows instead of clipping', () => {
  const layout = layoutHeaderDoc();

  test('the band keeps flow-height geometry and visible overflow', () => {
    const story = layout.pages[0]!.header;
    expect(story).toBeDefined();
    // #856: anchored extents never size the band. One 14pt line, not 80+pt of strip.
    expect(story!.box.height).toBeLessThan(60);

    const painted = paint(layout);
    const band = painted.querySelector<HTMLElement>('[data-docx-hf="header"]')!;
    expect(band).toBeTruthy();
    expect(band.style.overflow).toBe('visible');
    expect(parseFloat(band.style.height)).toBeCloseTo(story!.box.height, 0);
  });

  test('a column-frame strip anchored past the content width still paints', () => {
    const painted = paint(layout);
    const band = painted.querySelector<HTMLElement>('[data-docx-hf="header"]')!;
    const drawing = band.querySelector<HTMLElement>('.docx-drawing-layer > *');
    expect(drawing).toBeTruthy();
    // Entirely outside the band box: right of the content width, deeper than the flow
    // height. Under the old clip this element existed and no pixel of it survived.
    const left = parseFloat(drawing!.style.left);
    const top = parseFloat(drawing!.style.top);
    const height = parseFloat(drawing!.style.height);
    const bandWidth = parseFloat(band.style.width);
    const bandHeight = parseFloat(band.style.height);
    expect(left).toBeGreaterThan(bandWidth);
    expect(top + height).toBeGreaterThan(bandHeight);
  });

  test('overflowing ink is inert in normal mode and interactive while editing the band', () => {
    const inactive = paint(layout);
    const inactiveDrawing = inactive.querySelector<HTMLElement>(
      '[data-docx-hf="header"] .docx-drawing-layer > *'
    )!;
    expect(inactiveDrawing.style.pointerEvents).toBe('none');

    const active = paint(layout, 'rId1');
    const activeDrawing = active.querySelector<HTMLElement>(
      '[data-docx-hf="header"] .docx-drawing-layer > *'
    )!;
    expect(activeDrawing.style.pointerEvents).toBe('auto');
  });

  test('a negative indent hangs into the left margin instead of being cut', () => {
    const painted = paint(layout);
    const band = painted.querySelector<HTMLElement>('[data-docx-hf="header"]')!;
    const lefts = [...band.querySelectorAll<HTMLElement>('*')]
      .map((element) => parseFloat(element.style.left))
      .filter((left) => Number.isFinite(left));
    // -708 twips = -35.4pt of hanging ink.
    expect(Math.min(...lefts)).toBeLessThan(0);
  });

  test('the body is not displaced by the overflowing strip', () => {
    const painted = paint(layout);
    const content = painted.querySelector<HTMLElement>('.docx-page-content')!;
    // headerDistance 36pt + one 14pt line stays under the 72pt margin, so the content
    // box sits exactly at the section's top margin.
    expect(parseFloat(content.style.top)).toBeCloseTo(72, 0);
  });

  test('ink escaping the band is still clipped at the SHEET', () => {
    // Overflow is the fix; unbounded overflow is a new bug. A story-relative record can
    // resolve past the paper — a footer shape anchored far above its paragraph, a header
    // one reaching far below — and without a clip it paints across the inter-page gutter
    // onto the neighbouring sheet. The clip is the sheet in the band's own coordinates.
    const painted = paint(layout);
    const page = layout.pages[0]!;
    const story = page.header!;
    const band = painted.querySelector<HTMLElement>('[data-docx-hf="header"]')!;

    const clip = band.style.clipPath;
    expect(clip).toContain('polygon');
    const numbers = [...clip.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]));
    expect(numbers).toHaveLength(8);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    // Exactly the sheet, expressed relative to the band's own origin.
    expect(Math.min(...xs)).toBeCloseTo(page.box.x - story.box.x, 3);
    expect(Math.max(...xs)).toBeCloseTo(page.box.x - story.box.x + page.box.width, 3);
    expect(Math.min(...ys)).toBeCloseTo(page.box.y - story.box.y, 3);
    expect(Math.max(...ys)).toBeCloseTo(page.box.y - story.box.y + page.box.height, 3);
    // And the clip is genuinely OUTSIDE the band, or it would be the old bug again.
    expect(Math.max(...ys)).toBeGreaterThan(parseFloat(band.style.height));
  });

  test('a behindDoc header shape paints UNDER the body, not over it', () => {
    // `behindDoc` means behind the DOCUMENT. Painted from inside the band — which the page
    // appends after its content box — a letterhead reaching down over the body covered the
    // first body lines, the one thing the flag exists to prevent.
    const painted = paint(layoutHeaderDoc('1'));
    const page = painted.querySelector<HTMLElement>('.docx-page')!;
    const children = [...page.children];
    const behind = page.querySelector<HTMLElement>('[data-docx-hf-behind="header"]');
    const content = page.querySelector<HTMLElement>('.docx-page-content');
    expect(behind).toBeTruthy();
    expect(content).toBeTruthy();
    expect(children.indexOf(behind!)).toBeLessThan(children.indexOf(content!));
    // It carries real ink, and it is clipped to the sheet so it cannot reach the next page.
    expect(behind!.querySelector('.docx-drawing-layer > *')).toBeTruthy();
    expect(behind!.style.overflow).toBe('hidden');
    // Never interactive: furniture behind the body must not take a click meant for text.
    for (const element of behind!.querySelectorAll<HTMLElement>('.docx-drawing-layer > *')) {
      expect(element.style.pointerEvents).toBe('none');
    }
  });

  test('an inFront header shape paints in the band, and the band paints under the body', () => {
    const painted = paint(layout);
    const band = painted.querySelector<HTMLElement>('[data-docx-hf="header"]')!;
    expect(band.querySelector('.docx-drawing-layer > *')).toBeTruthy();
    expect(painted.querySelector('[data-docx-hf-behind="header"]')).toBeNull();
    // In front of the header text only: header content is a layer under the main document.
    const children = [...painted.querySelector<HTMLElement>('.docx-page')!.children];
    const content = painted.querySelector<HTMLElement>('.docx-page-content')!;
    expect(children.indexOf(band)).toBeLessThan(children.indexOf(content));
  });

  test('a nested drawing inside inert furniture is inert too', () => {
    // `pointer-events: none` on an ancestor is undone by an explicit `auto` on a child,
    // and every nested drawing carries one — a letterhead authored as a text box with a
    // picture inside would still have taken clicks meant for the body underneath.
    const painted = paint(layout);
    const nested = painted.querySelectorAll<HTMLElement>(
      '[data-docx-hf="header"] .docx-drawing-layer .docx-drawing'
    );
    for (const element of nested) {
      expect(element.style.pointerEvents).toBe('none');
    }
  });

  test('toggling the active band on a retained page does not replace the sheet', () => {
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const page = container.querySelector<HTMLElement>('.docx-page')!;
    const band = container.querySelector<HTMLElement>('[data-docx-hf="header"]')!;
    const drawing = container.querySelector<HTMLElement>(
      '[data-docx-hf="header"] .docx-drawing-layer > *'
    )!;
    expect(band.hasAttribute('data-docx-hf-active')).toBe(false);
    expect(drawing.style.pointerEvents).toBe('none');

    paintSemanticLayout(container, layout, {
      scale: 1,
      activeHeaderFooterRId: 'rId1',
      activeHeaderFooterPageIndex: 0,
    });
    expect(container.querySelector('.docx-page')).toBe(page);
    expect(band.hasAttribute('data-docx-hf-active')).toBe(true);
    expect(band.getAttribute('contenteditable')).toBe('true');
    expect(drawing.style.pointerEvents).toBe('auto');
    expect(container.querySelector('.docx-page-content')?.getAttribute('contenteditable')).toBe(
      'false'
    );

    paintSemanticLayout(container, layout, { scale: 1 });
    expect(container.querySelector('.docx-page')).toBe(page);
    expect(band.hasAttribute('data-docx-hf-active')).toBe(false);
    expect(drawing.style.pointerEvents).toBe('none');
  });
});
