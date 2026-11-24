// Text box members of one `wpg:wgp` drawing group.
//
// A member's `a:xfrm` places it in the group's child space (`chOff`/`chExt`); the group
// extent scales that space. The member's story lays out in the SCALED member box: insets and
// run sizes stay as authored, so a scaled group wraps its text at the member's painted width.
// The projection reads only the bounded group frame and the members' own properties; it never
// walks a story, so the per-drawing element budget is not spent on paragraphs.

import { groupFillOf } from './drawing-group-fill.ts';
import { groupMemberPlacement } from './drawing-group-transform.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';
import { shapeTransformElement } from './drawing-shape-transform.ts';
import {
  MAX_GROUP_SHAPE_CHILDREN,
  isGroupPropertyChild,
  readDrawingGroupFrame,
  schemaFlagIsSet,
  schemaFlagIsUnset,
} from './drawing-group-frame.ts';
import type { DrawingProjection } from './drawing-projection.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  childTransform,
  findDirectChild,
  isUnpaintedGroupTextbox,
  projectWspTextboxStory,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type TextboxStoryProjection,
} from './drawing-shape-projection.ts';
import {
  collapseSchemaWhitespace,
  schemaAttributeValue,
  WPS_NAMESPACE_URI,
} from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';

/** One text box member of a drawing group. @internal */
export interface GroupTextboxProjection {
  /** Canonical node id of the member `wps:wsp`; namespaces the story's line ids. */
  readonly memberNodeId: string;
  /** The member box in the group's extent space, in EMU (origin at the extent's top-left). */
  readonly frameEmu: Readonly<{ x: number; y: number; cx: number; cy: number }>;
  /** The member's story, projected at the scaled member size. */
  readonly story: TextboxStoryProjection;
  /**
   * Clockwise turn of the member's text about the member box center, in degrees [0, 360):
   * the member's `rot`, plus 180 for `flipV`. `flipH` never mirrors the text.
   */
  readonly rotationDegrees: number;
}

/** EMU-free angle units of `ST_Angle`: 60000 per degree. */
const ANGLE_UNITS_PER_DEGREE = 60_000;
/** `ST_Angle` is an `xsd:int`. */
const XSD_INT_MAX = 2_147_483_647;

/**
 * The clockwise turn of a member's text, or null when its transform is schema-invalid.
 *
 * The text keeps its reading direction under `flipH` and turns upside down under `flipV`, so
 * a flip adds either nothing or a half turn to the authored rotation.
 */
export function memberTextRotation(member: OoxmlElement): number | null {
  const spPr = findDirectChild(member.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const xfrm = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'xfrm',
      })
    : null;
  if (!xfrm) return 0;
  const flipH = schemaAttributeValue(xfrm.attributes, 'flipH');
  const flipV = schemaAttributeValue(xfrm.attributes, 'flipV');
  for (const flag of [flipH, flipV]) {
    if (!schemaFlagIsUnset(flag) && !schemaFlagIsSet(flag)) return null;
  }
  const raw = schemaAttributeValue(xfrm.attributes, 'rot');
  let degrees = 0;
  if (raw !== undefined) {
    const collapsed = collapseSchemaWhitespace(raw);
    // Bounded digit count: `rot` is an xsd:int and only scales an angle here.
    if (!/^[+-]?\d{1,12}$/.test(collapsed)) return null;
    const units = Number(collapsed);
    if (units < -XSD_INT_MAX - 1 || units > XSD_INT_MAX) return null;
    degrees = units / ANGLE_UNITS_PER_DEGREE;
  }
  if (schemaFlagIsSet(flipV)) degrees += 180;
  const turned = ((degrees % 360) + 360) % 360;
  return Number.isFinite(turned) ? turned : null;
}

/** The `w:txbxContent` root of a `wps:wsp`, or null when it holds no story. */
function storyRootOf(wsp: OoxmlElement): OoxmlElement | null {
  const txbx = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'txbx',
  });
  return txbx
    ? findDirectChild(txbx.children, { namespaceUri: WML_NAMESPACE_URI, localName: 'txbxContent' })
    : null;
}

/**
 * The story roots of a group's text box members, in document order, for read-only
 * derivations such as Find. A bounded read of the group frame and its direct members only.
 */
