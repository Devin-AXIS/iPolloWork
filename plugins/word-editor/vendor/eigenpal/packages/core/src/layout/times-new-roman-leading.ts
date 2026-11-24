/** Times New Roman's ascent, descent and legacy external leading, in units of its 2048 em. */
const ASCENT_EM = 1825 / 2048;
const DESCENT_EM = 443 / 2048;
const LEGACY_LINE_GAP_EM = 87 / 2048;
const TOLERANCE_EM = 1 / 2048;
const COMPLEX_SCRIPTS: ReadonlySet<string> = new Set(['Arab', 'Hebr', 'Syrc', 'Thaa', 'Nkoo']);

/**
 * Whether a run's line can take the legacy gap. Measured only for Latin text: Hebrew drawn in the
 * same version 7 face, in a complex-script run, steps by the face's own bytes (no gap).
 */
export function takesLegacyLineGap(style: {
  readonly latinLane?: unknown;
  readonly shaping?: { readonly script?: string };
}): boolean {
  return style.latinLane === undefined && !COMPLEX_SCRIPTS.has(style.shaping?.script ?? '');
}

/**
 * The external leading a face's single line takes, in points.
 *
 * Every face takes its own `hhea.lineGap`, except one: the Times New Roman that current Office
 * installs (version 7) declares a gap of 0, and the reference application still spaces it by
 * the 87 units of the earlier face. Measured with that face's own bytes: 20 single-spaced 12pt
 * lines step 13.7937pt, which is (1825 + 443 + 87) / 2048 em. Rockwell, Calibri, Verdana and
 * Arial step by their own bytes, gap or no gap, so this is that family's value, not a formula.
 * The face is recognised by its name and its own ascent and descent, never by the name alone.
 */
export function faceLineGapPt(
  family: string,
  ascentPt: number,
  descentPt: number,
  lineGapPt: number,
  sizePt: number,
  legacyGap = true
): number {
  if (!legacyGap || lineGapPt !== 0 || !(sizePt > 0)) return lineGapPt;
  if (family.trim().toLowerCase() !== 'times new roman') return lineGapPt;
  const fits = (value: number, expected: number) =>
    Math.abs(value / sizePt - expected) <= TOLERANCE_EM;
  return fits(ascentPt, ASCENT_EM) && fits(descentPt, DESCENT_EM)
    ? LEGACY_LINE_GAP_EM * sizePt
    : lineGapPt;
}
