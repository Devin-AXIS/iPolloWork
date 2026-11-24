// Header and footer content is one layer under the main document.
//
// The sheet is a stacking context. Its children paint by `z-index` level (inline style or
// the shipped stylesheet), then by child order; `paintRank` models that. A header or footer drawing set in front of
// text covers the header or footer text only: the whole layer paints before the body's
// behind-text drawings, the body and the body's in-front drawings. `behindDoc` still orders
// a drawing within that layer, and `relativeHeight` orders the drawings on one side of the
// text, as in the body. A `back` page border is under the layer, a `front` one over
// everything, and the edit pill stays over the body it sits beside.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import postcss from 'postcss';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  mountWithImages,
  picture,
} from './image-decode-harness.ts';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const VML_NS = 'xmlns:v="urn:schemas-microsoft-com:vml"';
const LEGACY_NS = `${VML_NS} xmlns:o="urn:schemas-microsoft-com:office:office"`;
const EMU = 12700;

/** Screen `z-index` rules of the shipped stylesheet, in source order. */
const Z_RULES: readonly { readonly selector: string; readonly value: string }[] = (() => {
  const cssPath = resolve(import.meta.dir, '../../styles/editor.css');
  const rules: { selector: string; value: string }[] = [];
  postcss.parse(readFileSync(cssPath, 'utf8'), { from: cssPath }).walkRules((rule) => {
    if (rule.parent?.type === 'atrule') return;
    rule.walkDecls('z-index', (decl) => {
      for (const selector of rule.selectors) {
        if (/:(hover|focus|active)|::/.test(selector) || decl.value.includes('var(')) continue;
        rules.push({ selector, value: decl.value });
      }
    });
  });
  return rules;
})();

/** The element's `z-index`: inline first, then the LAST matching rule (enough for this sheet). */
function zIndexOf(element: HTMLElement): number | null {
  if (element.style.zIndex) return Number(element.style.zIndex);
  let value: string | null = null;
  for (const rule of Z_RULES) {
    try {
      if (element.matches(rule.selector)) value = rule.value;
    } catch {
      // Selectors happy-dom cannot parse do not apply to the painted sheet.
    }
  }
  return value === null || value === 'auto' ? null : Number(value);
}

/**
 * Paint level of one sheet child. A child that is not a stacking context lets the z-index of
 * its drawing layers escape to the sheet, so the highest of those counts as its own.
 */
function paintLevel(child: HTMLElement): number {
  const own = zIndexOf(child);
  if (own !== null) return own;
  if (child.style.clipPath || child.style.isolation === 'isolate') return 0;
  const nested = [...child.querySelectorAll<HTMLElement>('.docx-drawing-layer')].map(
    (layer) => zIndexOf(layer) ?? 0
  );
  return Math.max(0, ...nested);
}

interface Anchor {
  readonly id: number;
  readonly frame: 'page' | 'column';
  readonly y: number;
  readonly behind: boolean;
  /** A high `relativeHeight` must not lift a header drawing over the body. */
  readonly relativeHeight: number;
  readonly graphic?: 'shape' | 'picture';
}

