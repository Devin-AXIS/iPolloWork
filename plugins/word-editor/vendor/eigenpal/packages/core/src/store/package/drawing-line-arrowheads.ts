import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

type Point = Readonly<{ x: number; y: number }>;
type EndType = 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';
type End = { type: EndType; width: Size; length: Size };
type Size = 'sm' | 'med' | 'lg';

const END_TYPES: ReadonlySet<string> = new Set(['triangle', 'stealth', 'diamond', 'oval', 'arrow']);
/** Vertices of an oval line end; enough for a smooth outline at line-end sizes. */
const OVAL_POINTS = 16;
/** Segments of the round cap on each arm of an open arrow. */
const CAP_SEGMENTS = 6;
/** Line ends never scale below the size they have on a 2 pt line (25,400 EMU). */
const MIN_END_UNIT_EMU = 25_400;
/** Full width and length of a line end, in end units. */
const END_SIZE: Readonly<Record<Size, number>> = { sm: 2, med: 3, lg: 5 };
/** How far a stealth end's notch sits behind its tip, by length, in end units. */
const STEALTH_NOTCH: Readonly<Record<Size, number>> = { sm: 1, med: 2, lg: 3 };
/** An open arrow's arm reach behind its apex, by length, in end units. */
const ARROW_REACH: Readonly<Record<Size, number>> = { sm: 2, med: 3, lg: 4.5 };
/** An open arrow's arm spread from the line axis, by width, in end units. */
const ARROW_SPREAD: Readonly<Record<Size, number>> = { sm: 1.25, med: 1.75, lg: 2.5 };

/**
 * The filled outline of one line end at `tip`, pointing along unit vector (ux, uy), in the
 * stroke colour. Sizes are in end units: the line width, but never less than 2 pt.
 *
 * Every outline starts at the line end, which the paint clip and group transforms read.
 * A centred outline then starts with a zero-width cut from its centre to its front point
 * on the line axis, so the second point gives the line direction.
 *
 * - `triangle`: a solid triangle whose tip is the line end.
 * - `stealth`: a triangle with its back notched in toward the tip.
 * - `diamond` and `oval`: centred on the line end.
 * - `arrow`: an open V stroked at the line width with round arm ends, its outer point on
 *   the line end.
 */
function endOutline(tip: Point, ux: number, uy: number, end: End, strokeWidth: number): Point[] {
  const unit = Math.max(strokeWidth, MIN_END_UNIT_EMU);
  const length = END_SIZE[end.length] * unit;
  const half = (END_SIZE[end.width] * unit) / 2;
  const at = (along: number, across: number): Point => ({
    x: tip.x + ux * along - uy * across,
    y: tip.y + uy * along + ux * across,
  });
  switch (end.type) {
    case 'triangle':
      return [tip, at(-length, half), at(-length, -half)];
    case 'stealth':
      return [tip, at(-length, half), at(-STEALTH_NOTCH[end.length] * unit, 0), at(-length, -half)];
    case 'diamond':
      return [
        tip,
        at(length / 2, 0),
        at(0, half),
        at(-length / 2, 0),
        at(0, -half),
        at(length / 2, 0),
      ];
    case 'oval': {
      const points: Point[] = [tip];
      for (let index = 0; index <= OVAL_POINTS; index += 1) {
        const angle = (index / OVAL_POINTS) * Math.PI * 2;
        points.push(at((Math.cos(angle) * length) / 2, Math.sin(angle) * half));
      }
      return points;
    }
    case 'arrow':
      return openArrow(
        at,
        ARROW_REACH[end.length] * unit,
        ARROW_SPREAD[end.width] * unit,
        strokeWidth
      );
  }
}

/**
 * How far the line stops short of its end under a line end, so a wide line does not show
 * past the end's narrow tip: at the triangle's base less half the line width, at the stealth
 * notch, or at an open arrow's apex. Centred ends cover the line end and keep it.
 */
function endSetback(end: End, strokeWidth: number): number {
  const unit = Math.max(strokeWidth, MIN_END_UNIT_EMU);
  switch (end.type) {
    case 'triangle':
      return Math.max(0, END_SIZE[end.length] * unit - strokeWidth / 2);
    case 'stealth':
      return STEALTH_NOTCH[end.length] * unit;
    case 'arrow': {
      const reach = ARROW_REACH[end.length] * unit;
      const spread = ARROW_SPREAD[end.width] * unit;
      return ((strokeWidth / 2) * Math.hypot(reach, spread)) / spread;
    }
    case 'diamond':
    case 'oval':
      return 0;
  }
}

/**
 * The path with its first point moved `distance` along it, dropping the points it passes.
 * A path no longer than the distance stays whole: it still paints under its line end.
 */
