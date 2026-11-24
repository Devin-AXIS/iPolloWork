// Table border three-state read, cascade, and collapsed conflict resolution.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { MAX_TABLE_COLUMNS, readTableStructure } from '../semantic-table.ts';
import {
  borderWeight,
  COMPOUND_BORDER_MIN_GAP_PT,
  COMPOUND_BORDER_MIN_STROKE_PT,
  computeDoubleBorderMetricsPt,
  createTableBorderOwnershipBudget,
  effectiveBorderSide,
  MAX_BORDER_OWNERSHIP_INTERVALS,
  MAX_TABLE_BORDER_STROKES,
  readBorderSide,
  resolveBorderConflict,
  resolveTableCellBorderGrid,
  type BorderGridGeometry,
  type CellBorderBox,
  type TableBorderBox,
  type TableBorderSide,
} from '../table-borders.ts';
import { buildColumnOwnershipIndexes, ownerAt } from '../table-border-ownership.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function edge(
  style: 'single' | 'dashed' | 'dotted' | 'double' | 'triple',
  color: string | null,
  widthPt: number
): TableBorderSide {
  return { state: 'edge', style, color, widthPt };
}

const none: TableBorderSide = { state: 'none' };
const omitted: TableBorderSide = { state: 'omitted' };

function box(partial: Partial<CellBorderBox>): CellBorderBox {
  return {
    top: omitted,
    left: omitted,
    bottom: omitted,
    right: omitted,
    ...partial,
  };
}

describe('readBorderSide three-state', () => {
  test('omitted / none / edge, hostile color dropped, sz in eighths', () => {
    const read = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body><w:tbl><w:tr><w:tc><w:tcPr>
        <w:tcBorders>
          <w:top w:val="double" w:color="2E75B6" w:sz="24"/>
          <w:left w:val="none"/>
          <w:bottom w:val="single" w:color="javascript:alert(1)" w:sz="8"/>
          <w:right w:val="dashed" w:color="CC3333" w:sz="8"/>
        </w:tcBorders>
      </w:tcPr><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!read.ok) throw new Error(read.reason);
    const body = read.part.root.children.find(
      (c) => c.kind !== 'textValue' && c.localName === 'body'
    );
    const table = body?.children.find((c) => c.kind === 'table');
    expect(table).toBeDefined();
    const structure = readTableStructure(table!, 468, 0)!;
    const borders = structure.rows[0]!.cells[0]!.borders;
    expect(borders.top).toEqual(edge('double', '2E75B6', 3));
    expect(borders.left).toEqual(none);
    expect(borders.bottom.state).toBe('edge');
    if (borders.bottom.state === 'edge') {
      expect(borders.bottom.color).toBeNull(); // hostile rejected
      expect(borders.bottom.widthPt).toBe(1);
    }
    expect(borders.right).toEqual(edge('dashed', 'CC3333', 1));
  });
});

