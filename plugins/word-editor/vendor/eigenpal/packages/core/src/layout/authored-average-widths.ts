import type { ResolvedRunStyle } from './run-style.ts';

// The reverse automatic-spacing gap is half the authored Latin face's OS/2 average width.
// Hosts usually lay these families out on a metric-compatible substitute, and a substitute
// keeps glyph advances, not this average, so the authored value is recorded here. Units are
// 2048ths of an em for [regular, bold, italic, bold italic]. Numbers only; no font data.
const AVERAGE_WIDTHS: ReadonlyMap<string, readonly [number, number, number, number]> = new Map([
  ['aptos', [1148, 1202, 1150, 1204]],
  ['arial', [904, 980, 904, 980]],
  ['calibri', [1067, 1098, 1067, 1099]],
  // Calibri Light has no bold face and Century no bold or italic face; a synthesized style keeps
  // the regular face width.
  ['calibri light', [1065, 1065, 1067, 1067]],
  ['cambria', [1260, 1228, 1111, 1198]],
  ['century', [951, 951, 951, 951]],
  ['century gothic', [995, 994, 995, 994]],
  ['courier new', [1229, 1229, 1229, 1229]],
  ['times new roman', [821, 874, 823, 844]],
]);

/** Whether a run's own advances can carry a derived reverse gap at all. */
export function reverseGapStyleEligible(style: ResolvedRunStyle): boolean {
  return (
    !!style &&
    Number.isFinite(style.fontSizePt) &&
    style.fontSizePt > 0 &&
    (style.characterSpacingPt ?? 0) === 0 &&
    style.shaping?.direction !== 'rtl' &&
    (!style.verticalAlign || style.verticalAlign === 'baseline') &&
    (style.horizontalScalePercent === undefined || style.horizontalScalePercent === 100)
  );
}

/** The reverse gap from the recorded average width of the authored family, if known. */
export function knownFamilyReverseGap(style: ResolvedRunStyle): number | undefined {
  if (!reverseGapStyleEligible(style)) return;
  const widths = AVERAGE_WIDTHS.get(style.fontFamily?.trim().toLowerCase() ?? '');
  if (!widths) return;
  const average = widths[(style.bold ? 1 : 0) + (style.italic ? 2 : 0)]!;
  return (style.fontSizePt * average) / 2048 / 2;
}
