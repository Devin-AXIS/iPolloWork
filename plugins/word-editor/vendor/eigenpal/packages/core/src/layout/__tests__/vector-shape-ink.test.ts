// A stroked outline on the edge of its drawing reaches past the extent; the paint clip grows.

import { describe, expect, test } from 'bun:test';
import type { InlineDrawingRecord } from '../drawing-layout.ts';
import type { LayoutBox } from '../semantic-records.ts';
import { EMU_PER_POINT } from '../drawing-layout.ts';
import { clipGeometryToRegion } from '../drawing-geometry.ts';
import { vectorShapeInkClip } from '../vector-shape-ink.ts';

const EXTENT = 100 * EMU_PER_POINT;
const HALF_STROKE = 9525 / 2 / EMU_PER_POINT;
const CONTENT = { x: 10, y: 20, width: 100, height: 100 };

type Path = readonly Readonly<{ x: number; y: number }>[];
type Sides = Record<'top' | 'right' | 'bottom' | 'left', number>;

function record(
  paths: readonly Path[],
  options: {
    readonly effect?: Partial<Sides>;
    readonly paintBounds?: LayoutBox;
    readonly closed?: boolean;
    readonly stroke?: boolean;
    readonly arrowheads?: readonly Path[];
  } = {}
): InlineDrawingRecord {
  const effect = { top: 0, right: 0, bottom: 0, left: 0, ...options.effect };
  return {
    vectorShape: {
      extentEmu: { cx: EXTENT, cy: EXTENT },
      components: [
        {
          subpathsEmu: paths,
          subpathsClosed: paths.map(() => options.closed ?? false),
          fillHex: null,
          fillAlpha: 1,
          strokeHex: options.stroke === false ? null : '000000',
          strokeAlpha: 1,
          strokeWidthEmu: 9525,
          ...(options.arrowheads ? { arrowheadsEmu: options.arrowheads } : {}),
        },
      ],
    },
    geometry: { contentBounds: CONTENT, effectInsets: effect },
    paintBounds: options.paintBounds ?? {
      x: CONTENT.x - effect.left,
      y: CONTENT.y - effect.top,
      width: CONTENT.width + effect.left + effect.right,
      height: CONTENT.height + effect.top + effect.bottom,
    },
  } as unknown as InlineDrawingRecord;
}

/** How far the ink clip reaches past `paintBounds` on each side. */
function growth(drawing: InlineDrawingRecord): Sides {
  const paint = drawing.paintBounds;
  const clip = vectorShapeInkClip(drawing, paint);
  return {
    left: paint.x - clip.x,
    top: paint.y - clip.y,
    right: clip.x + clip.width - (paint.x + paint.width),
    bottom: clip.y + clip.height - (paint.y + paint.height),
  };
}

const vertical = (x: number): Path => [
  { x, y: 0 },
  { x, y: EXTENT },
];
const NONE: Sides = { top: 0, right: 0, bottom: 0, left: 0 };