describe('border conflict (zero cell spacing)', () => {
  test('none loses to an edge; two nones stay none', () => {
    expect(resolveBorderConflict(none, edge('single', '999999', 0.5))).toEqual(
      edge('single', '999999', 0.5)
    );
    expect(resolveBorderConflict(none, none)).toEqual(none);
  });

  test('Word weights stroke styles and treats dotted/dashed as weight one', () => {
    expect(borderWeight(edge('dotted', '339933', 12))).toBe(1);
    expect(borderWeight(edge('dashed', '339933', 12))).toBe(1);
    expect(borderWeight(edge('double', '2E75B6', 0.375))).toBe(9);
    const winner = resolveBorderConflict(
      edge('double', '2E75B6', 0.375),
      edge('single', null, 0.5)
    );
    expect(winner).toMatchObject({ style: 'double', widthPt: 0.375 });
    const tie = resolveBorderConflict(edge('double', '2E75B6', 0.5), edge('single', null, 1.5));
    expect(tie).toMatchObject({ style: 'double' });
    expect(
      resolveBorderConflict(edge('dotted', null, 12), edge('single', null, 0.5))
    ).toMatchObject({ style: 'single' });
  });

  test('equal styles use all three Word brightness comparisons before reading order', () => {
    const winner = (a: string, b: string) =>
      resolveBorderConflict(edge('single', a, 1), edge('single', b, 1));
    // Green counts twice: simple R+G+B would choose green incorrectly.
    expect(winner('008000', 'C00000')).toMatchObject({ color: 'C00000' });
    // Equal R+B+2G: compare B+2G, then G.
    expect(winner('0000FF', 'FF0000')).toMatchObject({ color: 'FF0000' });
    expect(winner('000100', '000002')).toMatchObject({ color: '000002' });
    expect(
      resolveBorderConflict(edge('single', 'FFFFFF', 1), edge('single', null, 1))
    ).toMatchObject({ color: null });
  });

  test('effective cascade: cell edge wins over table; explicit none suppresses table', () => {
    const tableSingle = edge('single', null, 0.5);
    expect(effectiveBorderSide(edge('single', '999999', 0.125), tableSingle)).toEqual(
      edge('single', '999999', 0.125)
    );
    expect(effectiveBorderSide(none, tableSingle)).toEqual(none);
    expect(effectiveBorderSide(none, tableSingle, { interior: true })).toEqual(none);
    expect(effectiveBorderSide(omitted, tableSingle)).toEqual(tableSingle);
  });

  test('§5.3 mid vertical: top dashed red, bottom absent', () => {
    const table: TableBorderBox = {
      top: edge('single', null, 0.5),
      left: edge('single', null, 0.5),
      bottom: edge('single', null, 0.5),
      right: edge('single', null, 0.5),
      insideH: edge('single', null, 0.5),
      insideV: edge('single', null, 0.5),
    };
    const tl = box({
      top: edge('double', '2E75B6', 0.375),
      left: edge('double', '2E75B6', 0.375),
      bottom: edge('double', '2E75B6', 0.375),
      right: edge('dashed', 'CC3333', 0.125),
    });
    const tr = box({
      top: edge('dotted', '339933', 0.125),
      left: edge('dashed', 'CC3333', 0.125),
      bottom: edge('dotted', '339933', 0.125),
      right: edge('dotted', '339933', 0.125),
    });
    const bl = box({
      top: edge('double', '2E75B6', 0.375),
      left: edge('double', '2E75B6', 0.375),
      bottom: none,
      right: none,
    });
    const br = box({
      top: edge('dotted', '339933', 0.125),
      left: none,
      bottom: edge('triple', '9933CC', 0.375),
      right: edge('dotted', '339933', 0.125),
    });
    const grid = resolveTableCellBorderGrid(
      [
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: tl, mergeRowSpan: 1 },
          { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: tr, mergeRowSpan: 1 },
        ],
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: bl, mergeRowSpan: 1 },
          { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: br, mergeRowSpan: 1 },
        ],
      ],
      table,
      2
    );
    expect(grid[0]![0]!.right).toEqual({ style: 'dashed', color: 'CC3333', widthPt: 0.125 });
    expect(grid[1]![0]!.right).toBeUndefined();
    expect(grid[0]![0]!.bottom).toEqual({ style: 'double', color: '2E75B6', widthPt: 0.375 });
    expect(grid[0]![1]!.bottom).toEqual({ style: 'dotted', color: '339933', widthPt: 0.125 });
    expect(grid[1]![1]!.bottom).toEqual({ style: 'triple', color: '9933CC', widthPt: 0.375 });
    // BL bottom none → explicit none suppresses table outer edge.
    expect(grid[1]![0]!.bottom).toBeUndefined();
    // Interior left of TR/BR not painted (owned by left cell).
    expect(grid[0]![1]!.left).toBeUndefined();
    expect(grid[1]![1]!.left).toBeUndefined();
  });
});

