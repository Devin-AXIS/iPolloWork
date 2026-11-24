// Wrap exclusion scanline primitives (typed-drawings-and-images task 8).
//
// Exact polygon exclusion after shape xfrm mapping; paragraph integration lands in task 9.
// `a:srcRect` crop does not remap wrap polygons — only image pixel sampling uses crop.

import type { DrawingTransform, SourceCrop } from '../store/package/drawing-projection.ts';
import { EMU_PER_POINT } from './drawing-layout.ts';
import {
  EMPTY_INSETS,
  MAX_IMAGE_POLYGON_POINTS,
  expandBoxByInsets,
  finite,
  projectPointsThroughXfrm,
  sourceExtentFrame,
  type DrawingGeometry,
  type DrawingInsets,
  type DrawingPoint,
} from './drawing-geometry.ts';
import type { LayoutBox } from './semantic-records.ts';

export interface ScanlineInterval {
  readonly start: number;
  readonly end: number;
}

export type WrapTextSide = 'bothSides' | 'left' | 'right' | 'largest';

/**
 * Edge length of the square `wp:wrapPolygon` coordinates address (ECMA-376 §20.4.2.16).
 *
 * The polygon is authored against the drawing's own extent in this fixed unit space, so the
 * same point list describes the same outline at any picture size.
 */
const WRAP_POLYGON_UNITS = 21600;

export interface WrapExclusionInput {
  readonly mode: 'square' | 'tight' | 'through' | 'topAndBottom';
  readonly contentBounds: LayoutBox;
  readonly polygon: readonly DrawingPoint[] | null;
  readonly clipPolygon: readonly DrawingPoint[] | null;
  readonly wrapDistances: DrawingInsets;
  readonly effectInsets: DrawingInsets;
  readonly textSide: WrapTextSide;
  /**
   * The physical side `largest` keeps when both sides are equally wide. Absent means the
   * right, as in compatibility modes before 15; the paragraph breaker sets the left for
   * mode 15 and later (`largestWrapTieLeft`).
   */
  readonly largestTie?: 'left' | 'right';
  readonly contentLeft: number;
  readonly contentRight: number;
}

export function mergeScanlineIntervals(
  intervals: readonly ScanlineInterval[]
): readonly ScanlineInterval[] {
  if (intervals.length === 0) return Object.freeze([]);
  const sorted = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const merged: ScanlineInterval[] = [];
  let current = sorted[0]!;
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index]!;
    if (next.start <= current.end + 0.000_1) {
      current = Object.freeze({ start: current.start, end: Math.max(current.end, next.end) });
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return Object.freeze(merged);
}

export function intersectScanlineIntervals(
  left: readonly ScanlineInterval[],
  right: readonly ScanlineInterval[]
): readonly ScanlineInterval[] {
  const out: ScanlineInterval[] = [];
  for (const a of left) {
    for (const b of right) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end > start + 0.000_001) out.push(Object.freeze({ start, end }));
    }
  }
  return mergeScanlineIntervals(out);
}

export function clampIntervalsToContent(
  intervals: readonly ScanlineInterval[],
  contentLeft: number,
  contentRight: number
): readonly ScanlineInterval[] {
  const out: ScanlineInterval[] = [];
  for (const interval of intervals) {
    const start = Math.max(interval.start, contentLeft);
    const end = Math.min(interval.end, contentRight);
    if (end > start + 0.000_001) out.push(Object.freeze({ start, end }));
  }
  return mergeScanlineIntervals(out);
}

