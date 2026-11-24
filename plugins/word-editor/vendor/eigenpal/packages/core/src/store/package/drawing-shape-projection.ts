import { identityGroupThemeEffect } from './drawing-group-theme-effects.ts';
// Renderable projections of `wps:wsp` graphics: solid-geometry vector shapes and textbox
// stories. Split from drawing-projection.ts, which owns the drawing walk, MC selection, and
// the assembled DrawingProjection; this module is pure direct-child reads with no walk state.

import { parseEmu, findDirectChild } from './drawing-shape-readers.ts';
export { MAX_EMU, parseEmu, findDirectChild } from './drawing-shape-readers.ts';
import { isElement } from './drawing-projection-walk.ts';
import {
  findGraphicData,
  isGroupPropertyChild,
  MAX_GROUP_SHAPE_CHILDREN,
  readDrawingGroupFrame,
  supportedGroupVisuals,
  schemaFlagIsSet,
} from './drawing-group-frame.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from './ooxml-drawing-rules.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { projectLineArrowheads } from './drawing-line-arrowheads.ts';
import { compoundBands } from './drawing-line-compound.ts';
import { drawingTextboxFrame } from './drawing-textbox-frame.ts';
import {
  authoredPatternFill,
  patternMeanColor,
  type VectorPattern,
} from './drawing-pattern-fill.ts';
import {
  hasPathlessCustomGeometry,
  needsGeometryEngine,
  readCustomPolygons,
  type ShapePath,
} from './drawing-vector-paths.ts';
import { readShapeShadow, shapeEffectList, type ShapeShadow } from './drawing-shape-effects.ts';
import { drawingRenderers } from './drawing-renderers.ts';
import {
  gradientMeanColor,
  placeGradient,
  readGradientFill,
  shadeGradient,
  shapeAffine,
  type GradientFillSpec,
  type VectorGradient,
} from './drawing-gradient.ts';
import {
  pathFillColor,
  readShapeGeometry,
  shapePointTransform,
  shapeRotationDegrees,
} from './drawing-shape-geometry.ts';
import {
  groupMemberPlacement,
  transformComponent,
  turnGroupComponents,
} from './drawing-group-transform.ts';
import { groupFillOf, groupFillSpansMembers, withResolvedGroupFill } from './drawing-group-fill.ts';
import { groupPictureOutline } from './drawing-group-picture-outline.ts';
import { readLineProperties, readStyleReferenceIndex } from './drawing-line-properties.ts';
import {
  directFill,
  resolveColorNode,
  type ShapeColor,
  type ShapeSchemeColorResolver,
} from './drawing-shape-color.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import {
  childTransform,
  shapeFlagsValid,
  shapeProperties,
  shapeTransformElement,
  zeroExtentShapeProjection,
} from './drawing-shape-transform.ts';
export { childTransform } from './drawing-shape-transform.ts';
import type {
  TextboxOutlineProjection,
  TextboxTextAreaRule,
} from './legacy-vml-textbox-geometry.ts';
import type { LegacyTextboxShadow } from './legacy-vml-textbox-stroke.ts';

const WPS_GRAPHIC_DATA_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const MAX_VECTOR_SHAPE_POINTS = 1024;

export type { ShapeSchemeColorResolver } from './drawing-shape-color.ts';
export type ShapeStyleMatrixResolver = (
  kind: 'fill' | 'line',
  index: number
) => OoxmlElement | null;

/**
 * The renderable subset of a `wps:wsp` non-picture graphic, or of one bounded `wpg:wgp`
 * group of them: closed polygon subpaths (`a:custGeom` with move/line/close/cubicBezTo
 * verbs, or a supported `a:prstGeom`) with a solid fill and/or stroke. The colour may come
 * from `a:srgbClr` or from the theme, through `a:schemeClr` or a `wps:style` matrix
 * reference. Anything richer (picture fills, a turned group, a nested group) projects as
 * `null` and paints the labelled placeholder instead. A top-level text box paints through its
 * story, not through this projection.
 *
 * @public
 */
export interface VectorShapeProjection {
  /** The drawing extent that frames the subpath coordinate space. */
  readonly extentEmu: Readonly<{ cx: number; cy: number }>;
  /**
   * Every component's subpath polygons, flattened, in extent-EMU space; fill rule is
   * even-odd. Painting reads `components`, which keeps each polygon with its own colours;
   * this stays the geometry summary (bounds, hit tests, wrap holes).
   */
  readonly subpathsEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  /**
   * Validated 6-digit sRGB hex (no `#`) of the one component, or null. A group of two or
   * more components has no single fill, so this is null there as well: null means "no one
   * fill to name", not "nothing is filled". Read `components` to paint.
   */
  readonly fillHex: string | null;
  readonly fillAlpha?: number;
  /** As `fillHex`, for the stroke: the one component's stroke, else null. */
  readonly strokeHex: string | null;
  readonly strokeAlpha?: number;
  /** The one component's stroke width in EMU; 0 when absent or when grouped. */
  readonly strokeWidthEmu: number;
  /** Independently styled paths, always non-empty. A direct shape has one component. */
  readonly components: readonly VectorShapeComponent[];
  /**
   * Geometry outside the extent paints too. A direct shape, turned or upright, is not cut at
   * its extent or its effect extent: a callout's tail, or a custom path past its box, shows
   * whole. A turned group, a group with a turned member, and a drawing canvas do not cut
   * their members at the frame either. Any other group still cuts its members at its frame
   * and its effect extent.
   */
  readonly overflowVisible?: true;
  /**
   * A shape or a group turned by its `a:xfrm/@rot`, in clockwise degrees in (0, 360). It
   * turns about the centre of its unturned extent, so its geometry paints outside the extent,
   * while layout keeps the extent and `wp:effectExtent` it reserves. Absent when not turned. A
   * shape with no extent carries its turn but paints nothing, so it sets no `overflowVisible`.
   *
   * Informational only: the turn and the flips are already applied to every component's
   * points, so a painter must not apply it again.
   */
  readonly rotationDegrees?: number;
}

