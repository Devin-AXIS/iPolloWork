// A paragraph's own `wp:wrapTopAndBottom` band that reaches lines laid out before its anchor line.
//
// DOM-free. A break synthesizes the band of an anchor in its own text when the anchor's line
// opens, so only that line and the lines after it see the band. A `paragraph` frame places the
// band from the paragraph's top, though, and the band can cross an earlier line. Those lines
// move below the band too. The band does not depend on where the lines fall, so one more break
// with the band present from the first line settles the paragraph.

import type { ExclusionZone } from './drawing-exclusion.ts';
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import type { PendingLine } from './pending-line.ts';
import { topAndBottomSkipBeforeLine } from './top-and-bottom-clearance.ts';

const FIT_TOLERANCE_PT = 0.01;

type LineExtent = Pick<PendingLine, 'end' | 'height' | 'exclusionSkipBefore'>;

/** Story y of each line's top: the extent of the lines before it, then its own skip. */
function lineTopsOf(lines: readonly LineExtent[], paragraphStartY: number): number[] {
  const tops: number[] = [];
  let extent = paragraphStartY;
  for (const line of lines) {
    const skip = line.exclusionSkipBefore ?? 0;
    tops.push(extent + skip);
    extent += line.height + skip;
  }
  return tops;
}

/** The line that holds the anchor at `modelStart`: the first that ends after it, or the last. */
function anchorLineIndex(lines: readonly LineExtent[], modelStart: number): number {
  const index = lines.findIndex((line) => line.end > modelStart);
  return index >= 0 ? index : lines.length - 1;
}

/**
 * Whether the line that holds each anchor ends inside the flow region. The second break is kept
 * only when it does; otherwise the first break stands.
 */
export function anchorLinesFitRegion(
  lines: readonly LineExtent[],
  starts: ReadonlySet<number>,
  paragraphStartY: number,
  regionBottomY: number | undefined
): boolean {
  if (regionBottomY === undefined) return true;
  const tops = lineTopsOf(lines, paragraphStartY);
  for (const start of starts) {
    const index = anchorLineIndex(lines, start);
    if (index < 0) continue;
    if (tops[index]! + lines[index]!.height > regionBottomY + FIT_TOLERANCE_PT) return false;
  }
  return true;
}

/**
 * The model offsets of the paragraph-framed own bands that cross a line before their anchor line,
 * or null when none does. Only bands in `starts` count. A band whose anchor line ends past the
 * region bottom does not count.
 */
export function ownBandsCrossingEarlierLines(options: {
  readonly lines: readonly LineExtent[];
  readonly zones: readonly ExclusionZone[];
  readonly starts: ReadonlySet<number>;
  readonly paragraphStartY: number;
  readonly spaceBefore: number;
  readonly regionBottomY?: number;
}): ReadonlySet<number> | null {
  const { lines, starts } = options;
  if (starts.size === 0 || lines.length < 2) return null;
  const tops = lineTopsOf(lines, options.paragraphStartY);
  let crossing: Set<number> | null = null;
  for (const zone of options.zones) {
    if (zone.input.mode !== 'topAndBottom' || !starts.has(zone.anchorModelStart)) continue;
    const index = anchorLineIndex(lines, zone.anchorModelStart);
    if (index <= 0) continue;
    const anchorLine = lines[index]!;
    if (
      options.regionBottomY !== undefined &&
      tops[index]! + anchorLine.height > options.regionBottomY + FIT_TOLERANCE_PT
    )
      continue;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const spaceAbove = earlier === 0 ? options.spaceBefore : 0;
      const line = lines[earlier]!;
      if (topAndBottomSkipBeforeLine(tops[earlier]!, line.height, [zone], spaceAbove) > 0) {
        (crossing ??= new Set()).add(zone.anchorModelStart);
        break;
      }
    }
  }
  return crossing;
}

/**
 * Break the paragraph once more when a paragraph-framed band of its own crosses a line before its
 * anchor line, with that band present from the first line. Returns the new lines, or null when
 * the first break stands: no band crosses an earlier line, or the new break moves an anchor line
 * out of the region.
 */
export function rebreakForEarlierOwnBands(options: {
  readonly lines: readonly PendingLine[];
  readonly zones: readonly ExclusionZone[];
  readonly starts: ReadonlySet<number>;
  readonly flow: ParagraphFlowOptions | undefined;
  readonly rebreak: (flow: ParagraphFlowOptions) => readonly PendingLine[];
}): readonly PendingLine[] | null {
  const { flow } = options;
  const paragraphStartY = flow?.paragraphStartY ?? 0;
  const crossing = ownBandsCrossingEarlierLines({
    lines: options.lines,
    zones: options.zones,
    starts: options.starts,
    paragraphStartY,
    spaceBefore: flow?.paragraphSpaceBefore ?? 0,
    ...(flow?.regionBottomY !== undefined ? { regionBottomY: flow.regionBottomY } : {}),
  });
  if (!crossing) return null;
  const lines = options.rebreak({ ...flow, ownBandsFromFirstLine: crossing });
  if (!anchorLinesFitRegion(lines, crossing, paragraphStartY, flow?.regionBottomY)) return null;
  let lastAnchorLine = -1;
  for (const start of crossing)
    lastAnchorLine = Math.max(lastAnchorLine, anchorLineIndex(lines, start));
  for (let index = 0; index < lastAnchorLine; index += 1) {
    const line = lines[index]!;
    if ((line.exclusionSkipBefore ?? 0) > 0) line.ownBandClearance = true;
  }
  return lines;
}
