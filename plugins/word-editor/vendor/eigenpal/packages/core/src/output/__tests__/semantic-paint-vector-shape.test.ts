// A typed `wps:wsp` solid-geometry shape paints as inline SVG, not a placeholder card.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type { VectorShapeProjection } from '../../store/package/drawing-projection.ts';
import { computeDrawingGeometry } from '../../layout/drawing-geometry.ts';
import { EMU_PER_POINT, type InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import { DEFAULT_DRAWING_PAINT_STRINGS, paintDrawingRecord } from '../semantic-paint-drawings.ts';

const EXTENT = Object.freeze({ cx: 6_696_075, cy: 47_625 });

const SUBPATHS = Object.freeze([
  Object.freeze([
    Object.freeze({ x: 6_696_075, y: 38_100 }),
    Object.freeze({ x: 0, y: 38_100 }),
    Object.freeze({ x: 0, y: 47_625 }),
    Object.freeze({ x: 6_696_075, y: 47_625 }),
  ]),
  Object.freeze([
    Object.freeze({ x: 6_696_075, y: 0 }),
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 0, y: 9_525 }),
    Object.freeze({ x: 6_696_075, y: 9_525 }),
  ]),
]);

function vectorShape(): VectorShapeProjection {
  return Object.freeze({
    extentEmu: EXTENT,
    subpathsEmu: SUBPATHS,
    fillHex: '000000',
    strokeHex: null,
    strokeWidthEmu: 0,
    components: Object.freeze([
      Object.freeze({
        subpathsEmu: SUBPATHS,
        fillHex: '000000',
        fillAlpha: 1,
        strokeHex: null,
        strokeAlpha: 1,
        strokeWidthEmu: 0,
      }),
    ]),
  });
}

function shapeRecord(): InlineDrawingRecord {
  const width = EXTENT.cx / EMU_PER_POINT;
  const height = EXTENT.cy / EMU_PER_POINT;
  const geometry = computeDrawingGeometry({
    extentWidth: width,
    extentHeight: height,
    anchorX: 0,
    anchorY: 0,
    effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: Object.freeze({
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: Object.freeze({ x: 0, y: 0 }),
      extentEmu: EXTENT,
    }),
    presetGeometry: 'rect',
  });
  return Object.freeze({
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
    resource: Object.freeze({ kind: 'missing' as const, partName: null, reason: 'no-resource' }),
    accessibility: Object.freeze({ hidden: false, decorative: true, label: null }),
    hyperlinkHref: null,
    effects: Object.freeze({ grayscale: false, brightness: 0, contrast: 0 }),
    crop: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
    transform: Object.freeze({
      rotationDegrees: 0,
      flipHorizontal: false,
      flipVertical: false,
      offsetEmu: Object.freeze({ x: 0, y: 0 }),
      extentEmu: EXTENT,
    }),
    placeholderGraphicKind: 'textbox',
    vectorShape: vectorShape(),
  }) as unknown as InlineDrawingRecord;
}