/** One painted layer of a vector shape. @public */
export interface VectorShapeComponent {
  readonly subpathsEmu: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  /** Authored close commands; omitted by older consumers means closed polygons. */
  readonly subpathsClosed?: readonly boolean[];
  /** Filled line-end polygons in the same projected coordinate space. */
  readonly arrowheadsEmu?: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  readonly fillHex: string | null;
  readonly fillAlpha: number;
  readonly strokeHex: string | null;
  readonly strokeAlpha: number;
  readonly strokeWidthEmu: number;
  /**
   * A gradient fill (`a:gradFill`), painted in place of `fillHex` where the painter can.
   * `fillHex` then holds the mean of its stops.
   */
  readonly fillGradient?: VectorGradient;
  /** A preset pattern the fill paints with; `fillHex` is its mean colour. */
  readonly fillPattern?: VectorPattern;
  /** The outer shadow the shape casts, painted under this component. */
  readonly shadow?: ShapeShadow;
  /**
   * The component only casts `shadow`: it is the silhouette of a shape with several paths,
   * placed before them, and paints no fill or outline of its own.
   */
  readonly shadowOnly?: true;
  /** Authored line ends and joins, inherited from the selected theme line when absent. */
  readonly strokeCap?: 'butt' | 'round' | 'square';
  readonly strokeJoin?: 'round' | 'bevel' | 'miter';
  /** Miter limit in line widths, for a miter join. */
  readonly strokeMiterLimit?: number;
  /** Dash and gap lengths in multiples of the stroke width; absent for a solid outline. */
  readonly strokeDash?: readonly number[];
  /** Paint clips to these closed subpaths, as an inner shadow clips to its shape. */
  readonly clipEmu?: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  /** In a picture's frame: paints under the picture (its shadow and fill), not over it. */
  readonly belowPicture?: true;
  /**
   * How far the stroked path lies outside the geometry by design, in EMU: a picture outline
   * runs half its width outside the picture, so the whole stroke stays off the picture.
   */
  readonly strokeOutsetEmu?: number;
  /**
   * The outline sits inside the closed geometry (`a:ln algn="in"`): painters draw it at twice
   * its width clipped to the path, so the authored width stays inside the shape and adds no
   * reach past the extent. Set only for a closed outline with area.
   */
  readonly strokeInset?: boolean;
  /**
   * The subpaths fill by the nonzero winding rule rather than even-odd, so overlapping
   * subpaths of one direction stay filled where they cross.
   */
  readonly fillRule?: 'nonzero';
}

/**
 * The story carried by a `wps:wsp` text box (`wps:txbx` → `w:txbxContent`).
 *
 * The projection captures only the story root and the shape chrome reads; it never walks the
 * story content, so the per-drawing element budget is not spent on paragraphs. Layout collects
 * blocks from `content` under its own caps.
 *
 * @internal
 */
