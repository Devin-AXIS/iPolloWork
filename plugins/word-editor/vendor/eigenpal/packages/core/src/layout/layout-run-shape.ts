import { isRunKerningEnabled } from './run-kerning.ts';
import { runLigatureFeatureKey, runLigatureFeatures } from './run-ligatures.ts';
// Shared HarfBuzz call used by shaped measurement and non-DOM exporters.

import type { ResolvedFont } from './font-resource.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import {
  createShapingEnvironment,
  type ShapedRun,
  type ShapingEnvironment,
  type ShapingEnvironmentInput,
  type TextShaper,
} from './shaped-run.ts';

/** Fingerprinted, operation-wide portion of every shaping call. @public */
export type LayoutShapingEnvironment = Omit<
  ShapingEnvironmentInput,
  'font' | 'direction' | 'fallbackOrder'
> & {
  /** Host can apply document optional ligatures consistently to measurement and glyph output. */
  readonly documentLigatures?: boolean;
};

/**
 * The alphabet a face is asked the `smcp` question with, once per face.
 *
 * The question has to be about the FACE and never about the text being measured. Every caret
 * edge on a line is `measureDisplayText(span.text.slice(0, offset), …)` through this same
 * entry point, so a span and each of its prefixes must resolve to the same measurement
 * source. A per-text answer cannot do that: a prefix holds a subset of the span's characters,
 * so a span that misses coverage while its prefix has it takes the fallback while the prefix
 * takes the shaped path, and the caret lands wherever the two disagree.
 */
const SMALL_CAPS_PROBE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Half-points, which is the unit the shaper takes and OOXML stores.
 *
 * The BASE size, never the super/subscript size: the shaper asserts an integer, and rounding
 * `11pt × 0.75 × 2 = 16.5` up to 17 half-points measured superscript 3% wider than paint
 * draws it — every span after one on the line sat left of its glyphs, and the caret landed
 * mid-glyph. Advances are unhinted and scale linearly, so callers shape at the base size and
 * multiply by the drawn-size factor, which is exactly the factor paint applies.
 */
export function layoutRunHalfPointsOf(style: ResolvedRunStyle): number {
  const halfPoints = Math.round(style.fontSizePt * 2);
  // A zero-sized run would shape to nothing and make a line of no height; the smallest size
  // Word records is half a point.
  return Math.max(1, halfPoints);
}

/**
 * Shape one run with the same environment measurement uses.
 *
 * @internal
 */
export function shapeLayoutStyleRun(
  shaper: TextShaper,
  environment: LayoutShapingEnvironment,
  font: ResolvedFont,
  style: ResolvedRunStyle,
  text: string
): ShapedRun {
  const context = style.shaping?.context;
  return shaper.shape({
    text,
    fontSizeHalfPoints: layoutRunHalfPointsOf(style),
    bidiLevel: style.shaping?.direction === 'rtl' ? 1 : 0,
    environment: runShapingEnvironment(environment, font, style),
    ...(context ? { context } : {}),
  });
}

/**
 * Environments per (operation environment, face, run-level shaping inputs).
 *
 * Every span of a document shapes in one of a handful of environments, and building one
 * validates, sorts and freezes every record. Only a frozen operation environment is keyed: a
 * caller's mutable object could change under the cache.
 */
const runEnvironments = new WeakMap<
  LayoutShapingEnvironment,
  WeakMap<ResolvedFont, Map<string, ShapingEnvironment>>
>();

