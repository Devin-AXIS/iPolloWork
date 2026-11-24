// Read-only projection of a SmartArt drawing from its saved drawing part.
//
// The saved `dsp:drawing` holds the shapes Office last laid out, in the coordinate space of
// the graphic frame. Each `dsp:sp` has the same shape properties as a `wps:wsp`, plus an
// optional DrawingML text body and its own text rectangle (`dsp:txXfrm`). Shapes paint
// through the vector shape components; text lowers to read-only stories that lay out in
// their text rectangles. The data model supplies the diagram background and outline.
//
// A diagram renders whole or not at all: when one visible shape falls outside the supported
// subset, the projection is null and the drawing keeps its labelled placeholder.

import {
  DIAGRAM_DRAWING_NAMESPACE_URI,
  DIAGRAM_GRAPHIC_DATA_URI,
  DIAGRAM_NAMESPACE_URI,
  type DiagramPartResolver,
} from './diagram-parts.ts';
import { findGraphicData, schemaFlagIsUnset } from './drawing-group-frame.ts';
import { transformComponent } from './drawing-group-transform.ts';
import { readLineProperties } from './drawing-line-properties.ts';
import { drawingRenderers, type DrawingRenderers } from './drawing-renderers.ts';
import { isElement } from './drawing-projection-walk.ts';
import { directFill, resolveColorNode } from './drawing-shape-color.ts';
import { shapeRotationDegrees } from './drawing-shape-geometry.ts';
import {
  childTransform,
  projectShapeComponents,
  type ShapeSchemeColorResolver,
  type ShapeStyleMatrixResolver,
  type VectorShapeComponent,
  type VectorShapeProjection,
} from './drawing-shape-projection.ts';
import { findDirectChild, parseEmu, readSize } from './drawing-shape-readers.ts';
import { lowerDrawingTextBody, type DrawingTextDefaults } from './drawingml-text-lowering.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { shapeThemeCacheToken } from './theme-color-resolution.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';

const DSP = DIAGRAM_DRAWING_NAMESPACE_URI;
const A = DRAWINGML_MAIN_NAMESPACE_URI;

/** A diagram has far more shapes than a drawn group; these bound one diagram. */
const MAX_DIAGRAM_SHAPES = 512;
const MAX_DIAGRAM_GROUP_DEPTH = 8;
const MAX_DIAGRAM_POINTS = 65_536;

export interface DiagramProjection {
  readonly vectorShape: VectorShapeProjection | null;
  readonly groupTextboxes: readonly GroupTextboxProjection[] | null;
}

export interface DiagramProjectionContext {
  readonly resolveDiagramParts?: DiagramPartResolver;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
}

/** Child space → frame space: `frame = offset + child * scale` on each axis. */
interface FrameTransform {
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

const IDENTITY: FrameTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };

function child(parent: OoxmlElement | null | undefined, namespaceUri: string, localName: string) {
  return parent ? findDirectChild(parent.children, { namespaceUri, localName }) : null;
}

/** A nested group's `a:xfrm` mapped onto its parent's space. Null when unsupported. */
function groupTransform(group: OoxmlElement, parent: FrameTransform): FrameTransform | null {
  const xfrm = child(child(group, DSP, 'grpSpPr'), A, 'xfrm');
  if (!xfrm) return parent;
  if (shapeRotationDegrees(xfrm) !== 0) return null;
  for (const flag of ['flipH', 'flipV']) {
    if (!schemaFlagIsUnset(schemaAttributeValue(xfrm.attributes, flag))) return null;
  }
  const point = (name: string, x: string, y: string) => {
    const element = child(xfrm, A, name);
    return {
      x: element ? (parseEmu(schemaAttributeValue(element.attributes, x), false) ?? 0) : 0,
      y: element ? (parseEmu(schemaAttributeValue(element.attributes, y), false) ?? 0) : 0,
    };
  };
  const off = point('off', 'x', 'y');
  const chOff = point('chOff', 'x', 'y');
  const ext = child(xfrm, A, 'ext');
  const chExt = child(xfrm, A, 'chExt');
  const size = (element: OoxmlElement | null, name: string) =>
    element ? readSize(schemaAttributeValue(element.attributes, name), null) : null;
  const [cx, cy, chCx, chCy] = [
    size(ext, 'cx'),
    size(ext, 'cy'),
    size(chExt, 'cx'),
    size(chExt, 'cy'),
  ];
  const scaleX = cx !== null && chCx !== null && chCx > 0 ? cx / chCx : 1;
  const scaleY = cy !== null && chCy !== null && chCy > 0 ? cy / chCy : 1;
  return {
    x: parent.x + (off.x - chOff.x * scaleX) * parent.scaleX,
    y: parent.y + (off.y - chOff.y * scaleY) * parent.scaleY,
    scaleX: scaleX * parent.scaleX,
    scaleY: scaleY * parent.scaleY,
  };
}