function invertIntervals(
  excluded: readonly ScanlineInterval[],
  contentLeft: number,
  contentRight: number
): readonly ScanlineInterval[] {
  const available: ScanlineInterval[] = [];
  let cursor = contentLeft;
  for (const interval of excluded) {
    if (interval.start > cursor) {
      available.push(Object.freeze({ start: cursor, end: interval.start }));
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < contentRight) {
    available.push(Object.freeze({ start: cursor, end: contentRight }));
  }
  return Object.freeze(available);
}

/** Directional anisotropic Minkowski expansion for wrap distances. */
export function expandBoundsAnisotropic(bounds: LayoutBox, distances: DrawingInsets): LayoutBox {
  return expandBoxByInsets(bounds, distances);
}

export function squareExclusionBounds(
  contentBounds: LayoutBox,
  effectInsets: DrawingInsets,
  wrapDistances: DrawingInsets
): LayoutBox {
  return expandBoundsAnisotropic(expandBoxByInsets(contentBounds, effectInsets), wrapDistances);
}

function edgeCrossingsAtY(
  polygon: readonly DrawingPoint[],
  y: number
): readonly { readonly x: number; readonly delta: number }[] {
  const crossings: { x: number; delta: number }[] = [];
  const limit = Math.min(polygon.length, MAX_IMAGE_POLYGON_POINTS);
  if (limit < 2) return Object.freeze([]);
  for (let index = 0; index < limit; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % limit]!;
    const y0 = current.y;
    const y1 = next.y;
    if (y0 === y1) continue;
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (y < minY || y > maxY) continue;
    if (y === maxY && y1 > y0) continue;
    if (y === minY && y1 < y0) continue;
    const t = (y - y0) / (y1 - y0);
    const x = current.x + t * (next.x - current.x);
    if (Number.isFinite(x)) {
      crossings.push({ x, delta: y1 > y0 ? 1 : -1 });
    }
  }
  crossings.sort((left, right) => left.x - right.x || left.delta - right.delta);
  return Object.freeze(crossings);
}

function horizontalSpansAtY(
  polygon: readonly DrawingPoint[],
  y: number
): readonly ScanlineInterval[] {
  const spans: ScanlineInterval[] = [];
  const limit = Math.min(polygon.length, MAX_IMAGE_POLYGON_POINTS);
  for (let index = 0; index < limit; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % limit]!;
    if (current.y !== next.y) continue;
    if (Math.abs(y - current.y) > 0.000_001) continue;
    const start = Math.min(current.x, next.x);
    const end = Math.max(current.x, next.x);
    if (end > start) spans.push(Object.freeze({ start, end }));
  }
  return mergeScanlineIntervals(spans);
}

function polygonExcludedIntervalsAtY(
  polygon: readonly DrawingPoint[],
  y: number,
  fillRule: 'nonzero' | 'evenodd'
): readonly ScanlineInterval[] {
  const fromCrossings = intervalsFromCrossings(edgeCrossingsAtY(polygon, y), fillRule);
  const fromHorizontal = horizontalSpansAtY(polygon, y);
  return mergeScanlineIntervals([...fromCrossings, ...fromHorizontal]);
}

function intervalsFromCrossings(
  crossings: readonly { readonly x: number; readonly delta: number }[],
  fillRule: 'nonzero' | 'evenodd'
): readonly ScanlineInterval[] {
  if (crossings.length === 0) return Object.freeze([]);
  const intervals: ScanlineInterval[] = [];
  if (fillRule === 'evenodd') {
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const start = crossings[index]!.x;
      const end = crossings[index + 1]!.x;
      if (end > start) intervals.push(Object.freeze({ start, end }));
    }
    return Object.freeze(intervals);
  }
  let winding = 0;
  let startX: number | null = null;
  for (const crossing of crossings) {
    const previous = winding;
    winding += crossing.delta;
    if (previous === 0 && winding !== 0) {
      startX = crossing.x;
    } else if (previous !== 0 && winding === 0 && startX !== null) {
      if (crossing.x > startX) intervals.push(Object.freeze({ start: startX, end: crossing.x }));
      startX = null;
    }
  }
  return Object.freeze(intervals);
}

function combinedInsets(wrapDistances: DrawingInsets, effectInsets: DrawingInsets): DrawingInsets {
  return Object.freeze({
    top: finite(wrapDistances.top) + finite(effectInsets.top),
    right: finite(wrapDistances.right) + finite(effectInsets.right),
    bottom: finite(wrapDistances.bottom) + finite(effectInsets.bottom),
    left: finite(wrapDistances.left) + finite(effectInsets.left),
  });
}

