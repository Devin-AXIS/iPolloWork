import { expect, test } from 'bun:test';
import { narrowRectangularWrapSkip } from '../narrow-wrap-clearance.ts';
import { loadBody, layoutUnderFloat, squareWrapZone } from './float-over-table-harness.ts';
import type { ExclusionZone } from '../drawing-exclusion.ts';
import { mergeAvailableIntervalsAtY } from '../drawing-exclusion.ts';
import { linesOf } from '../semantic-records.ts';

const square = squareWrapZone({
  anchorParagraphId: 'p',
  top: 20,
  height: 100,
  left: 2,
  width: 98,
  contentWidth: 100,
});
const tight: ExclusionZone = {
  ...square,
  input: {
    ...square.input,
    mode: 'tight',
    polygon: [
      { x: 2, y: 20 },
      { x: 100, y: 20 },
      { x: 100, y: 120 },
      { x: 2, y: 120 },
    ],
  },
};

const through: ExclusionZone = { ...tight, input: { ...tight.input, mode: 'through' } };

test('square and rectangular contours clear the full prospective line box', () => {
  // Square moves the line to the rectangle's bottom. A tight or through contour moves it in
  // steps of the line height, to the first step clear of the contour.
  for (const [zone, fromInside, fromAbove] of [
    [square, 90, 110],
    [tight, 98, 112],
    [through, 98, 112],
  ] as const) {
    expect(narrowRectangularWrapSkip(30, 14, [zone], 0, 100, 14)).toBe(fromInside);
    expect(narrowRectangularWrapSkip(10, 14, [zone], 0, 100, 14)).toBe(fromAbove);
    expect(narrowRectangularWrapSkip(0, 14, [zone], 0, 100, 14)).toBe(0);
    expect(narrowRectangularWrapSkip(120, 14, [zone], 0, 100, 14)).toBe(0);
  }
});

test('a curved contour that leaves no glyph-wide passage steps the line by its height', () => {
  // The left edge leans from x 3 to x 2, so a 2pt-3pt passage is left in front of it.
  for (const mode of ['tight', 'through'] as const) {
    const leaning: ExclusionZone = {
      ...tight,
      input: {
        ...tight.input,
        mode,
        polygon: [
          { x: 3, y: 20 },
          { x: 100, y: 20 },
          { x: 100, y: 120 },
          { x: 2, y: 120 },
        ],
      },
    };
    expect(narrowRectangularWrapSkip(30, 14, [leaning], 0, 100, 6)).toBe(98);
    // A glyph that fits the passage keeps the line in place.
    expect(narrowRectangularWrapSkip(30, 14, [leaning], 0, 100, 1)).toBe(0);
  }
});

test('fitting gaps, oversized glyphs and curved contours retain their fallback', () => {
  expect(narrowRectangularWrapSkip(30, 14, [square], 0, 100, 1)).toBe(0);
  expect(narrowRectangularWrapSkip(30, 14, [square], 0, 100, 101)).toBe(0);
  const triangle: ExclusionZone = {
    ...tight,
    input: {
      ...tight.input,
      polygon: [
        { x: 2, y: 20 },
        { x: 100, y: 120 },
        { x: 2, y: 120 },
      ],
    },
  };
  expect(narrowRectangularWrapSkip(30, 14, [triangle], 0, 100, 14)).toBe(0);
});

test('overlapping rectangles advance across successive lower boundaries', () => {
  const left = squareWrapZone({
    anchorParagraphId: 'p',
    top: 20,
    height: 60,
    left: 0,
    width: 51,
    contentWidth: 100,
  });
  const right = squareWrapZone({
    anchorParagraphId: 'p',
    top: 20,
    height: 100,
    left: 49,
    width: 51,
    contentWidth: 100,
  });
  expect(narrowRectangularWrapSkip(30, 14, [left, right], 0, 100, 100)).toBe(90);
});

test('floating tables clear quarter-inch passages even when a letter fits', () => {
  for (const side of [8, 18, 18.5, 20, 38]) {
    const table: ExclusionZone = {
      ...squareWrapZone({
        anchorParagraphId: 'p',
        top: 20,
        height: 100,
        left: side,
        width: 200 - side * 2,
        contentWidth: 200,
      }),
      sourceKind: 'table',
    };
    expect(narrowRectangularWrapSkip(30, 14, [table], 0, 200, 6)).toBe(side <= 18 ? 90 : 0);
    expect(mergeAvailableIntervalsAtY(30, [table], 0, 200)).toHaveLength(side <= 18 ? 0 : 2);
    expect(mergeAvailableIntervalsAtY(120, [table], 0, 200)).toEqual([{ start: 0, end: 200 }]);
  }
});

