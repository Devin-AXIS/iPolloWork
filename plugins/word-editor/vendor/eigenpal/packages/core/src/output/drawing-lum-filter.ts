// Picture brightness/contrast (`a:lum`) as a CSS `filter` value.
//
// Word applies `a:lum` as ONE linear transfer per sRGB channel, measured on Word 16
// with a grey-ramp fixture (issue #821):
//
//   out = slope * (in - pivot) + pivot + bright
//   slope = contrast >= 0 ? 1 / (1 - contrast) : 1 + contrast
//   pivot = 0.5 - bright / 2
//
// so brightness shifts the contrast pivot down as it shifts the output up, and +100%
// contrast is a hard step at the pivot. The Washout preset (`bright="70001"
// contrast="-70000"`) therefore maps white to white; the previous
// `brightness() contrast()` chain pivoted around mid grey and painted white as `#A6A6A6`.
//
// CSS `contrast(c)` is `c * in + (1 - c) / 2` and `brightness(b)` is `b * in`, each clamped to
// [0, 1]. Two of them compose to any `slope * in + intercept` without an intermediate clamp
// changing the result, so the transfer stays a shorthand `filter` value: no SVG element, and
// the same string feeds the paint fingerprint.

import type { DrawingImageEffects } from '../store/package/drawing-image-effects.ts';

/** Slope that stands in for the infinite one at +100% contrast: a step narrower than one 8-bit level. */
const HARD_STEP_SLOPE = 1000;

/** `out = slope * in + intercept` over sRGB channels in [0, 1]. */
export interface LumTransfer {
  readonly slope: number;
  readonly intercept: number;
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Word's `a:lum` transfer for `bright`/`contrast` given in percent (`70.001` for `70001`).
 * Returns `null` for the identity transfer and for non-finite input.
 */
export function lumTransfer(brightPercent: number, contrastPercent: number): LumTransfer | null {
  if (!Number.isFinite(brightPercent) || !Number.isFinite(contrastPercent)) return null;
  const bright = clampUnit(brightPercent / 100);
  const contrast = clampUnit(contrastPercent / 100);
  if (bright === 0 && contrast === 0) return null;
  const slope =
    contrast >= 0 ? Math.min(HARD_STEP_SLOPE, 1 / (1 - contrast)) : Math.max(0, 1 + contrast);
  const pivot = 0.5 - bright / 2;
  const intercept = pivot + bright - slope * pivot;
  return Object.freeze({ slope, intercept });
}

/** Six decimals: far below one 8-bit level, and stable across paints for the fingerprint. */
function styleNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * The transfer as CSS filter functions. Order follows the sign of the intercept so no
 * primitive clamps a value the final clamp would not: with a positive intercept
 * `contrast()` runs first and stays inside [0, 1]; with a negative one `brightness()` runs
 * first and only saturates inputs that saturate anyway.
 */
export function lumFilterFunctions(transfer: LumTransfer): string {
  const { slope, intercept } = transfer;
  if (intercept >= 0) {
    const brightness = slope + 2 * intercept;
    if (brightness <= 0) return 'brightness(0)';
    return `contrast(${styleNumber(slope / brightness)}) brightness(${styleNumber(brightness)})`;
  }
  const contrast = 1 - 2 * intercept;
  return `brightness(${styleNumber(slope / contrast)}) contrast(${styleNumber(contrast)})`;
}

/** Colour-mode filter for a painted picture; `undefined` when nothing applies. */
export function drawingFilterStyle(effects: DrawingImageEffects): string | undefined {
  const parts: string[] = [];
  if (effects.grayscale) parts.push('grayscale(1)');
  const transfer = lumTransfer(effects.brightness, effects.contrast);
  if (transfer) parts.push(lumFilterFunctions(transfer));
  // `a:alphaModFix` is a fixed alpha the record publishes for every sink. The PDF writer
  // applies it as a graphics-state alpha; the same picture must not paint opaque here.
  const { opacity } = effects;
  if (opacity !== undefined && Number.isFinite(opacity) && opacity >= 0 && opacity < 1)
    parts.push(`opacity(${Math.round(opacity * 1000) / 1000})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}