export interface TextboxStoryProjection {
  /** Canonical node id of the `w:txbxContent` element. */
  readonly contentNodeId: string;
  /** The `w:txbxContent` element itself; treated as an opaque story root here. */
  readonly content: OoxmlElement;
  /** `wps:bodyPr` insets with the OOXML defaults (91440 EMU l/r, 45720 EMU t/b) when absent. */
  readonly insetsEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  /** `wps:bodyPr/@anchor` collapsed to the three renderable positions; default top. */
  readonly verticalAnchor: 'top' | 'center' | 'bottom';
  /**
   * Autofit child of `wps:bodyPr`. `shape` on a top-level box sets {@link fitHeightToText};
   * `normal` (shrink text on overflow) keeps the extent.
   */
  readonly autofit: 'none' | 'shape' | 'normal';
  /**
   * `wps:bodyPr/@wrap="none"` (VML `mso-wrap-style:none`): lines never wrap at the box edge,
   * and the box takes the width of its widest line plus the insets. Absent for wrapped text.
   */
  readonly noWrap?: true;
  /** Solid fill of the hosting shape, painted behind the story; null for no fill. */
  readonly fillHex: string | null;
  /** Solid outline of the hosting shape; null for no outline. */
  readonly strokeHex: string | null;
  /** Outline width in EMU; 0 when absent. */
  readonly strokeWidthEmu: number;
  /** The shape around a legacy VML story; absent for an upright rectangle. */
  readonly legacyFrame?: TextboxLegacyFrame;
  /** The outline is centred on the shape edge, half outside the extent, as VML strokes it. */
  readonly strokeCentered?: true;
  /** VML `insetpen`: the outline lies inside the box and insets the text by its full width. */
  readonly strokeInset?: true;
  /**
   * VML `mso-fit-shape-to-text` or DrawingML `a:spAutoFit` on a top-level box: the box height
   * follows its text when laid out.
   */
  readonly fitHeightToText?: true;
  /**
   * The fit comes from DrawingML `a:spAutoFit`, which also fits an inline or turned box. A
   * legacy VML box that fits its text keeps its extent when inline or turned.
   */
  readonly drawingFit?: true;
  /** Outline dash pattern in multiples of the outline width; absent for solid. */
  readonly strokeDash?: readonly number[];
  /** How outline dashes end; absent for flat ends. */
  readonly strokeCap?: 'round' | 'square';
  /** The shape painted again under itself in one colour, offset on the page. */
  readonly shadow?: LegacyTextboxShadow;
  /**
   * The story is DrawingML shape text lowered to read-only paragraphs (a diagram's text): it
   * lays out without the document's styles and with the DrawingML line rule.
   */
  readonly drawingText?: true;
  /**
   * The drawing's `vectorShape` paints the box's fill, outline and effects; the story paints
   * only its text. The fill and outline fields stay for the text insets they give.
   */
  readonly chromeByVector?: true;
}

/** Shape geometry, turn and text flow of a text box: a legacy VML one, or a DrawingML one. */
export interface TextboxLegacyFrame {
  /** Space between the shape box and its text area, in EMU, before the story insets. */
  readonly textAreaEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  /** Outline geometry; null for a rectangle. */
  readonly outline: TextboxOutlineProjection | null;
  /** Clockwise shape turn in degrees, in [0, 360). */
  readonly rotationDegrees: number;
  /** The text turns with the shape; otherwise it stays upright in the turned box. */
  readonly textTurnsWithShape: boolean;
  /**
   * `vertical` runs lines top to bottom, stacked right to left; `verticalBottomToTop` runs
   * them bottom to top, stacked left to right.
   */
  readonly flow: 'horizontal' | 'vertical' | 'verticalBottomToTop';
  /** The shape paints and its text does not, as a text area some shapes write hides it. */
  readonly textHidden?: true;
  /** How the text area follows the box size, for a box that fits its text. */
  readonly textAreaRule?: TextboxTextAreaRule;
}

function readStyleReference(
  wsp: OoxmlElement,
  referenceName: 'fillRef' | 'lnRef',
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): {
  readonly color: ShapeColor;
  readonly matrix?: OoxmlElement;
  readonly gradient?: GradientFillSpec;
} | null {
  const reference = readStyleReferenceIndex(wsp, referenceName);
  const color = reference?.color;
  if (!reference || !color) return null;
  const index = reference.index;
  const placeholder = resolveColorNode(color, resolveSchemeColor);
  const matrix = resolveStyleMatrixReference?.(
    referenceName === 'fillRef' ? 'fill' : 'line',
    index
  );
  if (!placeholder || !matrix) return null;
  if (referenceName === 'fillRef') {
    if (!isElement(matrix) || matrix.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) return null;
    if (matrix.localName === 'gradFill') {
      const gradient = readGradientFill(matrix, resolveSchemeColor, placeholder);
      return gradient ? { color: gradientMeanColor(gradient), gradient } : null;
    }
    if (matrix.localName !== 'solidFill') return null;
    const matrixColor = matrix.children.find(isElement);
    const resolved = matrixColor
      ? resolveColorNode(matrixColor, resolveSchemeColor, placeholder)
      : null;
    return resolved ? { color: resolved } : null;
  }
  const lineFill = directFill(matrix, resolveSchemeColor, placeholder);
  if (!lineFill.present || !lineFill.color) return null;
  // Width and alignment come from `readLineProperties`, which inherits them per attribute;
  // it reuses this theme line rather than resolving it again.
  return { color: lineFill.color, matrix };
}

/** The `wps:wsp` under the anchor's graphic data, or null when the payload is something else. */
export function findWspInAnchor(anchor: OoxmlElement): OoxmlElement | null {
  const data = findGraphicData(anchor);
  if (!data) return null;
  if (schemaAttributeValue(data.attributes, 'uri') !== WPS_GRAPHIC_DATA_URI) return null;
  return (
    findDirectChild(data.children, {
      namespaceUri: WPS_NAMESPACE_URI,
      localName: 'wsp',
    }) ?? null
  );
}

