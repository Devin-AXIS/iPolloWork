// A legacy shape drawn by its own straight-segment path (`v:shape/@path`), as a vector shape.
//
// Converted documents draw rules, frames and table lines this way: a shape with no template
// whose path moves and draws straight lines in the shape's coordinate space. A curve, an arc
// or a formula reference stays outside this reader, and the shape keeps its other route.

import type { VectorShapeProjection } from './drawing-shape-projection.ts';
import { freezeVectorShapeComponent } from './drawing-vector-freeze.ts';
import { vmlPolygonPath } from './legacy-vml-formulas.ts';
import { inkComponents, legacyInk, type LegacyBox } from './legacy-vml-shapes.ts';
import { attribute as a, children, named, pair, VML, coordOrigin } from './legacy-vml-values.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

const EMU_PER_POINT = 12_700;

/**
 * The vector shape of a template-free `v:shape` whose path draws only straight segments, in a
 * drawing extent of `outer` with the shape at `box` (points). Null for any other shape.
 */
export function legacyPathShape(
  node: OoxmlElement,
  box: LegacyBox,
  outer: LegacyBox
): VectorShapeProjection | null {
  if (!named(node, VML, 'shape') || a(node, 'type') !== undefined) return null;
  const path = a(node, 'path');
  if (!path || children(node).some((child) => named(child, VML, 'formulas'))) return null;
  const polygons = vmlPolygonPath(path, []);
  if (!polygons || polygons.length === 0) return null;
  const origin = coordOrigin(a(node, 'coordorigin') ?? '0,0'),
    size = pair(a(node, 'coordsize') ?? '21600,21600');
  if (!origin || !size || size.some((value) => value < 0)) return null;
  // An axis of no size draws on its origin, as a straight rule does.
  const scale = (value: number, axis: 0 | 1) =>
    size[axis] === 0 ? 0 : ((value - origin[axis]) * (axis ? box.height : box.width)) / size[axis];
  const closed = polygons.map((polygon) => polygon.closed);
  const ink = legacyInk(node, !closed.some(Boolean));
  if (!ink) return null;
  const subpaths = polygons.map((polygon) =>
    polygon.points.map((point) =>
      Object.freeze({
        x: Math.round((box.x + scale(point.x, 0)) * EMU_PER_POINT),
        y: Math.round((box.y + scale(point.y, 1)) * EMU_PER_POINT),
      })
    )
  );
  if (subpaths.flat().some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    return null;
  const stroked = ink.stroke !== 'none' && ink.weight > 0;
  const fillHex =
    ink.fill === 'none' || !closed.some(Boolean) ? null : ink.fill.slice(1).toUpperCase();
  const strokeHex = stroked ? ink.stroke.slice(1).toUpperCase() : null;
  if (fillHex === null && strokeHex === null) return null;
  const component = freezeVectorShapeComponent({
    subpathsEmu: subpaths,
    subpathsClosed: closed,
    fillHex,
    fillAlpha: 1,
    strokeHex,
    strokeAlpha: 1,
    strokeWidthEmu: stroked ? Math.round(ink.weight * EMU_PER_POINT) : 0,
  });
  return Object.freeze({
    extentEmu: Object.freeze({
      cx: Math.round(outer.width * EMU_PER_POINT),
      cy: Math.round(outer.height * EMU_PER_POINT),
    }),
    subpathsEmu: component.subpathsEmu,
    fillHex,
    fillAlpha: 1,
    strokeHex,
    strokeAlpha: 1,
    strokeWidthEmu: component.strokeWidthEmu,
    components: Object.freeze(inkComponents(component, ink)),
  });
}
