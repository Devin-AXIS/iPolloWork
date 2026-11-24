// The frame a picture draws from its `pic:spPr`: the geometry that clips the picture, the
// outline over it, and the outer shadow and fill under it. Other effects (glow, reflection,
// soft edge) come from an installed effects renderer.

import { readShapeShadow, shapeEffectList, type ShapeReflection } from './drawing-shape-effects.ts';
import { drawingRenderers } from './drawing-renderers.ts';
import { directFill, type ShapeColor } from './drawing-shape-color.ts';
import { gradientMeanColor, readGradientFill } from './drawing-gradient.ts';
import { readShapeGeometry, shapePointTransform } from './drawing-shape-geometry.ts';
import { readLineProperties } from './drawing-line-properties.ts';
import { compoundBands } from './drawing-line-compound.ts';
import { findDirectChild, parseEmu } from './drawing-shape-readers.ts';
import type {
  ShapeSchemeColorResolver,
  ShapeStyleMatrixResolver,
  VectorShapeComponent,
  VectorShapeProjection,
} from './drawing-shape-projection.ts';
import { parseSchemaBoolean, schemaAttributeValue } from './ooxml-drawing-rules.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  type OoxmlElement,
} from './ooxml-tree.ts';

type Point = Readonly<{ x: number; y: number }>;

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** The geometry of one picture frame never takes more points than a lone shape may. */
const MAX_FRAME_POINTS = 1024;

export interface PictureFrameContext {
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
  readonly resolveStyleMatrixReference?: ShapeStyleMatrixResolver;
}

export interface PictureFrameProjection {
  /**
   * The ring that clips the picture, in the unit square of its extent, for geometry other than
   * a rectangle. Absent when the geometry is a rectangle or has more than one outline.
   */
  readonly clipUnit?: readonly Point[];
  /** Effects that change how the picture itself paints. */
  readonly effects?: PictureFrameEffects;
  /**
   * What the frame paints, in the extent's EMU space: components marked `belowPicture`
   * (outer shadow, fill) paint under the picture, the outline over it. Null when the frame
   * paints nothing.
   */
  readonly vectorShape: VectorShapeProjection | null;
}

/** Effects that change how a picture itself paints, beyond what its frame draws. @public */
export interface PictureFrameEffects {
  /** A mirror image of the picture below it. */
  readonly reflection?: ShapeReflection;
  /** The picture's edge fades out over this distance inside it. */
  readonly softEdgeEmu?: number;
}

const NO_FRAME: PictureFrameProjection = Object.freeze({ vectorShape: null });

/** The color an authored fill paints with: solid, or the mean of a gradient's stops. */
function fillColor(parent: OoxmlElement, ctx: PictureFrameContext): ShapeColor | null {
  const fill = directFill(parent, ctx.resolveSchemeColor);
  if (!fill.present) return null;
  if (fill.color) return fill.color;
  const gradFill = findDirectChild(parent.children, { namespaceUri: A, localName: 'gradFill' });
  const gradient = gradFill ? readGradientFill(gradFill, ctx.resolveSchemeColor) : null;
  return gradient ? gradientMeanColor(gradient) : null;
}

/**
 * The frame of a `pic:pic`, sized to the drawing extent. A turned picture keeps its clip, which
 * layout turns with the picture, but paints no frame: its outline and shadow would need the
 * turned box layout reserves for the picture alone.
 */