function shortenStart(points: readonly Point[], distance: number): readonly Point[] {
  if (!(distance > 0)) return points;
  let left = distance;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segment = Math.hypot(to.x - from.x, to.y - from.y);
    if (segment > left) {
      const share = left / segment;
      return [
        { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share },
        ...points.slice(index),
      ];
    }
    left -= segment;
  }
  return points;
}

/**
 * An open arrow: two arms of thickness `thickness` whose centre lines run `reach` back and
 * `spread` out from an apex. The apex sits behind the line end by the outer miter, so the
 * outer edges meet on the line end; the inner edges meet one miter further back.
 */
function openArrow(
  at: (along: number, across: number) => Point,
  reach: number,
  spread: number,
  thickness: number
): Point[] {
  const arm = Math.hypot(reach, spread);
  const radius = thickness / 2;
  const miter = (radius * arm) / spread;
  // Unit vectors in (along, across): the upper arm's direction away from the apex, and its
  // normal away from the line axis.
  const dAlong = -reach / arm;
  const dAcross = spread / arm;
  const nAlong = spread / arm;
  const nAcross = reach / arm;
  const cap = (sign: 1 | -1, outerFirst: boolean): Point[] => {
    const centreAlong = -miter - reach;
    const centreAcross = sign * spread;
    const points: Point[] = [];
    for (let index = 0; index <= CAP_SEGMENTS; index += 1) {
      const step = outerFirst ? index : CAP_SEGMENTS - index;
      const angle = (step / CAP_SEGMENTS) * Math.PI;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push(
        at(
          centreAlong + radius * (cos * nAlong + sin * dAlong),
          centreAcross + sign * radius * (cos * nAcross + sin * dAcross)
        )
      );
    }
    return points;
  };
  return [at(0, 0), ...cap(1, true), at(-2 * miter, 0), ...cap(-1, false)];
}

/** Line-end outlines and the stroked paths shortened under them. */
export interface LineEndProjection {
  readonly arrows: readonly (readonly Point[])[];
  /** The input paths, each open one stopping short of its line ends. */
  readonly paths: readonly (readonly Point[])[];
}

/**
 * Bounded line ends of the supported types. Unknown visible decorations refuse the shape.
 * The returned paths are for stroking only: a filled path keeps its own outline.
 */
export function projectLineArrowheads(
  paths: readonly (readonly Point[])[],
  closed: readonly boolean[],
  line: OoxmlElement | null,
  strokeWidth: number
): LineEndProjection | null {
  const ends: { head?: End; tail?: End } = {};
  const size = (value: string | undefined): Size | null =>
    value === 'sm' || value === 'lg' || value === 'med'
      ? value
      : value === undefined
        ? 'med'
        : null;
  for (const child of line?.children ?? []) {
    if (
      child.kind !== 'generic' ||
      child.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI ||
      (child.localName !== 'headEnd' && child.localName !== 'tailEnd')
    )
      continue;
    const type = schemaAttributeValue(child.attributes, 'type') ?? 'none';
    if (type === 'none') continue;
    if (!END_TYPES.has(type)) return null;
    const width = size(schemaAttributeValue(child.attributes, 'w'));
    const length = size(schemaAttributeValue(child.attributes, 'len'));
    if (width === null || length === null) return null;
    ends[child.localName === 'headEnd' ? 'head' : 'tail'] = {
      type: type as EndType,
      width,
      length,
    };
  }
  const arrows: Point[][] = [];
  if (!(strokeWidth > 0) || (!ends.head && !ends.tail)) return { arrows, paths };
  const stroked: (readonly Point[])[] = [];
  for (const [index, points] of paths.entries()) {
    if (closed[index] || points.length < 2) {
      stroked.push(points);
      continue;
    }
    let trimmed = points;
    for (const side of ['head', 'tail'] as const) {
      const end = ends[side];
      if (!end) continue;
      const ordered = side === 'head' ? points : [...points].reverse();
      const tip = ordered[0]!;
      const next = ordered.find((point) => point.x !== tip.x || point.y !== tip.y);
      if (!next) continue;
      const distance = Math.hypot(tip.x - next.x, tip.y - next.y);
      const outline = endOutline(
        tip,
        (tip.x - next.x) / distance,
        (tip.y - next.y) / distance,
        end,
        strokeWidth
      );
      if (!outline.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
        return null;
      arrows.push(outline);
      const setback = endSetback(end, strokeWidth);
      trimmed =
        side === 'head'
          ? shortenStart(trimmed, setback)
          : [...shortenStart([...trimmed].reverse(), setback)].reverse();
    }
    stroked.push(trimmed);
  }
  return { arrows, paths: stroked };
}
