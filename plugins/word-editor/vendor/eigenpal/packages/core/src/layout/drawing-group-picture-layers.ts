// The picture members of a drawing group after its first one.
//
// A group's first picture is the drawing record's own image (`resource`, `crop`, and
// `geometry.imageTransformCorners`). Every later picture is a layer: its own resource, crop,
// and frame inside the extent. Layers paint in document order above the first picture and
// below the group's vector members. Each resolves through the same resource path as the
// first picture, keyed by its relationship.

import type { DrawingPoint } from './drawing-geometry.ts';
import { framedTokenJoin } from './framed-token.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from './drawing-layout.ts';
import type {
  DrawingProjection,
  GroupPictureProjection,
  SourceCrop,
} from '../store/package/drawing-projection.ts';
import type { ImageResourceState } from '../store/package/image-resources.ts';

/** One picture member of a drawing group after the first, as a drawing record holds it. */
export interface DrawingGroupPictureLayerRecord {
  /** The picture's own image resource, resolved like the record's `resource`. */
  readonly resource: ImageResourceState;
  /** The picture's own `a:srcRect` crop, as fractions of the image. */
  readonly crop: SourceCrop;
  /**
   * The picture's frame as fractions of the drawing extent, which is
   * `geometry.contentBounds` of the record.
   */
  readonly frameUnit: Readonly<{ x: number; y: number; width: number; height: number }>;
}

/**
 * The layout token of one group picture. Length-framed: relationship ids are verbatim file
 * values, so a printable separator would let two different pictures share one token.
 */
export function groupPictureLayoutToken(picture: GroupPictureProjection): string {
  return framedTokenJoin([
    String(picture.crop.left),
    String(picture.crop.top),
    String(picture.crop.right),
    String(picture.crop.bottom),
    `${picture.frameEmu.x},${picture.frameEmu.y}`,
    `${picture.frameEmu.cx},${picture.frameEmu.cy}`,
    picture.embeddedRelationshipId ?? '',
    picture.linkedRelationshipId ?? '',
    picture.memberNodeId,
    picture.alternateContent ? 'mc' : '',
    picture.clipUnit?.map((point) => `${point.x},${point.y}`).join(' ') ?? '',
  ]);
}

/** The projection that resolves the resource of one layer picture. */
function layerProjection(
  projection: DrawingProjection,
  layer: GroupPictureProjection
): DrawingProjection {
  return { ...projection, groupPicture: layer, groupPictureLayers: undefined };
}

/** The resource of each layer picture, in layer order; undefined for a drawing without one. */
export function groupPictureLayerResources(
  projection: DrawingProjection,
  resourceOf: (projection: DrawingProjection) => ImageResourceState
): readonly ImageResourceState[] | undefined {
  const layers = projection.groupPictureLayers;
  if (!layers || layers.length === 0) return undefined;
  return Object.freeze(layers.map((layer) => resourceOf(layerProjection(projection, layer))));
}

/** The `groupPictureLayers` field of a drawing record; empty for a drawing without one. */
export function groupPictureLayerFields(
  projection: DrawingProjection,
  resources: readonly ImageResourceState[] | undefined
): { readonly groupPictureLayers?: readonly DrawingGroupPictureLayerRecord[] } {
  const layers = projection.groupPictureLayers;
  if (!layers || layers.length === 0 || !resources || resources.length !== layers.length) {
    return {};
  }
  const extent = projection.extentEmu;
  if (!(extent.cx > 0 && extent.cy > 0)) return {};
  return {
    groupPictureLayers: Object.freeze(
      layers.map((layer, index) =>
        Object.freeze({
          resource: resources[index]!,
          crop: layer.crop,
          frameUnit: Object.freeze({
            x: layer.frameEmu.x / extent.cx,
            y: layer.frameEmu.y / extent.cy,
            width: layer.frameEmu.cx / extent.cx,
            height: layer.frameEmu.cy / extent.cy,
          }),
        })
      )
    ),
  };
}

/**
 * The record that paints one layer picture alone: the layer's resource and crop, with its
 * frame as the image corners, no vector members, no link, and no other layers. Every output
 * paints a layer through its ordinary group picture path with this record.
 *
 * @internal
 */
export function groupPictureLayerDrawing<D extends InlineDrawingRecord | AnchoredDrawingRecord>(
  drawing: D,
  layer: DrawingGroupPictureLayerRecord
): D {
  const box = drawing.geometry.contentBounds;
  const left = box.x + layer.frameUnit.x * box.width;
  const top = box.y + layer.frameUnit.y * box.height;
  const right = left + layer.frameUnit.width * box.width;
  const bottom = top + layer.frameUnit.height * box.height;
  const corners: readonly DrawingPoint[] = Object.freeze([
    Object.freeze({ x: left, y: top }),
    Object.freeze({ x: right, y: top }),
    Object.freeze({ x: right, y: bottom }),
    Object.freeze({ x: left, y: bottom }),
  ]);
  const layered: D = {
    ...drawing,
    resource: layer.resource,
    crop: layer.crop,
    // The record's own image already carries the group's link over the whole extent.
    hyperlinkHref: null,
    vectorShape: null,
    groupPictureLayers: undefined,
    geometry: Object.freeze({ ...drawing.geometry, imageTransformCorners: corners }),
  };
  return Object.freeze(layered);
}