export function projectPictureFrame(
  picture: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  ctx: PictureFrameContext
): PictureFrameProjection {
  const spPr = findDirectChild(picture.children, {
    typedKind: 'pictureShapeProperties',
    namespaceUri: PIC_NAMESPACE_URI,
    localName: 'spPr',
  });
  if (!spPr || !(extent.cx > 0) || !(extent.cy > 0)) return NO_FRAME;
  const geometry = readShapeGeometry(spPr, extent);
  const clipUnit = geometry ? clipRing(geometry.paths, extent) : null;
  const xfrm = findDirectChild(spPr.children, {
    typedKind: 'pictureTransform',
    namespaceUri: A,
    localName: 'xfrm',
  });
  const rotation = xfrm ? parseEmu(schemaAttributeValue(xfrm.attributes, 'rot'), false) : null;
  const flag = (name: string) =>
    xfrm ? (parseSchemaBoolean(schemaAttributeValue(xfrm.attributes, name)) ?? false) : false;
  const turned = rotation !== null && rotation % 21_600_000 !== 0;
  const place = shapePointTransform(extent, flag('flipH'), flag('flipV'), 0);
  const budget = { remaining: MAX_FRAME_POINTS };
  const filled = turned
    ? null
    : framePaths(spPr, extent, 0, place, budget, (path) => path.fill !== 'none');
  const effectList = shapeEffectList(
    picture,
    spPr,
    ctx.resolveSchemeColor,
    ctx.resolveStyleMatrixReference
  );
  const effectsRenderer = drawingRenderers().effects;
  // A turned picture paints no frame and no effects.
  const projected =
    effectsRenderer && !turned
      ? effectsRenderer.picture({
          shape: picture,
          spPr,
          effectList,
          outlineEmu: filled?.length ? filled.map((subpath) => subpath.points) : null,
          ...(ctx.resolveSchemeColor ? { resolveSchemeColor: ctx.resolveSchemeColor } : {}),
        })
      : null;
  const effects = projected?.effects ?? null;
  const clip = { ...(clipUnit ? { clipUnit } : {}), ...(effects ? { effects } : {}) };
  if (turned) return { ...(clipUnit ? { clipUnit } : {}), vectorShape: null };
  if (!filled) return { ...clip, vectorShape: null };

  const components: VectorShapeComponent[] = [];
  const shadow = readShapeShadow(effectList, ctx.resolveSchemeColor, {
    flipH: flag('flipH'),
    flipV: flag('flipV'),
    rotationDegrees: 0,
  });
  if (shadow && filled.length) {
    components.push({
      subpathsEmu: filled.map((subpath) => subpath.points),
      subpathsClosed: filled.map(() => true),
      fillHex: shadow.hex,
      fillAlpha: 1,
      strokeHex: null,
      strokeAlpha: 1,
      strokeWidthEmu: 0,
      shadow,
      shadowOnly: true,
      belowPicture: true,
    });
  }
  // Effects under the picture (a glow) paint first, under its shadow too.
  const under = projected?.underComponents ?? [];
  if (under.length) {
    const marked = under.map((component) => ({ ...component, belowPicture: true as const }));
    components.splice(0, components.length, ...marked, ...components);
  }
  // A fill shows where the picture is transparent, so it paints under the picture.
  const fill = fillColor(spPr, ctx);
  if (fill && filled.length) {
    components.push({
      subpathsEmu: filled.map((subpath) => subpath.points),
      subpathsClosed: filled.map(() => true),
      fillHex: fill.hex,
      fillAlpha: fill.alpha,
      strokeHex: null,
      strokeAlpha: 1,
      strokeWidthEmu: 0,
      belowPicture: true,
    });
  }
  const ln = findDirectChild(spPr.children, { namespaceUri: A, localName: 'ln' });
  const stroke = ln ? fillColor(ln, ctx) : null;
  const line =
    ln && stroke ? readLineProperties(picture, ln, ctx.resolveStyleMatrixReference) : null;
  // The outline runs on the geometry grown by half its width, so it lies wholly outside the
  // picture and never covers it.
  const stroked =
    line && line.widthEmu > 0
      ? framePaths(spPr, extent, line.widthEmu, place, budget, (path) => path.stroke)
      : null;
  if (stroke && line && stroked?.length) {
    const outline: VectorShapeComponent = {
      subpathsEmu: stroked.map((subpath) => subpath.points),
      subpathsClosed: stroked.map((subpath) => subpath.closed),
      fillHex: null,
      fillAlpha: 1,
      strokeHex: stroke.hex,
      strokeAlpha: stroke.alpha,
      strokeWidthEmu: line.widthEmu,
      strokeOutsetEmu: line.widthEmu / 2,
      ...(line.cap ? { strokeCap: line.cap } : {}),
      // A picture outline with no join of its own joins round.
      strokeJoin: line.join ?? 'round',
      ...(line.dash ? { strokeDash: line.dash } : {}),
    };
    components.push(...compoundBands(outline, line.compound));
  }
  if (!components.length) return { ...clip, vectorShape: null };
  return {
    ...clip,
    vectorShape: {
      extentEmu: { cx: extent.cx, cy: extent.cy },
      subpathsEmu: components.flatMap((component) => component.subpathsEmu),
      fillHex: null,
      strokeHex: null,
      strokeWidthEmu: 0,
      components,
    },
  };
}

type FramePath = { readonly points: readonly Point[]; readonly closed: boolean };

/**
 * The subpaths of the frame geometry that `pick` keeps, evaluated on the extent grown by `grow`
 * on every side and placed in the extent, charged against `budget`. A frame with no geometry
 * of its own is a rectangle. Null when the points run past the budget.
 */
function framePaths(
  spPr: OoxmlElement,
  extent: Readonly<{ cx: number; cy: number }>,
  grow: number,
  place: (point: Point) => Point,
  budget: { remaining: number },
  pick: (path: { readonly fill: string; readonly stroke: boolean }) => boolean
): readonly FramePath[] | null {
  const half = grow / 2;
  const box = { cx: extent.cx + grow, cy: extent.cy + grow };
  const geometry = readShapeGeometry(spPr, box);
  const paths = geometry?.paths ?? [
    {
      subpaths: [
        {
          points: [
            { x: 0, y: 0 },
            { x: box.cx, y: 0 },
            { x: box.cx, y: box.cy },
            { x: 0, y: box.cy },
          ],
          closed: true,
        },
      ],
      fill: 'norm',
      stroke: true,
    },
  ];
  const out: FramePath[] = [];
  for (const path of paths) {
    if (!pick(path)) continue;
    for (const subpath of path.subpaths) {
      budget.remaining -= subpath.points.length;
      if (budget.remaining < 0) return null;
      out.push({
        points: subpath.points.map((point) => place({ x: point.x - half, y: point.y - half })),
        closed: subpath.closed,
      });
    }
  }
  return out;
}

/**
 * The geometry's one filled outline as a ring in the unit square, or null for a rectangle
 * (the default clip) and for geometry of several outlines, which one ring cannot express.
 */
function clipRing(
  paths: readonly {
    readonly fill: string;
    readonly subpaths: readonly { readonly points: readonly Point[]; readonly closed: boolean }[];
  }[],
  extent: Readonly<{ cx: number; cy: number }>
): readonly Point[] | null {
  const outlines = paths.filter((path) => path.fill !== 'none').flatMap((path) => path.subpaths);
  if (outlines.length !== 1) return null;
  const count = outlines[0]!.points.length;
  if (count < 3 || count > MAX_FRAME_POINTS) return null;
  const ring = outlines[0]!.points.map((point) =>
    Object.freeze({ x: point.x / extent.cx, y: point.y / extent.cy })
  );
  if (!ring.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const isRectangle =
    ring.length === 4 &&
    ring.every((point) => (point.x === 0 || point.x === 1) && (point.y === 0 || point.y === 1));
  return isRectangle ? null : Object.freeze(ring);
}
