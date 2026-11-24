// A legacy VML group (`v:group`) as vector members and member text stories, painted as a
// drawing canvas paints: every member is a vector component in the group extent, and each
// member text box lays out as a group member story over its shape.
//
// A group renders whole or not at all here. Beside member text, one member may be a picture,
// which paints as the group's picture. A member outside this subset (a second picture, a cropped one, an unknown
// template) leaves the group to the graphic preview reader.

import { transformComponent } from './drawing-group-transform.ts';
import type { VectorShapeComponent, VectorShapeProjection } from './drawing-shape-projection.ts';
import type { GroupPictureProjection } from './drawing-group-picture.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import { RELATIONSHIPS_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import {
  legacyBoxShape,
  legacyLineShape,
  type LegacyBox,
  type LegacyLineEnds,
} from './legacy-vml-shapes.ts';
import { isStandardVmlTemplate } from './legacy-vml-templates.ts';
import { legacyPathShape } from './legacy-vml-path-shape.ts';
import { legacyTextbox, legacyTextboxStory } from './legacy-vml-textbox.ts';
import {
  attribute as a,
  children,
  named,
  numeric,
  OFFICE,
  pair,
  styleOf,
  VML,
  WORD_VML,
  coordOrigin,
} from './legacy-vml-values.ts';

const EMU_PER_POINT = 12_700;
// Diagrams drawn as one group reach a few hundred members; each paints a component or two.
const MAX_MEMBERS = 512;
const MAX_DEPTH = 8;
const PICTURE_TEMPLATE = '#_x0000_t75';
const LINE_TEMPLATE = '#_x0000_t32';

/** The vector members and member stories of a legacy group. */
export interface LegacyVectorGroup {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
  readonly groupPicture: GroupPictureProjection | null;
}

/** The validated style of a group member, or null when it is outside the subset. */
export type LegacyMemberStyle = (node: OoxmlElement) => ReadonlyMap<string, string> | null;

interface Output {
  readonly components: VectorShapeComponent[];
  readonly texts: GroupTextboxProjection[];
  picture: GroupPictureProjection | null;
  /** How many components were projected before the picture, which paint under it. */
  underPicture: number;
  members: number;
}

/**
 * A picture member: a picture-template shape whose only content is its embedded image, or
 * `undefined` for any other member. Null refuses the group: a second picture, a crop, a link,
 * or anything else on the image.
 */
function pictureMember(
  member: OoxmlElement,
  box: LegacyBox,
  out: Output
): GroupPictureProjection | null | undefined {
  if (member.localName !== 'shape' || a(member, 'type') !== PICTURE_TEMPLATE) return undefined;
  const content = children(member).filter((n) => !named(n, OFFICE, 'lock'));
  const image = content.find((n) => named(n, VML, 'imagedata'));
  if (!image) return undefined;
  const id = image.attributes.find(
    (attr) => attr.localName === 'id' && attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI
  )?.value;
  const plain = image.attributes.every(
    (attr) =>
      (attr.localName === 'id' && attr.namespaceUri === RELATIONSHIPS_NAMESPACE_URI) ||
      (attr.localName === 'title' && attr.namespaceUri === OFFICE)
  );
  if (out.picture || !id || !plain || content.length !== 1) return null;
  return Object.freeze({
    embeddedRelationshipId: id,
    linkedRelationshipId: null,
    crop: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
    frameEmu: Object.freeze({
      x: Math.round(box.x * EMU_PER_POINT),
      y: Math.round(box.y * EMU_PER_POINT),
      cx: Math.round(box.width * EMU_PER_POINT),
      cy: Math.round(box.height * EMU_PER_POINT),
    }),
    memberNodeId: image.id,
    alternateContent: false,
  });
}

/**
 * A picture frame with no picture: the background a canvas group writes first. It takes its
 * template's switched-off fill and outline and paints nothing.
 */
function emptyFrame(node: OoxmlElement): boolean {
  if (node.localName !== 'shape' || a(node, 'type') !== PICTURE_TEMPLATE) return false;
  if (['filled', 'stroked', 'fillcolor', 'strokecolor'].some((key) => a(node, key) !== undefined))
    return false;
  return children(node).every(
    (child) =>
      named(child, OFFICE, 'lock') ||
      (named(child, VML, 'fill') &&
        child.attributes.every(
          (attr) => attr.namespaceUri === OFFICE && attr.localName === 'detectmouseclick'
        ))
  );
}