/** The authored `a:gradFill` of a shape or line, when it is the element that fills it. */
function authoredGradientFill(
  parent: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver
): GradientFillSpec | null {
  for (const node of parent.children) {
    if (!isElement(node) || node.namespaceUri !== DRAWINGML_MAIN_NAMESPACE_URI) continue;
    if (node.localName === 'gradFill') return readGradientFill(node, resolveSchemeColor);
    if (['noFill', 'solidFill', 'blipFill', 'pattFill', 'grpFill'].includes(node.localName)) {
      return null;
    }
  }
  return null;
}

/** The fill and outline a `wps:wsp` paints with, from its own properties or its style. */
function shapePaint(
  wsp: OoxmlElement,
  authoredSpPr: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  groupFill?: OoxmlElement | null
) {
  // `a:grpFill` paints the fill of the nearest group that sets one.
  const spPr = withResolvedGroupFill(authoredSpPr, groupFill);
  const authoredFill = directFill(spPr, resolveSchemeColor);
  const authoredGradient = authoredFill.present
    ? authoredGradientFill(spPr, resolveSchemeColor)
    : null;
  const styleFill = authoredFill.present
    ? null
    : readStyleReference(wsp, 'fillRef', resolveSchemeColor, resolveStyleMatrixReference);
  const pattern = authoredFill.present ? authoredPatternFill(spPr, resolveSchemeColor) : null;
  const fill = authoredFill.present
    ? (authoredFill.color ??
      (authoredGradient ? gradientMeanColor(authoredGradient) : null) ??
      (pattern ? patternMeanColor(pattern) : null))
    : (styleFill?.color ?? null);
  const fillGradient = authoredFill.present ? authoredGradient : (styleFill?.gradient ?? null);
  const ln = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'ln',
  });
  const authoredStroke = ln ? directFill(ln, resolveSchemeColor) : null;
  const styleStroke =
    authoredStroke?.present === true
      ? null
      : readStyleReference(wsp, 'lnRef', resolveSchemeColor, resolveStyleMatrixReference);
  // An outline paints one colour; a gradient outline paints the mean of its stops.
  const strokeGradient =
    authoredStroke?.present === true && !authoredStroke.color && ln
      ? authoredGradientFill(ln, resolveSchemeColor)
      : null;
  const stroke =
    authoredStroke?.present === true
      ? (authoredStroke.color ?? (strokeGradient ? gradientMeanColor(strokeGradient) : null))
      : (styleStroke?.color ?? null);
  return { fill, fillGradient, pattern, ln, stroke, styleStroke };
}

function hasTextbox(wsp: OoxmlElement): boolean {
  return !!findDirectChild(wsp.children, { namespaceUri: WPS_NAMESPACE_URI, localName: 'txbx' });
}

/** The fill and outline colours a `wps:wsp` paints with, or null without `spPr`. @internal */
export function shapePaintOf(
  wsp: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
) {
  const spPr = shapeProperties(wsp);
  return spPr ? shapePaint(wsp, spPr, resolveSchemeColor, resolveStyleMatrixReference) : null;
}

const LINE_FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'pattFill']);
const SHAPE_FILLS = new Set([...LINE_FILLS, 'blipFill', 'grpFill']);

/** The first DrawingML child of `parent` named in `names`. */
function firstNamed(parent: OoxmlElement | null, names: ReadonlySet<string>) {
  return parent?.children.find(
    (node) =>
      isElement(node) &&
      node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      names.has(node.localName)
  ) as OoxmlElement | undefined;
}

/**
 * Whether a shape says it has no fill and no outline: its own `a:noFill`, or no authored paint
 * and no style paint (`a:fillRef`, `a:lnRef` index 0).
 */
function unpaintedByDesign(wsp: OoxmlElement): boolean {
  const spPr = shapeProperties(wsp);
  if (!spPr) return false;
  const none = (authored: OoxmlElement | undefined, reference: 'fillRef' | 'lnRef') =>
    authored
      ? authored.localName === 'noFill'
      : (readStyleReferenceIndex(wsp, reference)?.index ?? 0) === 0;
  const ln = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'ln',
  });
  return (
    none(firstNamed(spPr, SHAPE_FILLS), 'fillRef') && none(firstNamed(ln, LINE_FILLS), 'lnRef')
  );
}

/**
 * Whether a group member is a text box with no fill, no outline and no unsupported visuals.
 * Its only content is its text, which a group does not lay out, so the member paints nothing
 * and the group skips it.
 */
export function isUnpaintedGroupTextbox(
  member: OoxmlElement,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  groupFill?: OoxmlElement | null
): boolean {
  if (member.namespaceUri !== WPS_NAMESPACE_URI || member.localName !== 'wsp') return false;
  const spPr = shapeProperties(member);
  if (!spPr || !hasTextbox(member) || !supportedGroupVisuals(member, spPr, false)) return false;
  if (!identityGroupThemeEffect(member, resolveStyleMatrixReference)) return false;
  const paint = shapePaint(
    member,
    spPr,
    resolveSchemeColor,
    resolveStyleMatrixReference,
    groupFill
  );
  return paint.fill === null && paint.stroke === null;
}

