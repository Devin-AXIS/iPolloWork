// Shared rule placement for separator atoms within authored note stories.
import type { LayoutBox, LineRecord, StyleSpanRecord } from './semantic-records.ts';
import { baselineShiftPtOf } from './run-style.ts';
import type { StrikeoutStrokePt } from './sfnt-strikeout-metrics.ts';

/** Fallback stroke when no face answers: Calibri's own `OS/2` numbers over its em. */
const FALLBACK_OFFSET_EM = 0.25;
const FALLBACK_THICKNESS_PT = 0.5;

/**
 * Story-relative rule box for a measured separator span.
 *
 * Word paints `w:separator` as a strikeout stroke, so `stroke` carries the face's `OS/2`
 * `yStrikeoutPosition` and `yStrikeoutSize` at the run's size. Without a resolved face the
 * box keeps the legacy quarter-em offset and hairline thickness.
 * @public
 */
export function noteSeparatorRuleBox(
  span: StyleSpanRecord,
  line: LineRecord,
  stroke?: StrikeoutStrokePt
): LayoutBox {
  const offsetPt = stroke ? stroke.offsetPt : span.style.fontSizePt * FALLBACK_OFFSET_EM;
  const thicknessPt = stroke ? stroke.thicknessPt : FALLBACK_THICKNESS_PT;
  return {
    x: span.box.x,
    y: Math.max(line.box.y, line.box.y + line.baseline - baselineShiftPtOf(span.style) - offsetPt),
    width: span.box.width,
    height: thicknessPt,
  };
}
