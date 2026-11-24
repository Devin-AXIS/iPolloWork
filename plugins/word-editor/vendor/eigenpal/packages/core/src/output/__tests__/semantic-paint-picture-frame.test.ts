// A picture's frame paints around its image: the shadow under it, the outline over it, and
// the geometry clip on the image alone.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import {
  drawingRenderers,
  installDrawingRenderers,
} from '../../store/package/drawing-renderers.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  projectDrawing,
} from '../../store/package/drawing-projection.ts';
import type { ValidatedImageBytesHandle } from '../../store/package/image-resources.ts';
import { mockReadyImageResource } from '../../store/__tests__/drawing-ready-fixture.ts';
import {
  WML_NAMESPACE_URI,
  readOoxmlPart,
  type OoxmlDrawingNode,
  type OoxmlElement,
} from '../../store/package/ooxml-tree.ts';
import {
  buildInlineDrawingRecord,
  emuToPoints,
  type InlineDrawingRecord,
} from '../../layout/drawing-layout.ts';
import { vectorShapeInkClip } from '../../layout/vector-shape-ink.ts';
import { DEFAULT_DRAWING_PAINT_STRINGS, paintDrawingRecord } from '../semantic-paint-drawings.ts';

const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const READY_PNG = mockReadyImageResource({
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  pixelWidth: 400,
  pixelHeight: 200,
});

function record(spPrTail: string): InlineDrawingRecord {
  const xml =
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:r="${R}"><w:body><w:p><w:r><w:drawing>` +
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="457200"/>' +
    `<wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch/></pic:blipFill><pic:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm>' +
    `${spPrTail}</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>` +
    '</w:r></w:p></w:body></w:document>';
  const parsed = readOoxmlPart(xml, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  const stack: OoxmlElement[] = [parsed.part.root];
  let drawing: OoxmlDrawingNode | null = null;
  while (stack.length && !drawing) {
    const node = stack.shift()!;
    if (node.kind === 'drawing') drawing = node;
    else for (const child of node.children) if (child.kind !== 'textValue') stack.push(child);
  }
  const projection = projectDrawing(drawing!, {
    ownerPartName: '/word/document.xml',
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  })!;
  return buildInlineDrawingRecord({
    input: {
      drawingNodeId: projection.drawingNodeId,
      ownerPartName: '/word/document.xml',
      projection,
      resource: READY_PNG,
    },
    paragraphId: 'p1',
    start: 0,
    slotX: 0,
    y: 0,
    baseline: emuToPoints(projection.extentEmu.cy),
    contentLeft: 0,
    contentRight: 600,
  });
}

function paint(drawing: InlineDrawingRecord): HTMLElement {
  const urlForReady = (handle: ValidatedImageBytesHandle, mime: string) =>
    `blob:fake/${mime}/${handle.resourceKey}`;
  return paintDrawingRecord(
    document,
    drawing,
    {
      scale: 1,
      strings: DEFAULT_DRAWING_PAINT_STRINGS,
      imageUrlPort: { create: urlForReady, revoke: () => {} },
    },
    { urlForReady, reconcile: () => {}, revokeAll: () => {} },
    Object.freeze({ x: 0, y: 0, width: 600, height: 800 })
  )!;
}

const RED_LINE = '<a:ln w="25400"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></a:ln>';
const SHADOW =
  '<a:effectLst><a:outerShdw blurRad="0" dist="38100" dir="2700000" algn="tl">' +
  '<a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>';

const installed = drawingRenderers();
afterEach(() => installDrawingRenderers({ effects: installed.effects }));

describe('picture frame paint', () => {
  test('the shadow paints under the image and the outline over it', () => {
    const element = paint(
      record(`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${RED_LINE}${SHADOW}`)
    );
    expect(element.classList.contains('docx-drawing-ready')).toBe(true);
    const layers = [...element.children];
    const image = layers.findIndex((layer) => layer.querySelector('img'));
    expect(image).toBeGreaterThan(0);
    expect(layers[image - 1]!.querySelector('[data-docx-shadow]')).not.toBeNull();
    const outline = layers[image + 1]!.querySelector('path[stroke="#C00000"]');
    expect(outline).not.toBeNull();
    expect(outline!.getAttribute('stroke-linejoin')).toBe('round');
  });

  test('the geometry clips the image, not the outline', () => {
    const element = paint(record(`<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom>${RED_LINE}`));
    const frame = element.querySelector<HTMLElement>('.docx-drawing-image-frame')!;
    expect(frame.querySelector('img')).not.toBeNull();
    expect(frame.style.clipPath).toMatch(/^polygon\(/);
    expect(element.style.clipPath).not.toMatch(/^polygon\(/);
  });

  test('an inline picture outline reaches past the sides and bottom but not the top', () => {
    const drawing = record(`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${RED_LINE}`);
    const ink = vectorShapeInkClip(drawing, drawing.paintBounds);
    const paint = drawing.paintBounds;
    expect(ink.y).toBe(paint.y);
    // A 2 pt outline outside the picture reaches 2 pt past each other edge.
    expect(paint.x - ink.x).toBeCloseTo(2, 6);
    expect(ink.x + ink.width - (paint.x + paint.width)).toBeCloseTo(2, 6);
    expect(ink.y + ink.height - (paint.y + paint.height)).toBeCloseTo(2, 6);
  });

  test('soft edges mask the image and a reflection mirrors it below', () => {
    // Paint draws what the projection carries; a stand-in effects renderer supplies it.
    installDrawingRenderers({
      effects: {
        shape: ({ components }) => components,
        picture: () => ({
          effects: {
            softEdgeEmu: 76200,
            reflection: {
              startAlpha: 0.5,
              endAlpha: 0,
              endPosition: 0.4,
              distanceEmu: 0,
              blurEmu: 0,
            },
          },
        }),
      },
    });
    const element = paint(
      record(
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:effectLst><a:softEdge rad="76200"/>' +
          '<a:reflection stA="50000" endPos="40000" dir="5400000" sy="-100000" algn="bl"/>' +
          '</a:effectLst>'
      )
    );
    const frame = element.querySelector<HTMLElement>('.docx-drawing-image-frame')!;
    expect(frame.style.getPropertyValue('mask-image')).toContain('linear-gradient');
    const reflection = element.querySelector<HTMLElement>('.docx-drawing-reflection')!;
    expect(reflection.style.getPropertyValue('mask-image')).toContain('rgba(0,0,0,0.5)');
    // The mirror is two fifths of the picture's 36 pt height, right below it.
    expect(reflection.style.height).toBe('14.4px');
    expect(reflection.style.top).toBe('36px');
    const copy = reflection.querySelector<HTMLElement>('.docx-drawing-image-frame')!;
    expect(copy.style.transform).toBe('scaleY(-1)');
  });

  test('a plain picture paints no frame', () => {
    const element = paint(record('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'));
    expect(element.querySelector('svg')).toBeNull();
  });
});
