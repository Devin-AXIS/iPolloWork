// Where one section's `w:pgBorders` lands on one sheet.
//
// LAYOUT OWNS THE BAND, paint owns the ink — the same division `columnSeparators` draws and
// the same one the paragraph rules already state (`semantic-paint.ts`, "the paint NEVER
// recomputes thicknesses"). Two reasons it has to be this way round for a page border:
//
//  - `w:offsetFrom="text"` measures `w:space` from the TEXT, so the distance from the sheet
//    edge is `margin - space - stroke`. Paint holds a page box and a scale; it does not hold
//    `w:pgMar`, and handing it the margins so it could subtract them would be handing it the
//    job of deciding where the border is.
//  - Compound styles (`double`, …) publish an INFLATED band, because Word's `w:sz` for those
//    is the total extent and a thin authored double still has to paint as two lines. That
//    inflation is `borderStrokeWidthPt`, shared with paragraph and table borders.
//
// Boxes leave here PAGE-BOX RELATIVE (origin = the sheet's own top-left), which is what keeps
// a reused sheet cheap: `remapPage` slides a page down the document stack and the frame rides
// along untouched.

import { borderStrokeWidthPt } from './border-metrics.ts';
import type { ParagraphBorderEdge } from './paragraph-style.ts';
import type { SectionPageBorders } from './page-borders.ts';
import { verticalMarginInsets } from './page-body-margins.ts';
import type {
  PageBorderFrameRecord,
  PageBorderStrokeRecord,
  PageGeometry,
} from './semantic-records.ts';

/** Visual thickness of one edge in points — the inflated band for compound styles. */
function strokeOf(edge: ParagraphBorderEdge | undefined): number {
  return edge ? borderStrokeWidthPt(edge.val, edge.widthPt) : 0;
}

/**
 * Distance from one sheet edge to the OUTER face of that side's rule, in points.
 *
 * `page`: `w:space` is that distance, straight off the file.
 *
 * `text`: `w:space` is the gap between the rule and the text, so the rule's inner face sits
 * `space` outside the text edge and its outer face a further `stroke` out — `margin - space -
 * stroke`. Clamped at zero: an authored space wider than the margin would put the frame off
 * the paper, where Word instead pins it to the sheet edge.
 *
 * A side with no rule still has a frame edge, because the two rules that meet it have to stop
 * somewhere. It gets the same formula with nothing of its own to contribute (`space` and
 * `stroke` both zero), which lands the corner on the text edge in `text` mode and on the sheet
 * edge in `page` mode. Word's own dialog keeps all four spacings equal even for sides that are
 * switched off, so the common three-sided frame is unaffected either way.
 */
function insetOf(
  offsetFrom: SectionPageBorders['offsetFrom'],
  edge: ParagraphBorderEdge | undefined,
  marginPt: number
): number {
  if (offsetFrom === 'page') return edge?.spacePt ?? 0;
  return Math.max(0, marginPt - (edge?.spacePt ?? 0) - strokeOf(edge));
}

/**
 * The frame for one sheet, or undefined when this page does not carry one.
 *
 * `isFirstPageOfSection` is the SECTION's first page, not the document's: `w:display` is a
 * section property, so in a three-section document a `firstPage` frame draws three times.
 *
 * The four rules close a rectangle rather than each spanning its own side. Word draws one box,
 * and horizontal rules that stopped at the text column while the verticals sat outside it read
 * as two rules with two detached bars beside them — the same thing `w:pBdr` gets right by
 * spanning from the left rule's outer edge to the right rule's.
 */
export function pageBorderFrame(
  borders: SectionPageBorders | undefined,
  geometry: PageGeometry,
  isFirstPageOfSection: boolean
): PageBorderFrameRecord | undefined {
  if (!borders) return undefined;
  if (borders.display === 'firstPage' && !isFirstPageOfSection) return undefined;
  if (borders.display === 'notFirstPage' && isFirstPageOfSection) return undefined;

  const topStroke = strokeOf(borders.top);
  const leftStroke = strokeOf(borders.left);
  const bottomStroke = strokeOf(borders.bottom);
  const rightStroke = strokeOf(borders.right);

  // `offsetFrom="text"` measures from the text extents, which a signed margin gives by size.
  const margins = verticalMarginInsets(geometry);
  const top = insetOf(borders.offsetFrom, borders.top, margins.top);
  const left = insetOf(borders.offsetFrom, borders.left, geometry.margin.left);
  const bottom = geometry.height - insetOf(borders.offsetFrom, borders.bottom, margins.bottom);
  const right = geometry.width - insetOf(borders.offsetFrom, borders.right, geometry.margin.right);

  const width = right - left;
  const height = bottom - top;
  // A frame the margins have swallowed (hostile `w:space`, a page smaller than its own
  // border inset) is dropped rather than published inside out.
  if (width <= 0 || height <= 0) return undefined;

  const strokes: PageBorderStrokeRecord[] = [];
  if (borders.top) {
    strokes.push({
      side: 'top',
      edge: borders.top,
      box: { x: left, y: top, width, height: topStroke },
    });
  }
  if (borders.bottom) {
    strokes.push({
      side: 'bottom',
      edge: borders.bottom,
      box: { x: left, y: bottom - bottomStroke, width, height: bottomStroke },
    });
  }
  if (borders.left) {
    strokes.push({
      side: 'left',
      edge: borders.left,
      box: { x: left, y: top, width: leftStroke, height },
    });
  }
  if (borders.right) {
    strokes.push({
      side: 'right',
      edge: borders.right,
      box: { x: right - rightStroke, y: top, width: rightStroke, height },
    });
  }
  if (strokes.length === 0) return undefined;
  return { zOrder: borders.zOrder, display: borders.display, strokes };
}
