// Gradient fills and outer shadows paint into the vector shape SVG.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { VectorShapeComponent } from '../../store/package/drawing-shape-projection.ts';
import { computeDrawingGeometry } from '../../layout/drawing-geometry.ts';
import { EMU_PER_POINT, type InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import { DEFAULT_DRAWING_PAINT_STRINGS, paintDrawingRecord } from '../semantic-paint-drawings.ts';

const EXTENT = Object.freeze({ cx: 1_270_000, cy: 635_000 });
const BOX = [
  { x: 0, y: 0 },
  { x: 1_270_000, y: 0 },
  { x: 1_270_000, y: 635_000 },
  { x: 0, y: 635_000 },
];

function record(component: VectorShapeComponent): InlineDrawingRecord {
  const width = EXTENT.cx / EMU_PER_POINT;
  const height = EXTENT.cy / EMU_PER_POINT;
  const transform = {
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    offsetEmu: { x: 0, y: 0 },
    extentEmu: EXTENT,
  };
  const geometry = computeDrawingGeometry({
    extentWidth: width,
    extentHeight: height,
    anchorX: 0,
    anchorY: 0,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform,
    presetGeometry: 'rect',
  });
  return {
    kind: 'inlineDrawing',
    drawingNodeId: 'n1',
    paragraphId: 'p1',
    ownerPartName: '/word/document.xml',
    start: 0,
    x: 0,
    y: 0,
    width,
    height,
    distL: 0,
    distR: 0,
    distT: 0,
    distB: 0,
    advanceStart: 0,
    advanceEnd: width,
    baselineOffset: 0,
    paintBounds: geometry.paintBounds,
    hitBounds: geometry.hitBounds,
    geometry,
    resource: { kind: 'missing', partName: null, reason: 'no-resource' },
    accessibility: { hidden: false, decorative: true, label: null },
    hyperlinkHref: null,
    effects: { grayscale: false, brightness: 0, contrast: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform,
    placeholderGraphicKind: 'textbox',
    vectorShape: {
      extentEmu: EXTENT,
      subpathsEmu: [BOX],
      fillHex: null,
      strokeHex: null,
      strokeWidthEmu: 0,
      components: [component],
    },
  } as unknown as InlineDrawingRecord;
}

function paint(component: VectorShapeComponent): SVGSVGElement {
  const element = paintDrawingRecord(
    document,
    record(component),
    { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, inertLinks: true },
    null
  );
  return element!.querySelector('svg')!;
}

const BASE: VectorShapeComponent = {
  subpathsEmu: [BOX],
  fillHex: '808080',
  fillAlpha: 0.5,
  strokeHex: null,
  strokeAlpha: 1,
  strokeWidthEmu: 0,
};

describe('vector shape effects paint', () => {
  test('a gradient fill references its gradient and carries opacity on the stops only', () => {
    const svg = paint({
      ...BASE,
      fillGradient: {
        kind: 'linear',
        stops: [
          { offset: 0, hex: 'FF0000', alpha: 0.5 },
          { offset: 1, hex: '0000FF', alpha: 0.5 },
        ],
        coords: [0, 0, 1_270_000, 0],
        matrix: [1, 0, 0, 1, 0, 0],
      },
    });
    const gradient = svg.querySelector('linearGradient')!;
    expect(gradient.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    expect(
      [...gradient.querySelectorAll('stop')].map((stop) => stop.getAttribute('stop-color'))
    ).toEqual(['#FF0000', '#0000FF']);
    const path = svg.querySelector('path:not([data-docx-shadow])')!;
    expect(path.getAttribute('fill')).toBe(`url(#${gradient.getAttribute('id')})`);
    expect(path.hasAttribute('fill-opacity')).toBe(false);
  });

  test('an outer shadow paints a blurred offset copy under the shape', () => {
    const svg = paint({
      ...BASE,
      fillAlpha: 1,
      shadow: { dxEmu: 0, dyEmu: 25_400, blurEmu: 38_100, hex: '000000', alpha: 0.4 },
    });
    const [shadow, shape] = [...svg.querySelectorAll('path')];
    expect(shadow!.hasAttribute('data-docx-shadow')).toBe(true);
    expect(shadow!.getAttribute('transform')).toBe('translate(0 25400)');
    expect(shadow!.getAttribute('opacity')).toBe('0.4');
    expect(shadow!.getAttribute('filter')).toMatch(/^url\(#docx-shadow-\d+\)$/);
    expect(svg.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('9525');
    // The filter region is in user space around the geometry, so lines and large blurs fit.
    const filter = svg.querySelector('filter')!;
    expect(filter.getAttribute('filterUnits')).toBe('userSpaceOnUse');
    expect(Number(filter.getAttribute('x'))).toBeLessThan(-28_000);
    expect(Number(filter.getAttribute('width'))).toBeGreaterThan(1_270_000 + 56_000);
    expect(shape!.getAttribute('fill')).toBe('#808080');
  });

  test('a shadow-only silhouette paints its shadow and nothing else', () => {
    const svg = paint({
      ...BASE,
      fillAlpha: 1,
      shadow: { dxEmu: 12_700, dyEmu: 12_700, blurEmu: 0, hex: '000000', alpha: 0.5 },
      shadowOnly: true,
    });
    const paths = [...svg.querySelectorAll('path')];
    expect(paths).toHaveLength(1);
    expect(paths[0]!.hasAttribute('data-docx-shadow')).toBe(true);
    expect(paths[0]!.hasAttribute('filter')).toBe(false);
  });

  test('a dashed outline scales its pattern by the stroke width', () => {
    const svg = paint({
      ...BASE,
      strokeHex: '1F3864',
      strokeWidthEmu: 12_700,
      strokeDash: [3, 1, 1, 1],
    });
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('stroke-dasharray')).toBe('38100 12700 12700 12700');
  });

  test('a solid outline has no dash pattern', () => {
    const svg = paint({ ...BASE, strokeHex: '1F3864', strokeWidthEmu: 12_700 });
    expect(svg.querySelector('path')!.hasAttribute('stroke-dasharray')).toBe(false);
  });
});
