import type { ResolvedRunStyle } from './run-style.ts';

// Enumerable symbols survive shaping copies without adding public style fields.
const authoredSpacing = Symbol('authored-layout-character-spacing');
type DerivedStyle = ResolvedRunStyle & { readonly [authoredSpacing]?: number };

/** Keep the first authored spacing when layout adjusts measured glyph advances. */
export function withLayoutDerivedSpacing(
  style: ResolvedRunStyle,
  spacingPt: number
): ResolvedRunStyle {
  if (!Number.isFinite(spacingPt)) throw new RangeError('Layout spacing must be finite');
  const source = (style as DerivedStyle)[authoredSpacing] ?? style.characterSpacingPt;
  return { ...style, characterSpacingPt: spacingPt, [authoredSpacing]: source } as DerivedStyle;
}

/** Editing commands must not copy a line-fitting adjustment into document properties. */
export function layoutDerivedSpacingStyleForEditing(style: ResolvedRunStyle): ResolvedRunStyle {
  const source = (style as DerivedStyle)[authoredSpacing];
  if (source === undefined) return style;
  const result = { ...style, characterSpacingPt: source } as DerivedStyle;
  delete (result as { [authoredSpacing]?: number })[authoredSpacing];
  return result;
}

/** Equal visual spacing must not merge runs with different authored spacing. */
export function layoutDerivedSpacingSourcesEqual(
  a: ResolvedRunStyle,
  b: ResolvedRunStyle
): boolean {
  const left = (a as DerivedStyle)[authoredSpacing] ?? a.characterSpacingPt;
  const right = (b as DerivedStyle)[authoredSpacing] ?? b.characterSpacingPt;
  return left === right;
}