function runShapingEnvironment(
  environment: LayoutShapingEnvironment,
  font: ResolvedFont,
  style: ResolvedRunStyle
): ShapingEnvironment {
  if (
    !Object.isFrozen(environment) ||
    !Object.isFrozen(environment.features) ||
    !Object.isFrozen(environment.variationAxes) ||
    !Object.isFrozen(environment.shapingLibrary)
  )
    return buildRunShapingEnvironment(environment, font, style);
  const direction = style.shaping?.direction ?? 'ltr';
  const script = style.shaping?.script;
  const key = `${direction}|${script ?? ''}|${isRunKerningEnabled(style) ? 1 : 0}|${
    environment.documentLigatures ? runLigatureFeatureKey(style) : ''
  }|${style.smallCaps ? 1 : 0}`;
  let byFont = runEnvironments.get(environment);
  if (!byFont) runEnvironments.set(environment, (byFont = new WeakMap()));
  let byKey = byFont.get(font);
  if (!byKey) byFont.set(font, (byKey = new Map()));
  let cached = byKey.get(key);
  if (!cached) byKey.set(key, (cached = buildRunShapingEnvironment(environment, font, style)));
  return cached;
}

function buildRunShapingEnvironment(
  environment: LayoutShapingEnvironment,
  font: ResolvedFont,
  style: ResolvedRunStyle
): ShapingEnvironment {
  return createShapingEnvironment({
    ...environment,
    font,
    direction: style.shaping?.direction ?? 'ltr',
    script:
      style.shaping?.script === 'Zyyy'
        ? environment.script
        : (style.shaping?.script ?? environment.script),
    // `w:smallCaps` selects the font's small-cap glyphs. Paint uses the matching CSS
    // feature, so shaping must reserve those glyph advances instead of lowercase advances.
    features: {
      ...environment.features,
      kern: isRunKerningEnabled(style) ? 1 : 0,
      ...(environment.documentLigatures ? runLigatureFeatures(style) : {}),
      ...(style.smallCaps ? { smcp: 1 } : {}),
    },
    fallbackOrder: [],
  } satisfies ShapingEnvironmentInput);
}

/**
 * Does this FACE carry small-cap glyphs? Asked once per face, never per text.
 *
 * All of the probe alphabet or none: a face that substitutes only part of it would shape some
 * characters as small caps and leave the rest as lowercase, while paint asks the browser to
 * synthesize the ones the face cannot draw. That is the fallback's job, and taking it for the
 * whole face keeps every measurement of one span on one side of the decision. Glyph ids do not
 * depend on point size, so the first caller's size may settle it.
 *
 * The probe is LATIN lowercase, so a face carrying `smcp` for Latin alone answers yes and a
 * mixed-script small-caps run shapes its Greek or Cyrillic lowercase at plain advances while
 * paint synthesizes small caps for them. A span and its prefixes still come from one source,
 * which is what the caret needs; the absolute width of that span is still a fraction out.
 * Widening the probe to every script a face might cover is the fix for the width, and it is
 * not this one.
 *
 * @internal
 */
export function layoutFaceHasSmallCaps(
  shaper: TextShaper,
  environment: LayoutShapingEnvironment,
  font: ResolvedFont,
  style: ResolvedRunStyle,
  cache: WeakMap<ResolvedFont, boolean>
): boolean {
  const cached = cache.get(font);
  if (cached !== undefined) return cached;
  let supported = true;
  try {
    for (const character of SMALL_CAPS_PROBE_ALPHABET) {
      const featured = shapeLayoutStyleRun(
        shaper,
        environment,
        font,
        { ...style, smallCaps: true },
        character
      );
      const plain = shapeLayoutStyleRun(
        shaper,
        environment,
        font,
        { ...style, smallCaps: false },
        character
      );
      const substituted =
        featured.glyphs.length !== plain.glyphs.length ||
        featured.glyphs.some((glyph, index) => glyph.id !== plain.glyphs[index]?.id);
      if (!substituted) {
        // A face with no `smcp` at all answers on the first letter, the common case.
        supported = false;
        break;
      }
    }
  } catch {
    // A face whose shaping refuses the probe cannot answer yes, and the answer is CACHED:
    // hit-testing measures once per caret prefix, and re-throwing 52 times per prefix
    // turned one hostile face into the cost of the whole line.
    supported = false;
  }
  cache.set(font, supported);
  return supported;
}