/** The diagram background (`dgm:bg`) and outline (`dgm:whole/a:ln`) as one frame rectangle. */
function backgroundComponent(
  dataModel: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  context: DiagramProjectionContext
): VectorShapeComponent | null {
  const bg = child(dataModel, DIAGRAM_NAMESPACE_URI, 'bg');
  const whole = child(dataModel, DIAGRAM_NAMESPACE_URI, 'whole');
  const fill = bg ? directFill(bg, context.resolveSchemeColor).color : null;
  const ln = child(whole, A, 'ln');
  const stroke = ln ? directFill(ln, context.resolveSchemeColor).color : null;
  if (fill === null && stroke === null) return null;
  const strokeWidthEmu = stroke && whole ? readLineProperties(whole, ln).widthEmu : 0;
  return {
    subpathsEmu: [
      [
        { x: 0, y: 0 },
        { x: extent.cx, y: 0 },
        { x: extent.cx, y: extent.cy },
        { x: 0, y: extent.cy },
      ],
    ],
    subpathsClosed: [true],
    fillHex: fill?.hex ?? null,
    fillAlpha: fill?.alpha ?? 1,
    strokeHex: stroke?.hex ?? null,
    strokeAlpha: stroke?.alpha ?? 1,
    strokeWidthEmu,
  };
}

/** The theme font slot and colour a shape's `dsp:style/a:fontRef` names. */
function textDefaults(sp: OoxmlElement, context: DiagramProjectionContext): DrawingTextDefaults {
  const fontRef = child(child(sp, DSP, 'style'), A, 'fontRef');
  const slot = fontRef ? schemaAttributeValue(fontRef.attributes, 'idx') : undefined;
  const colorNode = fontRef?.children.find(isElement);
  return {
    fontSlot: slot === 'major' ? 'major' : slot === 'minor' ? 'minor' : null,
    color: colorNode ? resolveColorNode(colorNode, context.resolveSchemeColor) : null,
  };
}

/** `dsp:txXfrm` (or the shape box) in frame space, with its turn. */
function textFrame(
  sp: OoxmlElement,
  shape: NonNullable<ReturnType<typeof childTransform>>
): {
  readonly offset: { x: number; y: number };
  readonly extent: { cx: number; cy: number };
  readonly rotation: number;
} | null {
  const txXfrm = child(sp, DSP, 'txXfrm');
  const shapeXfrm = child(child(sp, DSP, 'spPr'), A, 'xfrm');
  const shapeRotation = shapeRotationDegrees(shapeXfrm);
  if (shapeRotation === null) return null;
  if (!txXfrm) return { offset: shape.offset, extent: shape.extent, rotation: shapeRotation };
  const off = child(txXfrm, A, 'off');
  const ext = child(txXfrm, A, 'ext');
  const cx = ext ? readSize(schemaAttributeValue(ext.attributes, 'cx'), null) : null;
  const cy = ext ? readSize(schemaAttributeValue(ext.attributes, 'cy'), null) : null;
  const textRotation = shapeRotationDegrees(txXfrm);
  if (cx === null || cy === null || textRotation === null) return null;
  return {
    offset: {
      x: off ? (parseEmu(schemaAttributeValue(off.attributes, 'x'), false) ?? 0) : 0,
      y: off ? (parseEmu(schemaAttributeValue(off.attributes, 'y'), false) ?? 0) : 0,
    },
    extent: { cx, cy },
    // The text rectangle's turn adds to the shape's, so a turned shape can keep upright text.
    rotation: (shapeRotation + textRotation) % 360,
  };
}

interface WalkOutput {
  readonly components: VectorShapeComponent[];
  readonly texts: GroupTextboxProjection[];
  shapes: number;
}

