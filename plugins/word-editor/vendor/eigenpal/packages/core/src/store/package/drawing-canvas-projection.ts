// Read-only projection of a drawing canvas (`wpc:wpc`): the frame Word draws shapes, lines and
// connectors on. Members place themselves in the canvas extent in EMU, one to one; a nested
// `wpg:wgp` group maps its child space onto its own box. Member shapes paint as vector
// components and their text box stories lay out as group member stories.
//
// A canvas renders whole or not at all: a member outside the supported subset (a picture,
// ink, a nested canvas, an unsupported shape) leaves the canvas to its placeholder.

import { groupFillOf } from './drawing-group-fill.ts';
import {
  findGraphicData,
  isGroupPropertyChild,
  schemaFlagIsUnset,
  WPG_NAMESPACE_URI,
} from './drawing-group-frame.ts';
import { transformComponent } from './drawing-group-transform.ts';
import { readLineProperties } from './drawing-line-properties.ts';
import { isElement } from './drawing-projection-walk.ts';
import { directFill } from './drawing-shape-color.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';
import {
  childTransform,
  projectShapeComponents,
  projectWspTextboxStory,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type VectorShapeComponent,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';
import { findDirectChild, parseEmu, readSize } from './drawing-shape-readers.ts';
import { memberTextRotation, type GroupTextboxProjection } from './group-textbox-projection.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

export const WPC_GRAPHIC_DATA_URI =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';
export const WPC_NAMESPACE_URI =
  'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const MAX_CANVAS_MEMBERS = 256;
const MAX_CANVAS_POINTS = 32_768;

export interface CanvasProjection {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
}

interface CanvasContext {
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
}

/** Member space → canvas space on each axis: `canvas = offset + member * scale`. */
interface Placement {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

interface CanvasOutput {
  readonly components: VectorShapeComponent[];
  readonly texts: GroupTextboxProjection[];
  members: number;
}

function child(parent: OoxmlElement | null, namespaceUri: string, localName: string) {
  return parent ? findDirectChild(parent.children, { namespaceUri, localName }) : null;
}

function rectangle(extent: Readonly<{ cx: number; cy: number }>) {
  return [
    { x: 0, y: 0 },
    { x: extent.cx, y: 0 },
    { x: extent.cx, y: extent.cy },
    { x: 0, y: extent.cy },
  ];
}

/** The canvas background (`wpc:bg`) and outline (`wpc:whole/a:ln`). */
function backgroundComponent(
  canvas: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  context: CanvasContext
): VectorShapeComponent | null {
  const bg = child(canvas, WPC_NAMESPACE_URI, 'bg');
  const whole = child(canvas, WPC_NAMESPACE_URI, 'whole');
  const fill = bg ? directFill(bg, context.resolveSchemeColor).color : null;
  const ln = child(whole, A, 'ln');
  const stroke = ln ? directFill(ln, context.resolveSchemeColor).color : null;
  if (fill === null && stroke === null) return null;
  return {
    subpathsEmu: [rectangle(extent)],
    subpathsClosed: [true],
    fillHex: fill?.hex ?? null,
    fillAlpha: fill?.alpha ?? 1,
    strokeHex: stroke?.hex ?? null,
    strokeAlpha: stroke?.alpha ?? 1,
    strokeWidthEmu: stroke && whole ? readLineProperties(whole, ln).widthEmu : 0,
  };
}

/** A nested group's box and child space, or null when it turns, flips or lacks a size. */
function groupPlacement(group: OoxmlElement, parent: Placement): Placement | null {
  const xfrm = child(child(group, WPG_NAMESPACE_URI, 'grpSpPr'), A, 'xfrm');
  if (!xfrm || shapeRotationDegrees(xfrm) !== 0) return null;
  for (const flag of ['flipH', 'flipV']) {
    if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, flag))) return null;
  }
  const point = (name: string) => {
    const element = child(xfrm, A, name);
    return {
      x: element ? (parseEmu(schemaAttributeValue(element.attributes, 'x'), false) ?? 0) : 0,
      y: element ? (parseEmu(schemaAttributeValue(element.attributes, 'y'), false) ?? 0) : 0,
    };
  };
  const size = (name: string, axis: string) => {
    const element = child(xfrm, A, name);
    return element ? readSize(schemaAttributeValue(element.attributes, axis), null) : null;
  };
  const [cx, cy, chCx, chCy] = [
    size('ext', 'cx'),
    size('ext', 'cy'),
    size('chExt', 'cx'),
    size('chExt', 'cy'),
  ];
  if (cx === null || cy === null || chCx === null || chCy === null) return null;
  const off = point('off');
  const chOff = point('chOff');
  const scaleX = chCx > 0 ? cx / chCx : 0;
  const scaleY = chCy > 0 ? cy / chCy : 0;
  return {
    x: parent.x + (off.x - chOff.x * scaleX) * parent.scaleX,
    y: parent.y + (off.y - chOff.y * scaleY) * parent.scaleY,
    scaleX: scaleX * parent.scaleX,
    scaleY: scaleY * parent.scaleY,
  };
}

