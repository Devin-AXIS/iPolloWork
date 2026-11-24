// Text art paints as inline SVG: the fitted outline path, turned about the box centre, with
// the fill colour and opacity; without outlines, the text itself through the same fit.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { paintTextArt } from '../semantic-paint-text-art.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';
import type { DrawingTextArtRecord } from '../../layout/drawing-text-art.ts';

const ART: DrawingTextArtRecord = {
  text: 'DRAFT',
  fontFamily: 'Calibri',
  bold: false,
  italic: false,
  fontSizePt: 100,
  fillHex: 'C0C0C0',
  fillAlpha: 0.5,
  strokeHex: null,
  strokeAlpha: 1,
  strokeWidthPt: 0,
  rotationDegrees: 315,
  path: 'M7.2 3.6L200 3.6L200 96.4Z',
  fit: { scaleX: 2, scaleY: 1.5, offsetX: 7.2, offsetY: 90 },
};

function record(art: DrawingTextArtRecord): AnchoredDrawingRecord & {
  readonly textArt: DrawingTextArtRecord;
} {
  return {
    drawingNodeId: 'shape-1',
    x: 100,
    y: 200,
    width: 214.4,
    height: 100,
    paintBounds: { x: 50, y: 150, width: 314.4, height: 200 },
    accessibility: { hidden: false, decorative: false, label: '' },
    textArt: art,
  } as unknown as AnchoredDrawingRecord & { readonly textArt: DrawingTextArtRecord };
}

describe('text art paint', () => {
  test('the fitted outline paints as one translucent path in a turned box', () => {
    const element = paintTextArt(document, record(ART), 2, false);
    expect(element.className).toBe('docx-drawing docx-drawing-text-art');
    expect(element.dataset.drawingNodeId).toBe('shape-1');
    expect(element.style.left).toBe('100px');
    expect(element.style.width).toBe('628.8px');
    expect(element.style.pointerEvents).toBe('none');
    expect(element.getAttribute('aria-label')).toBe('DRAFT');
    const svg = element.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 214.4 100');
    expect(svg.style.left).toBe('100px');
    expect(svg.style.top).toBe('100px');
    expect(svg.style.transform).toBe('rotate(315deg)');
    const path = svg.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(ART.path);
    expect(path.getAttribute('fill')).toBe('#C0C0C0');
    expect(path.getAttribute('fill-opacity')).toBe('0.5');
    expect(path.getAttribute('stroke')).toBeNull();
  });

  test('without outlines the text paints through the fit, as text content only', () => {
    const element = paintTextArt(
      document,
      record({ ...ART, path: null, text: '<b>x</b>', strokeHex: '000000', strokeWidthPt: 1 }),
      1,
      true
    );
    expect(element.dataset.drawingNodeId).toBeUndefined();
    const text = element.querySelector('text')!;
    expect(text.textContent).toBe('<b>x</b>');
    expect(text.querySelector('b')).toBeNull();
    expect(text.getAttribute('transform')).toBe('matrix(2 0 0 1.5 7.2 90)');
    expect(text.getAttribute('font-family')).toBe('Calibri');
    expect(text.getAttribute('stroke')).toBe('#000000');
  });

  test('components an installed layout drew paint in box EMU in place of the path', () => {
    const wall = {
      subpathsEmu: [
        [
          { x: 0, y: 0 },
          { x: 12700, y: 0 },
          { x: 12700, y: 12700 },
        ],
      ],
      fillHex: '0066CC',
      fillAlpha: 1,
      strokeHex: null,
      strokeAlpha: 1,
      strokeWidthEmu: 0,
      fillRule: 'nonzero' as const,
    };
    const element = paintTextArt(document, record({ ...ART, components: [wall] }), 1, false);
    const svg = element.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${214.4 * 12700} ${100 * 12700}`);
    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute('d')).toBe('M0 0L12700 0L12700 12700Z');
    expect(paths[0]!.getAttribute('fill')).toBe('#0066CC');
    expect(paths[0]!.getAttribute('fill-rule')).toBe('nonzero');
  });

  test('an unmeasured record paints an empty, labelled frame', () => {
    const element = paintTextArt(document, record({ ...ART, path: null, fit: null }), 1, false);
    expect(element.querySelector('path, text')).toBeNull();
    expect(element.getAttribute('role')).toBe('img');
  });
});
