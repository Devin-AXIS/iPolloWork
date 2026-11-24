// Cell-box geometry shared by row layout and fragment finalize: where a cell's content box
// sits inside its border box on each page fragment.

import { borderExtentPt, type CellBorderBox, type TableBorderSide } from './table-borders.ts';
import { effectiveBorderSide } from './table-border-cascade.ts';
import type { CellMarginsPt, SemanticTableCell } from './semantic-table.ts';

/** Per-side content inset, including the applicable border clearance. */
export interface CellContentInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export function borderContentInset(
  margin: number,
  edge: CellBorderBox['top'],
  shared = false,
  collapsedHorizontal = false,
  receivingSharedTop = false
): number {
  if (edge.state !== 'edge') return margin;
  // Simple collapsed horizontal strokes extend halfway into each incident cell.
  // Compound strokes can extend beyond the authored edge box into existing padding.
  // Increase the inset only when that padding cannot clear the painted inner stroke.
  // Word converts eighth-point border sizes to integral twips before reserving space.
  // Odd eighths otherwise accumulate half a twip per row across a long table.
  const widthPt = Math.floor(edge.widthPt * 20 + 1e-8) / 20;
  const centered = shared && edge.style !== 'double' && edge.style !== 'triple';
  // Horizontal padding starts at the middle of a collapsed simple side rule.
  // With little/no padding, content must still clear its full painted extent.
  const halfInset =
    shared || (collapsedHorizontal && (edge.style === 'single' || edge.style === 'thick'));
  // An internal double rule is painted by the preceding cell's bottom edge.
  // Its inner stroke extends one authored width below that edge; reserving the
  // top-owned band's two widths charges the following row an extra stroke.
  const extent =
    shared && receivingSharedTop && edge.style === 'double'
      ? borderExtentPt(edge) - edge.widthPt
      : borderExtentPt(edge);
  return Math.max(margin + widthPt * (halfInset ? 0.5 : 1), extent * (centered ? 0.5 : 1));
}

/** True for a rule whose clearance the captured row-band rule covers. */
function simpleBand(edge: CellBorderBox['top']): boolean {
  return edge.state !== 'edge' || (edge.style !== 'double' && edge.style !== 'triple');
}

/**
 * Authored width of a simple collapsed horizontal rule, in points, else `0`.
 *
 * Compound rules answer to their own extent geometry, so they report `0` and leave the band
 * to {@link borderContentInset}. Word converts eighth-point sizes to whole twips before it
 * reserves space, so the same floor applies here or a long table accumulates half a twip
 * per row.
 */
export function simpleBandWidthPt(
  edge: CellBorderBox['top'] | { readonly style: string; readonly widthPt: number } | undefined
): number {
  if (!edge) return 0;
  if ('state' in edge && edge.state !== 'edge') return 0;
  const { style, widthPt } = edge as { style: string; widthPt: number };
  if (style === 'double' || style === 'triple') return 0;
  return Math.floor(widthPt * 20 + 1e-8) / 20;
}

/**
 * The content insets of one cell, including its authored-row band clearance.
 *
 * Prefer this over {@link contentInsets} wherever a `SemanticTableCell` is in hand: it keeps
 * the span-scoped content borders and the row-scoped band clearance together, which a cell
 * that continues a vertical merge carries separately.
 */
export function cellContentInsets(
  cell: SemanticTableCell,
  collapsedBorders: boolean
): CellContentInsets {
  return contentInsets(
    cell.margins,
    cell.contentBorders ?? cell.borders,
    cell.legacyContentAlignment === true && collapsedBorders,
    collapsedBorders,
    cell.contentBottomIsOuter,
    cell.centeredSideRules,
    cell.topBandClearancePt
  );
}

/**
 * Clearance a receiving cell reserves for the collapsed horizontal band above it, in points.
 *
 * The receiving row reserves the band and the row above reserves nothing. Inside one table
 * fragment the reserve is the band's full painted width, the conflict winner, whichever side
 * authored it: a narrower authored top under a wider bottom reserves the wider rule, and a
 * `w:val="nil"` on either side does not suppress a rule the other side still paints.
 *
 * Below a repeated header, `repeatBoundaryBandPt` passes the header row's bottom rule as
 * `bandPt` before mode 15, and the row keeps this authored band from mode 15.
 *
 * `bandPt` is the resolved band's painted width and `tableSide` what an inherited edge falls
 * back to. A vMerge seam paints nothing yet still reserves its inherited rule, which is why
 * the result takes the larger of the two.
 */
export function ownTopBandWidthPt(
  own: TableBorderSide,
  tableSide: TableBorderSide,
  bandPt = 0
): number {
  return Math.max(simpleBandWidthPt(effectiveBorderSide(own, tableSide)), bandPt);
}

export function contentInsets(
  margins: CellMarginsPt,
  borders: SemanticTableCell['borders'],
  legacyCollapsedContentAlignment = false,
  collapsedBorders = true,
  bottomIsOuter = false,
  centeredSideRules = false,
  topBandClearancePt?: number
): CellContentInsets {
  const leftExtent = borderExtentPt(borders.left);
  const rightExtent = borderExtentPt(borders.right);
  const simpleRules = [borders.left, borders.right].every(
    (edge) => edge.state !== 'edge' || edge.style === 'single' || edge.style === 'thick'
  );
  // The admitted legacy table centres its simple side rules on the grid lines: content starts
  // at the margin, or at a single rule's inner half where the margin is narrower than that.
  // A thick rule wider than its margin keeps the ordinary collapsed clearance.
  const centredLegacy =
    legacyCollapsedContentAlignment &&
    simpleRules &&
    ((margins.left >= leftExtent && margins.right >= rightExtent) ||
      [borders.left, borders.right].every(
        (edge) => edge.state !== 'edge' || edge.style === 'single'
      ));
  const centred = (centeredSideRules && collapsedBorders) || centredLegacy;
  // Collapsed horizontal rules are shared by adjacent rows. Each row reserves half
  // the authored thickness; separated cells reserve an independent full border.
  // A captured reference charges a collapsed horizontal band ENTIRELY to the row below it,
  // at that row's own authored top rule, and charges the row above nothing. Compound rules
  // keep their own extent geometry on both sides.
  const band = collapsedBorders && topBandClearancePt !== undefined;
  const bandTop = band && simpleBand(borders.top);
  const bandBottom = band && !bottomIsOuter && simpleBand(borders.bottom);
  return {
    top: bandTop
      ? margins.top + topBandClearancePt
      : borderContentInset(margins.top, borders.top, collapsedBorders, false, true),
    right: centred
      ? Math.max(margins.right, rightExtent / 2)
      : borderContentInset(margins.right, borders.right, false, collapsedBorders),
    bottom: bandBottom
      ? margins.bottom
      : borderContentInset(margins.bottom, borders.bottom, collapsedBorders && !bottomIsOuter),
    left: centred
      ? Math.max(margins.left, leftExtent / 2)
      : borderContentInset(margins.left, borders.left, false, collapsedBorders),
  };
}