function segmentIntersectionYInBand(
  a0: DrawingPoint,
  a1: DrawingPoint,
  b0: DrawingPoint,
  b1: DrawingPoint,
  yMin: number,
  yMax: number
): number | null {
  const dx1 = a1.x - a0.x;
  const dy1 = a1.y - a0.y;
  const dx2 = b1.x - b0.x;
  const dy2 = b1.y - b0.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const cross = (b0.x - a0.x) * dy1 - (b0.y - a0.y) * dx1;
  const t = cross / denom;
  const u = ((b0.x - a0.x) * dy2 - (b0.y - a0.y) * dx2) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  const y = a0.y + t * dy1;
  if (!Number.isFinite(y) || y < yMin - 0.000_001 || y > yMax + 0.000_001) return null;
  return y;
}

function collectCrossPolygonEdgeIntersectionYs(
  left: readonly DrawingPoint[],
  right: readonly DrawingPoint[],
  yMin: number,
  yMax: number
): readonly number[] {
  const ys: number[] = [];
  const leftLimit = Math.min(left.length, MAX_IMAGE_POLYGON_POINTS);
  const rightLimit = Math.min(right.length, MAX_IMAGE_POLYGON_POINTS);
  if (leftLimit < 2 || rightLimit < 2) return Object.freeze([]);
  const pairCap = MAX_IMAGE_POLYGON_POINTS * MAX_IMAGE_POLYGON_POINTS;
  let pairCount = 0;
  for (let leftIndex = 0; leftIndex < leftLimit; leftIndex += 1) {
    const a0 = left[leftIndex]!;
    const a1 = left[(leftIndex + 1) % leftLimit]!;
    for (let rightIndex = 0; rightIndex < rightLimit; rightIndex += 1) {
      if (pairCount >= pairCap) return Object.freeze(ys);
      pairCount += 1;
      const b0 = right[rightIndex]!;
      const b1 = right[(rightIndex + 1) % rightLimit]!;
      const y = segmentIntersectionYInBand(a0, a1, b0, b1, yMin, yMax);
      if (y !== null) ys.push(y);
    }
  }
  return Object.freeze(ys);
}

function collectSlabBoundaries(
  polygons: readonly (readonly DrawingPoint[])[],
  yMin: number,
  yMax: number
): readonly number[] {
  const ys = new Set<number>();
  ys.add(yMin);
  ys.add(yMax);
  for (const polygon of polygons) {
    const limit = Math.min(polygon.length, MAX_IMAGE_POLYGON_POINTS);
    for (let index = 0; index < limit; index += 1) {
      const y = polygon[index]!.y;
      if (Number.isFinite(y) && y >= yMin - 0.000_001 && y <= yMax + 0.000_001) ys.add(y);
    }
    for (let index = 0; index < limit; index += 1) {
      const current = polygon[index]!;
      const next = polygon[(index + 1) % limit]!;
      const y0 = current.y;
      const y1 = next.y;
      if (y0 === y1) continue;
      for (const boundary of [yMin, yMax]) {
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        if (boundary >= minY && boundary <= maxY) ys.add(boundary);
      }
    }
  }
  if (polygons.length >= 2) {
    for (const y of collectCrossPolygonEdgeIntersectionYs(polygons[0]!, polygons[1]!, yMin, yMax)) {
      ys.add(y);
    }
  }
  return Object.freeze([...ys].sort((a, b) => a - b));
}

function sourceIntervalsAtY(
  polygon: readonly DrawingPoint[],
  clipPolygon: readonly DrawingPoint[] | null,
  y: number,
  fillRule: 'nonzero' | 'evenodd'
): readonly ScanlineInterval[] {
  let source = polygonExcludedIntervalsAtY(polygon, y, fillRule);
  if (clipPolygon && clipPolygon.length >= 3) {
    source = intersectScanlineIntervals(
      source,
      polygonExcludedIntervalsAtY(clipPolygon, y, 'nonzero')
    );
  }
  return source;
}