/**
 * The painted components of one shape, one per geometry path: presets such as `can` or `cube`
 * draw faces with their own fill mode, and some paths only stroke or only fill.
 *
 * `groupMember` lets a text box member paint its shape; its story lays out separately. A
 * top-level text box paints through its story instead. A shape turns about the centre of its
 * extent, after its flips, so a turned shape may paint outside the extent.
 *
 * An empty list means the shape paints nothing (no fill and no outline); null means its
 * geometry, transform or paint is outside the supported subset.
 */
export function projectShapeComponents(
  wsp: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  pointBudget: { remaining: number },
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  groupMember = false,
  groupFill: OoxmlElement | null = null
): readonly VectorShapeComponent[] | null {
  if (!groupMember && hasTextbox(wsp)) return null;
  const spPr = shapeProperties(wsp);
  if (!spPr || groupFillSpansMembers(spPr, groupFill)) return null;
  const xfrm = shapeTransformElement(wsp);
  const rotation = shapeRotationDegrees(xfrm);
  if (rotation === null || !shapeFlagsValid(xfrm)) return null;
  const { fill, fillGradient, pattern, ln, stroke, styleStroke } = shapePaint(
    wsp,
    spPr,
    resolveSchemeColor,
    resolveStyleMatrixReference,
    groupFill
  );
  const line =
    stroke !== null
      ? readLineProperties(wsp, ln, resolveStyleMatrixReference, styleStroke?.matrix)
      : null;
  const strokeWidthEmu = line?.widthEmu ?? 0;
  if (fill === null && stroke === null) return [];

  const paths = shapePaths(spPr, extent, pointBudget);
  if (!paths) return null;
  const flipH = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipH'));
  const flipV = xfrm !== null && schemaFlagIsSet(schemaAttributeValue(xfrm.attributes, 'flipV'));
  const place = shapePointTransform(extent, flipH, flipV, rotation);
  const effectList = shapeEffectList(wsp, spPr, resolveSchemeColor, resolveStyleMatrixReference);
  const shadow = readShapeShadow(effectList, resolveSchemeColor, {
    flipH,
    flipV,
    rotationDegrees: rotation,
  });
  const gradient = fillGradient
    ? placeGradient(
        fillGradient,
        extent.cx,
        extent.cy,
        fillGradient.turnsWithShape
          ? shapeAffine(extent.cx, extent.cy, flipH, flipV, rotation)
          : shapeAffine(extent.cx, extent.cy, false, false, 0)
      )
    : null;
  const components: VectorShapeComponent[] = [];
  for (const path of paths) {
    const pathFill = pathFillColor(fill, path.fill);
    const pathStroke = path.stroke ? stroke : null;
    if (pathFill === null && pathStroke === null) continue;
    const polygons = path.subpaths
      .filter(({ points }) => points.length >= 3 || (points.length === 2 && pathStroke !== null))
      .map(({ points }) => points);
    if (polygons.length === 0) continue;
    const subpathsClosed = path.subpaths.flatMap((subpath) =>
      polygons.includes(subpath.points) ? [subpath.closed] : []
    );
    const lineEnds = pathStroke
      ? projectLineArrowheads(polygons, subpathsClosed, ln, strokeWidthEmu)
      : { arrows: [], paths: polygons };
    if (lineEnds === null) return null;
    const arrowheads = lineEnds.arrows;
    // A filled path keeps its outline; only a stroke-only path stops short of its line ends.
    const outlines = pathFill === null ? lineEnds.paths : polygons;
    const arrowPoints = arrowheads.reduce((sum, outline) => sum + outline.length, 0);
    if (arrowPoints > pointBudget.remaining) return null;
    pointBudget.remaining -= arrowPoints;
    components.push({
      subpathsEmu: outlines.map((points) => points.map(place)),
      subpathsClosed,
      ...(arrowheads.length
        ? { arrowheadsEmu: arrowheads.map((points) => points.map(place)) }
        : {}),
      fillHex: pathFill?.hex ?? null,
      fillAlpha: pathFill?.alpha ?? 1,
      ...(gradient && pathFill
        ? {
            fillGradient:
              path.fill === 'norm'
                ? gradient
                : shadeGradient(gradient, (color) => pathFillColor(color, path.fill) ?? color),
          }
        : {}),
      ...(pattern && pathFill && path.fill === 'norm' ? { fillPattern: pattern } : {}),
      strokeHex: pathStroke?.hex ?? null,
      strokeAlpha: pathStroke?.alpha ?? 1,
      strokeWidthEmu: pathStroke ? strokeWidthEmu : 0,
      ...(pathStroke && line?.cap ? { strokeCap: line.cap } : {}),
      ...(pathStroke && line ? { strokeJoin: line.join } : {}),
      ...(pathStroke && line?.join === 'miter' ? { strokeMiterLimit: line.miterLimit } : {}),
      ...(pathStroke && line?.dash ? { strokeDash: line.dash } : {}),
      // Only a closed outline with area can sit inside its geometry: a line, or a closed path
      // collapsed onto a line, stays centred, or the clip to its own path would remove it.
      ...(pathStroke &&
      line?.alignment === 'in' &&
      subpathsClosed.every(Boolean) &&
      polygons.every(enclosesArea)
        ? { strokeInset: true }
        : {}),
    });
  }
  if (line && line.compound !== 'sng') {
    components.splice(
      0,
      components.length,
      ...components.flatMap((component) => compoundBands(component, line.compound))
    );
  }
  // One shadow for the whole shape, under all of its paths: a single path carries it, and a
  // shape of several paths gets a silhouette of them all, painted before any of them.
  if (shadow && components.length === 1) {
    components[0] = { ...components[0]!, shadow };
  } else if (shadow && components.length > 1) {
    const silhouette = components.filter((component) => component.fillHex !== null);
    const casters = silhouette.length ? silhouette : components;
    components.unshift({
      subpathsEmu: casters.flatMap((component) => component.subpathsEmu),
      subpathsClosed: casters.flatMap((component) =>
        component.subpathsEmu.map((_, index) => component.subpathsClosed?.[index] !== false)
      ),
      fillHex: silhouette.length ? casters[0]!.fillHex : null,
      fillAlpha: 1,
      strokeHex: silhouette.length ? null : casters[0]!.strokeHex,
      strokeAlpha: 1,
      strokeWidthEmu: silhouette.length ? 0 : casters[0]!.strokeWidthEmu,
      shadow,
      shadowOnly: true,
    });
  }
  // Effects beyond the outer shadow paint only through an installed effects renderer.
  const effects = drawingRenderers().effects;
  if (!effects) return components;
  return effects.shape({
    shape: wsp,
    spPr,
    effectList,
    components,
    extent,
    ...(resolveSchemeColor ? { resolveSchemeColor } : {}),
  });
}

