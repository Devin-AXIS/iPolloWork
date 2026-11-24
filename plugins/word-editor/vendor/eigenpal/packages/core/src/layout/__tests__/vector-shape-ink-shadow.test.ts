// An outer shadow grows the vector shape paint clip by its offset and blur, so a shape with
// no effect extent still shows its shadow.

import { describe, expect, test } from 'bun:test';
import { vectorShapeInkClip } from '../vector-shape-ink.ts';
import type { InlineDrawingRecord } from '../drawing-layout.ts';
import type { VectorShapeComponent } from '../../store/package/drawing-shape-projection.ts';

const BOX = { x: 100, y: 100, width: 100, height: 50 };

function drawing(component: VectorShapeComponent): InlineDrawingRecord {
  return {
    paintBounds: BOX,
    geometry: { contentBounds: BOX, effectInsets: { top: 0, right: 0, bottom: 0, left: 0 } },
    vectorShape: {
      extentEmu: { cx: 1_270_000, cy: 635_000 },
      subpathsEmu: component.subpathsEmu,
      fillHex: component.fillHex,
      strokeHex: null,
      strokeWidthEmu: 0,
      components: [component],
    },
  } as unknown as InlineDrawingRecord;
}

const RECT = [
  { x: 0, y: 0 },
  { x: 1_270_000, y: 0 },
  { x: 1_270_000, y: 635_000 },
  { x: 0, y: 635_000 },
];

describe('vector shape ink clip with shadows', () => {
  test('a downward shadow grows the bottom by its offset and blur reach', () => {
    const clip = vectorShapeInkClip(
      drawing({
        subpathsEmu: [RECT],
        fillHex: '4472C4',
        fillAlpha: 1,
        strokeHex: null,
        strokeAlpha: 1,
        strokeWidthEmu: 0,
        shadow: { dxEmu: 0, dyEmu: 25_400, blurEmu: 50_800, hex: '000000', alpha: 0.4 },
      }),
      BOX
    );
    // 2 pt down plus three quarters of a 4 pt blur below; the blur alone on the other sides.
    expect(clip.y + clip.height).toBeCloseTo(150 + 2 + 3, 6);
    expect(clip.x).toBeCloseTo(100 - 3, 6);
    expect(clip.y).toBeCloseTo(100 - 1, 6);
  });

  test('a shape without a shadow keeps its paint bounds', () => {
    const clip = vectorShapeInkClip(
      drawing({
        subpathsEmu: [RECT],
        fillHex: '4472C4',
        fillAlpha: 1,
        strokeHex: null,
        strokeAlpha: 1,
        strokeWidthEmu: 0,
      }),
      BOX
    );
    expect(clip).toEqual(BOX);
  });
});