function walkShapes(
  parent: OoxmlElement,
  transform: FrameTransform,
  depth: number,
  out: WalkOutput,
  pointBudget: { remaining: number },
  partName: string,
  context: DiagramProjectionContext
): boolean {
  for (const node of parent.children) {
    if (!isElement(node) || node.namespaceUri !== DSP) continue;
    if (node.localName === 'grpSp') {
      if (depth >= MAX_DIAGRAM_GROUP_DEPTH) return false;
      const nested = groupTransform(node, transform);
      if (!nested) return false;
      if (!walkShapes(node, nested, depth + 1, out, pointBudget, partName, context)) return false;
      continue;
    }
    if (node.localName !== 'sp') continue;
    out.shapes += 1;
    if (out.shapes > MAX_DIAGRAM_SHAPES) return false;
    const nonVisual = child(child(node, DSP, 'nvSpPr'), DSP, 'cNvPr');
    if (nonVisual && !schemaFlagIsUnset(schemaAttributeValue(nonVisual.attributes, 'hidden')))
      continue;
    const shape = childTransform(node);
    if (!shape) return false;
    const components = projectShapeComponents(
      node,
      shape.extent,
      pointBudget,
      context.resolveSchemeColor,
      context.resolveStyleMatrixReference,
      true
    );
    if (components === null) return false;
    for (const component of components) {
      out.components.push(
        transformComponent(
          component,
          {
            x: transform.x + shape.offset.x * transform.scaleX,
            y: transform.y + shape.offset.y * transform.scaleY,
          },
          transform.scaleX,
          transform.scaleY
        )
      );
    }
    const txBody = child(node, DSP, 'txBody');
    if (!txBody) continue;
    const frame = textFrame(node, shape);
    if (!frame) return false;
    const lowered = lowerDrawingTextBody(
      txBody,
      `${partName}#text:${out.shapes}`,
      textDefaults(node, context),
      context.resolveSchemeColor
    );
    // Text a shape cannot show must not vanish silently: the diagram keeps its placeholder.
    if (lowered === 'unsupported') return false;
    if (lowered === 'no-text') continue;
    const width = frame.extent.cx * transform.scaleX;
    const height = frame.extent.cy * transform.scaleY;
    if (!(width > 0) || !(height > 0)) continue;
    // A quarter-turned body lays out in the box turned about its centre.
    const turned = lowered.quarterTurn !== 0;
    const cx = Math.round(turned ? height : width);
    const cy = Math.round(turned ? width : height);
    const left = transform.x + frame.offset.x * transform.scaleX + (width - cx) / 2;
    const top = transform.y + frame.offset.y * transform.scaleY + (height - cy) / 2;
    const rotation =
      (((frame.rotation + lowered.rotationDegrees + lowered.quarterTurn) % 360) + 360) % 360;
    out.texts.push(
      Object.freeze({
        memberNodeId: node.id,
        frameEmu: Object.freeze({ x: Math.round(left), y: Math.round(top), cx, cy }),
        story: Object.freeze({
          contentNodeId: lowered.content.id,
          content: lowered.content,
          insetsEmu: Object.freeze({ ...lowered.insetsEmu }),
          verticalAnchor: lowered.verticalAnchor,
          autofit: 'none' as const,
          ...(lowered.noWrap ? { noWrap: true as const } : {}),
          fillHex: null,
          strokeHex: null,
          strokeWidthEmu: 0,
          drawingText: true as const,
        }),
        rotationDegrees: Number.isFinite(rotation) ? rotation : 0,
      })
    );
  }
  return true;
}

/** Theme colour slots a diagram's shapes and text can name. */
const SCHEME_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'tx1',
  'bg1',
  'tx2',
  'bg2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const;

const elementIds = new WeakMap<object, number>();
let nextElementId = 1;
function elementId(element: object | null | undefined): number {
  if (!element) return 0;
  let id = elementIds.get(element);
  if (id === undefined) {
    id = nextElementId++;
    elementIds.set(element, id);
  }
  return id;
}

/**
 * What the theme contributes to a diagram: its scheme colours and its style matrices. Theme
 * resolvers are rebuilt for every package revision, so the memo compares what they resolve
 * to, not the functions themselves.
 */
function themeKey(context: DiagramProjectionContext): string {
  const token = context.resolveSchemeColor
    ? shapeThemeCacheToken(context.resolveSchemeColor)
    : undefined;
  if (token !== undefined) return token;
  const colors = SCHEME_SLOTS.map((slot) => context.resolveSchemeColor?.(slot) ?? '').join(',');
  const matrix = context.resolveStyleMatrixReference;
  const lists = matrix
    ? [matrix('fill', 1), matrix('line', 1), matrix('fill', 1001)].map(elementId).join(',')
    : '';
  return `${colors}|${lists}`;
}

interface DiagramMemo {
  readonly cx: number;
  readonly cy: number;
  /** The saved drawing, or the layout definition the drawing was laid out from. */
  readonly source: OoxmlElement;
  readonly dataModel: OoxmlElement;
  readonly styleDef: OoxmlElement | null;
  readonly colorsDef: OoxmlElement | null;
  readonly theme: string;
  readonly engine: DrawingRenderers['diagramLayout'];
  readonly result: DiagramProjection | null;
}