/** The ends of a straight connector in its own box, mirrored by its flip. */
function connectorEnds(style: ReadonlyMap<string, string>, box: LegacyBox): LegacyLineEnds | null {
  const flip = (style.get('flip') ?? '').trim().split(/\s+/).filter(Boolean);
  if (flip.some((axis) => axis !== 'x' && axis !== 'y')) return null;
  const x0 = flip.includes('x') ? box.width : 0,
    y0 = flip.includes('y') ? box.height : 0;
  return Object.freeze([
    Object.freeze([x0, y0]),
    Object.freeze([box.width - x0, box.height - y0]),
  ]) as LegacyLineEnds;
}

function projectMember(
  member: OoxmlElement,
  style: ReadonlyMap<string, string>,
  box: LegacyBox,
  host: OoxmlElement,
  out: Output
): boolean {
  if (style.get('visibility') === 'hidden') return true;
  const local = { x: 0, y: 0, width: box.width, height: box.height };
  let shape: VectorShapeProjection | null;
  if (member.localName === 'shape' && a(member, 'type') === LINE_TEMPLATE) {
    if (legacyTextbox(member) !== undefined) return false;
    const ends = connectorEnds(style, box);
    shape = ends ? legacyLineShape(member, box.width, box.height, ends) : null;
  } else {
    if (style.has('flip')) return false;
    shape = legacyBoxShape(member, local, local) ?? legacyPathShape(member, local, local);
  }
  if (!shape) return false;
  const origin = { x: box.x * EMU_PER_POINT, y: box.y * EMU_PER_POINT };
  for (const component of shape.components)
    out.components.push(transformComponent(component, origin, 1, 1));
  const textbox = legacyTextbox(member);
  if (textbox === undefined) return true;
  if (textbox === null) return false;
  const story = legacyTextboxStory(member, textbox, style, host, box.width, box.height);
  if (!story) return false;
  out.texts.push(
    Object.freeze({
      memberNodeId: member.id,
      frameEmu: Object.freeze({
        x: Math.round(origin.x),
        y: Math.round(origin.y),
        cx: Math.round(box.width * EMU_PER_POINT),
        cy: Math.round(box.height * EMU_PER_POINT),
      }),
      // The member's shape paints as a vector component; its story paints text only.
      story: Object.freeze({ ...story, fillHex: null, strokeHex: null }),
      rotationDegrees: 0,
    })
  );
  return true;
}

/**
 * A `v:line` member: its `from` and `to` points are in the group's coordinate space, and its
 * box is the one they span.
 */
function projectLine(
  line: OoxmlElement,
  box: LegacyBox,
  origin: readonly [number, number],
  size: readonly [number, number],
  out: Output
): boolean {
  const from = pair(a(line, 'from') ?? ''),
    to = pair(a(line, 'to') ?? '');
  if (!from || !to) return false;
  const place = ([x, y]: readonly [number, number]) =>
    [
      box.x + ((x - origin[0]) * box.width) / size[0],
      box.y + ((y - origin[1]) * box.height) / size[1],
    ] as const;
  const [start, end] = [place(from), place(to)];
  if (![...start, ...end].every((v) => Number.isFinite(v) && Math.abs(v) <= 100_000)) return false;
  if (start[0] === end[0] && start[1] === end[1]) return false;
  const left = Math.min(start[0], end[0]),
    top = Math.min(start[1], end[1]);
  const width = Math.abs(end[0] - start[0]),
    height = Math.abs(end[1] - start[1]);
  // A flip mirrors the line inside the box its points span.
  const flip = (styleOf(line)?.get('flip') ?? '').trim().split(/\s+/).filter(Boolean);
  if (flip.some((axis) => axis !== 'x' && axis !== 'y')) return false;
  const local = ([x, y]: readonly [number, number]) =>
    Object.freeze([
      flip.includes('x') ? width - (x - left) : x - left,
      flip.includes('y') ? height - (y - top) : y - top,
    ]);
  const ends = Object.freeze([local(start), local(end)]) as LegacyLineEnds;
  const shape = legacyLineShape(line, width, height, ends);
  if (!shape) return false;
  const offset = { x: left * EMU_PER_POINT, y: top * EMU_PER_POINT };
  for (const component of shape.components)
    out.components.push(transformComponent(component, offset, 1, 1));
  return true;
}