/**
 * Exact scanline intervals for P ⊕ [-left,right]×[-top,bottom] at `y`.
 * Unions slab projections across [y-bottom, y+top] after optional preset-clip intersection.
 */
export function minkowskiExcludedIntervalsAtY(
  polygon: readonly DrawingPoint[],
  y: number,
  insets: DrawingInsets,
  fillRule: 'nonzero' | 'evenodd',
  clipPolygon: readonly DrawingPoint[] | null = null
): readonly ScanlineInterval[] {
  const top = finite(insets.top);
  const bottom = finite(insets.bottom);
  const left = finite(insets.left);
  const right = finite(insets.right);
  const yMin = y - bottom;
  const yMax = y + top;
  const boundaries = collectSlabBoundaries(
    clipPolygon && clipPolygon.length >= 3 ? [polygon, clipPolygon] : [polygon],
    yMin,
    yMax
  );
  const expanded: ScanlineInterval[] = [];
  const sampleYs =
    boundaries.length >= 2
      ? boundaries.flatMap((ya, index) => {
          if (index + 1 >= boundaries.length) return [];
          const yb = boundaries[index + 1]!;
          if (yb <= ya + 0.000_001) return [ya];
          return [ya, yb, (ya + yb) / 2];
        })
      : [yMin];
  for (const sampleY of sampleYs) {
    const source = sourceIntervalsAtY(polygon, clipPolygon, sampleY, fillRule);
    for (const interval of source) {
      expanded.push(Object.freeze({ start: interval.start - left, end: interval.end + right }));
    }
  }
  return mergeScanlineIntervals(expanded);
}

function boundedRectanglePolygon(bounds: LayoutBox): readonly DrawingPoint[] {
  const { x, y, width, height } = bounds;
  return Object.freeze([
    Object.freeze({ x, y }),
    Object.freeze({ x: x + width, y }),
    Object.freeze({ x: x + width, y: y + height }),
    Object.freeze({ x, y: y + height }),
  ]);
}

export function normalizeWrapPolygonToPage(options: {
  readonly polygonEmu: readonly Readonly<{ x: number; y: number }>[];
  readonly extentWidthPt: number;
  readonly extentHeightPt: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
}): readonly DrawingPoint[] | null {
  const layoutWidth = Math.max(0, finite(options.extentWidthPt));
  const layoutHeight = Math.max(0, finite(options.extentHeightPt));
  const frame = sourceExtentFrame(options.transform, layoutWidth, layoutHeight);
  const limit = Math.min(options.polygonEmu.length, MAX_IMAGE_POLYGON_POINTS);
  if (limit < 3) {
    return boundedRectanglePolygon({
      x: options.anchorX,
      y: options.anchorY,
      width: layoutWidth,
      height: layoutHeight,
    });
  }

  // `wp:wrapPolygon` points are NOT EMU despite their schema type: they address a fixed
  // 21600-unit square spanning the drawing's own extent, so (21600, 21600) is its far
  // corner whatever size it is. Reading them as EMU collapses a full-rectangle polygon to a
  // 1.7pt sliver at the origin, and text walks straight over the picture.
  const scaleX = frame.width / WRAP_POLYGON_UNITS;
  const scaleY = frame.height / WRAP_POLYGON_UNITS;
  const local: DrawingPoint[] = [];
  for (let index = 0; index < limit; index += 1) {
    const point = options.polygonEmu[index]!;
    local.push(
      Object.freeze({
        x: finite(point.x) * scaleX,
        y: finite(point.y) * scaleY,
      })
    );
  }

  void options.crop;
  return projectPointsThroughXfrm({
    points: Object.freeze(local),
    sourceWidth: frame.width,
    sourceHeight: frame.height,
    offsetX: frame.offsetX,
    offsetY: frame.offsetY,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    transform: options.transform,
    layoutWidth,
    layoutHeight,
    anchorX: options.anchorX,
    anchorY: options.anchorY,
  });
}

