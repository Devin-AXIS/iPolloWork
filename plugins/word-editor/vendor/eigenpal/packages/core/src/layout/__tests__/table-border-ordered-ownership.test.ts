import { expect, test } from 'bun:test';
import { buildColumnOwnershipIndexes, ownerAt } from '../table-border-ownership.ts';
import type { BorderGridCell, CellBorderBox } from '../table-borders.ts';

const borders: CellBorderBox = {
  top: { state: 'omitted' },
  left: { state: 'omitted' },
  bottom: { state: 'omitted' },
  right: { state: 'omitted' },
};
const cell = (gridColumn: number, gridSpan = 1): BorderGridCell => ({
  gridColumn,
  gridSpan,
  vMergeContinue: false,
  borders,
});

/** The sweep visits coordinates in order, regardless of the source order of disjoint cells. */
test('ordered claims agree with reversed disjoint claims through shared budget exhaustion', () => {
  for (let seed = 0; seed < 40; seed += 1) {
    let column = seed % 3;
    const row = Array.from({ length: 12 }, (_, index) => {
      const width = 1 + ((index + seed) % 3);
      const result = cell(column, width);
      column += width + ((index * 3 + seed) % 2);
      return result;
    });
    // Empty and out-of-grid claims must not change ownership or spend budget.
    row.splice(4, 0, cell(-10, 0));
    row.push(cell(500));
    for (const limit of [0, 1, 5, 13, 30]) {
      const forwardWork = { ownershipSlotsWritten: 0, columnLookups: 0 };
      const reverseWork = { ownershipSlotsWritten: 0, columnLookups: 0 };
      const forwardBudget = { intervalsRemaining: limit };
      const reverseBudget = { intervalsRemaining: limit };
      const reverse = row.toReversed();
      const a = buildColumnOwnershipIndexes([row, row], 40, forwardWork, forwardBudget);
      const b = buildColumnOwnershipIndexes([reverse, reverse], 40, reverseWork, reverseBudget);
      expect(forwardBudget).toEqual(reverseBudget);
      expect(forwardWork).toEqual(reverseWork);
      for (let r = 0; r < 2; r += 1) {
        expect(a[r]!.map(({ start, end }) => [start, end])).toEqual(
          b[r]!.map(({ start, end }) => [start, end])
        );
        for (let col = -1; col <= 40; col += 1) {
          const left = ownerAt(a, r, col, forwardWork);
          const right = ownerAt(b, r, col, reverseWork);
          expect(left?.cell).toBe(right?.cell);
          if (left) expect(row[left.cellIndex]).toBe(left.cell);
          if (right) expect(reverse[right.cellIndex]).toBe(right.cell);
        }
      }
      expect(forwardWork).toEqual(reverseWork);
    }
  }
});

test('overlapping and out-of-order claims keep first-source ownership', () => {
  const row = [cell(4, 3), cell(0, 5), cell(2, 4), cell(-4, 1)];
  const indexes = buildColumnOwnershipIndexes([row], 7);
  expect(Array.from({ length: 7 }, (_, col) => ownerAt(indexes, 0, col)?.cellIndex)).toEqual([
    1, 1, 1, 1, 0, 0, 0,
  ]);
});

test('clamping and unusual budget values retain the sparse ownership limits', () => {
  const row = [cell(-2, 2), cell(2, 1), cell(3, 0), cell(1023, 100), cell(2048, 1)];
  const indexes = buildColumnOwnershipIndexes([row], 4096);
  expect(indexes[0]!.map(({ start, end }) => [start, end])).toEqual([
    [0, 2],
    [2, 3],
    [1023, 1024],
  ]);
  for (const remaining of [Number.NaN, -1, 0, 0.5, Number.POSITIVE_INFINITY]) {
    const budget = { intervalsRemaining: remaining };
    const result = buildColumnOwnershipIndexes([row], 4096, undefined, budget);
    expect(result[0]!.length).toBe(remaining > 0 ? (remaining < 1 ? 1 : 3) : 0);
    if (remaining === 0.5) expect(budget.intervalsRemaining).toBe(-0.5);
  }
});