function projectMember(
  member: OoxmlElement,
  placement: Placement,
  out: CanvasOutput,
  pointBudget: { remaining: number },
  context: CanvasContext,
  groupFill: OoxmlElement | null
): boolean {
  const shape = childTransform(member);
  if (!shape) return false;
  const components = projectShapeComponents(
    member,
    shape.extent,
    pointBudget,
    context.resolveSchemeColor,
    context.resolveStyleMatrixReference,
    true,
    groupFill
  );
  if (components === null) return false;
  const origin = {
    x: placement.x + shape.offset.x * placement.scaleX,
    y: placement.y + shape.offset.y * placement.scaleY,
  };
  for (const component of components) {
    out.components.push(transformComponent(component, origin, placement.scaleX, placement.scaleY));
  }
  const rotationDegrees = memberTextRotation(member);
  if (rotationDegrees === null) return true;
  const cx = Math.round(shape.extent.cx * placement.scaleX);
  const cy = Math.round(shape.extent.cy * placement.scaleY);
  const story = projectWspTextboxStory(
    member,
    { cx, cy },
    context.resolveSchemeColor,
    context.resolveStyleMatrixReference
  );
  if (!story) return true;
  out.texts.push(
    Object.freeze({
      memberNodeId: member.id,
      frameEmu: Object.freeze({ x: Math.round(origin.x), y: Math.round(origin.y), cx, cy }),
      // The member's shape paints as a vector component; its story paints text only.
      story: Object.freeze({
        ...story,
        insetsEmu: Object.freeze({ ...story.insetsEmu }),
        fillHex: null,
        strokeHex: null,
      }),
      rotationDegrees,
    })
  );
  return true;
}

function projectMembers(
  parent: OoxmlElement,
  placement: Placement,
  depth: number,
  out: CanvasOutput,
  pointBudget: { remaining: number },
  context: CanvasContext,
  groupFill: OoxmlElement | null = null
): boolean {
  for (const node of parent.children) {
    if (!isElement(node)) continue;
    if (node.namespaceUri === WPC_NAMESPACE_URI && ['bg', 'whole'].includes(node.localName))
      continue;
    if (isGroupPropertyChild(node)) continue;
    out.members += 1;
    if (out.members > MAX_CANVAS_MEMBERS) return false;
    if (node.namespaceUri === WPS_NAMESPACE_URI && node.localName === 'wsp') {
      const nonVisual = child(node, WPS_NAMESPACE_URI, 'cNvPr');
      if (nonVisual && !schemaFlagIsUnset(schemaAttributeValue(nonVisual.attributes, 'hidden')))
        continue;
      if (!projectMember(node, placement, out, pointBudget, context, groupFill)) return false;
      continue;
    }
    if (node.namespaceUri === WPG_NAMESPACE_URI && node.localName === 'wgp' && depth < 4) {
      const nested = groupPlacement(node, placement);
      if (
        !nested ||
        !projectMembers(
          node,
          nested,
          depth + 1,
          out,
          pointBudget,
          context,
          groupFillOf(node, groupFill)
        )
      )
        return false;
      continue;
    }
    return false;
  }
  return true;
}

/** The shapes and text of a drawing canvas, or null when it is not one or cannot render. */
export function projectCanvas(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  context: CanvasContext
): CanvasProjection | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const data = findGraphicData(anchor);
  if (!data || schemaAttributeValue(data.attributes, 'uri') !== WPC_GRAPHIC_DATA_URI) return null;
  const canvas = child(data, WPC_NAMESPACE_URI, 'wpc');
  if (!canvas) return null;
  const out: CanvasOutput = { components: [], texts: [], members: 0 };
  const background = backgroundComponent(canvas, extent, context);
  if (background) out.components.push(background);
  const pointBudget = { remaining: MAX_CANVAS_POINTS };
  const origin: Placement = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
  if (!projectMembers(canvas, origin, 0, out, pointBudget, context)) return null;
  if (out.components.length === 0 && out.texts.length === 0) return null;
  const subpathsEmu: (readonly Readonly<{ x: number; y: number }>[])[] = [];
  for (const component of out.components) {
    for (const path of component.subpathsEmu) subpathsEmu.push(path);
  }
  return {
    vectorShape: out.components.length
      ? {
          extentEmu: { cx: extent.cx, cy: extent.cy },
          subpathsEmu,
          fillHex: null,
          fillAlpha: 1,
          strokeHex: null,
          strokeAlpha: 1,
          strokeWidthEmu: 0,
          components: out.components,
          overflowVisible: true,
        }
      : null,
    groupTextboxes: out.texts.length ? Object.freeze(out.texts) : null,
  };
}
