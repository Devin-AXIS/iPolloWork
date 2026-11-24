// DrawingML gradient fills (`a:gradFill`): stops, a linear angle or a path focus, read at the
// store trust boundary and placed in the coordinate space of the shape's painted points.
//
// A gradient is laid out in the shape's own unturned box. `place` maps that box onto the
// shape's flip and turn, and a group's offset and scale compose onto the same matrix, so a
// painter needs one transform and the stop list. Stops are validated sRGB with an alpha.

import { findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  resolveColorNode,
  type ShapeColor,
  type ShapeSchemeColorResolver,
} from './drawing-shape-color.ts';
import { parseSchemaBoolean, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const MAX_GRADIENT_STOPS = 16;

/** An affine map `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
export type AffineMatrix = readonly [number, number, number, number, number, number];

/** One colour stop of a gradient. @public */
export interface GradientStop {
  /** Position along the gradient, 0..1. */
  readonly offset: number;
  /** Validated six-character sRGB hex, without `#`. */
  readonly hex: string;
  /** Opacity, 0..1. */
  readonly alpha: number;
}

/**
 * A gradient ready to paint. `linear` runs from (x1, y1) to (x2, y2); `radial` grows from
 * its centre (cx, cy) at offset 0 to radius r at offset 1. Both are in gradient space, which
 * `matrix` maps onto the component's point space.
 */
export interface VectorGradient {
  readonly kind: 'linear' | 'radial';
  /** Stops in offset order; at least two. */
  readonly stops: readonly GradientStop[];
  /** `[x1, y1, x2, y2]` for a linear gradient, `[cx, cy, r]` for a radial one. */
  readonly coords: readonly number[];
  /** Gradient space onto the component's point space. */
  readonly matrix: AffineMatrix;
  /**
   * False when the gradient keeps its direction as its shape turns (`rotWithShape="0"`): a
   * turned group moves it with the shape but does not turn it. Absent when it turns.
   */
  readonly turnsWithShape?: false;
}

/** A gradient read from markup, not yet placed on a shape. */
export interface GradientFillSpec {
  readonly stops: readonly GradientStop[];
  readonly shade:
    | { readonly kind: 'linear'; readonly angleDegrees: number; readonly scaled: boolean }
    | {
        readonly kind: 'path';
        /** `a:fillToRect` insets as fractions of the box: l, t, r, b. */
        readonly focus: readonly [number, number, number, number];
      };
  /** The gradient turns and flips with its shape (`rotWithShape`, default on). */
  readonly turnsWithShape: boolean;
}

function intAttribute(element: OoxmlElement | null, name: string, limit: number): number | null {
  const raw = element ? schemaAttributeValue(element.attributes, name) : undefined;
  if (raw === undefined || !/^[+-]?\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  return Math.abs(value) <= limit ? value : null;
}

/** Read `a:gradFill`. Null when a stop colour cannot resolve or the stop list is unusable. */
export function readGradientFill(
  gradFill: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  placeholder?: ShapeColor
): GradientFillSpec | null {
  const gsLst = findDirectChild(gradFill.children, { namespaceUri: A, localName: 'gsLst' });
  if (!gsLst) return null;
  const stops: GradientStop[] = [];
  for (const gs of gsLst.children) {
    if (!isElement(gs) || gs.namespaceUri !== A || gs.localName !== 'gs') continue;
    if (stops.length >= MAX_GRADIENT_STOPS) return null;
    const position = intAttribute(gs, 'pos', 100_000);
    let colorNode: OoxmlElement | null = null;
    for (const node of gs.children) {
      if (isElement(node)) {
        colorNode = node;
        break;
      }
    }
    const color = colorNode ? resolveColorNode(colorNode, resolveSchemeColor, placeholder) : null;
    if (position === null || position < 0 || !color) return null;
    stops.push({ offset: position / 100_000, hex: color.hex, alpha: color.alpha });
  }
  if (stops.length === 0) return null;
  stops.sort((left, right) => left.offset - right.offset);
  const lin = findDirectChild(gradFill.children, { namespaceUri: A, localName: 'lin' });
  const path = findDirectChild(gradFill.children, { namespaceUri: A, localName: 'path' });
  const rotWithShape = schemaAttributeValue(gradFill.attributes, 'rotWithShape');
  // `xsd:boolean` collapses white space: " 0 " keeps the gradient's direction too. An invalid
  // spelling turns with the shape, as the default does.
  const turnsWithShape = parseSchemaBoolean(rotWithShape) !== false;
  if (path && !lin) {
    const rect = findDirectChild(path.children, { namespaceUri: A, localName: 'fillToRect' });
    const inset = (name: string) => (intAttribute(rect, name, 10_000_000) ?? 0) / 100_000;
    return {
      stops,
      shade: { kind: 'path', focus: [inset('l'), inset('t'), inset('r'), inset('b')] },
      turnsWithShape,
    };
  }
  const angle = intAttribute(lin, 'ang', 21_600_000) ?? 0;
  const scaled = schemaAttributeValue(lin?.attributes ?? [], 'scaled');
  return {
    stops,
    shade: {
      kind: 'linear',
      angleDegrees: angle / 60_000,
      scaled: scaled === '1' || scaled === 'true',
    },
    turnsWithShape,
  };
}

/** One colour standing for the gradient where a painter has no gradient: the stop mean. */
export function gradientMeanColor(spec: Pick<GradientFillSpec, 'stops'>): ShapeColor {
  const channels = [0, 0, 0];
  let alpha = 0;
  for (const stop of spec.stops) {
    for (let index = 0; index < 3; index += 1) {
      channels[index]! += Number.parseInt(stop.hex.slice(index * 2, index * 2 + 2), 16);
    }
    alpha += stop.alpha;
  }
  const count = spec.stops.length;
  return {
    hex: channels
      .map((channel) =>
        Math.round(channel / count)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
      .toUpperCase(),
    alpha: alpha / count,
  };
}

/**
 * Place a gradient on a shape box of `width` x `height`, with `place` mapping the box onto the
 * shape's painted space (flip and turn). A linear gradient spans the box along its angle; a
 * scaled angle is measured in the unit square and stretches with the box. A path gradient
 * grows from the focus rectangle's centre to the farthest box corner.
 */
export function placeGradient(
  spec: GradientFillSpec,
  width: number,
  height: number,
  place: AffineMatrix
): VectorGradient | null {
  if (!(width > 0) || !(height > 0)) return null;
  const stops =
    spec.stops.length === 1 ? [spec.stops[0]!, { ...spec.stops[0]!, offset: 1 }] : spec.stops;
  if (spec.shade.kind === 'path') {
    const [l, t, r, b] = spec.shade.focus;
    const cx = (l + 1 - r) / 2;
    const cy = (t + 1 - b) / 2;
    let radius = 0;
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      radius = Math.max(radius, Math.hypot(x - cx, y - cy));
    }
    // Gradient space is the unit square, stretched onto the box.
    const box: AffineMatrix = [width, 0, 0, height, 0, 0];
    return {
      kind: 'radial',
      stops,
      coords: [cx, cy, radius || 1],
      matrix: compose(place, box),
      ...(spec.turnsWithShape ? {} : { turnsWithShape: false as const }),
    };
  }
  const radians = (spec.shade.angleDegrees * Math.PI) / 180;
  let nx = Math.cos(radians);
  let ny = Math.sin(radians);
  if (spec.shade.scaled) {
    nx /= width;
    ny /= height;
  }
  const length = Math.hypot(nx, ny) || 1;
  nx /= length;
  ny /= length;
  const half = (width * Math.abs(nx) + height * Math.abs(ny)) / 2;
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    kind: 'linear',
    stops,
    coords: [centerX - nx * half, centerY - ny * half, centerX + nx * half, centerY + ny * half],
    matrix: place,
    ...(spec.turnsWithShape ? {} : { turnsWithShape: false as const }),
  };
}

/** `outer` after `inner`: the map that applies `inner` first. */
export function compose(outer: AffineMatrix, inner: AffineMatrix): AffineMatrix {
  const [a1, b1, c1, d1, e1, f1] = outer;
  const [a2, b2, c2, d2, e2, f2] = inner;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Flip, then turn clockwise about the centre of a `width` x `height` box. */
export function shapeAffine(
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean,
  rotationDegrees: number
): AffineMatrix {
  const flip: AffineMatrix = [
    flipH ? -1 : 1,
    0,
    0,
    flipV ? -1 : 1,
    flipH ? width : 0,
    flipV ? height : 0,
  ];
  if (rotationDegrees === 0) return flip;
  const radians = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  const turn: AffineMatrix = [
    cos,
    sin,
    -sin,
    cos,
    cx - cos * cx + sin * cy,
    cy - sin * cx - cos * cy,
  ];
  return compose(turn, flip);
}

/** A gradient whose stops blend toward black or white, for darkened and lightened faces. */
export function shadeGradient(
  gradient: VectorGradient,
  shade: (color: ShapeColor) => ShapeColor
): VectorGradient {
  return {
    ...gradient,
    stops: gradient.stops.map((stop) => {
      const shaded = shade({ hex: stop.hex, alpha: stop.alpha });
      return { offset: stop.offset, hex: shaded.hex, alpha: shaded.alpha };
    }),
  };
}