export function excludedIntervalsOnScanline(
  y: number,
  input: WrapExclusionInput
): readonly ScanlineInterval[] {
  const effectInsets = input.effectInsets ?? EMPTY_INSETS;
  const wrapDistances = input.wrapDistances ?? EMPTY_INSETS;
  const contentLeft = finite(input.contentLeft);
  const contentRight = finite(input.contentRight);

  if (input.mode === 'topAndBottom') {
    const band = expandBoundsAnisotropic(
      expandBoxByInsets(input.contentBounds, effectInsets),
      wrapDistances
    );
    if (y < band.y || y >= band.y + band.height) return Object.freeze([]);
    return clampIntervalsToContent(
      [{ start: contentLeft, end: contentRight }],
      contentLeft,
      contentRight
    );
  }

  if (input.mode === 'square') {
    const bounds = squareExclusionBounds(input.contentBounds, effectInsets, wrapDistances);
    if (y < bounds.y || y >= bounds.y + bounds.height) return Object.freeze([]);
    return clampIntervalsToContent(
      [{ start: bounds.x, end: bounds.x + bounds.width }],
      contentLeft,
      contentRight
    );
  }

  const polygon =
    input.polygon && input.polygon.length >= 3
      ? input.polygon
      : boundedRectanglePolygon(input.contentBounds);
  const fillRule = input.mode === 'through' ? 'evenodd' : 'nonzero';
  const insets = combinedInsets(wrapDistances, effectInsets);
  const excluded = minkowskiExcludedIntervalsAtY(polygon, y, insets, fillRule, input.clipPolygon);
  return clampIntervalsToContent(excluded, contentLeft, contentRight);
}

function exclusionSpan(
  excluded: readonly ScanlineInterval[]
): { readonly start: number; readonly end: number } | null {
  if (excluded.length === 0) return null;
  return Object.freeze({
    start: Math.min(...excluded.map((interval) => interval.start)),
    end: Math.max(...excluded.map((interval) => interval.end)),
  });
}

function filterByTextSide(
  available: readonly ScanlineInterval[],
  excluded: readonly ScanlineInterval[],
  textSide: WrapTextSide,
  contentLeft: number,
  contentRight: number,
  largestTie: 'left' | 'right' = 'right'
): readonly ScanlineInterval[] {
  if (textSide === 'bothSides') return available;
  if (excluded.length === 0) return available;
  const span = exclusionSpan(excluded);
  if (!span) return available;
  if (textSide === 'left') {
    return Object.freeze(available.filter((interval) => interval.end <= span.start + 0.000_1));
  }
  if (textSide === 'right') {
    return Object.freeze(available.filter((interval) => interval.start >= span.end - 0.000_1));
  }
  const leftWidth = Math.max(0, span.start - contentLeft);
  const rightWidth = Math.max(0, contentRight - span.end);
  if (leftWidth === rightWidth) {
    return largestTie === 'left'
      ? Object.freeze(available.filter((interval) => interval.end <= span.start + 0.000_1))
      : Object.freeze(available.filter((interval) => interval.start >= span.end - 0.000_1));
  }
  return leftWidth > rightWidth
    ? Object.freeze(available.filter((interval) => interval.end <= span.start + 0.000_1))
    : Object.freeze(available.filter((interval) => interval.start >= span.end - 0.000_1));
}

export function availableTextIntervalsOnScanline(
  y: number,
  input: WrapExclusionInput
): readonly ScanlineInterval[] {
  const excluded = excludedIntervalsOnScanline(y, input);
  const available = invertIntervals(excluded, input.contentLeft, input.contentRight);
  return filterByTextSide(
    available,
    excluded,
    input.textSide,
    input.contentLeft,
    input.contentRight,
    input.largestTie
  );
}

