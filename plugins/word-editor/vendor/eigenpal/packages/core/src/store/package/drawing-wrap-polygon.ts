// `wp:wrapPolygon` coordinates of a tight or through wrap.
//
// A compatibility branch (an `mc:Choice` drawing) parses generic, so its polygon arrives as
// plain `wp:wrapPolygon`, `wp:start` and `wp:lineTo` nodes rather than typed kinds. Both forms
// carry the same authored contour.
import {
  DRAWING_WRAP_POLYGON_MAX_POINTS,
  ST_COORDINATE_MAX,
  ST_COORDINATE_MIN,
  schemaAttributeValue,
} from './ooxml-drawing-rules.ts';
import { isElement, type WalkState } from './drawing-projection-walk.ts';
import { WP_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from './ooxml-tree.ts';

const generic = (node: OoxmlElement, localName: string): boolean =>
  node.kind === 'generic' && node.namespaceUri === WP_NAMESPACE_URI && node.localName === localName;

const isPoint = (node: OoxmlElement): boolean =>
  node.kind === 'drawingWrapPolygonStart' ||
  node.kind === 'drawingWrapPolygonLineTo' ||
  generic(node, 'start') ||
  generic(node, 'lineTo');

/** Signed ST_Coordinate for wp:wrapPolygon x/y — full schema range. */
function parseWrapPolygonCoordinate(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < ST_COORDINATE_MIN || parsed > ST_COORDINATE_MAX) return null;
  return parsed;
}

export function readWrapPolygon(
  wrap: OoxmlElement,
  state: WalkState,
  nodeId: string
): readonly Readonly<{ x: number; y: number }>[] {
  const children: readonly OoxmlNode[] = wrap.children;
  const polygon = children.find(
    (child): child is OoxmlElement =>
      isElement(child) && (child.kind === 'drawingWrapPolygon' || generic(child, 'wrapPolygon'))
  );
  if (!polygon) return Object.freeze([]);
  let pointCount = 0;
  for (const child of polygon.children) {
    if (!isElement(child)) continue;
    if (!isPoint(child)) continue;
    pointCount += 1;
  }
  if (pointCount > DRAWING_WRAP_POLYGON_MAX_POINTS) {
    state.diagnostics.push({
      code: 'wrap-polygon-over-limit',
      nodeId,
      detail: String(pointCount),
    });
    return Object.freeze([]);
  }
  const points: Readonly<{ x: number; y: number }>[] = [];
  let malformed = false;
  for (const child of polygon.children) {
    if (!isElement(child)) continue;
    if (!isPoint(child)) continue;
    const x = parseWrapPolygonCoordinate(schemaAttributeValue(child.attributes, 'x'));
    const y = parseWrapPolygonCoordinate(schemaAttributeValue(child.attributes, 'y'));
    if (x === null || y === null) {
      malformed = true;
      continue;
    }
    points.push(Object.freeze({ x, y }));
  }
  if (malformed || points.length < 3) {
    state.diagnostics.push({
      code: 'wrap-polygon-malformed',
      nodeId,
      detail: malformed ? 'invalid-coordinate' : 'insufficient-points',
    });
    return Object.freeze([]);
  }
  return Object.freeze(points);
}