describe('readBorderSide from element', () => {
  test('bare missing node is omitted', () => {
    expect(readBorderSide(undefined)).toEqual(omitted);
  });
});

describe('compound border metrics (layout points)', () => {
  test('thin doubles preserve each authored stroke and gap', () => {
    expect(COMPOUND_BORDER_MIN_STROKE_PT).toBe(0.25);
    expect(COMPOUND_BORDER_MIN_GAP_PT).toBe(0.25);
    const thin = computeDoubleBorderMetricsPt(0.375);
    expect(thin).toEqual({ strokePt: 0.375, gapPt: 0.375, extentPt: 1.125, insetPt: -0.375 });
    expect(computeDoubleBorderMetricsPt(0.125)).toEqual({
      strokePt: 0.25,
      gapPt: 0.25,
      extentPt: 0.75,
      insetPt: -0.3125,
    });
  });

  test('thick doubles preserve the authored width of each stroke', () => {
    expect(computeDoubleBorderMetricsPt(3)).toEqual({
      strokePt: 3,
      gapPt: 3,
      extentPt: 9,
      insetPt: -3,
    });
  });

  test('metrics are scale-independent (paint only multiplies)', () => {
    // Same point records regardless of any paint scale — no px heuristics here.
    expect(computeDoubleBorderMetricsPt(0.375)).toEqual(computeDoubleBorderMetricsPt(0.375));
    expect(computeDoubleBorderMetricsPt(6).strokePt).toBe(6);
  });
});