function anchor({ id, frame, y, behind, relativeHeight, graphic = 'shape' }: Anchor): string {
  const vertical = frame === 'page' ? 'page' : 'paragraph';
  const body =
    graphic === 'picture'
      ? picture(id)
      : '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
        `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${300 * EMU}" cy="${170 * EMU}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill>' +
        '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>';
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    `relativeHeight="${relativeHeight}" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="${frame}"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="${vertical}"><wp:posOffset>${y * EMU}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${300 * EMU}" cy="${170 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/><wp:docPr id="${id}" name="Shape ${id}"/>${body}</wp:anchor></w:drawing></w:r>`
  );
}

function vmlRect(zIndex: number): string {
  return (
    '<w:r><w:pict><v:rect style="position:absolute;margin-left:72pt;margin-top:30pt;width:300pt;' +
    `height:170pt;z-index:${zIndex};mso-position-horizontal-relative:page;` +
    'mso-position-vertical-relative:page" fillcolor="#ffcc00" stroked="f"/></w:pict></w:r>'
  );
}

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;

function layeredDocx(borderZOrder: 'front' | 'back'): Uint8Array {
  const header =
    '<w:p>' +
    anchor({ id: 1, frame: 'page', y: 20, behind: true, relativeHeight: 900 }) +
    anchor({ id: 2, frame: 'column', y: 0, behind: false, relativeHeight: 950 }) +
    anchor({
      id: 3,
      frame: 'page',
      y: 40,
      behind: false,
      relativeHeight: 960,
      graphic: 'picture',
    }) +
    vmlRect(251700000) +
    text('Header line') +
    '</w:p>';
  const footer =
    '<w:p>' +
    anchor({ id: 4, frame: 'page', y: 560, behind: false, relativeHeight: 970 }) +
    text('Footer line') +
    '</w:p>';
  const body =
    '<w:p>' +
    anchor({ id: 5, frame: 'page', y: 100, behind: true, relativeHeight: 10 }) +
    anchor({ id: 6, frame: 'page', y: 260, behind: false, relativeHeight: 20 }) +
    text('Body text '.repeat(200)) +
    '</w:p>';
  const rels = (inner: string) =>
    strToU8(`<Relationships xmlns="${REL_NS}">${inner}</Relationships>`);
  const image = `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': rels(`<Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/>`),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body>${body}<w:sectPr>` +
        '<w:headerReference r:id="rIdHdr" w:type="default"/>' +
        '<w:footerReference r:id="rIdFtr" w:type="default"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
        `<w:pgBorders w:offsetFrom="page" w:zOrder="${borderZOrder}">` +
        '<w:top w:val="single" w:sz="48" w:space="24" w:color="0000FF"/></w:pgBorders>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': rels(
      `<Relationship Id="rIdHdr" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdFtr" Type="${R}/footer" Target="footer1.xml"/>` +
        image
    ),
    'word/header1.xml': strToU8(`<w:hdr ${DRAWING_NS} ${VML_NS}>${header}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr ${DRAWING_NS}>${footer}</w:ftr>`),
    'word/_rels/header1.xml.rels': rels(image),
    'word/media/image1.png': PNG_1X1,
  });
}

function paintedSheet(borderZOrder: 'front' | 'back') {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, layeredDocx(borderZOrder), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  const sheet = container.querySelector<HTMLElement>('.docx-page[data-page-index="0"]')!;
  // In paint order: by level, then child order.
  const layers = ([...sheet.children] as HTMLElement[])
    .map((element, order) => ({ element, order, level: paintLevel(element) }))
    .sort((a, b) => a.level - b.level || a.order - b.order)
    .map(({ element }) => element);
  const index = (selector: string): number => {
    const element = sheet.querySelector<HTMLElement>(`:scope > ${selector}`);
    expect(element === null).toBe(false);
    return layers.indexOf(element!);
  };
  return { surface: result.surface, sheet, layers, index };
}

describe('header and footer content paints under the body', () => {
  test('every header and footer drawing, in front or behind, paints before the body', () => {
    const { surface, layers, index } = paintedSheet('front');
    const bodyBehind = index('.docx-drawing-layer-behind');
    const content = index('.docx-page-content');
    const bodyFront = index('.docx-drawing-layer-front:not([data-docx-hf-front])');
    expect(bodyBehind).toBeLessThan(content);
    expect(content).toBeLessThan(bodyFront);
    const furniture = layers.filter((layer) =>
      layer.matches(
        '[data-docx-hf-behind], .docx-hf:not(.docx-hf--placeholder), [data-docx-hf-front]'
      )
    );
    // Header behind, both bands, and the header's page-relative in-front layer.
    expect(furniture.length).toBeGreaterThanOrEqual(4);
    // Selectors match in document scope, so a drawing layer's own children are included.
    const drawings = furniture.flatMap((layer) => [
      ...layer.querySelectorAll('.docx-drawing-layer > *'),
    ]);
    // Header: behind shape, in-front shape, in-front picture, VML rectangle. Footer: one shape.
    expect(drawings.length).toBe(5);
    for (const layer of furniture) expect(layers.indexOf(layer)).toBeLessThan(bodyBehind);
    surface.destroy();
  });

  test('inside the header, behind ink precedes the header text and in-front ink follows it', () => {
    const { surface, index } = paintedSheet('front');
    const behind = index('[data-docx-hf-behind="header"]');
    const band = index('.docx-hf[data-docx-hf="header"]');
    const pageFront = index('[data-docx-hf-front="header"]');
    expect(behind).toBeLessThan(band);
    expect(band).toBeLessThan(pageFront);
    surface.destroy();
  });

  test('a front page border paints over the body drawings and a back one under the header', () => {
    const front = paintedSheet('front');
    expect(front.index('.docx-page-borders')).toBeGreaterThan(
      front.index('.docx-drawing-layer-front:not([data-docx-hf-front])')
    );
    front.surface.destroy();
    const back = paintedSheet('back');
    expect(back.index('.docx-page-borders')).toBeLessThan(
      back.index('[data-docx-hf-behind="header"]')
    );
    back.surface.destroy();
  });

  test('the edit pill paints over the body', () => {
    const { surface, index } = paintedSheet('front');
    expect(index('[data-docx-hf-hint="header"]')).toBeGreaterThan(index('.docx-page-content'));
    expect(index('[data-docx-hf-hint="footer"]')).toBeGreaterThan(index('.docx-page-content'));
    surface.destroy();
  });
});

