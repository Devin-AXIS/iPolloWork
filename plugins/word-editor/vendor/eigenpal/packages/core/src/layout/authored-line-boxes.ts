import { layoutRunHalfPointsOf } from './layout-run-shape.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';

// The single-spaced line box of an authored family that hosts rarely have.
//
// With no face of its own, a run measures its line on whatever face the fallback picks, and
// that face's ascent and descent move every line and every page break. The authored face's
// box is a property of the family, so it is recorded here and kept whatever face draws the
// glyphs, the way a packaged plan's `lineMetrics` keeps it for its substitute. Widths are not
// recorded: they need the face, and a face that is not metric-compatible would trade one
// error for another. Values are `hhea` ascent, descent and line gap in 2048ths of an em, the
// same for every style of the family. Numbers only; no font data.
const LINE_BOXES: ReadonlyMap<string, { readonly family: string; readonly em: LineBoxEm }> =
  new Map([
    ['garamond', { family: 'Garamond', em: lineBoxEm(1765, 539, 0) }],
    ['segoe ui', { family: 'Segoe UI', em: lineBoxEm(2210, 514, 0) }],
  ]);

/** A line box as em ratios, the shape of a font substitution's `lineMetrics`. */
export interface LineBoxEm {
  readonly heightEm: number;
  readonly baselineEm: number;
}

function lineBoxEm(ascent: number, descent: number, gap: number): LineBoxEm {
  return { heightEm: (ascent + descent + gap) / 2048, baselineEm: (ascent + gap) / 2048 };
}

/** The recorded family `family` names, with its box, or undefined when none is recorded. */
export function recordedLineBoxFamily(
  family: string | null | undefined
): { readonly family: string; readonly em: LineBoxEm } | undefined {
  return family ? LINE_BOXES.get(family.trim().toLowerCase()) : undefined;
}

/**
 * The authored family's line box at the run's size, or undefined when the family is not
 * recorded. Only for a run whose family resolved to no face: a face the host supplied for
 * the family carries its own box.
 */
export function authoredLineBox(
  style: ResolvedRunStyle
): { readonly height: number; readonly baseline: number } | undefined {
  const recorded = recordedLineBoxFamily(style.fontFamily);
  if (!recorded) return undefined;
  const sizePt = (layoutRunHalfPointsOf(style) / 2) * glyphSizeFactorOf(style);
  return { height: recorded.em.heightEm * sizePt, baseline: recorded.em.baselineEm * sizePt };
}