/**
 * The shape's geometry paths in its own extent, charged against the point budget. A straight
 * line keeps its endpoints exactly, so a zero-extent axis stays a line. A custom geometry
 * keeps the bounded polygon reader where it applies; the geometry engine covers presets and
 * the custom paths that reader refuses (arcs and quadratic curves).
 */
function shapePaths(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  pointBudget: { remaining: number }
): readonly ShapePath[] | null {
  const prstGeom = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'prstGeom',
  });
  const preset = prstGeom ? schemaAttributeValue(prstGeom.attributes, 'prst') : undefined;
  const custGeom = findDirectChild(spPr.children, {
    namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
    localName: 'custGeom',
  });
  if (!custGeom && (preset === 'line' || preset === 'straightConnector1')) {
    if (pointBudget.remaining < 2) return null;
    pointBudget.remaining -= 2;
    const points = [
      { x: 0, y: 0 },
      { x: extent.cx, y: extent.cy },
    ];
    return [{ subpaths: [{ points, closed: false }], fill: 'norm', stroke: true }];
  }
  if (custGeom) {
    const polygons = readCustomPolygons(custGeom, extent, pointBudget);
    if (polygons) return [polygons];
    // Only what the polygon reader cannot express goes to the engine. A path the reader
    // refuses for its sizes, such as a zero path space on a sized axis, stays refused.
    if (!needsGeometryEngine(custGeom)) return null;
  }
  const geometry = readShapeGeometry(spPr, extent);
  if (!geometry) return null;
  let points = 0;
  for (const path of geometry.paths) {
    for (const subpath of path.subpaths) points += subpath.points.length;
  }
  if (points > pointBudget.remaining) return null;
  pointBudget.remaining -= points;
  return geometry.paths;
}

/** Whether a closed path encloses any area (shoelace), so that clipping to it leaves ink. */
function enclosesArea(points: readonly Readonly<{ x: number; y: number }>[]): boolean {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  // Relative to the path's own box, so child units of any size work; what remains below this
  // is rounding on a collinear path, not an inside.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const box = (maxX - minX) * (maxY - minY);
  return box > 0 && Math.abs(twiceArea) > box * 1e-9;
}

/**
 * Renderable-subset projection of direct `wps:wsp` and one bounded `wpg:wgp` group.
 *
 * `groupPictureNodeIds` names the group members the group picture projection paints; they
 * are skipped here. Every other member must be a supported `wps:wsp`, or the group refuses.
 */
