import { identityGroupThemeEffect } from './drawing-group-theme-effects.ts';
import { groupFillOf } from './drawing-group-fill.ts';
import {
  identityPictureStretch,
  supportedPictureProperties,
  visiblePictureMember,
} from './drawing-group-picture-admission.ts';
// The picture member of a `wpg:wgp` drawing group. A group can hold a raster picture beside
// its vector members, for example a scanned page with ruled lines drawn over it. The vector
// projection paints `wps:wsp` members only, so without this read the whole group painted
// nothing. The picture keeps its own frame inside the group extent and resolves through the
// same bounded image resource path as a top-level picture.

import {
  isGroupPropertyChild,
  MAX_GROUP_SHAPE_CHILDREN,
  readDrawingGroupFrame,
  schemaAngleIsZero,
  schemaFlagIsUnset,
} from './drawing-group-frame.ts';
import { isElement } from './drawing-projection-walk.ts';
import { findDirectChild, parseCropPercent, parseEmu } from './drawing-shape-readers.ts';
import {
  isUnpaintedGroupTextbox,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  type OoxmlElement,
} from './ooxml-tree.ts';

/** One picture painted as a member of a drawing group. */
export interface GroupPictureProjection {
  readonly embeddedRelationshipId: string | null;
  readonly linkedRelationshipId: string | null;
  readonly crop: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  /** The picture's rectangle inside the drawing extent, in extent EMU. */
  readonly frameEmu: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  /** Canonical node id of the `pic:pic` member. The vector projection skips it. */
  readonly memberNodeId: string;
  /**
   * Whether the group is the chosen branch of a run-level `mc:AlternateContent`. Layout then
   * drops the whole group when the picture resource fails, as the projection drops other
   * MC payloads it cannot draw.
   */
  readonly alternateContent: boolean;
  /** The ring that clips the picture, in the unit square of the extent; absent for a box. */
  readonly clipUnit?: readonly Readonly<{ x: number; y: number }>[];
}

/** Whether a point, in extent EMU, lies within one extent of the drawing on every side. */
function withinGroupReach(
  x: number,
  y: number,
  extent: Readonly<{ cx: number; cy: number }>
): boolean {
  return x >= -extent.cx && x <= 2 * extent.cx && y >= -extent.cy && y <= 2 * extent.cy;
}

/**
 * Whether a member frame, in extent EMU, has a visible part inside the extent and stays
 * within one extent of it on every side.
 *
 * Paint clips the picture to the extent, so a frame outside it has no visible pixels. The
 * outer bound keeps a file-supplied offset or a tiny `a:chExt` from scaling the frame into
 * coordinates that no output can represent: the frame never reaches farther than three
 * times the drawing's own extent.
 */
function memberFrameIsBounded(
  frame: Readonly<{ x: number; y: number; cx: number; cy: number }>,
  extent: Readonly<{ cx: number; cy: number }>
): boolean {
  const right = frame.x + frame.cx;
  const bottom = frame.y + frame.cy;
  if (!(frame.x < extent.cx && frame.y < extent.cy && right > 0 && bottom > 0)) return false;
  return withinGroupReach(frame.x, frame.y, extent) && withinGroupReach(right, bottom, extent);
}

/**
 * The same outer bound for the vector members of a group that holds a picture. A picture
 * makes such a group visible, so its members must not carry an offset or a stroke that the
 * outputs cannot represent either. A stroke may be at most as wide as the drawing.
 */
export function groupVectorMembersAreBounded(
  shape: VectorShapeProjection,
  extent: Readonly<{ cx: number; cy: number }>
): boolean {
  for (const component of shape.components) {
    const stroked = component.strokeHex !== null;
    if (stroked && !(component.strokeWidthEmu <= Math.max(extent.cx, extent.cy))) return false;
    for (const paths of [component.subpathsEmu, component.arrowheadsEmu ?? []]) {
      for (const path of paths) {
        for (const point of path) {
          if (!withinGroupReach(point.x, point.y, extent)) return false;
        }
      }
    }
  }
  return true;
}

