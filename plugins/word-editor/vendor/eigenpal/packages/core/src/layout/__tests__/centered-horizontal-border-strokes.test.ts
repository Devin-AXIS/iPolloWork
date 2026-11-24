import { expect, test } from 'bun:test';
import {
  EMPTY_CELL_BORDER_BOX,
  EMPTY_TABLE_BORDER_BOX,
  resolveTableCellBorderGrid,
  type TableBorderSide,
} from '../table-borders.ts';

for (const style of ['single', 'thick', 'dashed', 'dotted'] as const) {
  test(`${style} partial horizontal winners start at the row boundary`, () => {
    const edge = (widthPt: number): TableBorderSide => ({
      state: 'edge',
      style,
      widthPt,
      color: null,
    });
    const cell = (
      gridColumn: number,
      gridSpan: number,
      top: TableBorderSide,
      bottom: TableBorderSide
    ) => ({ gridColumn, gridSpan, borders: { ...EMPTY_CELL_BORDER_BOX, top, bottom } });
    const rows = [
      [cell(0, 2, edge(2), { state: 'omitted' })],
      [cell(0, 1, edge(4), edge(2)), cell(1, 1, edge(6), edge(2))],
    ];
    const resolved = resolveTableCellBorderGrid(rows, EMPTY_TABLE_BORDER_BOX, 2, {
      collapsedHorizontal: true,
      columnWidthsPt: [30, 50],
      rowBands: [
        { y: 0, height: 20 },
        { y: 20, height: 20 },
      ],
      cellBoxes: [
        [{ width: 80, height: 20 }],
        [
          { width: 30, height: 20 },
          { width: 50, height: 20 },
        ],
      ],
    });
    const strokes = resolved[0]![0]!.strokes!;
    expect(
      strokes
        .filter((stroke) => stroke.side === 'bottom')
        .map(({ x, y, width, height }) => ({ x, y, width, height }))
    ).toEqual([
      // Every column's rule starts AT the shared boundary and runs downward by its own
      // width, so a wider column reaches further into the row below without starting
      // higher. Captured in `.cache/pdf/claude-band-mixed/` (`m3`, `m4`, `m6`).
      { x: 0, y: 20, width: 30, height: 4 },
      { x: 30, y: 20, width: 50, height: 6 },
    ]);
    // The fragment's outer top rule has no preceding row to share its stroke.
    expect(strokes.find((stroke) => stroke.side === 'top')!.y).toBe(0);
    expect(
      resolved[1]!.flatMap((cell) => cell.strokes ?? []).filter((s) => s.side === 'top')
    ).toHaveLength(0);
    for (const cell of resolved[1]!) {
      const bottom = cell.strokes!.find((stroke) => stroke.side === 'bottom')!;
      expect(bottom.y).toBe(18);
      expect(bottom.y + bottom.height).toBe(20);
    }
    for (const stroke of strokes)
      expect(stroke.cssStyle).toBe(style === 'dashed' || style === 'dotted' ? style : 'solid');
  });
}
