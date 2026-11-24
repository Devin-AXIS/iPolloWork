// Before compatibility mode 15, a paragraph's last line must clear the band of a floating table
// (ECMA-376 Part 1, 17.4.57) together with its space after (17.3.1.33): a line that clears the
// band while its space after reaches into it moves below the band, as the line itself would.
// This holds for the band of the table the paragraph anchors and for a raised table that reaches
// back over earlier lines. Mode 15 tests the line alone.
//
// Limit: only a band that leaves no passage moves the line. A narrower table that the space after
// alone reaches would wrap the line beside it; the line keeps its full width.

import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import {
  type OwnTableAnchor,
  ownTableCoversTop,
  topAndBottomSkipBeforeLine,
} from './top-and-bottom-clearance.ts';

/** The space after a line adds to its extent against floating table bands. */
export function tableBandSpaceAfter(compatibilityMode: number | undefined, after: number): number {
  return after > 0 && hasCompatibilityRule(compatibilityMode, 'floatingTableBandHoldsSpaceAfter')
    ? after
    : 0;
}

/**
 * The skip that moves a line below the top-and-bottom bands of `zones` (see
 * `topAndBottomSkipBeforeLine`, which also takes `ownAnchor`), and the line with its `after`
 * below their floating table bands.
 */
export function lineBandSkip(
  top: number,
  height: number,
  zones: readonly ExclusionZone[],
  spaceAbove: number,
  after: number,
  ownAnchor?: OwnTableAnchor
): number {
  const skip = topAndBottomSkipBeforeLine(top, height, zones, spaceAbove, ownAnchor);
  if (after <= 0) return skip;
  const tables = zones.filter((zone) => zone.sourceKind === 'table');
  return tables.length > 0
    ? Math.max(skip, topAndBottomSkipBeforeLine(top, height + after, tables))
    : skip;
}

/**
 * Before compatibility mode 15, a paragraph at the top of a page keeps its space before when a
 * floating table that it anchors covers the top of the text area. The table can stand beside
 * the paragraph or span the column.
 */
export function ownTableKeepsTop(
  compatibilityMode: number | undefined,
  zones: readonly ExclusionZone[],
  anchorId: string
): boolean {
  return (
    hasCompatibilityRule(compatibilityMode, 'ownTableKeepsPageTopSpaceBefore') &&
    ownTableCoversTop(zones, anchorId, 0)
  );
}