describe('per-grid-interval conflict + stroke geometry', () => {
  const emptyTable: TableBorderBox = {
    top: omitted,
    left: omitted,
    bottom: omitted,
    right: omitted,
    insideH: omitted,
    insideV: omitted,
  };

  test('gridSpan bottom resolves distinct winners per lower neighbor', () => {
    const span = box({}); // omitted bottom → each below.top wins its column
    const belowL = box({ top: edge('double', '2E75B6', 0.375) });
    const belowR = box({ top: edge('dotted', '339933', 0.125) });
    const grid = resolveTableCellBorderGrid(
      [
        [{ gridColumn: 0, gridSpan: 2, vMergeContinue: false, borders: span, mergeRowSpan: 1 }],
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: belowL, mergeRowSpan: 1 },
          { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: belowR, mergeRowSpan: 1 },
        ],
      ],
      emptyTable,
      2
    );
    const segments = grid[0]![0]!.edgeSegments?.filter((s) => s.side === 'bottom') ?? [];
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      gridStart: 0,
      gridEnd: 1,
      edge: { style: 'double', color: '2E75B6', widthPt: 0.375 },
    });
    expect(segments[1]).toMatchObject({
      gridStart: 1,
      gridEnd: 2,
      edge: { style: 'dotted', color: '339933', widthPt: 0.125 },
    });
    // Convenience bottom is absent when winners differ.
    expect(grid[0]![0]!.bottom).toBeUndefined();
  });

  test('vMerge interior bottom intervals are suppressed; outer bottom remains', () => {
    const restart = box({
      bottom: edge('single', '999999', 0.125),
      top: edge('single', '999999', 0.125),
    });
    const cont = box({ top: edge('single', 'FF0000', 1) });
    const below = box({ top: edge('dashed', '00FF00', 0.5) });
    const grid = resolveTableCellBorderGrid(
      [
        [{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: restart, mergeRowSpan: 2 }],
        [{ gridColumn: 0, gridSpan: 1, vMergeContinue: true, borders: cont, mergeRowSpan: 1 }],
        [{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: below, mergeRowSpan: 1 }],
      ],
      emptyTable,
      1
    );
    // Continue cell publishes nothing (paint-inert seam).
    expect(grid[1]![0]).toEqual({});
    // Restart bottom is NOT suppressed: it conflicts with the row below the merge span,
    // never with the continue cell's top (that interval is the interior seam).
    expect(grid[0]![0]!.bottom).toBeDefined();
    expect(grid[0]![0]!.edgeSegments?.some((s) => s.side === 'bottom')).toBe(true);
  });

  test('geometry path publishes corner-adjusted double strokes in points', () => {
    const borders = box({
      top: edge('double', '2E75B6', 0.375),
      left: edge('double', '2E75B6', 0.375),
    });
    const geometry: BorderGridGeometry = {
      columnWidthsPt: [100],
      rowBands: [{ y: 0, height: 40 }],
      cellBoxes: [[{ width: 100, height: 40 }]],
    };
    const grid = resolveTableCellBorderGrid(
      [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders, mergeRowSpan: 1 }]],
      emptyTable,
      1,
      geometry
    );
    const cell = grid[0]![0]!;
    expect(cell.top?.style).toBe('double');
    expect(cell.left?.style).toBe('double');
    const strokes = cell.strokes ?? [];
    expect(strokes).toHaveLength(4);
    const topOuter = strokes.find((s) => s.side === 'top' && s.role === 'outer')!;
    const leftOuter = strokes.find((s) => s.side === 'left' && s.role === 'outer')!;
    // Concentric L: horizontal owns the corner square.
    expect(topOuter.x).toBe(-0.375);
    expect(topOuter.y).toBe(-0.375);
    expect(leftOuter.x).toBe(-0.375);
    expect(leftOuter.y).toBe(0);
    expect(topOuter.width).toBeGreaterThan(0);
    expect(leftOuter.height).toBeGreaterThan(0);
  });

  test('triple expands to three explicit stroke segments', () => {
    const borders = box({ bottom: edge('triple', '9933CC', 3) });
    const geometry: BorderGridGeometry = {
      columnWidthsPt: [50],
      rowBands: [{ y: 0, height: 30 }],
      cellBoxes: [[{ width: 50, height: 30 }]],
    };
    const grid = resolveTableCellBorderGrid(
      [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders, mergeRowSpan: 1 }]],
      emptyTable,
      1,
      geometry
    );
    const strokes = grid[0]![0]!.strokes?.filter((s) => s.side === 'bottom') ?? [];
    expect(strokes).toHaveLength(3);
    expect(strokes.map((s) => s.role)).toEqual(['outer', 'middle', 'inner']);
    expect(strokes.every((s) => s.height === 3)).toBe(true);
    // gap = max(1, 3) = 3; extent = 9 + 6 = 15
    expect(strokes[0]!.y).toBe(30 - 15);
    expect(strokes[1]!.y).toBe(30 - 15 + 6);
    expect(strokes[2]!.y).toBe(30 - 15 + 12);
  });

  test('thin triples use equal authored strokes and gaps without a 1pt paint floor', () => {
    const borders = box({ bottom: edge('triple', '9933CC', 0.375) });
    const grid = resolveTableCellBorderGrid(
      [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders, mergeRowSpan: 1 }]],
      emptyTable,
      1,
      {
        columnWidthsPt: [50],
        rowBands: [{ y: 0, height: 30 }],
        cellBoxes: [[{ width: 50, height: 30 }]],
      }
    );
    const strokes = grid[0]![0]!.strokes ?? [];
    expect(strokes.map((stroke) => stroke.height)).toEqual([0.375, 0.375, 0.375]);
    expect(strokes.map((stroke) => stroke.y)).toEqual([28.125, 28.875, 29.625]);
  });

  test('mixed double+dashed publishes double strokes and a dashed vertical rule', () => {
    const borders = box({
      top: edge('double', '2E75B6', 0.375),
      right: edge('dashed', 'CC3333', 0.125),
    });
    const geometry: BorderGridGeometry = {
      columnWidthsPt: [80],
      rowBands: [{ y: 0, height: 20 }],
      cellBoxes: [[{ width: 80, height: 20 }]],
    };
    const grid = resolveTableCellBorderGrid(
      [[{ gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders, mergeRowSpan: 1 }]],
      emptyTable,
      1,
      geometry
    );
    const cell = grid[0]![0]!;
    expect(cell.right).toEqual({ style: 'dashed', color: 'CC3333', widthPt: 0.125 });
    // A vertical rule starts at its grid line and runs right. CSS border-box draws a right
    // border INSIDE its element, so the rule publishes stroke geometry and keeps its style.
    const right = cell.strokes!.find((stroke) => stroke.side === 'right')!;
    expect({ x: right.x, width: right.width, cssStyle: right.cssStyle }).toEqual({
      x: 80,
      width: 0.125,
      cssStyle: 'dashed',
    });
    expect(cell.strokes?.every((s) => s.side === 'top' || s.side === 'right')).toBe(true);
    const topOuter = cell.strokes!.find((s) => s.role === 'outer')!;
    // No left/right double neighbor → flush to cell width.
    expect(topOuter.x).toBe(0);
    expect(topOuter.x + topOuter.width).toBe(80);
  });

  test('stroke publication is bounded (security)', () => {
    expect(MAX_TABLE_BORDER_STROKES).toBeLessThanOrEqual(256);
    // Pathological gridSpan must not allocate unboundedly — clamped by column count input.
    const cols = 64;
    const widths = Array.from({ length: cols }, () => 10);
    const topRow = [
      {
        gridColumn: 0,
        gridSpan: cols,
        vMergeContinue: false,
        borders: box({}),
        mergeRowSpan: 1,
      },
    ];
    const bottomRow = Array.from({ length: cols }, (_, i) => ({
      gridColumn: i,
      gridSpan: 1,
      vMergeContinue: false,
      borders: box({
        top: edge(i % 2 === 0 ? 'double' : 'dotted', i % 2 === 0 ? '111111' : '222222', 0.375),
      }),
      mergeRowSpan: 1,
    }));
    const geometry: BorderGridGeometry = {
      columnWidthsPt: widths,
      rowBands: [
        { y: 0, height: 20 },
        { y: 20, height: 20 },
      ],
      cellBoxes: [
        [{ width: cols * 10, height: 20 }],
        bottomRow.map(() => ({ width: 10, height: 20 })),
      ],
    };
    const grid = resolveTableCellBorderGrid([topRow, bottomRow], emptyTable, cols, geometry);
    const strokes = grid[0]![0]!.strokes ?? [];
    expect(strokes.length).toBeLessThanOrEqual(MAX_TABLE_BORDER_STROKES);
    // Distinct winners under the span → many bottom intervals, each ≤ 2 strokes.
    const bottomSegs = grid[0]![0]!.edgeSegments?.filter((s) => s.side === 'bottom') ?? [];
    expect(bottomSegs.length).toBe(cols);
  });

  test('ownership index preserves gridSpan / vMerge conflict winners', () => {
    // Same fixtures as the geometry-free conflict cases above — lock the winners so the
    // O(1) column map cannot drift from first-wins cellAt semantics.
    const span = box({});
    const belowL = box({ top: edge('double', '2E75B6', 0.375) });
    const belowR = box({ top: edge('dotted', '339933', 0.125) });
    const spanned = resolveTableCellBorderGrid(
      [
        [{ gridColumn: 0, gridSpan: 2, vMergeContinue: false, borders: span, mergeRowSpan: 1 }],
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: belowL, mergeRowSpan: 1 },
          { gridColumn: 1, gridSpan: 1, vMergeContinue: false, borders: belowR, mergeRowSpan: 1 },
        ],
      ],
      emptyTable,
      2
    );
    expect(
      spanned[0]![0]!.edgeSegments?.filter((s) => s.side === 'bottom').map((s) => s.edge)
    ).toEqual([
      { style: 'double', color: '2E75B6', widthPt: 0.375 },
      { style: 'dotted', color: '339933', widthPt: 0.125 },
    ]);

    const restart = box({
      bottom: edge('single', '999999', 0.125),
      right: edge('dashed', 'CC3333', 0.125),
    });
    const cont = box({ top: edge('single', 'FF0000', 1) });
    const neighborTop = box({ left: edge('double', '2E75B6', 0.375) });
    const neighborBottom = box({ left: edge('dotted', '339933', 0.125) });
    const merged = resolveTableCellBorderGrid(
      [
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: false, borders: restart, mergeRowSpan: 2 },
          {
            gridColumn: 1,
            gridSpan: 1,
            vMergeContinue: false,
            borders: neighborTop,
            mergeRowSpan: 1,
          },
        ],
        [
          { gridColumn: 0, gridSpan: 1, vMergeContinue: true, borders: cont, mergeRowSpan: 1 },
          {
            gridColumn: 1,
            gridSpan: 1,
            vMergeContinue: false,
            borders: neighborBottom,
            mergeRowSpan: 1,
          },
        ],
      ],
      emptyTable,
      2
    );
    expect(merged[1]![0]).toEqual({});
    // Right of the vMerge restart conflicts per merge row against each neighbor.left.
    const rightSegs = merged[0]![0]!.edgeSegments?.filter((s) => s.side === 'right') ?? [];
    expect(rightSegs).toEqual([
      {
        side: 'right',
        gridStart: 0,
        gridEnd: 1,
        startPt: 0,
        endPt: 1,
        edge: { style: 'double', color: '2E75B6', widthPt: 0.375 },
      },
      {
        side: 'right',
        gridStart: 1,
        gridEnd: 2,
        startPt: 1,
        endPt: 2,
        // Equal width (1 eighth): style ranks the tie before colour does, and dashed
        // outranks dotted.
        edge: { style: 'dashed', color: 'CC3333', widthPt: 0.125 },
      },
    ]);
    expect(merged[0]![0]!.right).toBeUndefined();
  });

  test('hostile wide table: sparse ownership stays linear in cells, not dense grid slots', () => {
    const cols = MAX_TABLE_COLUMNS;
    expect(cols).toBe(1024);
    const topRow = [
      {
        gridColumn: 0,
        gridSpan: cols,
        vMergeContinue: false,
        borders: box({}),
        mergeRowSpan: 1,
      },
    ];
    const bottomRow = Array.from({ length: cols }, (_, i) => ({
      gridColumn: i,
      gridSpan: 1,
      vMergeContinue: false,
      borders: box({
        top: edge(i % 2 === 0 ? 'double' : 'dotted', i % 2 === 0 ? '111111' : '222222', 0.375),
        left: edge('single', '333333', 0.125),
      }),
      mergeRowSpan: 1,
    }));
    const work = { ownershipSlotsWritten: 0, columnLookups: 0 };
    const grid = resolveTableCellBorderGrid([topRow, bottomRow], emptyTable, cols, undefined, work);

    // Sparse: one interval for the spanning top cell + one per bottom cell — not 2×cols
    // dense slot writes. Lookups: bottom of the span (cols) + right edges of bottom cells
    // that have a neighbor (cols − 1).
    expect(work.ownershipSlotsWritten).toBe(1 + cols);
    expect(work.columnLookups).toBe(cols + (cols - 1));
    expect(work.ownershipSlotsWritten + work.columnLookups).toBeLessThanOrEqual(3 * cols);

    const bottomSegs = grid[0]![0]!.edgeSegments?.filter((s) => s.side === 'bottom') ?? [];
    expect(bottomSegs).toHaveLength(cols);
    expect(bottomSegs[0]!.edge).toEqual({ style: 'double', color: '111111', widthPt: 0.375 });
    expect(bottomSegs[1]!.edge).toEqual({ style: 'dotted', color: '222222', widthPt: 0.375 });
    expect(bottomSegs[cols - 1]!.edge).toEqual({
      style: 'dotted',
      color: '222222',
      widthPt: 0.375,
    });
  });

  test('many sparse rows: ownership intervals track cells, not rows×columnCount', () => {
    const cols = MAX_TABLE_COLUMNS;
    const rowCount = 4_096;
    const rows = Array.from({ length: rowCount }, (_, rowIndex) => [
      {
        gridColumn: 0,
        gridSpan: 1,
        vMergeContinue: false,
        borders: box({
          bottom: edge('single', rowIndex % 2 === 0 ? '111111' : '222222', 0.125),
        }),
        mergeRowSpan: 1,
      },
    ]);
    const work = { ownershipSlotsWritten: 0, columnLookups: 0 };
    buildColumnOwnershipIndexes(rows, cols, work);
    // Dense would allocate rowCount × cols (≥4M) slots; sparse is one interval per cell.
    expect(work.ownershipSlotsWritten).toBe(rowCount);
    expect(work.ownershipSlotsWritten).toBeLessThan(rowCount * 2);
    expect(work.ownershipSlotsWritten).toBeLessThan(cols * 8);
  });

  test('sparse wide row: one spanning cell is one interval, not columnCount slots', () => {
    const cols = MAX_TABLE_COLUMNS;
    const work = { ownershipSlotsWritten: 0, columnLookups: 0 };
    const indexes = buildColumnOwnershipIndexes(
      [
        [
          {
            gridColumn: 0,
            gridSpan: cols,
            vMergeContinue: false,
            borders: box({}),
            mergeRowSpan: 1,
          },
        ],
      ],
      cols,
      work
    );
    expect(work.ownershipSlotsWritten).toBe(1);
    expect(ownerAt(indexes, 0, 0)?.cellIndex).toBe(0);
    expect(ownerAt(indexes, 0, cols - 1)?.cellIndex).toBe(0);
    expect(ownerAt(indexes, 0, cols)).toBeUndefined();
    // Empty interior columns outside any cell still miss without dense fill.
    expect(ownerAt(indexes, 0, -1)).toBeUndefined();
  });

  test('first-wins overlap: earlier cell keeps shared columns under sparse intervals', () => {
    const work = { ownershipSlotsWritten: 0, columnLookups: 0 };
    const indexes = buildColumnOwnershipIndexes(
      [
        [
          {
            gridColumn: 0,
            gridSpan: 3,
            vMergeContinue: false,
            borders: box({ right: edge('double', '2E75B6', 0.375) }),
            mergeRowSpan: 1,
          },
          {
            gridColumn: 2,
            gridSpan: 2,
            vMergeContinue: false,
            borders: box({ left: edge('dotted', '339933', 0.125) }),
            mergeRowSpan: 1,
          },
        ],
      ],
      4,
      work
    );
    // [0,3) first cell; second only claims uncovered [3,4).
    expect(work.ownershipSlotsWritten).toBe(2);
    expect(ownerAt(indexes, 0, 2)?.cellIndex).toBe(0);
    expect(ownerAt(indexes, 0, 3)?.cellIndex).toBe(1);
  });

  test('shared ownership budget bounds aggregate intervals across nested-like resolves', () => {
    expect(MAX_BORDER_OWNERSHIP_INTERVALS).toBeGreaterThanOrEqual(1_048_576);
    const budget = createTableBorderOwnershipBudget(8);
    const workA = { ownershipSlotsWritten: 0, columnLookups: 0 };
    const workB = { ownershipSlotsWritten: 0, columnLookups: 0 };
    const wideRow = Array.from({ length: 6 }, (_, i) => ({
      gridColumn: i,
      gridSpan: 1,
      vMergeContinue: false,
      borders: box({}),
      mergeRowSpan: 1,
    }));
    buildColumnOwnershipIndexes([wideRow], 6, workA, budget);
    buildColumnOwnershipIndexes([wideRow], 6, workB, budget);
    // First resolve consumes the whole budget; second cannot amplify further.
    expect(workA.ownershipSlotsWritten).toBe(6);
    expect(workB.ownershipSlotsWritten).toBe(2);
    expect(workA.ownershipSlotsWritten + workB.ownershipSlotsWritten).toBe(8);
    expect(budget.intervalsRemaining).toBe(0);
  });
});
