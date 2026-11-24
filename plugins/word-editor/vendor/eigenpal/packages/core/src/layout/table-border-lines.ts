// Table edges whose `ST_Border` line style (ECMA-376 §17.18.2) is more than one solid band.
//
// A table edge in one of these styles takes the geometry of a single rule as wide as its
// painted band: the band sits where a single rule of that width would, and the cell content
// clears it the same way. Reference renders of `w:tcBorders` (§17.4.66) and `w:tblBorders`
// (§17.4.38) in every compatibility mode place each band so. Layout then splits the band
// into the strokes of its style; paint only draws them.

import {
  borderDashPatternPt,
  borderLineStrokesPt,
  DASH_DOT_STROKED_BAND_PT,
} from './border-line-styles.ts';
import type { TableBorderStrokeRecord } from './table-borders.ts';

/**
 * An authored line style a table edge draws beyond its border category: a dash pattern, the
 * `dashDotStroked` hatch, a three-dimensional band or a thin-thick compound band.
 */
export type TableBorderLine =
  | 'dotDash'
  | 'dotDotDash'
  | 'dashSmallGap'
  | 'dashDotStroked'
  | 'threeDEmboss'
  | 'threeDEngrave'
  | 'thinThickSmallGap'
  | 'thickThinSmallGap'
  | 'thinThickThinSmallGap'
  | 'thinThickMediumGap'
  | 'thickThinMediumGap'
  | 'thinThickThinMediumGap'
  | 'thinThickLargeGap'
  | 'thickThinLargeGap'
  | 'thinThickThinLargeGap';

/** The line styles a table edge paints as a pattern or as parallel strokes. */
const TABLE_BORDER_LINES: readonly TableBorderLine[] = [
  'dotDash',
  'dotDotDash',
  'dashSmallGap',
  'dashDotStroked',
  'threeDEmboss',
  'threeDEngrave',
  'thinThickSmallGap',
  'thickThinSmallGap',
  'thinThickThinSmallGap',
  'thinThickMediumGap',
  'thickThinMediumGap',
  'thinThickThinMediumGap',
  'thinThickLargeGap',
  'thickThinLargeGap',
  'thinThickThinLargeGap',
];

const LINES: ReadonlySet<string> = new Set(TABLE_BORDER_LINES);

/** The line style of `val` when a table edge must remember it, else `undefined`. */
export function tableBorderLine(val: string): TableBorderLine | undefined {
  return LINES.has(val) ? (val as TableBorderLine) : undefined;
}

/** The edge fields the stroke split reads. */
interface LineEdge {
  readonly style: string;
  readonly color: string | null;
  readonly widthPt: number;
  readonly line?: TableBorderLine;
  readonly sizePt?: number;
}

/**
 * Split the band `stroke` of `edge` into the strokes its line style paints.
 *
 * A compound or three-dimensional band becomes parallel solid strokes, ordered top to bottom
 * or left to right in page space on every side. A dash-family band keeps its rectangle and
 * gains its dash lengths; a `dashDotStroked` band is marked as a hatch. Any other band is
 * returned as it is.
 */
export function splitTableBorderBand(
  stroke: TableBorderStrokeRecord,
  edge: LineEdge
): readonly TableBorderStrokeRecord[] {
  const val = edge.line ?? edge.style;
  const sizePt = edge.sizePt ?? edge.widthPt;
  if (val === 'dashDotStroked') {
    const horizontal = stroke.side === 'top' || stroke.side === 'bottom';
    const across = horizontal ? stroke.height : stroke.width;
    // A narrower published band (a clipped corner) keeps its own size.
    const band = Math.min(across, DASH_DOT_STROKED_BAND_PT);
    return [
      {
        ...stroke,
        cssStyle: 'dashed',
        hatch: true,
        ...(horizontal ? { height: band } : { width: band }),
      },
    ];
  }
  const dashPt = borderDashPatternPt(val, sizePt);
  if (dashPt) return [{ ...stroke, dashPt }];
  const strokes = borderLineStrokesPt(val, sizePt, edge.color);
  if (!strokes) return [stroke];
  const horizontal = stroke.side === 'top' || stroke.side === 'bottom';
  const roles: readonly TableBorderStrokeRecord['role'][] =
    strokes.length === 2
      ? ['outer', 'inner']
      : strokes.length === 3
        ? ['outer', 'middle', 'inner']
        : strokes.map((_, index) =>
            index === 0 ? 'outer' : index === strokes.length - 1 ? 'inner' : 'middle'
          );
  return strokes.map((part, index) => ({
    ...stroke,
    role: roles[index]!,
    color: part.color,
    cssStyle: 'solid' as const,
    ...(horizontal
      ? { y: stroke.y + part.offsetPt, height: part.widthPt }
      : { x: stroke.x + part.offsetPt, width: part.widthPt }),
  }));
}

/**
 * Replace the bands `strokes` holds from index `from` on with their split strokes, within
 * the `limit` on published strokes.
 */
export function splitPublishedTableBands(
  strokes: TableBorderStrokeRecord[],
  from: number,
  edge: LineEdge,
  limit: number
): void {
  if (!edge.line && edge.style !== 'dotted' && edge.style !== 'dashed') return;
  const split = strokes.splice(from).flatMap((stroke) => splitTableBorderBand(stroke, edge));
  for (const stroke of split) {
    if (strokes.length >= limit) return;
    strokes.push(stroke);
  }
}