export function projectVectorShape(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  compatibilityMode: boolean,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver,
  groupPictureNodeIds?: ReadonlySet<string>
): VectorShapeProjection | null {
  void compatibilityMode;
  // A straight vertical or horizontal line has a zero width or height.
  if (extent.cx < 0 || extent.cy < 0) return null;
  const pointBudget = { remaining: MAX_VECTOR_SHAPE_POINTS };
  const wsp = findWspInAnchor(anchor);
  if (extent.cx === 0 && extent.cy === 0) {
    // A group with no extent stays refused: its members have no extent to scale into.
    return wsp && !hasTextbox(wsp) ? zeroExtentShapeProjection(wsp) : null;
  }
  let components: VectorShapeComponent[] = [];
  let rotationDegrees = 0;
  let overflowVisible = false;
  if (wsp) {
    const shapeComponents = projectShapeComponents(
      wsp,
      extent,
      pointBudget,
      resolveSchemeColor,
      resolveStyleMatrixReference
    );
    if (!shapeComponents) return null;
    // A custom geometry with no paths, or a shape that sets neither a fill nor an outline,
    // paints nothing and keeps its box with no components and no placeholder. Any other empty
    // list, such as a colour the theme does not resolve, keeps the placeholder.
    if (
      shapeComponents.length === 0 &&
      !hasPathlessCustomGeometry(shapeProperties(wsp)) &&
      !unpaintedByDesign(wsp)
    ) {
      return null;
    }
    components = [...shapeComponents];
    rotationDegrees = shapeRotationDegrees(shapeTransformElement(wsp)) ?? 0;
    // A direct shape paints its whole geometry and outline, past its extent too.
    overflowVisible = true;
  } else {
    const frame = readDrawingGroupFrame(anchor, { turned: true });
    if (!frame) return null;
    const turn = frame.turn;
    const { x: chOffX, y: chOffY } = frame.childOffsetEmu;
    const { cx: chExtX, cy: chExtY } = frame.childExtentEmu;
    // Rules that share one x (or y) give the group a zero child extent on that axis. Every
    // child then sits at the group's origin on that axis, whatever the group's own extent.
    const scaleX = chExtX > 0 ? extent.cx / chExtX : 0;
    const scaleY = chExtY > 0 ? extent.cy / chExtY : 0;
    let childCount = 0;
    const groupFill = groupFillOf(frame.group, null);
    for (const child of frame.group.children) {
      if (!isElement(child) || isGroupPropertyChild(child)) continue;
      childCount += 1;
      if (childCount > MAX_GROUP_SHAPE_CHILDREN) return null;
      if (groupPictureNodeIds?.has(child.id)) {
        // The group picture paints the raster; its outline, if any, strokes above it here.
        const outline = groupPictureOutline(child, pointBudget, resolveSchemeColor, {
          project: projectShapeComponents,
          childTransform,
          place: (component, offset) =>
            transformComponent(
              component,
              { x: (offset.x - chOffX) * scaleX, y: (offset.y - chOffY) * scaleY },
              scaleX,
              scaleY
            ),
        });
        if (outline === null) return null;
        components.push(...outline);
        continue;
      }
      // One group level is the enforced nesting cap. Do not paint a partial nested group.
      if (child.namespaceUri !== WPS_NAMESPACE_URI || child.localName !== 'wsp') return null;
      const properties = findDirectChild(child.children, {
        namespaceUri: WPS_NAMESPACE_URI,
        localName: 'spPr',
      });
      if (!properties || !supportedGroupVisuals(child, properties, false)) return null;
      if (!identityGroupThemeEffect(child, resolveStyleMatrixReference)) return null;
      // The text of a text box member does not turn with its group yet: keep the placeholder.
      if (turn && hasTextbox(child)) return null;
      if (
        isUnpaintedGroupTextbox(child, resolveSchemeColor, resolveStyleMatrixReference, groupFill)
      )
        continue;
      const transform = childTransform(child);
      if (!transform) return null;
      // A turned member turns in group space, after its box scales, so it never skews.
      const memberTurn = shapeRotationDegrees(shapeTransformElement(child)) ?? 0;
      // A turned member paints whole, past the group extent where its corners reach.
      if (memberTurn !== 0) overflowVisible = true;
      const place = groupMemberPlacement(
        transform,
        frame.childOffsetEmu,
        scaleX,
        scaleY,
        memberTurn
      );
      const memberComponents = projectShapeComponents(
        child,
        place.extent,
        pointBudget,
        resolveSchemeColor,
        resolveStyleMatrixReference,
        true,
        groupFill
      );
      if (!memberComponents) return null; // A member that paints nothing adds nothing.
      for (const component of memberComponents) {
        components.push(transformComponent(component, place.offset, place.scaleX, place.scaleY));
      }
    }
    if (components.length === 0) return null;
    if (turn) {
      const turned = turnGroupComponents(components, extent, turn);
      if (!turned) return null;
      components = turned;
      rotationDegrees = turn.rotationDegrees;
    }
  }
  const subpathsEmu: (readonly Readonly<{ x: number; y: number }>[])[] = [];
  for (const component of components) {
    for (const path of component.subpathsEmu) subpathsEmu.push(path);
  }
  const first = components.length === 1 ? components[0]! : null;
  return {
    extentEmu: { cx: extent.cx, cy: extent.cy },
    subpathsEmu,
    fillHex: first?.fillHex ?? null,
    fillAlpha: first?.fillAlpha ?? 1,
    strokeHex: first?.strokeHex ?? null,
    strokeAlpha: first?.strokeAlpha ?? 1,
    strokeWidthEmu: first?.strokeWidthEmu ?? 0,
    components,
    ...(overflowVisible || rotationDegrees !== 0 ? { overflowVisible: true as const } : {}),
    ...(rotationDegrees !== 0 ? { rotationDegrees } : {}),
  };
}

