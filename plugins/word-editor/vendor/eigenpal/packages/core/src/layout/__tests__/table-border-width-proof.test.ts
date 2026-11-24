import { expect, test } from 'bun:test';
import {
  createTableBorderWidthProof,
  tableBorderWidthProofHolds,
} from '../table-border-width-proof.ts';
import {
  resolveTableCellBorderGrid,
  type BorderGridCell,
  type TableBorderBox,
  type TableBorderSide,
} from '../table-borders.ts';

const omitted = { state: 'omitted' } as const;
const edge: TableBorderSide = { state: 'edge', style: 'single', widthPt: 0.75, color: '000000' };
const table: TableBorderBox = {
  top: edge,
  left: edge,
  bottom: edge,
  right: edge,
  insideH: edge,
  insideV: edge,
};
const cell = (column: number, span = 1, extra: Partial<BorderGridCell> = {}): BorderGridCell => ({
  gridColumn: column,
  gridSpan: span,
  vMergeContinue: false,
  borders: { top: omitted, left: omitted, bottom: omitted, right: omitted },
  ...extra,
});
const rows: readonly BorderGridCell[][] = [
  [cell(0, 1, { mergeRowSpan: 2 }), cell(1, 2)],
  [
    cell(0, 1, { vMergeContinue: true }),
    cell(1),
    cell(2, 1, {
      borders: { top: edge, left: omitted, bottom: { state: 'none' }, right: edge },
    }),
  ],
  [cell(0, 2), cell(2, 1, { rowTableBorders: { ...table, insideH: { state: 'none' } } })],
  [cell(0), cell(1), cell(2)],
];
const sources = rows.map((cells) => ({ cells }));

function verticalShape(columns: readonly number[], centered: boolean) {
  const result = resolveTableCellBorderGrid(rows, table, columns.length, {
    columnWidthsPt: columns,
    collapsedHorizontal: true,
    rowBands: rows.map((_, index) => ({ y: index * 17.5, height: 17.5 })),
    cellBoxes: rows.map((row, rowIndex) =>
      row.map((cell, cellIndex) => ({
        width: columns
          .slice(cell.gridColumn, cell.gridColumn + cell.gridSpan)
          .reduce((sum, width) => sum + width, 0),
        height: 17.5 * (cell.mergeRowSpan ?? 1),
        outerBottomInsetReserved: (rowIndex + cellIndex) % 2 === 0,
        centeredSidePaint: centered,
      }))
    ),
  });
  return result.map((row) =>
    row.map(({ strokes, edgeSegments, ...rest }) => ({
      ...rest,
      strokes: strokes?.map(({ x: _x, width, ...stroke }) => ({
        ...stroke,
        ...(stroke.side === 'left' || stroke.side === 'right' ? { width } : {}),
      })),
      edgeSegments: edgeSegments?.map(({ startPt, endPt, ...segment }) => ({
        ...segment,
        ...(segment.side === 'left' || segment.side === 'right' ? { startPt, endPt } : {}),
      })),
    }))
  );
}

test('admitted simple borders retain vertical geometry across positive widths', () => {
  const proof = createTableBorderWidthProof(sources, table, [30, 40, 50]);
  expect(proof).not.toBeNull();
  const widths = [
    [1, 1, 1],
    [1, 2, 2 ** 20 - 3],
    [123.456, 7.125, 800.875],
  ];
  for (let seed = 1; seed <= 64; seed++)
    widths.push([1 + seed / 7, 1 + ((seed * 37) % 109), 1 + ((seed * 131) % 1009)]);
  for (const centered of [false, true]) {
    const expected = verticalShape([30, 40, 50], centered);
    for (const columns of widths) {
      expect(tableBorderWidthProofHolds(proof!, columns)).toBe(true);
      expect(verticalShape(columns, centered)).toEqual(expected);
    }
  }
});

test('border proofs refuse compound corners, diagonals, and invalid width domains', () => {
  for (const style of ['double', 'triple'] as const) {
    const changed = {
      ...table,
      right: { ...edge, state: 'edge' as const, style, widthPt: 1, color: null },
    };
    expect(createTableBorderWidthProof(sources, changed, [30, 40, 50])).toBeNull();
    const cells = [cell(0, 3, { rowTableBorders: changed })];
    expect(createTableBorderWidthProof([{ cells }], table, [30, 40, 50])).toBeNull();
  }
  const diagonal = cell(0, 3, { borders: { ...cell(0).borders, tl2br: edge } });
  expect(createTableBorderWidthProof([{ cells: [diagonal] }], table, [30, 40, 50])).toBeNull();
  const proof = createTableBorderWidthProof(sources, table, [30, 40, 50])!;
  for (const columns of [
    [],
    [1, 1],
    [0, 1, 1],
    [0.999, 1, 1],
    [NaN, 1, 1],
    [Infinity, 1, 1],
    [2 ** 20, 1, 1],
    [-1, 1, 1],
  ])
    expect(tableBorderWidthProofHolds(proof, columns)).toBe(false);
  for (const malformed of [cell(-1), cell(0, 4), cell(0.5), cell(0, 0)])
    expect(createTableBorderWidthProof([{ cells: [malformed] }], table, [30, 40, 50])).toBeNull();
});
