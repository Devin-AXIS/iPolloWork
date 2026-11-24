import type { OoxmlElement } from './ooxml-tree.ts';
import type { DrawingImageEffects } from './drawing-image-effects.ts';
import { attribute as a, off, vmlFraction } from './legacy-vml-values.ts';

/** The `v:imagedata` colour attributes this subset reads into picture effects. */
export const LEGACY_IMAGE_EFFECT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'gain',
  'blacklevel',
  'grayscale',
  'bilevel',
]);

const NO_EFFECTS: DrawingImageEffects = Object.freeze({
  grayscale: false,
  brightness: 0,
  contrast: 0,
});

const fraction = vmlFraction;

const flag = (raw: string | undefined) => raw !== undefined && !off(raw);

/**
 * The picture effects of one `v:imagedata`, or null when a value is outside the bounded subset.
 *
 * `gain` scales each channel and `blacklevel` lifts it. They are the same linear transfer as
 * DrawingML `a:lum`: a gain below one is negative contrast (`gain - 1`), a gain above one is
 * positive contrast (`1 - 1 / gain`), and the black level is half the brightness.
 */
export function legacyImageEffects(image: OoxmlElement): DrawingImageEffects | null {
  const gain = fraction(a(image, 'gain'));
  const black = fraction(a(image, 'blacklevel'));
  const grayscale = flag(a(image, 'grayscale'));
  const bilevel = flag(a(image, 'bilevel'));
  if (gain === undefined && black === undefined && !grayscale && !bilevel) return NO_EFFECTS;
  // The largest gain, `2147483647f`, is the black-and-white picture: full contrast.
  if (gain !== undefined && !(Number.isFinite(gain) && gain > 0 && gain <= 32_768)) return null;
  if (black !== undefined && !(Number.isFinite(black) && Math.abs(black) <= 1)) return null;
  const contrast = gain === undefined ? 0 : gain <= 1 ? (gain - 1) * 100 : (1 - 1 / gain) * 100;
  const brightness = black === undefined ? 0 : black * 200;
  const clamp = (value: number) => Math.max(-100, Math.min(100, Math.round(value * 1000) / 1000));
  return Object.freeze({
    grayscale,
    brightness: clamp(brightness),
    contrast: clamp(contrast),
    ...(bilevel ? { bilevel: 0.5 } : {}),
  });
}
