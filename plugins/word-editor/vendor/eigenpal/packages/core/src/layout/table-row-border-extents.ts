import type { BorderGridCell } from './table-borders.ts';

/** Physical row boundaries include skipped grid columns, independently of lookup budgets. */
export function tableRowBorderExtents(
  rows: readonly (readonly BorderGridCell[])[],
  columnCount: number
): readonly Readonly<{ start: number; end: number }>[] {
  return rows.map((row) => {
    let start = columnCount;
    let end = 0;
    for (const cell of row) {
      const left = Math.max(0, cell.gridColumn);
      const right = Math.min(columnCount, left + cell.gridSpan);
      if (right <= left) continue;
      start = Math.min(start, left);
      end = Math.max(end, right);
    }
    return { start, end };
  });
}
