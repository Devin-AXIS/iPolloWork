// A shape filled with a picture (`a:blipFill` in `wps:spPr`): the picture stretches over the
// shape's box, clipped to its geometry, and the shape's outline paints over it. It reuses the
// group picture path, so the image resolves through the same bounded resource path as any
// picture.

import { identityPictureStretch } from './drawing-group-picture-admission.ts';
import type { GroupPictureProjection } from './drawing-group-picture.ts';
import { schemaAngleIsZero } from './drawing-group-frame.ts';
import { isElement } from './drawing-projection-walk.ts';
import { readShapeGeometry } from './drawing-shape-geometry.ts';
import { findDirectChild, parseCropPercent } from './drawing-shape-readers.ts';
import { findWspInAnchor } from './drawing-shape-projection.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  type OoxmlElement,
} from './ooxml-tree.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);
/** A clip ring with more points than this keeps the picture's box. */
const MAX_CLIP_POINTS = 1024;

function relationship(blip: OoxmlElement, localName: 'embed' | 'link'): string | null {
  for (const attribute of blip.attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI)
      return attribute.value;
  }
  return null;
}

/**
 * The picture a top-level shape is filled with, as a group picture over the whole extent, or
 * null when the shape has no picture fill or one outside the painted subset: a tiled or
 * offset fill, a blip with effects, a turned or flipped shape, or a shape that holds text.
 */
export function readShapePictureFill(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): GroupPictureProjection | null {
  if (!(extent.cx > 0 && extent.cy > 0)) return null;
  const wsp = findWspInAnchor(anchor);
  if (!wsp || findDirectChild(wsp.children, { namespaceUri: WPS_NAMESPACE_URI, localName: 'txbx' }))
    return null;
  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const fill = spPr?.children.find(
    (node) => isElement(node) && node.namespaceUri === A && FILLS.has(node.localName)
  );
  if (!spPr || !fill || !isElement(fill) || fill.localName !== 'blipFill') return null;
  const blip = findDirectChild(fill.children, { namespaceUri: A, localName: 'blip' });
  if (!blip || findDirectChild(fill.children, { namespaceUri: A, localName: 'tile' })) return null;
  if (
    !identityPictureStretch(
      findDirectChild(fill.children, { namespaceUri: A, localName: 'stretch' })
    )
  )
    return null;
  const blipEffect = blip.children.some(
    (child) => isElement(child) && !(child.namespaceUri === A && child.localName === 'extLst')
  );
  if (blipEffect) return null;
  const embeddedRelationshipId = relationship(blip, 'embed');
  const linkedRelationshipId = relationship(blip, 'link');
  if (embeddedRelationshipId === null && linkedRelationshipId === null) return null;
  const xfrm = findDirectChild(spPr.children, { namespaceUri: A, localName: 'xfrm' });
  if (xfrm) {
    if (!schemaAngleIsZero(schemaAttributeValue(xfrm.attributes, 'rot'))) return null;
    for (const flip of ['flipH', 'flipV']) {
      const value = schemaAttributeValue(xfrm.attributes, flip);
      if (value !== undefined && value !== '0' && value !== 'false') return null;
    }
  }
  const srcRect = findDirectChild(fill.children, { namespaceUri: A, localName: 'srcRect' });
  const cropEdge = (name: string): number =>
    srcRect ? parseCropPercent(schemaAttributeValue(srcRect.attributes, name)) : 0;
  const clipUnit = clipRingOf(spPr, extent);
  return Object.freeze({
    embeddedRelationshipId,
    linkedRelationshipId,
    crop: Object.freeze({
      left: cropEdge('l'),
      top: cropEdge('t'),
      right: cropEdge('r'),
      bottom: cropEdge('b'),
    }),
    frameEmu: Object.freeze({ x: 0, y: 0, cx: extent.cx, cy: extent.cy }),
    memberNodeId: wsp.id,
    alternateContent: false,
    ...(clipUnit ? { clipUnit } : {}),
  });
}

/** The shape's one filled outline in the unit square of its extent; null for a rectangle. */
function clipRingOf(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>
): readonly Readonly<{ x: number; y: number }>[] | null {
  const geometry = readShapeGeometry(spPr, extent);
  if (!geometry) return null;
  const outlines = geometry.paths
    .filter((path) => path.fill !== 'none')
    .flatMap((path) => path.subpaths);
  if (outlines.length !== 1) return null;
  const points = outlines[0]!.points;
  if (points.length < 3 || points.length > MAX_CLIP_POINTS) return null;
  const ring = points.map((point) =>
    Object.freeze({ x: point.x / extent.cx, y: point.y / extent.cy })
  );
  const rectangle =
    ring.length === 4 &&
    ring.every((point) => (point.x === 0 || point.x === 1) && (point.y === 0 || point.y === 1));
  return rectangle ? null : Object.freeze(ring);
}
