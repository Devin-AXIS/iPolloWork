// Pure drawing geometry normalization (typed-drawings-and-images task 8).
//
// DOM-free points everywhere. `wp:extent` is the authoritative layout size; picture
// transforms (`a:xfrm`, preset clip) affect paint/hit/wrap geometry. `a:srcRect` crops
// image pixels only — it must not shrink or remap `a:prstGeom` clip or wrap contours.

import type { DrawingTransform, SourceCrop } from '../store/package/drawing-projection.ts';
import { DEFAULT_IMAGE_RESOURCE_LIMITS } from '../store/runtime/limits.ts';
import { clipBoxToRegion, EMU_PER_POINT, emuToPointsSafe } from './drawing-layout.ts';
import type { LayoutBox } from './semantic-records.ts';

export const ROTATION_UNITS_PER_DEGREE = 60_000;
export const CROP_PERCENT_MAX = 100_000;
export const MAX_IMAGE_POLYGON_POINTS = DEFAULT_IMAGE_RESOURCE_LIMITS.maxPolygonPoints;

export interface DrawingPoint {
  readonly x: number;
  readonly y: number;
}

export interface DrawingInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface NormalizedCrop {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type DrawingClipFallback = 'none' | 'unsupported-preset';

export interface DrawingGeometry {
  readonly contentBounds: LayoutBox;
  readonly paintBounds: LayoutBox;
  readonly hitBounds: LayoutBox;
  readonly transformedCorners: readonly DrawingPoint[];
  /** Unclipped image corners for affine encoding; clipping must not stretch the image. */
  readonly imageTransformCorners?: readonly DrawingPoint[];
  readonly clipPolygon: readonly DrawingPoint[] | null;
  readonly clipFallback: DrawingClipFallback;
  readonly effectInsets: DrawingInsets;
  /**
   * How far a layout region, such as a cell or the page, cut into the extent on each side.
   * Absent when no region did. An inline drawing's own line and column clip does not count.
   * A shape that paints past its extent stays cut at the region edge on these sides.
   */
  readonly regionCuts?: DrawingRegionCuts;
}

/**
 * How far inside each extent side a layout region's edge sits, in points: the deepest cut of
 * every region the drawing was clipped to. Zero where no region cut that side.
 */
export interface DrawingRegionCuts {
  /** How far below the extent's top edge a region's top edge sits. */
  readonly top: number;
  /** How far left of the extent's right edge a region's right edge sits. */
  readonly right: number;
  /** How far above the extent's bottom edge a region's bottom edge sits. */
  readonly bottom: number;
  /** How far right of the extent's left edge a region's left edge sits. */
  readonly left: number;
}

/** How far inside the extent edge a region edge must sit to cut it, in points. */
const REGION_CUT_EPSILON = 1e-3;

/** The extent sides `region` cuts into, and how deep, merged with earlier cuts. */
function regionCutsOf(geometry: DrawingGeometry, region: LayoutBox): DrawingRegionCuts | undefined {
  const content = geometry.contentBounds;
  const previous = geometry.regionCuts;
  // `depth` is how far inside the extent edge the region edge sits.
  const cuts = (depth: number, before = 0) =>
    depth > REGION_CUT_EPSILON ? Math.max(depth, before) : before;
  const result = {
    top: cuts(region.y - content.y, previous?.top),
    right: cuts(content.x + content.width - (region.x + region.width), previous?.right),
    bottom: cuts(content.y + content.height - (region.y + region.height), previous?.bottom),
    left: cuts(region.x - content.x, previous?.left),
  };
  return result.top > 0 || result.right > 0 || result.bottom > 0 || result.left > 0
    ? Object.freeze(result)
    : undefined;
}

export interface DrawingGeometryInput {
  readonly extentWidth: number;
  readonly extentHeight: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly effectExtentEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
  readonly presetGeometry: string | null;
  /** The geometry's clip ring in the unit square of the frame; it overrides the preset. */
  readonly clipUnit?: readonly DrawingPoint[];
}

const EMPTY_INSETS: DrawingInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const ELLIPSE_SEGMENTS = 32;
const ROUND_RECT_RATIO = 0.1;

const SUPPORTED_PRESET_GEometries = new Set(['rect', 'ellipse', 'roundRect']);

export function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function safeAdd(a: number, b: number): number {
  const sum = a + b;
  return Number.isFinite(sum) ? sum : 0;
}

function normalizeOpposingPair(
  left: number,
  right: number,
  maxSum: number
): { left: number; right: number } {
  let l = clamp(left, 0, maxSum);
  let r = clamp(right, 0, maxSum);
  if (l <= 0 || r <= 0) return { left: l, right: r };
  const sum = l + r;
  if (sum >= maxSum) {
    const scale = (maxSum - 1) / sum;
    l *= scale;
    r *= scale;
  }
  return { left: l, right: r };
}

/** Normalize raw OOXML rotation (60000ths of a degree) to [0, 360). */
export function normalizeRotationFromRaw(raw60000: number): number {
  if (!Number.isFinite(raw60000)) return 0;
  const degrees = raw60000 / ROTATION_UNITS_PER_DEGREE;
  let normalized = degrees % 360;
  if (normalized < 0) normalized += 360;
  return Number.isFinite(normalized) ? normalized : 0;
}

/** @deprecated Prefer {@link normalizeRotationFromRaw}. */
export function normalizeRotationDegrees(raw60000: number): number {
  return normalizeRotationFromRaw(raw60000);
}

/** Normalize raw crop percentages in [0, 100000] with opposing-sum guard. */
export function normalizeCropFromRaw(
  crop: Readonly<{ left: number; top: number; right: number; bottom: number }>
): NormalizedCrop {
  const horizontal = normalizeOpposingPair(
    clamp(crop.left, 0, CROP_PERCENT_MAX),
    clamp(crop.right, 0, CROP_PERCENT_MAX),
    CROP_PERCENT_MAX
  );
  const vertical = normalizeOpposingPair(
    clamp(crop.top, 0, CROP_PERCENT_MAX),
    clamp(crop.bottom, 0, CROP_PERCENT_MAX),
    CROP_PERCENT_MAX
  );
  return Object.freeze({
    left: horizontal.left,
    top: vertical.left,
    right: horizontal.right,
    bottom: vertical.right,
  });
}

/** Normalize projected crop fractions with opposing-sum guard. */
export function normalizeCropFractions(crop: SourceCrop): NormalizedCrop {
  const raw = normalizeCropFromRaw({
    left: crop.left * CROP_PERCENT_MAX,
    top: crop.top * CROP_PERCENT_MAX,
    right: crop.right * CROP_PERCENT_MAX,
    bottom: crop.bottom * CROP_PERCENT_MAX,
  });
  return Object.freeze({
    left: raw.left / CROP_PERCENT_MAX,
    top: raw.top / CROP_PERCENT_MAX,
    right: raw.right / CROP_PERCENT_MAX,
    bottom: raw.bottom / CROP_PERCENT_MAX,
  });
}

export function effectInsetsFromEmu(
  effectExtentEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>
): DrawingInsets {
  const toPoint = (emu: number): number => {
    if (!Number.isFinite(emu)) return 0;
    const points = emu / EMU_PER_POINT;
    if (!Number.isFinite(points)) return 0;
    if (Math.abs(points) > 10_000 * 72) return 0;
    return points;
  };
  return Object.freeze({
    top: toPoint(effectExtentEmu.top),
    right: toPoint(effectExtentEmu.right),
    bottom: toPoint(effectExtentEmu.bottom),
    left: toPoint(effectExtentEmu.left),
  });
}

export function expandBoxByInsets(box: LayoutBox, insets: DrawingInsets): LayoutBox {
  const left = finite(insets.left);
  const right = finite(insets.right);
  const top = finite(insets.top);
  const bottom = finite(insets.bottom);
  return Object.freeze({
    x: box.x - left,
    y: box.y - top,
    width: Math.max(0, safeAdd(box.width, left + right)),
    height: Math.max(0, safeAdd(box.height, top + bottom)),
  });
}

function visibleCropRect(
  width: number,
  height: number,
  crop: NormalizedCrop
): {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
} {
  const left = width * clamp(crop.left, 0, 1);
  const top = height * clamp(crop.top, 0, 1);
  const right = width * (1 - clamp(crop.right, 0, 1));
  const bottom = height * (1 - clamp(crop.bottom, 0, 1));
  // A side with no size of its own (a straight line's frame) is not cropped away.
  const emptyX = width > 0 ? right <= left : right < left;
  const emptyY = height > 0 ? bottom <= top : bottom < top;
  if (emptyX || emptyY) {
    const cx = width / 2;
    const cy = height / 2;
    return Object.freeze({ left: cx, top: cy, right: cx, bottom: cy });
  }
  return Object.freeze({ left, top, right, bottom });
}

export function sourceExtentFrame(
  transform: DrawingTransform,
  fallbackWidth: number,
  fallbackHeight: number
): {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
} {
  const cx = transform.extentEmu?.cx ?? 0;
  const cy = transform.extentEmu?.cy ?? 0;
  const offset = transform.offsetEmu ?? { x: 0, y: 0 };
  const width =
    cx > 0 ? finite(emuToPointsSafe(cx) ?? fallbackWidth) : Math.max(0, finite(fallbackWidth));
  const height =
    cy > 0 ? finite(emuToPointsSafe(cy) ?? fallbackHeight) : Math.max(0, finite(fallbackHeight));
  return Object.freeze({
    offsetX: finite(emuToPointsSafe(offset.x) ?? 0),
    offsetY: finite(emuToPointsSafe(offset.y) ?? 0),
    width,
    height,
  });
}

function cropLocalPoints(
  points: readonly DrawingPoint[],
  sourceWidth: number,
  sourceHeight: number,
  crop: NormalizedCrop
): readonly DrawingPoint[] {
  const visible = visibleCropRect(sourceWidth, sourceHeight, crop);
  const visibleWidth = visible.right - visible.left;
  const visibleHeight = visible.bottom - visible.top;
  // Guard division by zero only. `Math.max(dim, 1)` used to force a 1pt floor, which
  // silently scaled every sub-1pt source axis (Word's ~0.75pt form-rule bars) down by
  // `dim/1` — paintBounds came out 0.5625pt tall for a 0.75pt extent and the SVG clipped
  // to a sub-pixel box that disappeared on screen.
  const safeWidth = sourceWidth > 0 ? sourceWidth : 1;
  const safeHeight = sourceHeight > 0 ? sourceHeight : 1;
  const out: DrawingPoint[] = [];
  const limit = Math.min(points.length, MAX_IMAGE_POLYGON_POINTS);
  for (let index = 0; index < limit; index += 1) {
    const point = points[index]!;
    const nx =
      visibleWidth <= 0
        ? visible.left
        : visible.left + clamp(point.x / safeWidth, 0, 1) * visibleWidth;
    const ny =
      visibleHeight <= 0
        ? visible.top
        : visible.top + clamp(point.y / safeHeight, 0, 1) * visibleHeight;
    out.push(Object.freeze({ x: finite(nx), y: finite(ny) }));
  }
  return Object.freeze(out);
}

function transformAroundCenter(
  point: DrawingPoint,
  center: DrawingPoint,
  transform: DrawingTransform
): DrawingPoint {
  let x = point.x - center.x;
  let y = point.y - center.y;
  if (transform.flipHorizontal) x = -x;
  if (transform.flipVertical) y = -y;
  const radians = (finite(transform.rotationDegrees) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;
  return Object.freeze({ x: finite(rotatedX + center.x), y: finite(rotatedY + center.y) });
}

export function boundsOfPoints(points: readonly DrawingPoint[]): LayoutBox {
  if (points.length === 0) return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;
  const limit = Math.min(points.length, MAX_IMAGE_POLYGON_POINTS);
  for (let index = 1; index < limit; index += 1) {
    const point = points[index]!;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return Object.freeze({
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  });
}

/** Affine page mapping from transformed full source frame bbox into wp:extent. */
export interface XfrmPageMapping {
  readonly bboxX: number;
  readonly bboxY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly anchorX: number;
  readonly anchorY: number;
}

export function computeXfrmPageMapping(options: {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly transform: DrawingTransform;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly anchorX: number;
  readonly anchorY: number;
}): XfrmPageMapping {
  const center = Object.freeze({
    x: options.offsetX + options.sourceWidth / 2,
    y: options.offsetY + options.sourceHeight / 2,
  });
  const frameCorners = rectRing(0, 0, options.sourceWidth, options.sourceHeight);
  const transformedFrame: DrawingPoint[] = [];
  for (const corner of frameCorners) {
    transformedFrame.push(
      transformAroundCenter(
        Object.freeze({ x: corner.x + options.offsetX, y: corner.y + options.offsetY }),
        center,
        options.transform
      )
    );
  }
  const bbox = boundsOfPoints(transformedFrame);
  const safeW = Math.max(bbox.width, 0.000_001);
  const safeH = Math.max(bbox.height, 0.000_001);
  return Object.freeze({
    bboxX: bbox.x,
    bboxY: bbox.y,
    scaleX: Math.max(0, finite(options.layoutWidth)) / safeW,
    scaleY: Math.max(0, finite(options.layoutHeight)) / safeH,
    anchorX: finite(options.anchorX),
    anchorY: finite(options.anchorY),
  });
}

function mapPointWithXfrmPageMapping(point: DrawingPoint, mapping: XfrmPageMapping): DrawingPoint {
  return Object.freeze({
    x: finite(mapping.anchorX + (point.x - mapping.bboxX) * mapping.scaleX),
    y: finite(mapping.anchorY + (point.y - mapping.bboxY) * mapping.scaleY),
  });
}

/**
 * Project source-local points: crop → offset frame → rotate/flip around off+ext/2 →
 * map through one shared full-frame affine into authoritative wp:extent → anchor translate.
 */
export function projectPointsThroughXfrm(options: {
  readonly points: readonly DrawingPoint[];
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly crop: NormalizedCrop;
  readonly transform: DrawingTransform;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly mapping?: XfrmPageMapping;
}): readonly DrawingPoint[] {
  const mapping =
    options.mapping ??
    computeXfrmPageMapping({
      sourceWidth: options.sourceWidth,
      sourceHeight: options.sourceHeight,
      offsetX: options.offsetX,
      offsetY: options.offsetY,
      transform: options.transform,
      layoutWidth: options.layoutWidth,
      layoutHeight: options.layoutHeight,
      anchorX: options.anchorX,
      anchorY: options.anchorY,
    });
  const cropped = cropLocalPoints(
    options.points,
    options.sourceWidth,
    options.sourceHeight,
    options.crop
  );
  const limit = Math.min(
    cropped.length > 0 ? cropped.length : options.points.length,
    MAX_IMAGE_POLYGON_POINTS
  );
  const source = cropped.length > 0 ? cropped : options.points.slice(0, limit);
  const center = Object.freeze({
    x: options.offsetX + options.sourceWidth / 2,
    y: options.offsetY + options.sourceHeight / 2,
  });
  const mapped: DrawingPoint[] = [];
  for (let index = 0; index < limit; index += 1) {
    const point = source[index]!;
    const offsetApplied = Object.freeze({
      x: finite(point.x + options.offsetX),
      y: finite(point.y + options.offsetY),
    });
    mapped.push(
      mapPointWithXfrmPageMapping(
        transformAroundCenter(offsetApplied, center, options.transform),
        mapping
      )
    );
  }
  return Object.freeze(mapped);
}

/** @deprecated Prefer {@link projectPointsThroughXfrm}. */
export function transformLocalPoints(
  points: readonly DrawingPoint[],
  sourceWidth: number,
  sourceHeight: number,
  transform: DrawingTransform,
  layoutWidth: number,
  layoutHeight: number,
  anchorX: number,
  anchorY: number
): readonly DrawingPoint[] {
  const frame = sourceExtentFrame(transform, layoutWidth, layoutHeight);
  void sourceWidth;
  void sourceHeight;
  return projectPointsThroughXfrm({
    points,
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    offsetX: frame.offsetX,
    offsetY: frame.offsetY,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform,
    layoutWidth,
    layoutHeight,
    anchorX,
    anchorY,
  });
}

function rectRing(x: number, y: number, width: number, height: number): readonly DrawingPoint[] {
  // A straight line's frame has one zero side and keeps its length on the other; only a frame
  // with no size at all (or a negative side) collapses to its corner.
  if (width < 0 || height < 0 || (width <= 0 && height <= 0)) {
    const corner = Object.freeze({ x, y });
    return Object.freeze([corner, corner, corner, corner]);
  }
  return Object.freeze([
    Object.freeze({ x, y }),
    Object.freeze({ x: x + width, y }),
    Object.freeze({ x: x + width, y: y + height }),
    Object.freeze({ x, y: y + height }),
  ]);
}

/** Supported preset clip polygons in local source coordinates; null means rectangular fallback. */
export function presetClipPolygonLocal(
  preset: string | null,
  width: number,
  height: number
): readonly DrawingPoint[] | null {
  if (!preset || !SUPPORTED_PRESET_GEometries.has(preset)) return null;
  if (width <= 0 || height <= 0) return rectRing(0, 0, Math.max(0, width), Math.max(0, height));

  if (preset === 'rect') return rectRing(0, 0, width, height);

  if (preset === 'ellipse') {
    const points: DrawingPoint[] = [];
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2;
    const ry = height / 2;
    const segments = Math.min(ELLIPSE_SEGMENTS, MAX_IMAGE_POLYGON_POINTS);
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(
        Object.freeze({
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle),
        })
      );
    }
    return Object.freeze(points);
  }

  const radius = Math.min(width, height) * ROUND_RECT_RATIO;
  const r = Math.max(0, radius);
  const w = width;
  const h = height;
  return Object.freeze([
    Object.freeze({ x: r, y: 0 }),
    Object.freeze({ x: w - r, y: 0 }),
    Object.freeze({ x: w, y: r }),
    Object.freeze({ x: w, y: h - r }),
    Object.freeze({ x: w - r, y: h }),
    Object.freeze({ x: r, y: h }),
    Object.freeze({ x: 0, y: h - r }),
    Object.freeze({ x: 0, y: r }),
  ]);
}

function finitePoint(point: DrawingPoint): DrawingPoint {
  return Object.freeze({ x: finite(point.x), y: finite(point.y) });
}

/** Bounded axis-aligned clip; output is approximate for non-convex subjects. */
export function clipPolygonToBox(
  subject: readonly DrawingPoint[],
  clip: LayoutBox
): readonly DrawingPoint[] {
  if (subject.length === 0) return Object.freeze([]);
  const clipRight = clip.x + clip.width;
  const clipBottom = clip.y + clip.height;

  const clipEdge = (
    input: readonly DrawingPoint[],
    inside: (point: DrawingPoint) => boolean,
    intersect: (current: DrawingPoint, next: DrawingPoint) => DrawingPoint
  ): readonly DrawingPoint[] => {
    if (input.length === 0) return Object.freeze([]);
    const output: DrawingPoint[] = [];
    const limit = Math.min(input.length, MAX_IMAGE_POLYGON_POINTS);
    for (let index = 0; index < limit; index += 1) {
      const current = finitePoint(input[index]!);
      const next = finitePoint(input[(index + 1) % limit]!);
      const currentInside = inside(current);
      const nextInside = inside(next);
      if (currentInside && nextInside) {
        output.push(next);
      } else if (currentInside && !nextInside) {
        output.push(finitePoint(intersect(current, next)));
      } else if (!currentInside && nextInside) {
        output.push(finitePoint(intersect(current, next)));
        output.push(next);
      }
      if (output.length >= MAX_IMAGE_POLYGON_POINTS) break;
    }
    return Object.freeze(output.slice(0, MAX_IMAGE_POLYGON_POINTS));
  };

  let output: DrawingPoint[] = subject.slice(0, MAX_IMAGE_POLYGON_POINTS).map(finitePoint);
  output = [
    ...clipEdge(
      output,
      (p) => p.x >= clip.x,
      (a, b) => {
        const dx = b.x - a.x;
        const t = Math.abs(dx) > 0.000_001 ? (clip.x - a.x) / dx : 0;
        return Object.freeze({ x: clip.x, y: finite(a.y + t * (b.y - a.y)) });
      }
    ),
  ];
  output = [
    ...clipEdge(
      output,
      (p) => p.x <= clipRight,
      (a, b) => {
        const dx = b.x - a.x;
        const t = Math.abs(dx) > 0.000_001 ? (clipRight - a.x) / dx : 0;
        return Object.freeze({ x: clipRight, y: finite(a.y + t * (b.y - a.y)) });
      }
    ),
  ];
  output = [
    ...clipEdge(
      output,
      (p) => p.y >= clip.y,
      (a, b) => {
        const dy = b.y - a.y;
        const t = Math.abs(dy) > 0.000_001 ? (clip.y - a.y) / dy : 0;
        return Object.freeze({ x: finite(a.x + t * (b.x - a.x)), y: clip.y });
      }
    ),
  ];
  output = [
    ...clipEdge(
      output,
      (p) => p.y <= clipBottom,
      (a, b) => {
        const dy = b.y - a.y;
        const t = Math.abs(dy) > 0.000_001 ? (clipBottom - a.y) / dy : 0;
        return Object.freeze({ x: finite(a.x + t * (b.x - a.x)), y: clipBottom });
      }
    ),
  ];
  return Object.freeze(output);
}

function layoutBoxFromPoints(points: readonly DrawingPoint[]): LayoutBox {
  const bounds = boundsOfPoints(points);
  return Object.freeze({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
}

/** Even-odd point-in-polygon test for clip/hit (bounded). */
export function pointInClipPolygon(point: DrawingPoint, polygon: readonly DrawingPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  const limit = Math.min(polygon.length, MAX_IMAGE_POLYGON_POINTS);
  for (let index = 0, j = limit - 1; index < limit; j = index++) {
    const pi = polygon[index]!;
    const pj = polygon[j]!;
    if (
      !Number.isFinite(pi.x) ||
      !Number.isFinite(pi.y) ||
      !Number.isFinite(pj.x) ||
      !Number.isFinite(pj.y)
    ) {
      continue;
    }
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 0.000_000_001) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export { pointInDrawingClip } from './drawing-wrap.ts';

export function clipGeometryToRegion(
  geometry: DrawingGeometry,
  region: LayoutBox,
  /**
   * False for a clip that is no layout region a shape that paints past its extent stays cut
   * at: an inline drawing's own line, column, or reach. A cell, a frame, or a page records it.
   */
  recordCut = true
): DrawingGeometry {
  const paintBounds = clipBoxToRegion(geometry.paintBounds, region);
  const hitBounds =
    paintBounds.width > 0 && paintBounds.height > 0
      ? paintBounds
      : Object.freeze({ ...paintBounds });
  const clipPoints = (points: readonly DrawingPoint[] | null): readonly DrawingPoint[] | null => {
    if (!points || points.length === 0) return points;
    const clipped = clipPolygonToBox(points, region);
    return clipped.length >= 3 ? Object.freeze(clipped.map(finitePoint)) : Object.freeze([]);
  };
  const regionCuts = recordCut ? regionCutsOf(geometry, region) : geometry.regionCuts;
  return Object.freeze({
    ...geometry,
    paintBounds,
    hitBounds,
    transformedCorners: Object.freeze(
      clipPoints(geometry.transformedCorners) ?? geometry.transformedCorners
    ),
    clipPolygon: clipPoints(geometry.clipPolygon),
    ...(regionCuts ? { regionCuts } : {}),
  });
}

export function computeDrawingGeometry(input: DrawingGeometryInput): DrawingGeometry {
  const layoutWidth = Math.max(0, finite(input.extentWidth));
  const layoutHeight = Math.max(0, finite(input.extentHeight));
  const anchorX = finite(input.anchorX);
  const anchorY = finite(input.anchorY);
  const crop = normalizeCropFractions(input.crop);
  const effectInsets = effectInsetsFromEmu(input.effectExtentEmu);
  const frame = sourceExtentFrame(input.transform, layoutWidth, layoutHeight);

  const contentBounds = Object.freeze({
    x: anchorX,
    y: anchorY,
    width: layoutWidth,
    height: layoutHeight,
  });

  const projectOpts = {
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    offsetX: frame.offsetX,
    offsetY: frame.offsetY,
    crop,
    transform: input.transform,
    layoutWidth,
    layoutHeight,
    anchorX,
    anchorY,
  };
  const mapping = computeXfrmPageMapping(projectOpts);
  const uncropped = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

  const transformedCorners = projectPointsThroughXfrm({
    points: rectRing(0, 0, frame.width, frame.height),
    ...projectOpts,
    crop: uncropped,
    mapping,
  });

  const presetLocal = input.clipUnit
    ? Object.freeze(
        input.clipUnit.map((point) =>
          Object.freeze({ x: point.x * frame.width, y: point.y * frame.height })
        )
      )
    : presetClipPolygonLocal(input.presetGeometry, frame.width, frame.height);
  let clipFallback: DrawingClipFallback = 'none';
  let clipSource = presetLocal;
  if (!clipSource) {
    clipFallback = input.presetGeometry ? 'unsupported-preset' : 'none';
    clipSource = rectRing(0, 0, frame.width, frame.height);
  }
  const clipPolygon = projectPointsThroughXfrm({
    points: clipSource,
    ...projectOpts,
    crop: uncropped,
    mapping,
  });

  const clipBounds = layoutBoxFromPoints(
    clipPolygon.length >= 3 ? clipPolygon : transformedCorners
  );
  const paintBounds = expandBoxByInsets(clipBounds, effectInsets);
  const hitBounds = paintBounds;

  return Object.freeze({
    contentBounds,
    paintBounds,
    hitBounds,
    transformedCorners,
    imageTransformCorners: transformedCorners,
    clipPolygon: clipPolygon.length >= 3 ? clipPolygon : transformedCorners,
    clipFallback,
    effectInsets,
  });
}

export function drawingGeometryFromProjection(options: {
  readonly projection: import('../store/package/drawing-projection.ts').DrawingProjection;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly extentWidth: number;
  readonly extentHeight: number;
}): DrawingGeometry {
  const picture = options.projection.picture;
  const defaultTransform: DrawingTransform = Object.freeze({
    rotationDegrees: 0,
    flipHorizontal: false,
    flipVertical: false,
    offsetEmu: Object.freeze({ x: 0, y: 0 }),
    extentEmu: Object.freeze({ cx: 0, cy: 0 }),
  });
  const groupPicture = options.projection.groupPicture;
  if (groupPicture) {
    // The drawing's own frame stays the extent box: the group's vector members, the clip,
    // the hit area, and wrap all use it. Only the image corners move to the member's frame.
    const frame = computeDrawingGeometry({
      extentWidth: options.extentWidth,
      extentHeight: options.extentHeight,
      anchorX: options.anchorX,
      anchorY: options.anchorY,
      effectExtentEmu: options.projection.effectExtentEmu,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: defaultTransform,
      presetGeometry: null,
      ...(groupPicture.clipUnit ? { clipUnit: groupPicture.clipUnit } : {}),
    });
    const extent = options.projection.extentEmu;
    const scaleX = extent.cx > 0 ? options.extentWidth / extent.cx : 0;
    const scaleY = extent.cy > 0 ? options.extentHeight / extent.cy : 0;
    const member = groupPicture.frameEmu;
    const image = computeDrawingGeometry({
      extentWidth: member.cx * scaleX,
      extentHeight: member.cy * scaleY,
      anchorX: options.anchorX + member.x * scaleX,
      anchorY: options.anchorY + member.y * scaleY,
      effectExtentEmu: { top: 0, right: 0, bottom: 0, left: 0 },
      crop: groupPicture.crop,
      transform: defaultTransform,
      presetGeometry: null,
    });
    return Object.freeze({ ...frame, imageTransformCorners: image.transformedCorners });
  }
  return computeDrawingGeometry({
    extentWidth: options.extentWidth,
    extentHeight: options.extentHeight,
    anchorX: options.anchorX,
    anchorY: options.anchorY,
    effectExtentEmu: options.projection.effectExtentEmu,
    crop: picture?.crop ?? { left: 0, top: 0, right: 0, bottom: 0 },
    transform: picture?.transform ?? defaultTransform,
    presetGeometry: picture?.presetGeometry ?? null,
    ...(picture?.clipUnit ? { clipUnit: picture.clipUnit } : {}),
  });
}

/** Affine matrix mapping img-local coords into wp:extent content space (transform-origin 0 0). */
export interface CssImageAffine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export function applyCssImageAffine(point: DrawingPoint, affine: CssImageAffine): DrawingPoint {
  return Object.freeze({
    x: finite(affine.a * point.x + affine.c * point.y + affine.e),
    y: finite(affine.b * point.x + affine.d * point.y + affine.f),
  });
}

/**
 * Derive paint affine from source/a:xfrm frame through rotation/flip into authoritative wp:extent.
 * Rotated source bbox → post-rotation scales sx=outerW/bboxW, sy=outerH/bboxH; flips in source basis.
 * `a:srcRect` crop is applied inside the transform stage (crop viewport + img sizing), not here.
 */
export function computeCssImageAffine(options: {
  readonly transform: DrawingTransform;
  readonly contentWidth: number;
  readonly contentHeight: number;
}): CssImageAffine | null {
  const { transform, contentWidth, contentHeight } = options;
  if (contentWidth <= 0 || contentHeight <= 0) return null;

  const frame = sourceExtentFrame(transform, contentWidth, contentHeight);
  const sourceWidth = frame.width;
  const sourceHeight = frame.height;
  const mapping = computeXfrmPageMapping({
    sourceWidth,
    sourceHeight,
    offsetX: frame.offsetX,
    offsetY: frame.offsetY,
    transform,
    layoutWidth: contentWidth,
    layoutHeight: contentHeight,
    anchorX: 0,
    anchorY: 0,
  });

  const rotation = finite(transform.rotationDegrees);
  const hasRotation = Math.abs(rotation % 360) > 0.000_1;
  const flipH = transform.flipHorizontal ? -1 : 1;
  const flipV = transform.flipVertical ? -1 : 1;
  const sx = mapping.scaleX;
  const sy = mapping.scaleY;
  const kx = sourceWidth > 0 ? sourceWidth / contentWidth : 1;
  const ky = sourceHeight > 0 ? sourceHeight / contentHeight : 1;

  const identityLike =
    !hasRotation &&
    flipH === 1 &&
    flipV === 1 &&
    Math.abs(sx - 1) < 0.000_1 &&
    Math.abs(sy - 1) < 0.000_1 &&
    Math.abs(frame.offsetX) < 0.000_1 &&
    Math.abs(frame.offsetY) < 0.000_1 &&
    Math.abs(kx - 1) < 0.000_1 &&
    Math.abs(ky - 1) < 0.000_1;
  if (identityLike) return null;

  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = frame.offsetX + sourceWidth / 2;
  const centerY = frame.offsetY + sourceHeight / 2;

  const msA = sx * cos * flipH;
  const msC = -sx * sin * flipV;
  const msB = sy * sin * flipH;
  const msD = sy * cos * flipV;
  const msE =
    sx *
    (centerX - cos * flipH * (sourceWidth / 2) + sin * flipV * (sourceHeight / 2) - mapping.bboxX);
  const msF =
    sy *
    (centerY - sin * flipH * (sourceWidth / 2) - cos * flipV * (sourceHeight / 2) - mapping.bboxY);

  return Object.freeze({
    a: finite(msA * kx),
    b: finite(msB * kx),
    c: finite(msC * ky),
    d: finite(msD * ky),
    e: finite(msE),
    f: finite(msF),
  });
}

/** CSS `matrix(...)` for paint-time pixel transform; use transform-origin `0 0`. */
export function cssTransformForDrawingImage(options: {
  readonly transform: DrawingTransform;
  readonly contentWidth: number;
  readonly contentHeight: number;
}): string | undefined {
  const affine = computeCssImageAffine(options);
  if (!affine) return undefined;
  return `matrix(${finiteStyle(affine.a)}, ${finiteStyle(affine.b)}, ${finiteStyle(affine.c)}, ${finiteStyle(affine.d)}, ${finiteStyle(affine.e)}, ${finiteStyle(affine.f)})`;
}

function finiteStyle(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(value);
}

export { EMPTY_INSETS };