export interface GroupPictureRead {
  /** The first picture member, which paints lowest. */
  readonly picture: GroupPictureProjection;
  /** Every picture member in document order, `picture` first. */
  readonly pictures: readonly GroupPictureProjection[];
  /** Whether the group has members other than the pictures that paint. */
  readonly hasOtherMembers: boolean;
}

/**
 * The projection with every group picture marked as the chosen branch of a run-level
 * `mc:AlternateContent`. Layout then drops the whole group when any picture fails.
 */
export function withAlternateContentGroupPictures<
  P extends {
    readonly groupPicture: GroupPictureProjection | null;
    readonly groupPictureLayers?: readonly GroupPictureProjection[];
  },
>(projection: P): P {
  if (!projection.groupPicture) return projection;
  const mark = (picture: GroupPictureProjection): GroupPictureProjection =>
    Object.freeze({ ...picture, alternateContent: true });
  const layers = projection.groupPictureLayers?.map(mark);
  return Object.freeze({
    ...projection,
    groupPicture: mark(projection.groupPicture),
    ...(layers ? { groupPictureLayers: Object.freeze(layers) } : {}),
  });
}

function relationshipId(blip: OoxmlElement, localName: 'embed' | 'link'): string | null {
  for (const attribute of blip.attributes) {
    if (
      attribute.localName === localName &&
      attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
    ) {
      return attribute.value;
    }
  }
  return null;
}

function drawingMl(parent: OoxmlElement, localName: string): OoxmlElement | null {
  return findDirectChild(parent.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName,
  });
}

/**
 * Read the `pic:pic` members of a drawing group, or null to leave the group unpainted.
 *
 * The read accepts only what paint reproduces exactly. Every picture comes before every
 * other painted member, so the pictures paint in document order below them. Each picture
 * passes {@link readPictureMember}. Anything else returns null, and the group keeps its
 * earlier unpainted result. A text box member without fill or outline paints nothing, so it
 * neither counts as another member nor orders the pictures.
 */
export function readGroupPicture(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  resolveSchemeColor?: ShapeSchemeColorResolver
): GroupPictureRead | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const frame = readDrawingGroupFrame(anchor);
  // A picture cannot keep a visible size in a group whose child space is zero on an axis.
  if (!frame || frame.childExtentEmu.cx <= 0 || frame.childExtentEmu.cy <= 0) return null;
  const members: OoxmlElement[] = [];
  let hasOtherMembers = false;
  let count = 0;
  // A text box that says `a:grpFill` paints the group's fill, so it orders the pictures.
  const groupFill = groupFillOf(frame.group, null);
  for (const child of frame.group.children) {
    if (!isElement(child) || isGroupPropertyChild(child)) continue;
    count += 1;
    if (count > MAX_GROUP_SHAPE_CHILDREN) return null;
    if (isUnpaintedGroupTextbox(child, resolveSchemeColor, resolveStyleMatrixReference, groupFill))
      continue;
    if (child.namespaceUri === PIC_NAMESPACE_URI && child.localName === 'pic') {
      if (hasOtherMembers) return null;
      members.push(child);
    } else {
      hasOtherMembers = true;
    }
  }
  if (members.length === 0) return null;
  const pictures: GroupPictureProjection[] = [];
  for (const member of members) {
    const picture = readPictureMember(member, frame, extent, resolveStyleMatrixReference);
    if (!picture) return null;
    pictures.push(picture);
  }
  return { picture: pictures[0]!, pictures: Object.freeze(pictures), hasOtherMembers };
}

/**
 * One `pic:pic` member, or null when paint cannot reproduce it exactly.
 *
 * The picture is not rotated or flipped. It has a rectangle geometry, a fill that is not
 * tiled, and no blip effects. Its frame has a visible part inside the group extent and stays
 * within the bounds of {@link memberFrameIsBounded}.
 */
