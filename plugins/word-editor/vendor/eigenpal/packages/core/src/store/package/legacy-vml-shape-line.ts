import type { OoxmlElement } from './ooxml-tree.ts';
import type { LegacyLineEnds } from './legacy-vml-shapes.ts';
import { attribute, numeric, pair, points, coordOrigin } from './legacy-vml-values.ts';

interface ShapeLineGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ends: LegacyLineEnds;
}

/** Read a floating shape path with two points and one zero extent. Keep all source XML. */
export function shapeLineGeometry(
  node: OoxmlElement,
  style: ReadonlyMap<string, string>,
  floating: boolean
): ShapeLineGeometry | null | undefined {
  if (node.localName !== 'shape' || !floating) return undefined;
  const width = points(style.get('width')),
    height = points(style.get('height'));
  // A connector that draws its template line is a line at any size; another shape is a line
  // only when one side has no extent.
  const connector = attribute(node, 'type') === '#_x0000_t32' && !attribute(node, 'path');
  if (width !== 0 && height !== 0 && !connector) return undefined;
  if (![width, height].every((value) => Number.isFinite(value) && value >= 0 && value <= 10_000))
    return null;
  if (width + height === 0) return null;
  // A straight connector draws its template's path (`m,l21600,21600e`, its zeros written out
  // here): from the top-left to the bottom-right corner.
  const path =
    attribute(node, 'path') ??
    (attribute(node, 'type') === '#_x0000_t32' ? 'm0,0l21600,21600e' : undefined);
  if (!path || path.length > 256) return null;
  const flip = (style.get('flip') ?? '').trim().split(/\s+/).filter(Boolean);
  if (flip.some((axis) => axis !== 'x' && axis !== 'y')) return null;
  const tokens = path.match(/[mle]|-?(?:\d+(?:\.\d*)?|\.\d+)/gi) ?? [];
  if (
    tokens.length !== 7 ||
    tokens.join('').toLowerCase() !== path.replace(/[,\s]/g, '').toLowerCase() ||
    tokens[0]?.toLowerCase() !== 'm' ||
    tokens[3]?.toLowerCase() !== 'l' ||
    tokens[6]?.toLowerCase() !== 'e'
  )
    return null;
  const values = [tokens[1], tokens[2], tokens[4], tokens[5]].map(numeric);
  const size = pair(attribute(node, 'coordsize') ?? '21600,21600'),
    origin = coordOrigin(attribute(node, 'coordorigin') ?? '0,0');
  if (!size || !origin || !values.every(Number.isFinite) || size.some((value) => value < 0))
    return null;
  for (const axis of [0, 1]) {
    if (size[axis] === 0 && (values[axis] !== origin[axis] || values[axis + 2] !== origin[axis]))
      return null;
  }
  // A flip mirrors the path inside its box.
  const scale = (x: number, y: number): readonly [number, number] => {
    const px = ((x - origin[0]) * width) / (size[0] || 1),
      py = ((y - origin[1]) * height) / (size[1] || 1);
    return Object.freeze([
      flip.includes('x') ? width - px : px,
      flip.includes('y') ? height - py : py,
    ]);
  };
  const ends = Object.freeze([
    scale(values[0]!, values[1]!),
    scale(values[2]!, values[3]!),
  ]) as LegacyLineEnds;
  if (!ends.flat().every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000))
    return null;
  if (ends[0][0] === ends[1][0] && ends[0][1] === ends[1][1]) return null;
  return Object.freeze({ x: 0, y: 0, width, height, ends });
}
