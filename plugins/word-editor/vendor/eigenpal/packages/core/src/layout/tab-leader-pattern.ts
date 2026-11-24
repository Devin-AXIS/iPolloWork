/** Maximum furniture glyphs per leader; independent of authored tab width. */
export const MAX_TAB_LEADER_GLYPHS = 8192;

/**
 * Fit complete leader advances to one shared horizontal grid.
 *
 * `startPt` is measured from the paper's left edge, or the local textbox frame.
 * Offsets remain relative to the supplied gap. No glyph is clipped at either end,
 * and lines in the same face share their dot columns regardless of preceding text.
 * @public
 */
export function tabLeaderPattern(
  startPt: number,
  widthPt: number,
  advancePt: number
): { readonly offsetPt: number; readonly count: number } {
  if (![startPt, widthPt, advancePt].every(Number.isFinite) || widthPt <= 0 || advancePt <= 0)
    return { offsetPt: 0, count: 0 };
  const first = Math.ceil(startPt / advancePt - 1e-9) * advancePt;
  if (!Number.isFinite(first)) return { offsetPt: 0, count: 0 };
  const offsetPt = Math.max(0, first - startPt);
  return {
    offsetPt,
    count: Math.min(
      MAX_TAB_LEADER_GLYPHS,
      Math.max(0, Math.floor((widthPt - offsetPt) / advancePt + 1e-9))
    ),
  };
}
