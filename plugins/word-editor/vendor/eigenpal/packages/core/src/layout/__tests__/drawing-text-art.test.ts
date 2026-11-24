// VML text art layout: the string's glyph ink fills the shape box inside the VML text inset
// (0.1in left and right, 0.05in top and bottom), from real HarfBuzz outlines.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
  type FontRequest,
  type TextMeasurer,
} from '../index.ts';
import { layoutTextArt, rotatedBounds, textArtRunStyle } from '../drawing-text-art.ts';
import { shapedRunOutline } from '../text-outline.ts';
import type { ShapedRun } from '../shaped-run.ts';
import type { LegacyTextArtProjection } from '../../store/package/legacy-vml-text-art.ts';

await initializeHarfBuzz();

const REQUEST: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };
const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const resolved = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [
    { request: REQUEST, id: 'dejavu', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 },
  ],
  validateFont: harfBuzzFontValidator,
}).resolve(REQUEST);
if (resolved instanceof FontResolutionError) throw resolved;

const shaped = createShapedMeasurer({
  shaper: createHarfBuzzTextShaper(),
  resolveFont: () => resolved,
  fallback: createFixedMeasurer(6, 14),
  shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
  unicodeDataVersion: '15.1',
});

const ART: LegacyTextArtProjection = {
  text: 'DRAFT',
  fontFamily: 'DejaVu Sans',
  bold: false,
  italic: false,
  fillHex: 'C0C0C0',
  fillAlpha: 0.5,
  strokeHex: null,
  strokeAlpha: 1,
  strokeWidthPt: 0,
  rotationDegrees: 315,
};

/** Every coordinate pair of a path, as [x, y]. */
function pairs(path: string): Array<[number, number]> {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < numbers.length; i += 2) out.push([numbers[i]!, numbers[i + 1]!]);
  return out;
}

describe('text art layout', () => {
  test('the shaped glyph ink fills the box inside the text inset', () => {
    const art = layoutTextArt(ART, 412.4, 247.45, shaped);
    expect(art.path).not.toBeNull();
    const points = pairs(art.path!);
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(7.2, 2);
    expect(Math.max(...xs)).toBeCloseTo(412.4 - 7.2, 2);
    expect(Math.min(...ys)).toBeCloseTo(3.6, 2);
    expect(Math.max(...ys)).toBeCloseTo(247.45 - 3.6, 2);
    expect(art).toMatchObject({ fillHex: 'C0C0C0', fillAlpha: 0.5, rotationDegrees: 315 });
  });

  test('trimmed text fills the whole box with no inset', () => {
    const art = layoutTextArt({ ...ART, trim: true }, 240, 40, shaped);
    const points = pairs(art.path!);
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(0, 2);
    expect(Math.max(...xs)).toBeCloseTo(240, 2);
    expect(Math.min(...ys)).toBeCloseTo(0, 2);
    expect(Math.max(...ys)).toBeCloseTo(40, 2);
  });

  test('every page of a repeated header reuses one fitted record', () => {
    let shaped = 0;
    const counting: TextMeasurer = {
      ...createFixedMeasurer(6, 14),
      textOutline: () => {
        shaped += 1;
        return {
          path: 'M0 -10L20 -10L20 0Z',
          ink: { left: 0, top: -10, right: 20, bottom: 0 },
        };
      },
    };
    const first = layoutTextArt(ART, 300, 100, counting);
    for (let page = 0; page < 50; page++)
      expect(layoutTextArt(ART, 300, 100, counting)).toBe(first);
    expect(shaped).toBe(1);
    expect(layoutTextArt(ART, 320, 100, counting)).not.toBe(first);
    expect(shaped).toBe(2);
  });

  test('a family no face resolves draws in the default face instead of nothing', () => {
    const families: Array<string | null> = [];
    const defaultOnly: TextMeasurer = {
      ...createFixedMeasurer(6, 14),
      textOutline: (_text, style) => {
        families.push(style.fontFamily);
        return style.fontFamily === null
          ? { path: 'M0 -10L20 -10L20 0Z', ink: { left: 0, top: -10, right: 20, bottom: 0 } }
          : undefined;
      },
    };
    const art = layoutTextArt({ ...ART, fontFamily: '&quot' }, 300, 100, defaultOnly);
    expect(families).toEqual(['&quot', null]);
    expect(art.path).not.toBeNull();
    expect(art.fontFamily).toBe('&quot');
  });

  test('a measurer that knows only the ink box fits the drawn text instead', () => {
    const inkOnly: TextMeasurer = {
      ...createFixedMeasurer(6, 14),
      textOutline: () => ({ path: null, ink: { left: 1, top: -70, right: 301, bottom: 0 } }),
    };
    const art = layoutTextArt(ART, 314.4, 77.2, inkOnly);
    expect(art.path).toBeNull();
    expect(art.fit).toEqual({ scaleX: 1, scaleY: 1, offsetX: 6.2, offsetY: 73.6 });
  });

  test('without outlines or ink nothing is guessed', () => {
    expect(layoutTextArt(ART, 300, 100, createFixedMeasurer(6, 14))).toMatchObject({
      path: null,
      fit: null,
    });
    expect(layoutTextArt(ART, 300, 100, undefined).fit).toBeNull();
  });

  test('the measured style names the art face at the measuring size', () => {
    expect(textArtRunStyle({ ...ART, bold: true })).toMatchObject({
      fontFamily: 'DejaVu Sans',
      bold: true,
      italic: false,
      fontSizePt: 100,
    });
  });

  test('a turned box paints inside the box that holds the whole turn', () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    const turned = rotatedBounds(box, 315);
    const side = 150 / Math.SQRT2;
    expect(turned.width).toBeCloseTo(side, 6);
    expect(turned.height).toBeCloseTo(side, 6);
    expect(turned.x + turned.width / 2).toBeCloseTo(50, 6);
    expect(turned.y + turned.height / 2).toBeCloseTo(25, 6);
    expect(rotatedBounds(box, 0)).toBe(box);
  });
});

describe('shaped run outlines', () => {
  const glyph = (id: number, originX: number, path: string) => ({
    id,
    cluster: 0,
    originX,
    originY: 0,
    advanceX: 64_000,
    advanceY: 0,
    offsetX: 0,
    offsetY: 0,
    outline: { path, unitsPerEm: 1000 },
  });
  const run = (glyphs: unknown[]) => ({ glyphs }) as unknown as ShapedRun;

  test('glyphs move to their pen positions and y turns downward', () => {
    const outline = shapedRunOutline(
      run([glyph(1, 0, 'M0 0L500 0L500 700Z'), glyph(2, 64_000, 'M0 -200Q250 0 500 -200Z')]),
      10,
      64
    );
    expect(outline?.path).toBe('M0 0L5 0L5 -7ZM1000 2Q1002.5 0 1005 2Z');
    expect(outline?.ink).toEqual({ left: 0, top: -7, right: 1005, bottom: 2 });
  });

  test('a missing glyph or a foreign path command yields no outline', () => {
    expect(shapedRunOutline(run([glyph(0, 0, 'M0 0L1 1Z')]), 10, 64)).toBeUndefined();
    expect(shapedRunOutline(run([glyph(3, 0, 'M0 0A1 1 0 0 0 1 1Z')]), 10, 64)).toBeUndefined();
  });
});
