// Layout-owned compound border metrics shared by paragraph `w:pBdr` and table borders.
//
// WordprocessingML double borders specify each stroke in eighths of a point.
// The gap has the same width; the complete band therefore spans three strokes.
// Paint only scales these points — it must not reinterpret the authored width.

/** Minimum stroke width for a compound (double/triple) band, in points. */
export const COMPOUND_BORDER_MIN_STROKE_PT = 0.25;
/** Minimum gap between compound strokes, in points. */
export const COMPOUND_BORDER_MIN_GAP_PT = 0.25;

/**
 * How a multi-line border style (double, triple) is drawn: stroke width, gap, and total extent.
 *
 * Table stroke coordinates centre the painted band on the authored edge box.
 * Content insets must also account for the portion that extends inward.
 */
export interface CompoundBorderMetrics {
  readonly strokePt: number;
  readonly gapPt: number;
  readonly extentPt: number;
  /** Centers the compound band on the authored width; negative extends outward. */
  readonly insetPt: number;
}

/**
 * Double strokes use the authored width, with a quarter-point minimum.
 * The complete band is centred on the authored edge box. Device pixel rounding
 * belongs to rendering; these layout metrics remain in continuous points.
 */
export function computeDoubleBorderMetricsPt(widthPt: number): CompoundBorderMetrics {
  const strokePt = Math.max(widthPt, COMPOUND_BORDER_MIN_STROKE_PT);
  const gapPt = Math.max(widthPt, COMPOUND_BORDER_MIN_GAP_PT);
  const extentPt = strokePt * 2 + gapPt;
  return { strokePt, gapPt, extentPt, insetPt: (widthPt - extentPt) / 2 };
}

/**
 * OOXML `ST_Border` values whose painted band is wider than a single `w:sz` hairline.
 *
 * Decorative art borders are out of scope — callers treat them as a solid single.
 */
const COMPOUND_BORDER_VALS = new Set([
  'double',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'doubleWave',
]);

/** True when `ST_Border` paints as more than one parallel stroke. */
export function isCompoundBorderVal(val: string): boolean {
  return COMPOUND_BORDER_VALS.has(val);
}

/** A thin stroke or gap of the thin-thick styles, in points, whatever the authored width. */
const FIXED_THIN_PT = 0.75;
/** The thick stroke of the large-gap styles, in points. */
const FIXED_THICK_PT = 1.5;

/**
 * Each stroke and gap of a thin-thick or triple style, top to bottom (or left to right) in
 * page space on every edge, as a linear term `a × w + b` of the authored width `w`. Strokes
 * sit at even indices, gaps at odd ones.
 */
const COMPOUND_SEQUENCES: ReadonlyMap<string, readonly (readonly [number, number])[]> = (() => {
  const w = [1, 0] as const;
  const half = [0.5, 0] as const;
  const thin = [0, FIXED_THIN_PT] as const;
  const thick = [0, FIXED_THICK_PT] as const;
  return new Map<string, readonly (readonly [number, number])[]>([
    ['triple', [w, w, w, w, w]],
    ['thinThickSmallGap', [w, thin, thin]],
    ['thickThinSmallGap', [thin, thin, w]],
    ['thinThickMediumGap', [w, half, half]],
    ['thickThinMediumGap', [half, half, w]],
    ['thinThickLargeGap', [thick, w, thin]],
    ['thickThinLargeGap', [thin, w, thick]],
    ['thinThickThinSmallGap', [thin, thin, w, thin, thin]],
    ['thinThickThinMediumGap', [half, half, w, half, half]],
    ['thinThickThinLargeGap', [thin, w, thick, w, thin]],
  ]);
})();

/** One stroke of a compound border: offset from the band's top or left edge, and width. @internal */
export interface CompoundBorderStroke {
  /** Distance from the band's top (or left) edge to this stroke, in points. */
  readonly offsetPt: number;
  /** Thickness of this stroke, in points. */
  readonly widthPt: number;
}

/**
 * The strokes of a triple or thin-thick border with authored width `widthPt`, or null for
 * any other style. The band is the sum of every stroke and gap.
 */
