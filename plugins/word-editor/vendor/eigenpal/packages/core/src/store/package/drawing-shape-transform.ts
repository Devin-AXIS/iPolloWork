// The transform a DrawingML shape carries in `a:xfrm`: its offset and extent inside a group,
// its turn and flips, and the projection of a shape with no extent at all.

import { parseEmu, findDirectChild, readSize } from './drawing-shape-readers.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { schemaFlagIsSet, schemaFlagIsUnset } from './drawing-group-frame.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import type { VectorShapeProjection } from './drawing-shape-projection.ts';

/** The shape's `spPr`, in its own namespace: `wps:spPr`, or `dsp:spPr` in a diagram drawing. */
export function shapeProperties(wsp: OoxmlElement): OoxmlElement | null {
  return findDirectChild(wsp.children, { namespaceUri: wsp.namespaceUri, localName: 'spPr' });
}

/** The `a:xfrm` of a shape's `spPr`, or null. */
export function shapeTransformElement(wsp: OoxmlElement): OoxmlElement | null {
  const spPr = shapeProperties(wsp);
  return spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'xfrm',
      })
    : null;
}

/** Whether `flipH` and `flipV` on `xfrm` are absent or schema-valid booleans. */
export function shapeFlagsValid(xfrm: OoxmlElement | null): boolean {
  if (!xfrm) return true;
  return ['flipH', 'flipV'].every((name) => {
    const value = schemaAttributeValue(xfrm.attributes, name);
    return schemaFlagIsUnset(value) || schemaFlagIsSet(value);
  });
}

/**
 * A group child's offset and extent. A straight vertical or horizontal line has zero width or
 * height, so a zero axis is valid. The child's own geometry checks still decide whether it
 * paints. A negative extent is invalid and refuses.
 */
export function childTransform(wsp: OoxmlElement): {
  readonly offset: Readonly<{ x: number; y: number }>;
  readonly extent: Readonly<{ cx: number; cy: number }>;
} | null {
  const xfrm = shapeTransformElement(wsp);
  const off = xfrm
    ? findDirectChild(xfrm.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'off',
      })
    : null;
  const ext = xfrm
    ? findDirectChild(xfrm.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'ext',
      })
    : null;
  const cx = ext ? readSize(schemaAttributeValue(ext.attributes, 'cx'), null) : null;
  const cy = ext ? readSize(schemaAttributeValue(ext.attributes, 'cy'), null) : null;
  if (cx === null || cy === null) return null;
  return {
    offset: {
      x: off ? (parseEmu(schemaAttributeValue(off.attributes, 'x'), false) ?? 0) : 0,
      y: off ? (parseEmu(schemaAttributeValue(off.attributes, 'y'), false) ?? 0) : 0,
    },
    extent: { cx, cy },
  };
}

/**
 * The projection of a shape with no width and no height: it paints nothing, turned or not,
 * not even the caps of its outline, and keeps a point-sized frame, so it stays selectable.
 * Null when its `spPr`, turn or flips are invalid.
 */
export function zeroExtentShapeProjection(wsp: OoxmlElement): VectorShapeProjection | null {
  if (!shapeProperties(wsp)) return null;
  const xfrm = shapeTransformElement(wsp);
  const rotationDegrees = shapeRotationDegrees(xfrm);
  if (rotationDegrees === null || !shapeFlagsValid(xfrm)) return null;
  return {
    extentEmu: { cx: 0, cy: 0 },
    subpathsEmu: [],
    fillHex: null,
    fillAlpha: 1,
    strokeHex: null,
    strokeAlpha: 1,
    strokeWidthEmu: 0,
    components: [],
    ...(rotationDegrees !== 0 ? { rotationDegrees } : {}),
  };
}
