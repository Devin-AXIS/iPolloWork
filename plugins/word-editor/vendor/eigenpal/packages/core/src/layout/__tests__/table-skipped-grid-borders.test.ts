import { expect, test } from 'bun:test';
import {
  resolveTableCellBorderGrid,
  type BorderGridCell,
  type TableBorderBox,
  type TableBorderSide,
} from '../table-borders.ts';

const omitted: TableBorderSide = { state: 'omitted' };
const edge = (color: string): TableBorderSide => ({
  state: 'edge',
  style: 'single',
  widthPt: 2,
  color,
});
const table: TableBorderBox = {
  top: edge('000000'),
  bottom: edge('000000'),
  left: edge('FF0000'),
  right: edge('0000FF'),
  insideH: edge('000000'),
  insideV: edge('008000'),
};
const cell = (
  gridColumn: number,
  gridSpan = 1,
  extra: Partial<BorderGridCell> = {}
): BorderGridCell => ({
  gridColumn,
  gridSpan,
  vMergeContinue: false,
  borders: { top: omitted, bottom: omitted, left: omitted, right: omitted },
  ...extra,
});

test('skipped leading and trailing columns retain outer row borders', () => {
  const rows = [
    [cell(0), cell(1), cell(2)],
    [cell(1), cell(2)],
    [cell(0), cell(1)],
  ];
  const result = resolveTableCellBorderGrid(rows, table, 3);
  expect(result[1]![0]!.left?.color).toBe('FF0000');
  expect(result[1]![0]!.right?.color).toBe('008000');
  expect(result[2]![1]!.right?.color).toBe('0000FF');
  expect(result[0]![1]!.left).toBeUndefined();
  expect(result[0]![0]!.right?.color).toBe('008000');
});

test('spanning and explicitly suppressed edges retain cell precedence', () => {
  const first = cell(1, 2);
  const rows = [
    [first],
    [
      cell(1, 2, {
        borders: { ...first.borders, left: edge('FF00FF'), right: { state: 'none' } },
      }),
    ],
  ];
  const result = resolveTableCellBorderGrid(rows, table, 3);
  expect(result[0]![0]!.left?.color).toBe('FF0000');
  expect(result[0]![0]!.right?.color).toBe('0000FF');
  expect(result[1]![0]!.left?.color).toBe('FF00FF');
  expect(result[1]![0]!.right).toBeUndefined();
});

test('exposed edges do not depend on exhausted ownership budgets', () => {
  const result = resolveTableCellBorderGrid([[cell(1), cell(2)]], table, 4, undefined, undefined, {
    intervalsRemaining: 0,
  });
  expect(result[0]![0]!.left?.color).toBe('FF0000');
  expect(result[0]![0]!.right?.color).toBe('008000');
  expect(result[0]![1]!.left).toBeUndefined();
  expect(result[0]![1]!.right?.color).toBe('0000FF');
});

test('merged cells publish exposed left intervals only beside skipped columns', () => {
  const result = resolveTableCellBorderGrid(
    [
      [cell(0), cell(1, 1, { mergeRowSpan: 2 }), cell(2)],
      [cell(1, 1, { vMergeContinue: true }), cell(2)],
    ],
    table,
    3
  );
  const segments = result[0]![1]!.edgeSegments?.filter((edge) => edge.side === 'left');
  expect(segments).toHaveLength(1);
  expect(segments![0]).toMatchObject({ gridStart: 1, gridEnd: 2, edge: { color: 'FF0000' } });
  expect(result[1]![0]).toEqual({});
});

test('merged right edges switch between internal and exposed row intervals', () => {
  const result = resolveTableCellBorderGrid(
    [
      [cell(0), cell(1, 1, { mergeRowSpan: 2 }), cell(2)],
      [cell(0), cell(1, 1, { vMergeContinue: true })],
    ],
    table,
    3
  );
  const segments = result[0]![1]!.edgeSegments?.filter((edge) => edge.side === 'right');
  expect(segments).toHaveLength(2);
  expect(segments![0]).toMatchObject({ gridStart: 0, gridEnd: 1, edge: { color: '008000' } });
  expect(segments![1]).toMatchObject({ gridStart: 1, gridEnd: 2, edge: { color: '0000FF' } });
});
