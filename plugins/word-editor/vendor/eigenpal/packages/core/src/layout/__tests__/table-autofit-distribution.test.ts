import { describe, expect, test } from 'bun:test';
import {
  contentSizedWidths,
  fitMinimumsToRoom,
  spanAdjustedMinimums,
} from '../table-autofit-distribution.ts';

const sum = (widths: readonly number[]) => widths.reduce((total, width) => total + width, 0);

describe('columns sized by their content', () => {
  const all = [true, true, true];

  test('a table with room shares it in proportion to each column’s widest line', () => {
    const widths = contentSizedWidths([250, 125, 75], all, [20, 20, 20], [20, 30, 50], 450, 451, {
      insets: [],
    });
    expect(widths.map((width) => width / 4.5)).toEqual([20, 30, 50]);
  });

  test('a table with no width of its own takes its widest lines, up to its room', () => {
    expect(
      contentSizedWidths([250, 125, 75], all, [20, 20, 20], [20, 30, 50], undefined, 451, {
        insets: [],
      })
    ).toEqual([20, 30, 50]);
    const capped = contentSizedWidths([1, 1, 1], all, [20, 20, 20], [20, 800, 20], undefined, 451, {
      insets: [],
    });
    expect(sum(capped)).toBeCloseTo(451, 6);
    // The short columns hold whole; the long one wraps into the rest.
    expect(capped).toEqual([20, 411, 20]);
  });

  test('wrapping moves every column from its minimum toward its widest line alike', () => {
    const widths = contentSizedWidths([1, 1], [true, true], [10, 10], [210, 410], 320, 451, {
      insets: [],
    });
    // 300 points of the 600 wanted above the minimums: each column gets half its own.
    expect(widths).toEqual([110, 210]);
  });

  test('minimums wider than the room scale down together above their hairlines', () => {
    const widths = contentSizedWidths([1, 1, 1], all, [159, 301, 32], [159, 301, 32], 450, 451, {
      insets: [],
    });
    expect(sum(widths)).toBeCloseTo(451, 6);
    // Each column keeps its 1 pt hairline; what it holds above that scales alike.
    expect((widths[0]! - 1) / (widths[1]! - 1)).toBeCloseTo(158 / 300, 6);
  });

  test('a column with a preferred width keeps it while the others get their widest lines', () => {
    const mixed = [false, true, true];
    const roomy = contentSizedWidths([125, 1, 1], mixed, [26, 28, 32], [26, 28, 32], 450, 451, {
      insets: [],
    });
    // 450 - 125 - (28 + 32) = 265 points shared by the content-sized columns' widest lines.
    expect(roomy[0]).toBe(125);
    expect(roomy[1]).toBeCloseTo(28 + (265 * 28) / 60, 6);
    expect(roomy[2]).toBeCloseTo(32 + (265 * 32) / 60, 6);
    // Past that, it gives way first: the others keep their widest lines.
    const tight = contentSizedWidths([125, 1, 1], mixed, [26, 28, 32], [26, 301, 32], 450, 451, {
      insets: [],
    });
    expect(tight).toEqual([117, 301, 32]);
  });
});

describe('a cell spanning several columns', () => {
  test('raises the spanned columns to its own minimum by width plus content', () => {
    const raised = spanAdjustedMinimums(
      [250, 125, 75],
      [26, 28, 104],
      [26, 28, 104],
      [{ from: 1, count: 2, minimum: 301.7 }]
    );
    const weights = [125 + 28, 104 + 104];
    expect(raised[0]).toBe(26);
    expect(raised[1]).toBeCloseTo((301.7 * weights[0]!) / (weights[0]! + weights[1]!), 6);
    expect(raised[1]! + raised[2]!).toBeCloseTo(301.7, 6);
  });

  test('leaves columns that already hold it alone', () => {
    const minimums = [26, 28, 32];
    expect(
      spanAdjustedMinimums([250, 125, 75], minimums, minimums, [
        { from: 1, count: 2, minimum: 150 },
      ])
    ).toEqual(minimums);
  });

  test('never takes a column below its own minimum', () => {
    const raised = spanAdjustedMinimums(
      [10, 10],
      [5, 90],
      [5, 90],
      [{ from: 0, count: 2, minimum: 140 }]
    );
    expect(raised[0]).toBeGreaterThanOrEqual(5);
    expect(raised[1]).toBeGreaterThanOrEqual(90);
    expect(raised[0]! + raised[1]!).toBeCloseTo(140, 6);
  });

  test('raises columns that fall short by a fraction of a point', () => {
    // Text 0.002pt wider than its columns still breaks inside the cell.
    const raised = spanAdjustedMinimums(
      [6.85, 72],
      [6.85, 72],
      [6.85, 72],
      [{ from: 0, count: 2, minimum: 78.852 }]
    );
    expect(raised[0]! + raised[1]!).toBeGreaterThanOrEqual(78.852 - 1e-9);
  });
});

describe('minimums that overflow their room', () => {
  test('minimums that fit come back raised to hairlines', () => {
    expect(fitMinimumsToRoom([0.5, 40], 100, [10, 10])).toEqual([1, 40]);
  });

  test('every column keeps its insets and narrows its content by one factor', () => {
    const widths = fitMinimumsToRoom([40, 70, 130, 490], 400, [10, 10, 10, 10]);
    expect(sum(widths)).toBeCloseTo(400, 6);
    // 360 points of content share the room left after 40 points of insets.
    const scale = 360 / 690;
    expect(widths).toEqual([30, 60, 120, 480].map((content) => 10 + content * scale));
  });

  test('one unbreakable word does not take the other columns down to hairlines', () => {
    const widths = fitMinimumsToRoom([40, 50, 6000], 450, [10, 10, 10]);
    // The long content counts as 1584 points, so the short columns keep a readable share.
    expect(widths[0]).toBeGreaterThan(15);
    expect(widths[1]).toBeGreaterThan(widths[0]!);
    expect(sum(widths)).toBeCloseTo(450, 6);
  });

  test('content past the widest page counts as the widest page', () => {
    const widths = fitMinimumsToRoom([20, 2000, 9000], 300, [0, 0, 0]);
    expect(widths[1]).toBeCloseTo(widths[2]!, 6);
  });

  test('content past the widest page takes the room the other columns leave', () => {
    // Column 0 settles at its minimum; the capped column takes all the rest.
    const widths = fitMinimumsToRoom([10, 2000], 1700, [0, 0]);
    expect(widths[0]).toBe(10);
    expect(sum(widths)).toBeCloseTo(1700, 6);
  });

  test('no column grows past its minimum', () => {
    // The capped content needs less than the room, which would otherwise widen column 0.
    const widths = fitMinimumsToRoom([10, 3000], 2000, [0, 0]);
    expect(widths[0]).toBe(10);
    expect(widths[1]).toBeLessThanOrEqual(3000);
  });

  test('insets that alone overflow scale above their hairlines', () => {
    expect(fitMinimumsToRoom([30, 30], 21, [21, 21])).toEqual([10.5, 10.5]);
  });

  test('without insets every column keeps a hairline', () => {
    expect(fitMinimumsToRoom([11, 21], 17, [])).toEqual([1 + 10 * 0.5, 1 + 20 * 0.5]);
  });

  test('a room that is not finite keeps the minimums', () => {
    expect(fitMinimumsToRoom([40, 6000], Infinity, [10, 10])).toEqual([40, 6000]);
  });
});