/** A picture watermark in a header: VML, behind text, centered on the margins. */
function vmlPictureWatermark(widthPt: number, zIndex: number): string {
  return (
    '<w:r><w:pict><v:shape id="WordPictureWatermark1" o:spid="_x0000_s2049" ' +
    `style="position:absolute;margin-left:0;margin-top:0;width:${widthPt}pt;height:120pt;` +
    `z-index:${zIndex};mso-position-horizontal:center;mso-position-horizontal-relative:margin;` +
    'mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f">' +
    '<v:imagedata r:id="rIdImg" o:title="mark"/></v:shape></w:pict></w:r>'
  );
}

/** A behind-text DrawingML picture, centered on the margins. */
function marginCenteredPicture(widthPt: number, relativeHeight: number): string {
  return (
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" ' +
    `relativeHeight="${relativeHeight}" behindDoc="1" locked="0" layoutInCell="0" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>' +
    '<wp:positionV relativeFrom="margin"><wp:align>center</wp:align></wp:positionV>' +
    `<wp:extent cx="${widthPt * EMU}" cy="${90 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/><wp:docPr id="7" name="Picture 7"/>${picture(7)}</wp:anchor></w:drawing></w:r>`
  );
}

function watermarkDocx(): Uint8Array {
  const rels = (inner: string) =>
    strToU8(`<Relationships xmlns="${REL_NS}">${inner}</Relationships>`);
  const image = `<Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>`;
  // Document order puts the watermark first. Its rank is the higher one.
  const header =
    '<w:p>' +
    vmlPictureWatermark(360, -251610112) +
    marginCenteredPicture(280, 251703296) +
    text('Header line') +
    '</w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': rels(`<Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/>`),
    'word/document.xml': strToU8(
      `<w:document ${DRAWING_NS}><w:body><w:p>${text('Body text')}</w:p><w:sectPr>` +
        '<w:headerReference r:id="rIdHdr" w:type="default"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' +
        '<w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="737" w:gutter="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/_rels/document.xml.rels': rels(
      `<Relationship Id="rIdHdr" Type="${R}/header" Target="header1.xml"/>`
    ),
    'word/header1.xml': strToU8(`<w:hdr ${DRAWING_NS} ${LEGACY_NS}>${header}</w:hdr>`),
    'word/_rels/header1.xml.rels': rels(image),
    'word/media/image1.png': PNG_1X1,
  });
}

describe('drawings inside the header layer', () => {
  test('a picture watermark paints over a behind-text picture of a lower rank', async () => {
    // The watermark ranks above the picture, so it paints last, whatever the document order.
    const { surface, container } = await mountWithImages(watermarkDocx());
    const layer = container.querySelector('[data-docx-hf-behind="header"]');
    expect(layer === null).toBe(false);
    // At scale 1 the painter writes one pixel for each point.
    const widthsInPaintOrder = [
      ...layer!.querySelectorAll<HTMLElement>('.docx-drawing-layer > .docx-drawing'),
    ].map((drawing) => Math.round(parseFloat(drawing.style.width)));
    expect(widthsInPaintOrder).toEqual([280, 360]);
    surface.destroy();
  });
});
