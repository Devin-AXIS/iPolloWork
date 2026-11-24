// The rule bands of a spaced table's frame, and the parts of its insets its columns hold.
import { borderExtentPt, type TableBorderBox, type TableBorderSide } from './table-borders.ts';
import { computeDoubleBorderMetricsPt } from './border-metrics.ts';

/**
 * The width of the band a rule draws against its edge. A double rule draws its whole band
 * there, not the half a shared, centred rule takes from each side (`borderExtentPt`).
 */
export function outerBandPt(edge: TableBorderSide | undefined): number {
  if (edge?.state === 'edge' && edge.style === 'double')
    return computeDoubleBorderMetricsPt(edge.widthPt).extentPt;
  return borderExtentPt(edge);
}

/**
 * The parts of a spaced table's frame insets that its outer columns hold: the first column
 * holds its left rule band less the inside rule, the last its right rule band less the inside
 * rule. The rest of the insets, half the left band less half the right one, lies outside the
 * columns, so a table with a stated width ends that much further right.
 *
 * Measured in modes 0 and 15 with spacing of 2, 5 and 15pt, outer rules of 0 to 6pt on either
 * side and inside rules of 0 to 6pt. A row that skips the first or last grid columns
 * (`w:gridBefore`, `w:gridAfter`) moves its own outer cell in by that part too.
 */
export interface SpacingFrameParts {
  /** What the first column holds. */
  readonly leadPt: number;
  /** What the last column holds. */
  readonly trailPt: number;
  /** What lies outside the columns: half the left rule band less half the right one. */
  readonly outsidePt: number;
  /** The right rule's band, which draws outward from the table's box. */
  readonly rightBandPt: number;
}

/** The frame insets and rules `spacingFrameParts` reads. */
export interface SpacingFrameInsets {
  readonly leftPt: number;
  readonly rightPt: number;
  readonly borders: Pick<TableBorderBox, 'left' | 'right'>;
  /** A row's own `w:tblPrEx` side borders, already added to its insets. */
  readonly rowBorders?: Pick<TableBorderBox, 'left' | 'right'>;
}

/**
 * The frame parts a spaced table's outer columns hold (`SpacingFrameParts`), from the table's
 * own frame: a row's `w:tblPrEx` side borders move only that row's cells and are left out.
 * The parts follow the insets as placed, so an inset that `withSpacingFrame` clamps at the
 * edge gap (an inside rule far thicker than the spacing) clamps them too; that is unmeasured.
 */
export function spacingFrameParts(
  frame: SpacingFrameInsets | undefined
): SpacingFrameParts | undefined {
  if (!frame) return undefined;
  const rowLeftPt = frame.rowBorders ? outerBandPt(frame.rowBorders.left) : 0;
  const rowRightPt = frame.rowBorders ? outerBandPt(frame.rowBorders.right) : 0;
  const leftPt = frame.leftPt - rowLeftPt;
  const rightPt = frame.rightPt - rowRightPt;
  const rightBandPt = outerBandPt(frame.borders.right);
  const leadPt = leftPt - outerBandPt(frame.borders.left) / 2;
  const trailPt = rightPt + rightBandPt / 2;
  return { leadPt, trailPt, outsidePt: leftPt + rightPt - leadPt - trailPt, rightBandPt };
}
