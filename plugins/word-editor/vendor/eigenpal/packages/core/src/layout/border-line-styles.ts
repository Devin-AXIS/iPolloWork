// Stroke patterns of the `ST_Border` line styles (ECMA-376 §17.18.2) that are not one solid
// band: the dash family, the two three-dimensional styles and `dashDotStroked`.
//
// Shared by paragraph (`w:pBdr`, §17.3.1.24), table (`w:tblBorders` §17.4.38, `w:tcBorders`
// §17.4.66) and page borders, so every painter draws the same marks. Each value here was
// measured in reference renders with `w:sz` from 2 to 96 eighths of a point.

import {
  compoundBorderStrokesForExtentPt,
  compoundBorderStrokesPt,
  isThreeDBorderVal,
  threeDBorderOuterPt,
} from './border-metrics.ts';

export { DASH_DOT_STROKED_BAND_PT, isThreeDBorderVal } from './border-metrics.ts';

/**
 * Dash and gap lengths of the dash family, as multiples of the authored width, ink first.
 * The pattern repeats along the edge.
 */
const DASH_PATTERNS: ReadonlyMap<string, readonly number[]> = new Map([
  ['dotted', [1, 1]],
  ['dashed', [4, 4]],
  ['dashSmallGap', [4, 1]],
  ['dotDash', [7, 3, 3, 3]],
  ['dotDotDash', [6, 2, 2, 2, 2, 2]],
]);

/**
 * The dash and gap lengths in points of a dash-family line style with authored width
 * `widthPt`, ink first; null for any other style.
 *
 * @internal
 */
export function borderDashPatternPt(val: string, widthPt: number): readonly number[] | null {
  const pattern = DASH_PATTERNS.get(val);
  if (!pattern || !(widthPt > 0)) return null;
  return pattern.map((multiple) => multiple * widthPt);
}

/**
 * The hatch of `dashDotStroked`: hairlines at 45 degrees, rising toward the end of the edge,
 * `pitchPt` apart along it. Each period of `slots.length` hatch positions draws a line only
 * where its slot is true, which gives a dash, a gap, a dot and a gap.
 *
 * @internal
 */
export const DASH_DOT_STROKED_HATCH = {
  pitchPt: 0.72,
  lineWidthPt: 0.24,
  slots: [true, true, true, false, true, false, true, true],
} as const;

const HLS_MAX = 240;
const RGB_MAX = 255;

function rgbToHls(r: number, g: number, b: number): readonly [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = Math.floor(((max + min) * HLS_MAX + RGB_MAX) / (2 * RGB_MAX));
  if (max === min) return [(HLS_MAX * 2) / 3, lightness, 0];
  const sum = max + min;
  const saturation =
    lightness <= HLS_MAX / 2
      ? Math.floor(((max - min) * HLS_MAX + sum / 2) / sum)
      : Math.floor(((max - min) * HLS_MAX + (2 * RGB_MAX - sum) / 2) / (2 * RGB_MAX - sum));
  const delta = max - min;
  const part = (channel: number) =>
    Math.floor(((max - channel) * (HLS_MAX / 6) + delta / 2) / delta);
  let hue =
    r === max
      ? part(b) - part(g)
      : g === max
        ? HLS_MAX / 3 + part(r) - part(b)
        : (2 * HLS_MAX) / 3 + part(g) - part(r);
  if (hue < 0) hue += HLS_MAX;
  if (hue > HLS_MAX) hue -= HLS_MAX;
  return [hue, lightness, saturation];
}

function hueToRgb(n1: number, n2: number, hue: number): number {
  let h = hue;
  if (h < 0) h += HLS_MAX;
  if (h > HLS_MAX) h -= HLS_MAX;
  if (h < HLS_MAX / 6) return n1 + Math.floor(((n2 - n1) * h + HLS_MAX / 12) / (HLS_MAX / 6));
  if (h < HLS_MAX / 2) return n2;
  if (h < (HLS_MAX * 2) / 3)
    return n1 + Math.floor(((n2 - n1) * ((HLS_MAX * 2) / 3 - h) + HLS_MAX / 12) / (HLS_MAX / 6));
  return n1;
}