/** OOXML `wps:bodyPr` inset defaults in EMU. */
const DEFAULT_TEXTBOX_INSET_LR_EMU = 91_440;
const DEFAULT_TEXTBOX_INSET_TB_EMU = 45_720;

/**
 * Story projection of a `wps:wsp` carrying a `wps:txbx`. Captures the `w:txbxContent` root and
 * the bodyPr/shape-chrome reads without walking the story content; returns null when the shape
 * is not a text box or the box has no usable extent.
 */
export function projectTextboxStory(
  anchor: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): TextboxStoryProjection | null {
  const wsp = findWspInAnchor(anchor);
  if (!wsp) return null;
  const story = projectWspTextboxStory(
    wsp,
    extent,
    resolveSchemeColor,
    resolveStyleMatrixReference
  );
  if (!story) return story;
  // `a:spAutoFit` resizes a top-level box to its text, inline or anchored, turned or not. A
  // group member keeps its member size: the group's own extent places every member.
  const fitted: TextboxStoryProjection =
    story.autofit === 'shape' ? { ...story, fitHeightToText: true, drawingFit: true } : story;
  const spPr = shapeProperties(wsp);
  if (!spPr) return fitted;
  // A top-level box paints the outline of its geometry, turns, and flows its text vertically;
  // a group member's shape paints with the group.
  const bodyPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  const frame = drawingTextboxFrame(spPr, bodyPr, extent);
  return frame ? { ...fitted, legacyFrame: frame, strokeCentered: true } : fitted;
}

/**
 * Story projection of one `wps:wsp` element at `extent`: a top-level text box, or a text box
 * member of a group at its scaled member size. Null when the shape holds no story.
 */
export function projectWspTextboxStory(
  wsp: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  resolveSchemeColor?: ShapeSchemeColorResolver,
  resolveStyleMatrixReference?: ShapeStyleMatrixResolver
): TextboxStoryProjection | null {
  if (extent.cx <= 0 || extent.cy <= 0) return null;
  const txbx = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'txbx',
  });
  if (!txbx) return null;
  const content = findDirectChild(txbx.children, {
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'txbxContent',
  });
  if (!content) return null;

  const bodyPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'bodyPr',
  });
  const inset = (name: string, fallback: number): number => {
    const raw = bodyPr ? schemaAttributeValue(bodyPr.attributes, name) : undefined;
    if (raw === undefined) return fallback;
    const value = parseEmu(raw, false);
    return value === null || value < 0 ? fallback : value;
  };
  const anchorRaw = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'anchor') : undefined;
  const verticalAnchor =
    anchorRaw === 'ctr' ? 'center' : anchorRaw === 'b' ? 'bottom' : ('top' as const);
  const noWrap = bodyPr ? schemaAttributeValue(bodyPr.attributes, 'wrap') === 'none' : false;
  let autofit: TextboxStoryProjection['autofit'] = 'none';
  if (bodyPr) {
    if (
      findDirectChild(bodyPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'spAutoFit',
      })
    ) {
      autofit = 'shape';
    } else if (
      findDirectChild(bodyPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'normAutofit',
      })
    ) {
      autofit = 'normal';
    }
  }

  const spPr = findDirectChild(wsp.children, {
    namespaceUri: WPS_NAMESPACE_URI,
    localName: 'spPr',
  });
  const authoredFill = spPr ? directFill(spPr, resolveSchemeColor) : null;
  const styleFill =
    authoredFill?.present === true
      ? null
      : readStyleReference(wsp, 'fillRef', resolveSchemeColor, resolveStyleMatrixReference);
  const fillHex =
    (authoredFill?.present === true ? authoredFill.color?.hex : styleFill?.color.hex) ?? null;
  const ln = spPr
    ? findDirectChild(spPr.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'ln',
      })
    : null;
  const authoredStroke = ln ? directFill(ln, resolveSchemeColor) : null;
  const styleStroke =
    authoredStroke?.present === true
      ? null
      : readStyleReference(wsp, 'lnRef', resolveSchemeColor, resolveStyleMatrixReference);
  const strokeHex =
    (authoredStroke?.present === true ? authoredStroke.color?.hex : styleStroke?.color.hex) ?? null;
  const outline =
    strokeHex !== null
      ? readLineProperties(wsp, ln, resolveStyleMatrixReference, styleStroke?.matrix)
      : null;
  const strokeWidthEmu = outline?.widthEmu ?? 0;

  return {
    contentNodeId: content.id,
    content,
    insetsEmu: {
      top: inset('tIns', DEFAULT_TEXTBOX_INSET_TB_EMU),
      right: inset('rIns', DEFAULT_TEXTBOX_INSET_LR_EMU),
      bottom: inset('bIns', DEFAULT_TEXTBOX_INSET_TB_EMU),
      left: inset('lIns', DEFAULT_TEXTBOX_INSET_LR_EMU),
    },
    verticalAnchor,
    autofit,
    ...(noWrap ? { noWrap: true as const } : {}),
    fillHex,
    strokeHex,
    strokeWidthEmu,
    ...(outline?.dash ? { strokeDash: outline.dash } : {}),
  };
}