export function groupTextboxContents(anchor: OoxmlElement): readonly OoxmlElement[] {
  const frame = readDrawingGroupFrame(anchor);
  if (!frame) return [];
  const roots: OoxmlElement[] = [];
  let count = 0;
  for (const child of frame.group.children) {
    if (!isElement(child) || isGroupPropertyChild(child)) continue;
    count += 1;
    if (count > MAX_GROUP_SHAPE_CHILDREN) return [];
    if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') continue;
    if (memberTextRotation(child) === null) continue;
    const root = storyRootOf(child);
    if (root) roots.push(root);
  }
  return roots;
}

/**
 * The text box members of a group drawing, in document order.
 *
 * A group paints whole or not at all, so its member text follows the group: `groupPaints`
 * says whether the rest of the group paints. A group whose only members are text boxes
 * without fill or outline has nothing else to paint, and its text alone still renders.
 * A rotated or flipped member lays out upright and records the turn its text takes. Null
 * when no member contributes text.
 */
export function projectGroupTextboxes(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  groupPaints: boolean,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): readonly GroupTextboxProjection[] | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const frame = readDrawingGroupFrame(anchor);
  if (!frame) return null;
  const { cx: chExtX, cy: chExtY } = frame.childExtentEmu;
  const scaleX = chExtX > 0 ? extent.cx / chExtX : 0;
  const scaleY = chExtY > 0 ? extent.cy / chExtY : 0;
  const members: GroupTextboxProjection[] = [];
  let count = 0;
  let onlyUnpaintedText = true;
  const groupFill = groupFillOf(frame.group, null);
  for (const child of frame.group.children) {
    if (!isElement(child) || isGroupPropertyChild(child)) continue;
    count += 1;
    if (count > MAX_GROUP_SHAPE_CHILDREN) return null;
    if (
      !isUnpaintedGroupTextbox(child, resolveSchemeColor, resolveStyleMatrixReference, groupFill)
    ) {
      onlyUnpaintedText = false;
    }
    if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') continue;
    const rotationDegrees = memberTextRotation(child);
    if (rotationDegrees === null) continue;
    const transform = childTransform(child);
    if (!transform) continue;
    // The text lays out in the box the member's shape paints in: a turned member's box maps
    // into the group extent before it turns.
    const place = groupMemberPlacement(
      transform,
      frame.childOffsetEmu,
      scaleX,
      scaleY,
      shapeRotationDegrees(shapeTransformElement(child)) ?? 0
    );
    const cx = Math.round(place.extent.cx * place.scaleX);
    const cy = Math.round(place.extent.cy * place.scaleY);
    const story = projectWspTextboxStory(
      child,
      { cx, cy },
      resolveSchemeColor,
      resolveStyleMatrixReference
    );
    if (!story) continue;
    members.push(
      Object.freeze({
        memberNodeId: child.id,
        frameEmu: Object.freeze({
          x: Math.round(place.offset.x),
          y: Math.round(place.offset.y),
          cx,
          cy,
        }),
        story: Object.freeze({ ...story, insetsEmu: Object.freeze({ ...story.insetsEmu }) }),
        rotationDegrees,
      })
    );
  }
  if (members.length === 0 || !(groupPaints || onlyUnpaintedText)) return null;
  return Object.freeze(members);
}

/** The `groupTextboxes` field of a drawing projection: present only when a member has text. */
export function groupTextboxesField(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  painted: Pick<DrawingProjection, 'picture' | 'groupPicture' | 'vectorShape'>,
  ctx: Readonly<{
    resolveSchemeColor?: ShapeSchemeColorResolver;
    resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
  }>
): { readonly groupTextboxes?: readonly GroupTextboxProjection[] } {
  if (painted.picture) return {};
  const groupTextboxes = projectGroupTextboxes(
    anchor,
    extent,
    painted.groupPicture !== null || painted.vectorShape !== null,
    ctx.resolveSchemeColor,
    ctx.resolveStyleMatrixReference
  );
  return groupTextboxes ? { groupTextboxes } : {};
}

/** Whether a projection hosts a text-box story of its own or in a group member. */
export function hostsTextboxStory(projection: DrawingProjection | null | undefined): boolean {
  return !!projection && (projection.textboxStory !== null || !!projection.groupTextboxes);
}