/** Point-in effect-expanded clipped shape via exact scanline Minkowski region at `y`. */
export function pointInEffectExpandedClip(
  x: number,
  y: number,
  clipPolygon: readonly DrawingPoint[],
  effectInsets: DrawingInsets
): boolean {
  if (clipPolygon.length < 3) return false;
  const intervals = minkowskiExcludedIntervalsAtY(clipPolygon, y, effectInsets, 'nonzero');
  return intervals.some(
    (interval) => x >= interval.start - 0.000_001 && x <= interval.end + 0.000_001
  );
}

export function pointInDrawingClip(x: number, y: number, geometry: DrawingGeometry): boolean {
  const effectInsets = geometry.effectInsets ?? EMPTY_INSETS;
  const hitBox = geometry.hitBounds;
  if (x < hitBox.x || x > hitBox.x + hitBox.width || y < hitBox.y || y > hitBox.y + hitBox.height) {
    return false;
  }
  if (geometry.clipPolygon && geometry.clipPolygon.length >= 3) {
    return pointInEffectExpandedClip(x, y, geometry.clipPolygon, effectInsets);
  }
  const expanded = expandBoxByInsets(geometry.contentBounds, effectInsets);
  return (
    x >= expanded.x &&
    x <= expanded.x + expanded.width &&
    y >= expanded.y &&
    y <= expanded.y + expanded.height
  );
}

/** @deprecated Prefer {@link minkowskiExcludedIntervalsAtY}; kept for compatibility tests. */
export function expandPolygonAnisotropic(
  polygon: readonly DrawingPoint[],
  wrapDistances: DrawingInsets,
  effectInsets: DrawingInsets
): readonly DrawingPoint[] {
  const bounds = expandBoundsAnisotropic(
    {
      x: Math.min(...polygon.map((p) => p.x)),
      y: Math.min(...polygon.map((p) => p.y)),
      width: Math.max(...polygon.map((p) => p.x)) - Math.min(...polygon.map((p) => p.x)),
      height: Math.max(...polygon.map((p) => p.y)) - Math.min(...polygon.map((p) => p.y)),
    },
    combinedInsets(wrapDistances, effectInsets)
  );
  return boundedRectanglePolygon(bounds);
}

export function wrapExclusionFromProjection(options: {
  readonly mode: 'square' | 'tight' | 'through' | 'topAndBottom';
  readonly contentBounds: LayoutBox;
  readonly geometry: import('./drawing-geometry.ts').DrawingGeometry;
  readonly wrapDistancesEmu: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly polygonEmu: readonly Readonly<{ x: number; y: number }>[];
  readonly crop: SourceCrop;
  readonly transform: DrawingTransform;
  readonly extentWidthPt: number;
  readonly extentHeightPt: number;
  readonly textSide: WrapTextSide;
  readonly contentLeft: number;
  readonly contentRight: number;
}): WrapExclusionInput {
  const wrapDistances: DrawingInsets = Object.freeze({
    top: finite(options.wrapDistancesEmu.top / EMU_PER_POINT),
    right: finite(options.wrapDistancesEmu.right / EMU_PER_POINT),
    bottom: finite(options.wrapDistancesEmu.bottom / EMU_PER_POINT),
    left: finite(options.wrapDistancesEmu.left / EMU_PER_POINT),
  });
  const polygon =
    options.mode === 'tight' || options.mode === 'through'
      ? normalizeWrapPolygonToPage({
          polygonEmu: options.polygonEmu,
          extentWidthPt: options.extentWidthPt,
          extentHeightPt: options.extentHeightPt,
          anchorX: options.contentBounds.x,
          anchorY: options.contentBounds.y,
          crop: options.crop,
          transform: options.transform,
        })
      : null;
  return Object.freeze({
    mode: options.mode,
    contentBounds: options.contentBounds,
    polygon,
    clipPolygon: options.geometry.clipPolygon,
    wrapDistances,
    effectInsets: options.geometry.effectInsets,
    textSide: options.textSide,
    contentLeft: options.contentLeft,
    contentRight: options.contentRight,
  });
}
