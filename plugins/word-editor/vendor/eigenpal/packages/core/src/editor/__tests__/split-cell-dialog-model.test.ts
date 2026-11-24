// The Split cells dialog's shared count reading and defaults.

import { describe, expect, test } from 'bun:test';
import {
  initialSplitCellCounts,
  readSplitCellCounts,
  SPLIT_CELL_FALLBACK_MAX,
} from '../split-cell-dialog-model.ts';

describe('split cell dialog counts', () => {
  const limits = { maxRows: 3, maxCols: 4 };

  test('reads whole counts within the limits', () => {
    expect(readSplitCellCounts('2', '3', limits)).toEqual({
      counts: { rows: 3, cols: 2 },
      problem: null,
    });
  });

  test('names the field out of range and its limit', () => {
    expect(readSplitCellCounts('5', '1', limits).problem).toEqual({
      kind: 'range',
      field: 'columns',
      max: 4,
    });
    expect(readSplitCellCounts('2', 'x', limits).problem).toEqual({
      kind: 'range',
      field: 'rows',
      max: 3,
    });
    expect(readSplitCellCounts('0', '1', null).problem).toEqual({
      kind: 'range',
      field: 'columns',
      max: SPLIT_CELL_FALLBACK_MAX,
    });
  });

  test('one cell is not a split', () => {
    expect(readSplitCellCounts('1', '1', limits)).toEqual({
      counts: null,
      problem: { kind: 'oneCell' },
    });
  });

  test('opens with the first split the engine honours', () => {
    const allow = (allowed: string[]) => (command: { rows: number; cols: number }) =>
      allowed.includes(`${command.rows}x${command.cols}`)
        ? ({ ok: true } as const)
        : ({ ok: false, code: 'invalidArgs', reason: 'no' } as const);
    expect(initialSplitCellCounts(limits, allow(['1x2', '2x1']))).toEqual({
      columns: '2',
      rows: '1',
    });
    // Too narrow for two columns: two rows.
    expect(initialSplitCellCounts(limits, allow(['2x1']))).toEqual({ columns: '1', rows: '2' });
    // Merged over three rows: two does not divide them, three does.
    expect(initialSplitCellCounts(limits, allow(['3x1']))).toEqual({ columns: '1', rows: '3' });
  });
});