describe('vector shape paint', () => {
  test('paints an SVG path with the validated fill and no placeholder card', () => {
    const element = paintDrawingRecord(
      document,
      shapeRecord(),
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    );
    expect(element).not.toBeNull();
    expect(element!.className).toContain('docx-drawing-shape');
    expect(element!.querySelector('.docx-drawing-placeholder-card')).toBeNull();
    expect(element!.querySelector('img')).toBeNull();
    const svg = element!.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 6696075 47625');
    const path = svg!.querySelector('path');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('fill')).toBe('#000000');
    expect(path!.getAttribute('fill-rule')).toBe('evenodd');
    const d = path!.getAttribute('d')!;
    expect(d.startsWith('M6696075 38100L')).toBe(true);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });

  test('an edge rule widens the paint clip, not the pointer target', () => {
    const base = shapeRecord();
    const rule = [
      { x: 0, y: 0 },
      { x: 0, y: EXTENT.cy },
    ];
    const record = {
      ...base,
      vectorShape: {
        ...vectorShape(),
        components: [
          {
            subpathsEmu: [rule],
            subpathsClosed: [false],
            fillHex: null,
            fillAlpha: 1,
            strokeHex: '000000',
            strokeAlpha: 1,
            strokeWidthEmu: 25_400,
          },
        ],
      },
    } as InlineDrawingRecord;
    const element = paintDrawingRecord(
      document,
      record,
      { scale: 2, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    )!;
    // The pointer target keeps the published bounds that layout hit testing matches.
    expect(element.style.left).toBe('0px');
    expect(parseFloat(element.style.width)).toBeCloseTo(base.paintBounds.width * 2, 6);
    expect(element.style.pointerEvents).toBe('auto');
    expect(element.style.overflow).toBe('visible');
    // Half of a 2pt rule is 1pt, 2px at scale 2, on the left side only. No extra element.
    expect(element.style.clipPath).toBe('inset(0px 0px 0px -2px)');
    expect(element.children).toHaveLength(1);
    const frame = element.querySelector<HTMLElement>('.docx-drawing-image-frame')!;
    expect(frame.parentElement).toBe(element);
    expect(frame.style.left).toBe('0px');
    expect(frame.style.pointerEvents).toBe('none');
    expect(record.paintBounds).toEqual(base.paintBounds);

    // A shape whose ink stays inside clips at its box and keeps frame pointer events.
    const plain = paintDrawingRecord(
      document,
      base,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    )!;
    expect(plain.style.overflow).toBe('hidden');
    expect(plain.style.clipPath).toBe('');
    expect(plain.querySelector<HTMLElement>('.docx-drawing-image-frame')!.style.pointerEvents).toBe(
      ''
    );
  });

  test('a standalone vertical line paints in a frame at its length scale', () => {
    const base = shapeRecord();
    const height = 72;
    const line = [
      { x: 0, y: 0 },
      { x: 0, y: height * EMU_PER_POINT },
    ];
    const content = { x: 0, y: 0, width: 0, height };
    const record = {
      ...base,
      paintBounds: content,
      hitBounds: content,
      geometry: { ...base.geometry, contentBounds: content, paintBounds: content },
      vectorShape: {
        ...vectorShape(),
        extentEmu: { cx: 0, cy: height * EMU_PER_POINT },
        components: [
          {
            subpathsEmu: [line],
            subpathsClosed: [false],
            fillHex: null,
            fillAlpha: 1,
            strokeHex: '000000',
            strokeAlpha: 1,
            strokeWidthEmu: 25_400,
          },
        ],
      },
    } as InlineDrawingRecord;
    const element = paintDrawingRecord(
      document,
      record,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    )!;
    expect(element).not.toBeNull();
    // A 2pt rule reaches 1pt either side of its zero-width box.
    expect(element.style.clipPath).toBe('inset(0px -1px 0px -1px)');
    const frame = element.querySelector<HTMLElement>('.docx-drawing-image-frame')!;
    // The frame spans one stroke width either side, at the line's 1pt-per-12700-EMU scale.
    expect(frame.style.left).toBe('-2px');
    expect(frame.style.width).toBe('4px');
    expect(frame.querySelector('svg')!.getAttribute('viewBox')).toBe(
      `-25400 0 50800 ${72 * 12700}`
    );
  });

  test('an inset outline strokes at twice its width, clipped to its own geometry', () => {
    const base = shapeRecord();
    const square = [
      { x: 0, y: 0 },
      { x: EXTENT.cx, y: 0 },
      { x: EXTENT.cx, y: EXTENT.cy },
      { x: 0, y: EXTENT.cy },
    ];
    const record = {
      ...base,
      vectorShape: {
        ...vectorShape(),
        components: [
          {
            subpathsEmu: [square],
            subpathsClosed: [true],
            fillHex: null,
            fillAlpha: 1,
            strokeHex: '000000',
            strokeAlpha: 1,
            strokeWidthEmu: 12_700,
            strokeInset: true,
          },
        ],
      },
    } as InlineDrawingRecord;
    const element = paintDrawingRecord(
      document,
      record,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    )!;
    const path = element.querySelector('svg > path')!;
    expect(path.getAttribute('stroke-width')).toBe('25400');
    const clipId = /^url\(#(.+)\)$/.exec(path.getAttribute('clip-path')!)![1]!;
    const clip = element.querySelector(`clipPath[id="${clipId}"] path`)!;
    expect(clip.getAttribute('d')).toBe(path.getAttribute('d'));
    // The ink stays inside, so the paint clip does not grow.
    expect(element.style.clipPath).toBe('');
  });

  test('paints grouped components with independent colours and opacity', () => {
    const base = shapeRecord();
    const firstPath = vectorShape().subpathsEmu[0]!;
    const secondPath = vectorShape().subpathsEmu[1]!;
    const record = {
      ...base,
      vectorShape: {
        ...vectorShape(),
        components: [
          {
            subpathsEmu: [firstPath],
            fillHex: '4472C4',
            fillAlpha: 0.5,
            strokeHex: null,
            strokeAlpha: 1,
            strokeWidthEmu: 0,
          },
          {
            subpathsEmu: [secondPath],
            fillHex: 'FF0000',
            fillAlpha: 1,
            strokeHex: '000000',
            strokeAlpha: 0.25,
            strokeWidthEmu: 12_700,
          },
        ],
      },
    } as InlineDrawingRecord;
    const element = paintDrawingRecord(
      document,
      record,
      { scale: 1, strings: DEFAULT_DRAWING_PAINT_STRINGS, imageUrlPort: null, inertLinks: true },
      null
    )!;
    const paths = element.querySelectorAll('path');
    expect(paths).toHaveLength(2);
    expect(paths[0]!.getAttribute('fill')).toBe('#4472C4');
    expect(paths[0]!.getAttribute('fill-opacity')).toBe('0.5');
    expect(paths[1]!.getAttribute('fill')).toBe('#FF0000');
    expect(paths[1]!.getAttribute('stroke')).toBe('#000000');
    expect(paths[1]!.getAttribute('stroke-opacity')).toBe('0.25');
  });
});