test('table passage filtering keeps a wide alternative and ignores off-column tables', () => {
  const table: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: 'p',
      top: 20,
      height: 100,
      left: 8,
      width: 100,
      contentWidth: 200,
    }),
    sourceKind: 'table',
  };
  expect(mergeAvailableIntervalsAtY(30, [table], 0, 200)).toEqual([{ start: 108, end: 200 }]);
  expect(mergeAvailableIntervalsAtY(30, [table], 150, 165)).toEqual([{ start: 150, end: 165 }]);
});

test('a drawing cannot narrow an admitted table passage below the minimum in either input order', () => {
  const table: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: 'p',
      top: 20,
      height: 100,
      left: 20,
      width: 140,
      contentWidth: 200,
    }),
    sourceKind: 'table',
  };
  const drawing = squareWrapZone({
    anchorParagraphId: 'p',
    top: 20,
    height: 40,
    left: 0,
    width: 5,
    contentWidth: 200,
  });
  for (const zones of [
    [table, drawing],
    [drawing, table],
  ]) {
    expect(mergeAvailableIntervalsAtY(30, zones, 0, 200)).toEqual([{ start: 160, end: 200 }]);
    expect(mergeAvailableIntervalsAtY(60, zones, 0, 200)).toEqual([
      { start: 0, end: 20 },
      { start: 160, end: 200 },
    ]);
  }
});

test('an unrelated curved drawing cannot reopen blocked floating-table passages', () => {
  const table: ExclusionZone = { ...square, sourceKind: 'table' };
  const curved: ExclusionZone = {
    ...tight,
    verticalBand: { x: 200, y: 20, width: 100, height: 100 },
    input: {
      ...tight.input,
      contentBounds: { x: 200, y: 20, width: 100, height: 100 },
      polygon: [
        { x: 200, y: 20 },
        { x: 300, y: 120 },
        { x: 200, y: 120 },
      ],
    },
  };
  expect(narrowRectangularWrapSkip(30, 14, [table, curved], 0, 100, 1)).toBe(90);
});

test('paragraph placement clears a narrow table beside an off-column curved drawing', () => {
  const source = loadBody('<w:p><w:r><w:t>ABCD EFGH</w:t></w:r></w:p>');
  const paragraph = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const table: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: paragraph.id,
      top: 0,
      height: 40,
      left: 8,
      width: 164,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
  const base = squareWrapZone({
    anchorParagraphId: paragraph.id,
    top: 0,
    height: 60,
    left: 190,
    width: 10,
    contentWidth: 180,
  });
  const curved: ExclusionZone = {
    ...base,
    input: {
      ...base.input,
      mode: 'tight',
      polygon: [
        { x: 190, y: 0 },
        { x: 200, y: 30 },
        { x: 190, y: 60 },
      ],
    },
  };
  for (const zones of [[table], [table, curved], [curved, table]]) {
    const lines = linesOf(layoutUnderFloat(source, new Map([[0, zones]])));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.box.y).toBe(40);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('ABCD EFGH');
  }
});

function combinedTableAndCurve(height: number, polygon: readonly { x: number; y: number }[]) {
  const table: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: 'p',
      top: 0,
      height,
      left: 25,
      width: 147,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
  const base = squareWrapZone({
    anchorParagraphId: 'p',
    top: 0,
    height: Math.max(...polygon.map((point) => point.y)),
    left: 0,
    width: 40,
    contentWidth: 180,
  });
  const curved: ExclusionZone = { ...base, input: { ...base.input, mode: 'tight', polygon } };
  return [table, curved] as const;
}

test('combined table and curve clearance stops when a passage widens', () => {
  const zones = combinedTableAndCurve(100, [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 0, y: 60 },
  ]);
  const skip = narrowRectangularWrapSkip(0, 14, zones, 0, 180, 6);
  expect(skip).toBe(56);
  expect(skip).toBeLessThan(100);
  expect(mergeAvailableIntervalsAtY(skip, zones, 0, 180)).toEqual([{ start: 2, end: 25 }]);
  expect(narrowRectangularWrapSkip(0, 14, [zones[1]], 0, 180, 6)).toBe(0);
});