function readPictureMember(
  picture: OoxmlElement,
  frame: NonNullable<ReturnType<typeof readDrawingGroupFrame>>,
  extent: Readonly<{ cx: number; cy: number }>,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): GroupPictureProjection | null {
  if (!identityGroupThemeEffect(picture, resolveStyleMatrixReference)) return null;
  const nonVisual = findDirectChild(picture.children, {
    namespaceUri: PIC_NAMESPACE_URI,
    localName: 'nvPicPr',
  });
  const pictureInfo = nonVisual
    ? findDirectChild(nonVisual.children, { namespaceUri: PIC_NAMESPACE_URI, localName: 'cNvPr' })
    : null;
  if (!visiblePictureMember(pictureInfo)) return null;

  const blipFill = findDirectChild(picture.children, {
    namespaceUri: PIC_NAMESPACE_URI,
    localName: 'blipFill',
  });
  const blip = blipFill ? drawingMl(blipFill, 'blip') : null;
  if (!blipFill || !blip || drawingMl(blipFill, 'tile')) return null;
  if (!identityPictureStretch(drawingMl(blipFill, 'stretch'))) return null;
  const blipEffect = blip.children.some(
    (child) =>
      isElement(child) &&
      !(child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI && child.localName === 'extLst')
  );
  if (blipEffect) return null;
  const embeddedRelationshipId = relationshipId(blip, 'embed');
  const linkedRelationshipId = relationshipId(blip, 'link');
  if (embeddedRelationshipId === null && linkedRelationshipId === null) return null;

  const shapeProperties = findDirectChild(picture.children, {
    namespaceUri: PIC_NAMESPACE_URI,
    localName: 'spPr',
  });
  const xfrm = shapeProperties ? drawingMl(shapeProperties, 'xfrm') : null;
  if (!shapeProperties || !xfrm || !supportedPictureProperties(shapeProperties)) return null;
  if (!schemaAngleIsZero(schemaAttributeValue(xfrm.attributes, 'rot'))) return null;
  if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipH'))) return null;
  if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, 'flipV'))) return null;
  if (drawingMl(shapeProperties, 'custGeom')) return null;
  const preset = drawingMl(shapeProperties, 'prstGeom');
  if (preset && schemaAttributeValue(preset.attributes, 'prst') !== 'rect') return null;
  const offset = drawingMl(xfrm, 'off');
  const size = drawingMl(xfrm, 'ext');
  const cx = size ? parseEmu(schemaAttributeValue(size.attributes, 'cx')) : null;
  const cy = size ? parseEmu(schemaAttributeValue(size.attributes, 'cy')) : null;
  if (cx === null || cy === null || cx <= 0 || cy <= 0) return null;
  const x = offset ? (parseEmu(schemaAttributeValue(offset.attributes, 'x'), false) ?? 0) : 0;
  const y = offset ? (parseEmu(schemaAttributeValue(offset.attributes, 'y'), false) ?? 0) : 0;

  const scaleX = extent.cx / frame.childExtentEmu.cx;
  const scaleY = extent.cy / frame.childExtentEmu.cy;
  const frameEmu = {
    x: (x - frame.childOffsetEmu.x) * scaleX,
    y: (y - frame.childOffsetEmu.y) * scaleY,
    cx: cx * scaleX,
    cy: cy * scaleY,
  };
  if (!memberFrameIsBounded(frameEmu, extent)) return null;
  const srcRect = drawingMl(blipFill, 'srcRect');
  const cropEdge = (name: string): number =>
    srcRect ? parseCropPercent(schemaAttributeValue(srcRect.attributes, name)) : 0;
  return Object.freeze({
    embeddedRelationshipId,
    linkedRelationshipId,
    crop: Object.freeze({
      left: cropEdge('l'),
      top: cropEdge('t'),
      right: cropEdge('r'),
      bottom: cropEdge('b'),
    }),
    frameEmu: Object.freeze(frameEmu),
    memberNodeId: picture.id,
    alternateContent: false,
  });
}
