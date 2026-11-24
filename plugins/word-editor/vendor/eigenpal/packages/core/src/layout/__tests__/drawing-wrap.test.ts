// Wrap polygon scanline and exclusion primitives (typed-drawings-and-images task 8).

import { describe, expect, test } from 'bun:test';
import type { DrawingTransform } from '../../store/package/drawing-projection.ts';
import {
  availableTextIntervalsOnScanline,
  expandBoundsAnisotropic,
  excludedIntervalsOnScanline,
  normalizeWrapPolygonToPage,
  squareExclusionBounds,
} from '../drawing-wrap.ts';
import type { DrawingInsets, DrawingPoint } from '../drawing-geometry.ts';

const identityTransform: DrawingTransform = Object.freeze({
  rotationDegrees: 0,
  flipHorizontal: false,
  flipVertical: false,
  offsetEmu: Object.freeze({ x: 0, y: 0 }),
  extentEmu: Object.freeze({ cx: 0, cy: 0 }),
});

describe('expandBoundsAnisotropic', () => {
  test('wrap distances use directional Minkowski expansion', () => {
    const bounds = { x: 100, y: 50, width: 80, height: 40 };
    const distances: DrawingInsets = { top: 5, right: 10, bottom: 15, left: 20 };
    const expanded = expandBoundsAnisotropic(bounds, distances);
    expect(expanded).toEqual({ x: 80, y: 45, width: 110, height: 60 });
  });
});

describe('normalizeWrapPolygonToPage', () => {
  test('maps wrap polygon through shape xfrm into page coordinates', () => {
    const polygon = Object.freeze([
      { x: 0, y: 0 },
      { x: 127_000, y: 0 },
      { x: 127_000, y: 63_500 },
      { x: 0, y: 63_500 },
    ]);
    const page = normalizeWrapPolygonToPage({
      polygonEmu: polygon,
      extentWidthPt: 10,
      extentHeightPt: 5,
      anchorX: 20,
      anchorY: 30,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform,
    });
    expect(page).not.toBeNull();
    expect(page![0]).toEqual({ x: 20, y: 30 });
    expect(page![2]).toEqual({ x: 30, y: 35 });
  });

  test('malformed polygon with fewer than three points returns bounded rectangle', () => {
    const page = normalizeWrapPolygonToPage({
      polygonEmu: Object.freeze([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]),
      extentWidthPt: 50,
      extentHeightPt: 40,
      anchorX: 0,
      anchorY: 0,
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      transform: identityTransform,
    });
    expect(page).not.toBeNull();
    expect(page!.length).toBe(4);
    expect(page![0]).toEqual({ x: 0, y: 0 });
    expect(page![2]).toEqual({ x: 50, y: 40 });
  });
});

describe('uses transformed wrap geometry', () => {
  const contentLeft = 0;
  const contentRight = 200;
  const wrapDistances: DrawingInsets = { top: 0, right: 5, bottom: 0, left: 5 };
  const effectInsets: DrawingInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  test('square exclusion uses expanded transformed bounds', () => {
    const bounds = squareExclusionBounds(
      { x: 80, y: 40, width: 40, height: 20 },
      effectInsets,
      wrapDistances
    );
    expect(bounds).toEqual({ x: 75, y: 40, width: 50, height: 20 });
    const excluded = excludedIntervalsOnScanline(50, {
      mode: 'square',
      contentBounds: { x: 80, y: 40, width: 40, height: 20 },
      polygon: null,
      wrapDistances,
      effectInsets,
      textSide: 'bothSides',
      contentLeft,
      contentRight,
    });
    expect(excluded).toEqual([{ start: 75, end: 125 }]);
  });

  test('tight excludes outer filled intervals on a fixed scanline', () => {
    const triangle: readonly DrawingPoint[] = Object.freeze([
      { x: 100, y: 30 },
      { x: 140, y: 70 },
      { x: 60, y: 70 },
    ]);
    const excluded = excludedIntervalsOnScanline(50, {
      mode: 'tight',
      contentBounds: { x: 60, y: 30, width: 80, height: 40 },
      polygon: triangle,
      wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      textSide: 'bothSides',
      contentLeft,
      contentRight,
    });
    expect(excluded.length).toBe(1);
    expect(excluded[0]!.start).toBeCloseTo(80, 0);
    expect(excluded[0]!.end).toBeCloseTo(120, 0);
  });

  test('through uses even-odd contours and retains interior passages', () => {
    const frame: readonly DrawingPoint[] = Object.freeze([
      { x: 50, y: 20 },
      { x: 150, y: 20 },
      { x: 150, y: 80 },
      { x: 50, y: 80 },
      { x: 50, y: 20 },
      { x: 80, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 40 },
    ]);
    const excluded = excludedIntervalsOnScanline(50, {
      mode: 'through',
      contentBounds: { x: 50, y: 20, width: 100, height: 60 },
      polygon: frame,
      wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      textSide: 'bothSides',
      contentLeft,
      contentRight,
    });
    expect(excluded).toEqual([
      { start: 50, end: 80 },
      { start: 120, end: 150 },
    ]);
  });

  test('bothSides, left, right, and largest filter available intervals', () => {
    const input = {
      mode: 'square' as const,
      contentBounds: { x: 80, y: 40, width: 40, height: 20 },
      polygon: null as readonly DrawingPoint[] | null,
      wrapDistances: { top: 0, right: 0, bottom: 0, left: 0 },
      effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      contentLeft,
      contentRight,
    };
    expect(availableTextIntervalsOnScanline(50, { ...input, textSide: 'bothSides' })).toEqual([
      { start: 0, end: 80 },
      { start: 120, end: 200 },
    ]);
    expect(availableTextIntervalsOnScanline(50, { ...input, textSide: 'left' })).toEqual([
      { start: 0, end: 80 },
    ]);
    expect(availableTextIntervalsOnScanline(50, { ...input, textSide: 'right' })).toEqual([
      { start: 120, end: 200 },
    ]);
    const largest = availableTextIntervalsOnScanline(50, { ...input, textSide: 'largest' });
    expect(largest).toEqual([{ start: 120, end: 200 }]);
  });
});
