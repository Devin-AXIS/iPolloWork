// Vertical clearance under `wrapTopAndBottom` bands. Extracted from drawing-exclusion so
// that module stays inside its line budget; the rule and its budget are unchanged.

import type { ExclusionZone } from './drawing-exclusion.ts';
import { emuToPointsSafe } from './drawing-layout.ts';
import { wrappedParagraphAnchorTop } from './anchor-content-top.ts';
import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { LayoutBox } from './semantic-records.ts';

/** Maximum rechecks when clearing a line below overlapping topAndBottom bands. */
export const MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS = 8;

function lineIntervalIntersectsTopAndBottomBand(
  lineTop: number,
  lineBottom: number,
  bandTop: number,
  bandBottom: number
): boolean {
  // A line that only touches the band stays. The two edges come from separate float sums, so
  // an exact comparison moved a line whose bottom equals a band top by rounding alone.
  return lineTop < bandBottom - TOUCH_TOLERANCE_PT && lineBottom > bandTop + TOUCH_TOLERANCE_PT;
}

const TOUCH_TOLERANCE_PT = 0.01;

/** The paragraph of a line and the spacing that line keeps below a floating table it anchors. */
export interface OwnTableAnchor {
  readonly id: string;
  readonly spaceAbove: number;
}

/**
 * Whether a floating table that `anchorId` anchors starts on this page and covers `topY`, the
 * top of the text area. A paragraph at the top of a page then keeps its space before in legacy
 * layout. The later part of a table that breaks across pages does not count.
 */
export function ownTableCoversTop(
  zones: readonly ExclusionZone[],
  anchorId: string,
  topY: number
): boolean {
  return zones.some(
    (zone) =>
      zone.sourceKind === 'table' &&
      zone.anchorParagraphId === anchorId &&
      !zone.continuedTablePart &&
      zone.verticalBand.y <= topY + TOUCH_TOLERANCE_PT &&
      zone.verticalBand.y + zone.verticalBand.height > topY + TOUCH_TOLERANCE_PT
  );
}

/**
 * Vertical skip before placing a line whose [top, bottom] interval intersects a topAndBottom band.
 *
 * Uses the full final line height, unions overlapping band bottoms, and rechecks until clear or
 * {@link MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS} — pre-placement may pass a minimum height; callers
 * must re-run at line close with the styled/drawing final height.
 *
 * `spaceAbove` is the paragraph spacing above a paragraph's first line. A drawing's band that
 * crosses that spacing or the line moves the line to the band bottom, and the line keeps its
 * spacing below the band. So does the band of a floating table that `ownAnchor`, the line's
 * paragraph, anchors: such a table is positioned from the top of that paragraph, above its
 * spacing, and the line keeps `ownAnchor.spaceAbove` below it. That spacing includes space
 * before that the top of a page suppressed, because the line no longer opens the page. Other
 * floating tables, frames, and header or footer objects keep the plain rule.
 */
export function topAndBottomSkipBeforeLine(
  lineTopY: number,
  lineHeight: number,
  zones: readonly ExclusionZone[],
  spaceAbove = 0,
  ownAnchor?: OwnTableAnchor
): number {
  if (lineHeight <= 0 || zones.length === 0) return 0;
  let skip = 0;
  if (spaceAbove > 0.001 || (ownAnchor?.spaceAbove ?? 0) > 0.001) {
    let spacedTarget = -Infinity;
    for (const zone of zones) {
      // Only a drawing's band. The line after a floating table or frame starts at its bottom.
      const own =
        ownAnchor !== undefined &&
        zone.sourceKind === 'table' &&
        zone.anchorParagraphId === ownAnchor.id;
      if (zone.input.mode !== 'topAndBottom' || (zone.sourceKind && !own)) continue;
      const kept = own ? Math.max(spaceAbove, ownAnchor.spaceAbove) : spaceAbove;
      if (kept <= 0.001) continue;
      const bandTop = zone.verticalBand.y;
      const bandBottom = bandTop + zone.verticalBand.height;
      if (
        lineIntervalIntersectsTopAndBottomBand(
          lineTopY - spaceAbove,
          lineTopY + lineHeight,
          bandTop,
          bandBottom
        )
      )
        spacedTarget = Math.max(spacedTarget, bandBottom + kept);
    }
    if (spacedTarget > -Infinity) skip = Math.max(0, spacedTarget - lineTopY);
  }
  for (let attempt = 0; attempt < MAX_TOP_AND_BOTTOM_CLEARANCE_ATTEMPTS; attempt += 1) {
    const intervalTop = lineTopY + skip;
    const intervalBottom = intervalTop + lineHeight;
    let unionBottom = intervalTop;
    let intersects = false;
    for (const zone of zones) {
      if (zone.input.mode !== 'topAndBottom') continue;
      const bandTop = zone.verticalBand.y;
      const bandBottom = bandTop + zone.verticalBand.height;
      if (
        lineIntervalIntersectsTopAndBottomBand(intervalTop, intervalBottom, bandTop, bandBottom)
      ) {
        intersects = true;
        unionBottom = Math.max(unionBottom, bandBottom);
      }
    }
    if (!intersects) break;
    const nextSkip = unionBottom - lineTopY;
    if (nextSkip <= skip + 0.001) break;
    skip = nextSkip;
  }
  return skip;
}

