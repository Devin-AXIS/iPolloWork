// The x space a paragraph's lines break in beside floats, and the zones as its pen sees them.
//
// It has two jobs, in both paragraph directions. First, square wrapping on the largest side
// breaks a tie between equal sides by a physical side that the compatibility mode chooses
// (left from mode 15, right before); that side is set on each such zone. Second, a
// right-to-left paragraph mirrors every zone, as follows.
//
// A right-to-left line fills the passages a float leaves it from right to left: its first
// words take the rightmost passage, and the text then continues in the passage to the left of
// the float. The line breaker moves its pen one way only, from the line's start edge, so a
// right-to-left paragraph breaks in x mirrored about its own measure. There the start edge is
// on the left and the rightmost passage is the first one the pen meets. Every zone the breaker
// reads is mirrored once, so passages, wrap sides, wrap distances, and clearance all agree.
// Alignment maps each part of the line back to its physical passage
// (`lineAlignmentMeasure`).

import type { DrawingInsets, DrawingPoint } from './drawing-geometry.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { WrapTextSide } from './drawing-wrap.ts';
import type { LayoutBox } from './semantic-records.ts';
import {
  carryHorizontalResolution,
  type TextWrappingBreakClear,
} from './text-wrapping-break-clear.ts';

/** Where a paragraph's pen breaks lines beside floats. */
export interface WrapBreakSpace {
  /** The left bound of the pen's x space: the paragraph's content left, or its mirror. */
  readonly left: number;
  /** The right bound of the pen's x space. */
  readonly right: number;
  /** True when lines break in x mirrored about the paragraph's measure. */
  readonly mirrored: boolean;
  /** The zones as the pen sees them. Each zone maps to one stable mirrored copy. */
  readonly zones: (zones: readonly ExclusionZone[]) => readonly ExclusionZone[];
  /** The physical side a `w:br w:clear` names, as a side of the pen's x space. */
  readonly clearSide: (clear: TextWrappingBreakClear) => TextWrappingBreakClear;
}

/**
 * The break space of a paragraph whose measure starts at `lineLeft` and is `width` wide.
 *
 * A left-to-right paragraph breaks in physical x, between `contentLeft` and `wrapRight`. A
 * right-to-left paragraph mirrors x about its measure, so the pen's first line origin (after a
 * first-line indent) maps to the physical right edge less that indent. Its bounds are the
 * physical edges mirrored. The far bound stops at the paragraph's own left edge, as
 * `wrapRight` stops at its right edge. The near bound also reaches a hanging first line, which
 * starts before the measure in that space.
 *
 * `largestTieLeft` breaks a tie of square wrapping on the largest side to the physical left
 * (compatibility mode 15 and later). The tie is physical, so it is set on each zone before the
 * zone is mirrored.
 */
export function wrapBreakSpace(
  rightToLeft: boolean,
  lineLeft: number,
  width: number,
  edges: {
    readonly firstLineOffset: number;
    readonly contentLeft: number;
    readonly wrapRight: number;
    readonly largestTieLeft?: boolean;
  }
): WrapBreakSpace {
  const { contentLeft, wrapRight } = edges;
  const tieLeft = edges.largestTieLeft === true;
  if (!rightToLeft && !tieLeft) {
    return {
      left: contentLeft,
      right: wrapRight,
      mirrored: false,
      zones: (zones) => zones,
      clearSide: (clear) => clear,
    };
  }
  const axis = 2 * lineLeft + width;
  // Made on first use, so a paragraph whose lines meet no zone it changes allocates nothing.
  let images: WeakMap<ExclusionZone, ExclusionZone> | undefined;
  const image = (zone: ExclusionZone): ExclusionZone => {
    images ??= new WeakMap();
    let seen = images.get(zone);
    if (!seen) {
      seen = tieLeft && wrapsLargest(zone) ? withLargestTie(zone, 'left') : zone;
      if (rightToLeft) seen = mirrorExclusionZone(seen, axis);
      if (seen !== zone) carryHorizontalResolution(zone, seen);
      images.set(zone, seen);
    }
    return seen;
  };
  const zones = (list: readonly ExclusionZone[]) =>
    // A left-to-right paragraph changes only zones that wrap on the largest side; any other
    // list comes back as it is.
    list.length === 0 || (!rightToLeft && !list.some(wrapsLargest))
      ? list
      : Object.freeze(list.map(image));
  if (!rightToLeft) {
    return { left: contentLeft, right: wrapRight, mirrored: false, zones, clearSide: (c) => c };
  }
  return {
    left: Math.min(axis - wrapRight, lineLeft + Math.min(0, edges.firstLineOffset)),
    right: Math.min(axis - contentLeft, lineLeft + width),
    mirrored: true,
    zones,
    clearSide: (clear) => (clear === 'left' ? 'right' : clear === 'right' ? 'left' : clear),
  };
}

function wrapsLargest(zone: ExclusionZone): boolean {
  return zone.input.textSide === 'largest';
}

function withLargestTie(zone: ExclusionZone, largestTie: 'left' | 'right'): ExclusionZone {
  return Object.freeze({ ...zone, input: Object.freeze({ ...zone.input, largestTie }) });
}

/** `zone` reflected about the vertical line `x = axis / 2`. */
export function mirrorExclusionZone(zone: ExclusionZone, axis: number): ExclusionZone {
  const input = zone.input;
  return Object.freeze({
    ...zone,
    verticalBand: mirrorBox(zone.verticalBand, axis),
    input: Object.freeze({
      ...input,
      contentBounds: mirrorBox(input.contentBounds, axis),
      polygon: mirrorPolygon(input.polygon, axis),
      clipPolygon: mirrorPolygon(input.clipPolygon, axis),
      wrapDistances: mirrorInsets(input.wrapDistances),
      effectInsets: mirrorInsets(input.effectInsets),
      textSide: mirrorTextSide(input.textSide),
      largestTie: input.largestTie === 'left' ? 'right' : 'left',
      contentLeft: axis - input.contentRight,
      contentRight: axis - input.contentLeft,
    }),
  });
}

function mirrorBox(box: LayoutBox, axis: number): LayoutBox {
  return Object.freeze({ ...box, x: axis - box.x - box.width });
}

function mirrorPolygon(
  polygon: readonly DrawingPoint[] | null,
  axis: number
): readonly DrawingPoint[] | null {
  if (!polygon) return polygon;
  return Object.freeze(polygon.map((point) => Object.freeze({ x: axis - point.x, y: point.y })));
}

function mirrorInsets(insets: DrawingInsets): DrawingInsets {
  return Object.freeze({ ...insets, left: insets.right, right: insets.left });
}

/**
 * A wrap side names a physical side, so it swaps. `largest` stays, and its physical tie side
 * (`largestTie`, right when absent) swaps with the zone.
 */
function mirrorTextSide(side: WrapTextSide): WrapTextSide {
  return side === 'left' ? 'right' : side === 'right' ? 'left' : side;
}
