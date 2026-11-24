// Compound outlines (`a:ln/@cmpd`): one outline painted as two or three parallel bands.

import type { VectorShapeComponent } from './drawing-shape-projection.ts';

type Point = Readonly<{ x: number; y: number }>;

export type LineCompound = 'sng' | 'dbl' | 'thickThin' | 'thinThick' | 'tri';

/**
 * The painted bands of each compound type, from the outer edge inward, as fractions of the
 * line width. The outer edge of a closed outline is its outside; on an open line it is the
 * left of the path direction.
 */
const BANDS: Readonly<
  Record<Exclude<LineCompound, 'sng'>, readonly (readonly [number, number])[]>
> = {
  dbl: [
    [0, 1 / 3],
    [2 / 3, 1],
  ],
  thickThin: [
    [0, 0.6],
    [0.8, 1],
  ],
  thinThick: [
    [0, 0.2],
    [0.4, 1],
  ],
  tri: [
    [0, 1 / 6],
    [1 / 3, 2 / 3],
    [5 / 6, 1],
  ],
};

/** A miter longer than this many offsets bevels, as a stroke's miter limit does. */
const MITER_LIMIT = 4;

/** The compound type an `a:ln/@cmpd` value names; anything else is a single line. */
export function lineCompound(value: string | undefined): LineCompound {
  return value === 'dbl' || value === 'thickThin' || value === 'thinThick' || value === 'tri'
    ? value
    : 'sng';
}

/** Twice the signed area: positive when the left of the path direction is its outside. */
function orientation(points: readonly Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** The path moved `distance` along its left normal, with mitred corners. */
function offsetPath(points: readonly Point[], closed: boolean, distance: number): Point[] {
  const distinct = points.filter(
    (point, index) =>
      index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y
  );
  if (closed && distinct.length > 1) {
    const first = distinct[0]!;
    const last = distinct[distinct.length - 1]!;
    if (first.x === last.x && first.y === last.y) distinct.pop();
  }
  const count = distinct.length;
  if (count < 2 || distance === 0) return [...points];
  const normal = (from: Point, to: Point): Point => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: (to.y - from.y) / length, y: -(to.x - from.x) / length };
  };
  const out: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const point = distinct[index]!;
    const hasPrevious = closed || index > 0;
    const hasNext = closed || index < count - 1;
    const incoming = hasPrevious ? normal(distinct[(index - 1 + count) % count]!, point) : null;
    const outgoing = hasNext ? normal(point, distinct[(index + 1) % count]!) : null;
    const a = incoming ?? outgoing!;
    const b = outgoing ?? incoming!;
    const denominator = 1 + a.x * b.x + a.y * b.y;
    const scale = denominator > 2 / (MITER_LIMIT * MITER_LIMIT) ? 1 / denominator : 0.5;
    out.push({
      x: point.x + (a.x + b.x) * scale * distance,
      y: point.y + (a.y + b.y) * scale * distance,
    });
  }
  return out;
}

/**
 * A stroked component as its compound bands: each band strokes the path moved to the band's
 * centre at the band's width. Only the first band keeps the line ends. A single line, or a
 * component with no stroke, stays as it is.
 *
 * The bands carry no fill: a filled component becomes one fill-only component on the
 * original geometry, painted first with the shadow, then the stroke-only bands. Filling each
 * band's moved path would paint the fill past the geometry, into the gaps between the lines,
 * and once per band where it is translucent.
 */
export function compoundBands(
  component: VectorShapeComponent,
  compound: LineCompound
): readonly VectorShapeComponent[] {
  // An inset outline already clips to its own geometry; it keeps a single band.
  if (
    compound === 'sng' ||
    component.strokeHex === null ||
    component.strokeInset === true ||
    !(component.strokeWidthEmu > 0)
  ) {
    return [component];
  }
  const width = component.strokeWidthEmu;
  const outset = component.strokeOutsetEmu ?? 0;
  const {
    arrowheadsEmu,
    strokeOutsetEmu: _outset,
    fillGradient: _gradient,
    fillPattern: _pattern,
    fillRule: _fillRule,
    shadow,
    ...rest
  } = component;
  const filled = component.fillHex !== null;
  const fill: VectorShapeComponent[] = [];
  if (filled) {
    const {
      arrowheadsEmu: _arrowheads,
      strokeOutsetEmu: _strokeOutset,
      strokeCap: _cap,
      strokeJoin: _join,
      strokeMiterLimit: _miterLimit,
      strokeDash: _dash,
      ...fillOnly
    } = component;
    fill.push({ ...fillOnly, strokeHex: null, strokeAlpha: 1, strokeWidthEmu: 0 });
  }
  const bands = BANDS[compound].map(([from, to], index): VectorShapeComponent => {
    // Offset of the band centre from the path, toward the outer edge.
    const centre = width / 2 - ((from + to) / 2) * width;
    const subpaths = component.subpathsEmu.map((points, at) => {
      const closed = component.subpathsClosed?.[at] !== false;
      const side = closed && orientation(points) < 0 ? -1 : 1;
      return offsetPath(points, closed, side * centre);
    });
    const reach = outset + Math.abs(centre);
    return {
      ...rest,
      ...(index === 0 && arrowheadsEmu ? { arrowheadsEmu } : {}),
      // With no fill component, the outer band casts the shadow, once.
      ...(index === 0 && shadow && !filled ? { shadow } : {}),
      fillHex: null,
      fillAlpha: 1,
      subpathsEmu: subpaths,
      strokeWidthEmu: (to - from) * width,
      ...(reach > 0 ? { strokeOutsetEmu: reach } : {}),
    };
  });
  return [...fill, ...bands];
}