function projectMembers(
  group: OoxmlElement,
  box: LegacyBox,
  depth: number,
  host: OoxmlElement,
  memberStyle: LegacyMemberStyle,
  out: Output
): boolean {
  const origin = coordOrigin(a(group, 'coordorigin') ?? '0,0'),
    size = pair(a(group, 'coordsize') ?? '21600,21600');
  if (!origin || !size || size.some((v) => v <= 0)) return false;
  for (const child of children(group)) {
    if (named(child, OFFICE, 'lock') || (depth === 0 && named(child, WORD_VML, 'wrap'))) continue;
    // An anchor lock only keeps the drawing on its paragraph while editing.
    if (depth === 0 && named(child, WORD_VML, 'anchorlock') && child.attributes.length === 0)
      continue;
    if (named(child, VML, 'shapetype')) {
      if (!isStandardVmlTemplate(child)) return false;
      continue;
    }
    if (++out.members > MAX_MEMBERS) return false;
    if (
      child.namespaceUri !== VML ||
      !['shape', 'rect', 'roundrect', 'oval', 'line', 'group'].includes(child.localName)
    )
      return false;
    if (emptyFrame(child)) continue;
    const style = memberStyle(child);
    if (!style) return false;
    if (child.localName === 'line') {
      if (!projectLine(child, box, origin, size, out)) return false;
      continue;
    }
    const left = numeric(style.get('left') ?? '0'),
      top = numeric(style.get('top') ?? '0'),
      width = numeric(style.get('width')),
      height = numeric(style.get('height'));
    // A connector, or a shape drawn by its own path, may have no extent on one side.
    const line =
      child.localName === 'shape' &&
      (a(child, 'type') === LINE_TEMPLATE || (!a(child, 'type') && !!a(child, 'path')));
    if (
      ![left, top, width, height].every(Number.isFinite) ||
      (line ? width < 0 || height < 0 || width + height <= 0 : width <= 0 || height <= 0)
    )
      return false;
    const next = {
      x: box.x + ((left - origin[0]) * box.width) / size[0],
      y: box.y + ((top - origin[1]) * box.height) / size[1],
      width: (width * box.width) / size[0],
      height: (height * box.height) / size[1],
    };
    if (Object.values(next).some((v) => !Number.isFinite(v) || Math.abs(v) > 100_000)) return false;
    if (child.localName === 'group') {
      if (depth >= MAX_DEPTH || !projectMembers(child, next, depth + 1, host, memberStyle, out))
        return false;
      continue;
    }
    const picture = pictureMember(child, next, out);
    if (picture === null) return false;
    if (picture) {
      out.picture = picture;
      out.underPicture = out.components.length;
      continue;
    }
    if (!projectMember(child, style, next, host, out)) return false;
  }
  return true;
}

/**
 * The members of a `v:group` of `width`×`height` points as vector components and member
 * stories, or null when a member is outside this subset. `host` is the `w:pict` that holds the
 * group, and `memberStyle` validates each member's style.
 */
export function legacyVectorGroup(
  root: OoxmlElement,
  host: OoxmlElement,
  width: number,
  height: number,
  memberStyle: LegacyMemberStyle
): LegacyVectorGroup | null {
  const out: Output = { components: [], texts: [], picture: null, underPicture: 0, members: 0 };
  if (!projectMembers(root, { x: 0, y: 0, width, height }, 0, host, memberStyle, out)) return null;
  if (!out.components.length && !out.texts.length && !out.picture) return null;
  // Members before the picture paint under it and the rest over it. A later member that
  // covers the picture would need a third layer, so that group keeps the graphic preview.
  if (out.picture && !out.texts.length && coversPicture(out)) return null;
  if (out.picture) {
    for (let index = 0; index < out.underPicture; index += 1)
      out.components[index] = { ...out.components[index]!, belowPicture: true };
  }
  const subpathsEmu: (readonly Readonly<{ x: number; y: number }>[])[] = [];
  for (const component of out.components) {
    for (const path of component.subpathsEmu) subpathsEmu.push(path);
  }
  return Object.freeze({
    vectorShape: out.components.length
      ? Object.freeze({
          extentEmu: Object.freeze({
            cx: Math.round(width * EMU_PER_POINT),
            cy: Math.round(height * EMU_PER_POINT),
          }),
          subpathsEmu,
          fillHex: null,
          fillAlpha: 1,
          strokeHex: null,
          strokeAlpha: 1,
          strokeWidthEmu: 0,
          components: Object.freeze(out.components),
          // A group does not cut its members at its frame, as a canvas does not.
          overflowVisible: true as const,
        })
      : null,
    groupTextboxes: out.texts.length ? Object.freeze(out.texts) : null,
    groupPicture: out.picture,
  });
}

/** Whether a member projected after the picture overlaps the picture's frame. */
function coversPicture(out: Output): boolean {
  const frame = out.picture!.frameEmu;
  for (const component of out.components.slice(out.underPicture)) {
    for (const path of component.subpathsEmu) {
      let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      for (const point of path) {
        left = Math.min(left, point.x);
        top = Math.min(top, point.y);
        right = Math.max(right, point.x);
        bottom = Math.max(bottom, point.y);
      }
      if (
        left < frame.x + frame.cx &&
        right > frame.x &&
        top < frame.y + frame.cy &&
        bottom > frame.y
      )
        return true;
    }
  }
  return false;
}