/**
 * Story y where a `wp:wrapTopAndBottom` band starts: the drawing's own top, not the anchor line's.
 *
 * The band clears the drawing, so it begins where the drawing begins. A `wp:positionV` whose frame
 * is the anchor's own flow position (`paragraph` or `line`) displaces the drawing down by
 * `wp:posOffset`, and the band with it — the painted geometry already applies that offset. A
 * `paragraph` frame measures from the paragraph's top (`paragraphY`), not from the line that holds
 * the anchor, so an anchor on a later line keeps its band where its drawing is painted. Frames
 * that resolve against the page or its margins do not start at the anchor, and an alignment needs a
 * frame box the paragraph does not know while it is breaking; both keep the anchor line top.
 */
export function topAndBottomBandAnchorY(
  anchorLineY: number,
  vertical: Readonly<{
    relativeFrom: string;
    align: string | null;
    offsetEmu: number | null;
  }> | null,
  paragraphY = anchorLineY
): number {
  if (!vertical || vertical.align !== null) return anchorLineY;
  if (vertical.relativeFrom !== 'paragraph' && vertical.relativeFrom !== 'line') return anchorLineY;
  const offset = emuToPointsSafe(vertical.offsetEmu ?? 0);
  if (offset === null) return anchorLineY;
  return (vertical.relativeFrom === 'paragraph' ? paragraphY : anchorLineY) + offset;
}

/**
 * The skip before a line that bands of its own paragraph's anchors cause.
 *
 * `withOwn` holds the inherited zones plus the paragraph's own bands. Inherited bands may be
 * absent in the next page or column. This skip is not: it moves with the line, and each fresh
 * region repeats it.
 */
export function travellingTopAndBottomSkip(
  lineTopY: number,
  lineHeight: number,
  spaceAbove: number,
  zones: {
    readonly inherited: readonly ExclusionZone[];
    readonly withOwn: readonly ExclusionZone[];
  }
): number {
  const withOwn = topAndBottomSkipBeforeLine(lineTopY, lineHeight, zones.withOwn, spaceAbove);
  const inherited = topAndBottomSkipBeforeLine(lineTopY, lineHeight, zones.inherited, spaceAbove);
  return Math.max(0, withOwn - inherited);
}

/**
 * The band top of a paragraph-positioned body drawing after the content box top limit, the
 * same limit `resolveAnchoredDrawingPosition` applies to its painted box. Without a body
 * frame base, or inside a table cell, the band keeps its own top.
 */
export function paragraphBandTop(
  bandTop: number,
  projection: Pick<DrawingProjection, 'wrap' | 'position'>,
  options: {
    readonly frameBase?: BodyAnchorFrameBase;
    readonly anchorCellBox?: LayoutBox | null;
  }
): number {
  const frame = projection.position?.vertical;
  if (!options.frameBase || !frame || frame.align !== null) return bandTop;
  return wrappedParagraphAnchorTop(bandTop, frame.relativeFrom, projection.wrap, {
    ...options.frameBase,
    cellBox: options.anchorCellBox ?? null,
  });
}