const PROJECTIONS = new WeakMap<OoxmlElement, DiagramMemo>();

/**
 * The shapes and text of a SmartArt drawing, or null when the drawing is not a diagram or a
 * visible shape is outside the supported subset. A diagram saved without its drawing part
 * is laid out from its data model, layout, quick style and colour parts.
 *
 * Layout keys text by story identity, so an unchanged drawing projects the same objects on
 * every pass: the memo holds one result per anchor, extent, diagram parts and theme.
 */
export function projectDiagram(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  context: DiagramProjectionContext
): DiagramProjection | null {
  if (!context.resolveDiagramParts || extent.cx <= 0 || extent.cy <= 0) return null;
  const data = findGraphicData(anchor);
  if (!data || schemaAttributeValue(data.attributes, 'uri') !== DIAGRAM_GRAPHIC_DATA_URI) {
    return null;
  }
  const relIds = child(data, DIAGRAM_NAMESPACE_URI, 'relIds');
  const parts = relIds ? context.resolveDiagramParts(relIds) : null;
  if (!parts) return null;
  const source = parts.drawing ?? parts.layoutDef;
  if (!source) return null;
  const theme = themeKey(context);
  // Without a saved drawing, the diagram needs an installed layout engine.
  const engine = parts.drawing ? undefined : drawingRenderers().diagramLayout;
  const memo = PROJECTIONS.get(anchor);
  if (
    memo &&
    memo.cx === extent.cx &&
    memo.cy === extent.cy &&
    memo.source === source &&
    memo.dataModel === parts.dataModel &&
    memo.styleDef === parts.styleDef &&
    memo.colorsDef === parts.colorsDef &&
    memo.theme === theme &&
    memo.engine === engine
  ) {
    return memo.result;
  }
  let result: DiagramProjection | null = null;
  if (parts.drawing && parts.drawingPartName) {
    result = projectDiagramParts(
      parts.drawing,
      parts.dataModel,
      parts.drawingPartName,
      extent,
      context
    );
  } else if (parts.layoutDef && engine) {
    const drawing = engine(
      {
        dataModel: parts.dataModel,
        layoutDef: parts.layoutDef,
        styleDef: parts.styleDef,
        colorsDef: parts.colorsDef,
      },
      extent,
      { fontFamily: parts.fontFamily, resolveSchemeColor: context.resolveSchemeColor }
    );
    result = drawing
      ? projectDiagramParts(
          drawing,
          parts.dataModel,
          `${parts.dataPartName}#layout`,
          extent,
          context
        )
      : null;
  }
  PROJECTIONS.set(anchor, {
    cx: extent.cx,
    cy: extent.cy,
    source,
    dataModel: parts.dataModel,
    styleDef: parts.styleDef,
    colorsDef: parts.colorsDef,
    theme,
    engine,
    result,
  });
  return result;
}

function projectDiagramParts(
  drawing: OoxmlElement,
  dataModel: OoxmlElement,
  drawingPartName: string,
  extent: Readonly<{ cx: number; cy: number }>,
  context: DiagramProjectionContext
): DiagramProjection | null {
  const spTree = child(drawing, DSP, 'spTree');
  if (!spTree) return null;
  const root = groupTransform(spTree, IDENTITY);
  if (!root) return null;
  const out: WalkOutput = { components: [], texts: [], shapes: 0 };
  const background = backgroundComponent(dataModel, extent, context);
  if (background) out.components.push(background);
  const pointBudget = { remaining: MAX_DIAGRAM_POINTS };
  if (!walkShapes(spTree, root, 0, out, pointBudget, drawingPartName, context)) return null;
  if (out.components.length === 0 && out.texts.length === 0) return null;
  const subpathsEmu: (readonly Readonly<{ x: number; y: number }>[])[] = [];
  for (const component of out.components) {
    for (const path of component.subpathsEmu) subpathsEmu.push(path);
  }
  return Object.freeze({
    vectorShape: out.components.length
      ? Object.freeze({
          extentEmu: Object.freeze({ cx: extent.cx, cy: extent.cy }),
          subpathsEmu,
          fillHex: null,
          fillAlpha: 1,
          strokeHex: null,
          strokeAlpha: 1,
          strokeWidthEmu: 0,
          components: out.components,
        })
      : null,
    groupTextboxes: out.texts.length ? Object.freeze(out.texts) : null,
  });
}