export function compoundBorderStrokesPt(
  val: string,
  widthPt: number
): readonly CompoundBorderStroke[] | null {
  const sequence = COMPOUND_SEQUENCES.get(val);
  if (!sequence) return null;
  const strokes: CompoundBorderStroke[] = [];
  let offset = 0;
  sequence.forEach(([a, b], index) => {
    const size = Math.max(a * widthPt + b, COMPOUND_BORDER_MIN_STROKE_PT);
    if (index % 2 === 0) strokes.push({ offsetPt: offset, widthPt: size });
    offset += size;
  });
  return strokes;
}

/**
 * The strokes of a triple or thin-thick border whose painted band is `extentPt` thick, for a
 * painter that holds the band and not the authored width. Null for any other style.
 *
 * @internal
 */
export function compoundBorderStrokesForExtentPt(
  val: string,
  extentPt: number
): readonly CompoundBorderStroke[] | null {
  const sequence = COMPOUND_SEQUENCES.get(val);
  if (!sequence) return null;
  const a = sequence.reduce((sum, [slope]) => sum + slope, 0);
  const b = sequence.reduce((sum, [, fixed]) => sum + fixed, 0);
  return compoundBorderStrokesPt(val, Math.max(0, (extentPt - b) / a));
}

/** The painted band of `dashDotStroked`, in points, whatever the authored width. */
export const DASH_DOT_STROKED_BAND_PT = 3;

/** True for the two three-dimensional line styles (ECMA-376 §17.18.2). */
export function isThreeDBorderVal(val: string): boolean {
  return val === 'threeDEmboss' || val === 'threeDEngrave';
}

/**
 * Each outer stroke of a three-dimensional border, in points: 0.75pt, or 1.5pt from an
 * authored width of 3pt. The authored width is the middle stroke.
 */
export function threeDBorderOuterPt(widthPt: number): number {
  return widthPt >= 3 ? 1.5 : 0.75;
}

/**
 * Visual thickness of one border edge in points — the stroke box height/width layout
 * publishes. Double borders include both strokes and their gap; triple and thin-thick styles
 * span their own strokes and gaps; a three-dimensional style adds its two outer strokes;
 * `dashDotStroked` has a fixed band; everything else uses `w:sz`.
 */
export function borderStrokeWidthPt(val: string, widthPt: number): number {
  const strokes = compoundBorderStrokesPt(val, widthPt);
  if (strokes) {
    const last = strokes[strokes.length - 1]!;
    return last.offsetPt + last.widthPt;
  }
  if (isCompoundBorderVal(val)) return computeDoubleBorderMetricsPt(widthPt).extentPt;
  if (isThreeDBorderVal(val)) return widthPt + 2 * threeDBorderOuterPt(widthPt);
  if (val === 'dashDotStroked') return DASH_DOT_STROKED_BAND_PT;
  return widthPt;
}

/**
 * Every `ST_Border` value that is a LINE (ECMA-376 §17.18.2), `nil` / `none` excluded.
 *
 * The rest of the enumeration — `apples`, `cabins`, `iceCreamCones`, another ninety of them —
 * are ART borders: repeated bitmap tiles, not strokes. They carry a `w:sz` and a `w:color`
 * like any other edge, so nothing about the attributes says which kind an edge is, and a
 * reader that only checks for `none` paints a row of apples as a plain black rule.
 *
 * Page borders are where this bites: art borders are legal ONLY on `w:pgBorders`, and a
 * decorative frame silently degraded to a box is a worse answer than no frame at all.
 * Paragraph and table borders keep their existing fall-through-to-solid behaviour, which for
 * them is unreachable by the schema anyway.
 */
const LINE_BORDER_VALS = new Set([
  'single',
  'thick',
  'double',
  'dotted',
  'dashed',
  'dotDash',
  'dotDotDash',
  'triple',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
  'wave',
  'doubleWave',
  'dashSmallGap',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'outset',
  'inset',
]);

/** True when `ST_Border` names a line style rather than a decorative art border. */
export function isLineBorderVal(val: string): boolean {
  return LINE_BORDER_VALS.has(val);
}