test('combined clearance checks contour vertices inside the prospective line', () => {
  const zones = combinedTableAndCurve(100, [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 20, y: 7 },
    { x: 2, y: 14 },
    { x: 0, y: 14 },
  ]);
  expect(narrowRectangularWrapSkip(0, 14, zones, 0, 180, 6)).toBe(14);
});

test('clearing a table does not resume text inside a remaining curved exclusion', () => {
  const pair = combinedTableAndCurve(40, [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 180, y: 70 },
    { x: 0, y: 70 },
  ]);
  const narrowTable: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: 'p',
      top: 0,
      height: 40,
      left: 8,
      width: 164,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
  for (const table of [pair[0], narrowTable]) {
    const zones = [table, pair[1]];
    const skip = narrowRectangularWrapSkip(0, 14, zones, 0, 180, 6);
    expect(skip).toBe(70);
    expect(mergeAvailableIntervalsAtY(skip + 0.001, zones, 0, 180)).toEqual([
      { start: 0, end: 180 },
    ]);
  }
});

test('an off-column table leaves a blocking curve to step the line by its height', () => {
  const [, curved] = combinedTableAndCurve(40, [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 180, y: 70 },
    { x: 0, y: 70 },
  ]);
  const table: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: 'p',
      top: 0,
      height: 40,
      left: 190,
      width: 20,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
  // The curve covers the whole column down to 70pt: five 14pt steps clear it.
  expect(narrowRectangularWrapSkip(0, 14, [curved], 0, 180, 6)).toBe(70);
  expect(narrowRectangularWrapSkip(0, 14, [table, curved], 0, 180, 6)).toBe(70);
});

test('combined clearance exhausts its scan budget below every blocking zone', () => {
  const zones = combinedTableAndCurve(1000, [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 30, y: 1000 },
    { x: 0, y: 1000 },
  ]);
  expect(narrowRectangularWrapSkip(0, 14, zones, 0, 180, 6)).toBe(1000);
  const later = squareWrapZone({
    anchorParagraphId: 'p',
    top: 5000,
    height: 1000,
    left: 0,
    width: 180,
    contentWidth: 180,
  });
  expect(narrowRectangularWrapSkip(0, 14, [...zones, later], 0, 180, 6)).toBe(1000);
});

test('unrelated dense contour events cannot exhaust current table passage checks', () => {
  const table: ExclusionZone = {
    ...squareWrapZone({
      anchorParagraphId: 'p',
      top: 0,
      height: 40,
      left: 0,
      width: 80,
      contentWidth: 180,
    }),
    sourceKind: 'table',
  };
  for (const [left, top] of [
    [20, 60],
    [200, 0],
  ]) {
    const base = squareWrapZone({
      anchorParagraphId: 'p',
      top: top!,
      height: 10,
      left: left!,
      width: 40,
      contentWidth: 180,
    });
    const polygon = Array.from({ length: 260 }, (_, index) => ({
      x: left! + 20 + 20 * Math.cos((index * Math.PI * 2) / 260),
      y: top! + 5 + 5 * Math.sin((index * Math.PI * 2) / 260),
    }));
    const curved: ExclusionZone = { ...base, input: { ...base.input, mode: 'tight', polygon } };
    expect(narrowRectangularWrapSkip(0, 14, [table, curved], 0, 180, 6)).toBe(0);
  }
});

test('paragraph placement does not publish glyphs inside a combined table and curved exclusion', () => {
  const source = loadBody('<w:p><w:r><w:t>ABCD EFGH</w:t></w:r></w:p>');
  const paragraph = source.root.children
    .flatMap((child) => ('children' in child ? child.children : []))
    .find((child) => child.kind === 'paragraph')!;
  const zones = combinedTableAndCurve(40, [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 0, y: 60 },
  ]).map((zone) => ({ ...zone, anchorParagraphId: paragraph.id }));
  const lines = linesOf(layoutUnderFloat(source, new Map([[0, zones]])));
  expect(lines).toHaveLength(1);
  expect(lines[0]!.box.y).toBe(40);
  expect(lines[0]!.spans[0]!.box.x).toBeCloseTo(10, 2);
  expect(lines[0]!.spans.map((span) => span.text).join('')).toBe('ABCD EFGH');
});