describe('vectorShapeInkClip', () => {
  test('edge rules grow only the sides they sit on', () => {
    const grown = growth(record([vertical(0), vertical(EXTENT)]));
    expect(grown.left).toBeCloseTo(HALF_STROKE, 9);
    expect(grown.right).toBeCloseTo(HALF_STROKE, 9);
    // Butt caps add nothing past the ends of a vertical rule.
    expect(grown.top).toBe(0);
    expect(grown.bottom).toBe(0);
  });

  test('the clip follows the bounds it is given, such as absolute export bounds', () => {
    const drawing = record([vertical(0)]);
    const absolute = { x: 510, y: 820, width: 100, height: 100 };
    const clip = vectorShapeInkClip(drawing, absolute);
    expect(clip.x).toBeCloseTo(510 - HALF_STROKE, 9);
    expect(clip.width).toBeCloseTo(100 + HALF_STROKE, 9);
    expect(clip.y).toBe(820);
  });

  test('an effect extent already covers its side; a rule inside the extent needs nothing', () => {
    const covered = growth(record([vertical(0), vertical(EXTENT)], { effect: { right: 1 } }));
    expect(covered.left).toBeCloseTo(HALF_STROKE, 9);
    expect(covered.right).toBe(0);
    expect(growth(record([vertical(EXTENT / 2)]))).toEqual(NONE);
  });

  test('a negative effect extent is an authored crop and stays', () => {
    const cropped = record([vertical(0)], {
      effect: { left: -1 },
      paintBounds: { x: CONTENT.x + 1, y: CONTENT.y, width: 99, height: 100 },
    });
    expect(growth(cropped).left).toBe(0);
  });

  test('a stroked rectangle on the extent grows every side by half the stroke', () => {
    const square: Path = [
      { x: 0, y: 0 },
      { x: EXTENT, y: 0 },
      { x: EXTENT, y: EXTENT },
      { x: 0, y: EXTENT },
    ];
    const grown = growth(record([square], { closed: true }));
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(grown[side]).toBeCloseTo(HALF_STROKE, 9);
    }
  });

  test('an acute miter on the top edge reaches past half the stroke, up to the limit', () => {
    // A 60 degree apex: the miter ratio is 1 / sin(30 degrees) = 2, inside the limit of 4.
    const apex: Path = [
      { x: EXTENT / 2 - EXTENT / 4, y: (EXTENT / 4) * Math.sqrt(3) },
      { x: EXTENT / 2, y: 0 },
      { x: EXTENT / 2 + EXTENT / 4, y: (EXTENT / 4) * Math.sqrt(3) },
    ];
    expect(growth(record([apex])).top).toBeCloseTo(2 * HALF_STROKE, 9);
    // A 10 degree apex exceeds the limit and is bevelled: the segment edges bound it.
    const spike: Path = [
      { x: EXTENT / 2 - EXTENT * Math.sin(Math.PI / 36), y: EXTENT * Math.cos(Math.PI / 36) },
      { x: EXTENT / 2, y: 0 },
      { x: EXTENT / 2 + EXTENT * Math.sin(Math.PI / 36), y: EXTENT * Math.cos(Math.PI / 36) },
    ];
    expect(growth(record([spike])).top).toBeCloseTo(HALF_STROKE * Math.sin(Math.PI / 36), 9);
  });

  test('geometry outside the extent stays clipped', () => {
    const far: Path = [
      { x: -999_999_999_999_999, y: 0 },
      { x: -999_999_999_999_999, y: EXTENT },
    ];
    expect(growth(record([far]))).toEqual(NONE);
    // A path that leaves at a shallow angle reaches past the edge only by its own stroke:
    // no join forms where it crosses the edge.
    const exit: Path = [
      { x: EXTENT / 10, y: 0 },
      { x: -EXTENT / 10, y: EXTENT },
    ];
    const grown = growth(record([exit]));
    const sine = 0.2 / Math.hypot(0.2, 1);
    // Within the 1 EMU edge tolerance.
    expect(grown.left).toBeCloseTo(HALF_STROKE * (1 / Math.hypot(0.2, 1)), 3);
    expect(grown.top).toBeCloseTo(HALF_STROKE * sine, 3);
  });

  test('the inner side of a sharp join adds no reach', () => {
    // A 30 degree V pointing down, just under the top edge. Its inner miter point would sit
    // above the edge; the outer tip below the apex is the only miter ink.
    const half = 9525 / 2;
    const apexY = 3 * half;
    const rise = half / 2;
    const run = rise * Math.tan(Math.PI / 12);
    const v: Path = [
      { x: EXTENT / 2 - run, y: apexY - rise },
      { x: EXTENT / 2, y: apexY },
      { x: EXTENT / 2 + run, y: apexY - rise },
    ];
    expect(growth(record([v]))).toEqual(NONE);
  });

  test('a repeated closing point still measures the apex miter', () => {
    const apex = { x: EXTENT / 2, y: 0 };
    const triangle: Path = [
      apex,
      { x: EXTENT / 2 + EXTENT / 4, y: (EXTENT / 4) * Math.sqrt(3) },
      { x: EXTENT / 2 - EXTENT / 4, y: (EXTENT / 4) * Math.sqrt(3) },
      apex,
    ];
    expect(growth(record([triangle], { closed: true })).top).toBeCloseTo(2 * HALF_STROKE, 9);
  });

  test('a side that a layout region clipped stays clipped', () => {
    // A table cell cut the drawing 30pt in from its left edge.
    const grown = growth(
      record([vertical(0), vertical(EXTENT)], {
        paintBounds: { x: 40, y: 20, width: 70, height: 100 },
      })
    );
    expect(grown.left).toBe(0);
    expect(grown.right).toBeCloseTo(HALF_STROKE, 9);
  });

  test('a group edge that rounds a few ULPs past the extent still grows its side', () => {
    const past = EXTENT * (1 + 1e-15);
    expect(past).toBeGreaterThan(EXTENT);
    expect(growth(record([vertical(past)])).right).toBeCloseTo(HALF_STROKE, 6);
  });

  test('a line-end triangle on a line that ends in the extent grows the clip', () => {
    // A horizontal rule along the top edge ending at the right edge, with a 3x-stroke wing.
    const wing = 3 * 9525;
    const arrow: Path = [
      { x: EXTENT, y: 0 },
      { x: EXTENT - wing, y: -wing / 2 },
      { x: EXTENT - wing, y: wing / 2 },
    ];
    const rule: Path = [
      { x: 0, y: 0 },
      { x: EXTENT - wing, y: 0 },
    ];
    const grown = growth(record([rule], { arrowheads: [arrow] }));
    expect(grown.top).toBeCloseTo(wing / 2 / EMU_PER_POINT, 9);
    // A triangle wholly outside the extent stays clipped.
    const outside = arrow.map((point) => ({ x: point.x + 2 * EXTENT, y: point.y }));
    expect(growth(record([rule], { arrowheads: [outside] })).top).toBeCloseTo(HALF_STROKE, 9);
    // So does one whose line ends outside, even when a wing reaches back inside.
    const tipOutside: Path = [
      { x: EXTENT + wing / 2, y: 0 },
      { x: EXTENT - wing / 2, y: -wing / 2 },
      { x: EXTENT - wing / 2, y: wing / 2 },
    ];
    const clipped = growth(record([rule], { arrowheads: [tipOutside] }));
    expect(clipped.right).toBe(0);
    expect(clipped.top).toBeCloseTo(HALF_STROKE, 9);
  });

  test('an inset outline keeps the extent clip', () => {
    const drawing = record([vertical(0)]);
    const shape = drawing.vectorShape!;
    const inset = {
      ...drawing,
      vectorShape: { ...shape, components: [{ ...shape.components[0]!, strokeInset: true }] },
    } as InlineDrawingRecord;
    expect(growth(inset)).toEqual(NONE);
  });

  test('growth is measured from the painted edge, not the effect extent', () => {
    // A region clip rebuilt the paint box from the bare extent, dropping a 0.25pt effect.
    const rebuilt = record([vertical(0)], {
      effect: { left: 0.25 },
      paintBounds: { ...CONTENT },
    });
    expect(growth(rebuilt).left).toBeCloseTo(HALF_STROKE, 9);
  });

  test('a standalone vertical line grows its zero-width box on both sides', () => {
    const line = {
      vectorShape: {
        extentEmu: { cx: 0, cy: EXTENT },
        components: [
          {
            subpathsEmu: [vertical(0)],
            subpathsClosed: [false],
            fillHex: null,
            fillAlpha: 1,
            strokeHex: '000000',
            strokeAlpha: 1,
            strokeWidthEmu: 9525,
          },
        ],
      },
      geometry: {
        contentBounds: { x: 10, y: 20, width: 0, height: 100 },
        effectInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      paintBounds: { x: 10, y: 20, width: 0, height: 100 },
    } as unknown as InlineDrawingRecord;
    const clip = vectorShapeInkClip(line, line.paintBounds);
    expect(clip.x).toBeCloseTo(10 - HALF_STROKE, 9);
    expect(clip.width).toBeCloseTo(2 * HALF_STROKE, 9);
    expect(clip.height).toBe(100);
    // Clipped away by a region, the line has nothing left to grow.
    const gone = { ...line, paintBounds: { x: 10, y: 20, width: 0, height: 0 } };
    expect(vectorShapeInkClip(gone, gone.paintBounds)).toBe(gone.paintBounds);
  });

  test('a drawing clipped to nothing stays empty', () => {
    const empty = record([vertical(0), vertical(EXTENT)], {
      paintBounds: { x: CONTENT.x, y: CONTENT.y, width: 0, height: 0 },
    });
    expect(vectorShapeInkClip(empty, empty.paintBounds)).toBe(empty.paintBounds);
  });

  test('sub-threshold drift between paint and content bounds is not a region cut', () => {
    const drawing = record([vertical(0)], {
      paintBounds: { x: CONTENT.x + 5e-5, y: CONTENT.y + 5e-5, width: 100, height: 100 },
    });
    expect(growth(drawing).left).toBeCloseTo(HALF_STROKE, 9);
  });

  test('fill-only shapes and point-sized paths do not grow the clip', () => {
    expect(growth(record([vertical(0)], { stroke: false }))).toEqual(NONE);
    const point: Path = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(growth(record([point]))).toEqual(NONE);
  });

  test('a shape that paints outside its extent grows by its whole geometry', () => {
    const box: Path = [
      { x: -20 * EMU_PER_POINT, y: 10 * EMU_PER_POINT },
      { x: 50 * EMU_PER_POINT, y: 10 * EMU_PER_POINT },
      { x: 50 * EMU_PER_POINT, y: EXTENT + 30 * EMU_PER_POINT },
      { x: -20 * EMU_PER_POINT, y: EXTENT + 30 * EMU_PER_POINT },
    ];
    const clipped = record([box], { closed: true, stroke: false });
    expect(growth(clipped)).toEqual(NONE);
    const open = {
      ...clipped,
      vectorShape: { ...clipped.vectorShape!, overflowVisible: true },
    } as InlineDrawingRecord;
    const grown = growth(open);
    expect(grown.left).toBeCloseTo(20, 9);
    expect(grown.bottom).toBeCloseTo(30, 9);
    expect(grown.top).toBe(0);
    expect(grown.right).toBe(0);
  });

  // Measured: an upright shape with a 20pt negative effect extent on every side paints whole,
  // fill and outline; only a region cuts a shape that paints outside its extent.
  test('a negative effect extent cuts nothing from a shape that paints outside its extent', () => {
    const rect: Path = [
      { x: 0, y: 0 },
      { x: EXTENT, y: 0 },
      { x: EXTENT, y: EXTENT },
      { x: 0, y: EXTENT },
    ];
    const effect = { top: -20, right: -20, bottom: -20, left: -20 };
    const cut = record([rect], { closed: true, stroke: false, effect });
    // Without overflow the negative effect extent still cuts the shape.
    expect(growth(cut)).toEqual(NONE);
    const open = {
      ...cut,
      vectorShape: { ...cut.vectorShape!, overflowVisible: true },
    } as InlineDrawingRecord;
    const grown = growth(open);
    for (const side of ['left', 'top', 'right', 'bottom'] as const)
      expect(grown[side]).toBeCloseTo(20, 9);
    // A region that cuts further than the effect extent still cuts.
    const regionCut = clipped(open, {
      x: CONTENT.x + 30,
      y: CONTENT.y + 25,
      width: 200,
      height: 200,
    });
    expect(growth(regionCut).left).toBe(0);
    expect(growth(regionCut).top).toBe(0);
    expect(growth(regionCut).right).toBeCloseTo(20, 9);
  });

  test('a region that cuts less deep than a negative effect extent cuts at its own edge', () => {
    const open = record([TAIL], { closed: true, stroke: false });
    const shape = { ...open.vectorShape!, overflowVisible: true };
    const effect = { top: 0, right: -10, bottom: 0, left: 0 };
    const cut = record([TAIL], { closed: true, stroke: false, effect });
    // The region's right edge sits 3pt inside the extent, the effect extent's 10pt inside.
    const region = { x: 0, y: 0, width: CONTENT.x + CONTENT.width - 3, height: 500 };
    const regionOverEffect = clipped({ ...cut, vectorShape: shape } as InlineDrawingRecord, region);
    expect(regionOverEffect.geometry.regionCuts?.right).toBeCloseTo(3, 9);
    // The effect extent cuts nothing, so the clip grows back from 10pt inside to the region
    // edge, 3pt inside.
    expect(growth(regionOverEffect).right).toBeCloseTo(7, 9);
    // A record that layout clips again from its extent keeps the cut too.
    const reclipped = clipped(
      { ...open, vectorShape: shape, paintBounds: CONTENT } as InlineDrawingRecord,
      region
    );
    expect(growth(reclipped).right).toBe(0);
    // A cell edge on the effect extent's edge cuts there, as it does 0.05pt further in.
    const onEffect = { x: 0, y: 0, width: CONTENT.x + CONTENT.width - 10, height: 500 };
    const cellEdge = clipped({ ...cut, vectorShape: shape } as InlineDrawingRecord, onEffect);
    expect(cellEdge.geometry.regionCuts?.right).toBeCloseTo(10, 9);
    expect(growth(cellEdge).right).toBe(0);
    const nearEdge = { ...onEffect, width: onEffect.width - 0.05 };
    const cellNear = clipped({ ...cut, vectorShape: shape } as InlineDrawingRecord, nearEdge);
    expect(growth(cellNear).right).toBe(0);
    // An inline drawing's own line or column clip records no cut: the shape grows past it.
    const lineEdge = clipped(
      { ...cut, vectorShape: shape } as InlineDrawingRecord,
      onEffect,
      false
    );
    expect(lineEdge.geometry.regionCuts).toBeUndefined();
    expect(growth(lineEdge).right).toBeCloseTo(60, 9);
    // Nested regions: the deepest cut wins, whichever comes first.
    const deep = { ...onEffect, width: onEffect.width - 20 };
    const nested = clipped(
      clipped({ ...open, vectorShape: shape } as InlineDrawingRecord, deep),
      region
    );
    expect(nested.geometry.regionCuts?.right).toBeCloseTo(30, 9);
    // A region edge outside the extent cuts nothing: the tail paints past a cell or a margin.
    const wide = { x: 0, y: 0, width: CONTENT.x + CONTENT.width + 5, height: 500 };
    const past = clipped({ ...open, vectorShape: shape } as InlineDrawingRecord, wide);
    expect(past.geometry.regionCuts).toBeUndefined();
    expect(growth(past).right).toBeCloseTo(50, 9);
  });
});

/** A tail that reaches 50pt past the right extent edge. */
const TAIL: Path = [
  { x: 0, y: 0 },
  { x: EXTENT, y: 0 },
  { x: EXTENT * 1.5, y: EXTENT / 2 },
  { x: EXTENT, y: EXTENT },
  { x: 0, y: EXTENT },
];

/** `drawing` clipped to `region` the way layout clips a placed drawing. */
function clipped(
  drawing: InlineDrawingRecord,
  region: LayoutBox,
  recordCut = true
): InlineDrawingRecord {
  const geometry = clipGeometryToRegion(
    {
      ...drawing.geometry,
      paintBounds: drawing.paintBounds,
      hitBounds: drawing.paintBounds,
      transformedCorners: [],
      clipPolygon: null,
      clipFallback: 'none',
    },
    region,
    recordCut
  );
  return { ...drawing, paintBounds: geometry.paintBounds, geometry } as InlineDrawingRecord;
}