function hlsToHex(hue: number, lightness: number, saturation: number): string {
  const l = Math.max(0, Math.min(HLS_MAX, lightness));
  const channel = (value: number) =>
    Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase();
  if (saturation === 0) {
    const gray = Math.floor((l * RGB_MAX) / HLS_MAX);
    return channel(gray).repeat(3);
  }
  const m2 =
    l <= HLS_MAX / 2
      ? Math.floor((l * (HLS_MAX + saturation) + HLS_MAX / 2) / HLS_MAX)
      : l + saturation - Math.floor((l * saturation + HLS_MAX / 2) / HLS_MAX);
  const m1 = 2 * l - m2;
  const scale = (value: number) => Math.floor((value * RGB_MAX + HLS_MAX / 2) / HLS_MAX);
  return (
    channel(scale(hueToRgb(m1, m2, hue + HLS_MAX / 3))) +
    channel(scale(hueToRgb(m1, m2, hue))) +
    channel(scale(hueToRgb(m1, m2, hue - HLS_MAX / 3)))
  );
}

/**
 * The light, middle and dark tones of a three-dimensional border in `color` (RRGGBB, or
 * null for auto).
 *
 * The tones keep the hue and saturation and move the lightness, on a 0 to 240 scale: the
 * light tone is the colour itself from lightness 120, 40 lighter from 60, and 80 lighter
 * below that; the middle tone is 70 darker than the light one and the dark tone 80 darker.
 * Black and auto give silver, grey and black, and white gives white and two greys.
 */
export function threeDBorderTones(color: string | null): readonly [string, string, string] {
  const hex = color?.toUpperCase() ?? '000000';
  if (hex === '000000') return ['C0C0C0', '606060', '000000'];
  if (hex === 'FFFFFF') return ['FFFFFF', 'A0A0A0', '808080'];
  const [hue, lightness, saturation] = rgbToHls(
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  );
  const light = lightness >= 120 ? lightness : lightness >= 60 ? lightness + 40 : lightness + 80;
  return [
    hlsToHex(hue, light, saturation),
    hlsToHex(hue, light - 70, saturation),
    hlsToHex(hue, light - 80, saturation),
  ];
}

/** One stroke across a border band: offset from the band's top or left edge, width and colour. */
export interface BorderLineStroke {
  readonly offsetPt: number;
  readonly widthPt: number;
  /** RRGGBB, or null for the edge's own colour. */
  readonly color: string | null;
}

/**
 * The parallel strokes of a multi-stroke line style with authored width `widthPt`, top to
 * bottom (or left to right) in page space on every edge; null for a one-stroke style.
 *
 * Compound styles draw every stroke in the edge colour. A three-dimensional style draws its
 * outer, middle and inner strokes in the tones of {@link threeDBorderTones}: light to dark
 * for `threeDEmboss`, dark to light for `threeDEngrave`.
 */
export function borderLineStrokesPt(
  val: string,
  widthPt: number,
  color: string | null
): readonly BorderLineStroke[] | null {
  if (isThreeDBorderVal(val)) {
    const outer = threeDBorderOuterPt(widthPt);
    const [light, mid, dark] = threeDBorderTones(color);
    const [first, last] = val === 'threeDEmboss' ? [light, dark] : [dark, light];
    return [
      { offsetPt: 0, widthPt: outer, color: first },
      { offsetPt: outer, widthPt, color: mid },
      { offsetPt: outer + widthPt, widthPt: outer, color: last },
    ];
  }
  const strokes = compoundBorderStrokesPt(val, widthPt);
  return strokes ? strokes.map((stroke) => ({ ...stroke, color })) : null;
}

/**
 * {@link borderLineStrokesPt} for a painter that holds the painted band `extentPt` and not
 * the authored width.
 *
 * @internal
 */
export function borderLineStrokesForExtentPt(
  val: string,
  extentPt: number,
  color: string | null
): readonly BorderLineStroke[] | null {
  if (isThreeDBorderVal(val)) {
    // The band is the authored width plus two outer strokes of 0.75pt, or 1.5pt from 3pt.
    const widthPt = extentPt >= 6 ? extentPt - 3 : Math.max(0, extentPt - 1.5);
    return borderLineStrokesPt(val, widthPt, color);
  }
  const strokes = compoundBorderStrokesForExtentPt(val, extentPt);
  return strokes ? strokes.map((stroke) => ({ ...stroke, color })) : null;
}
