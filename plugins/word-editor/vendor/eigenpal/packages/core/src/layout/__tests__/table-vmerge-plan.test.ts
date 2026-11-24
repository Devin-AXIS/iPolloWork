// What the vMerge height plan is allowed to hand the paginator.
//
// The plan is ADVISORY. It raises a row's minimum height and takes a merge head's content
// out of its own row's height, and that is the whole of its authority: it may not hand out a
// position, because a row can move to another page after the plan was made and a position
// would then be a lie. Both rules below are the ones four rounds of review kept breaking.

import { describe, expect, test } from 'bun:test';
import type { SemanticTableCell, SemanticTableRow } from '../semantic-table.ts';
import {
  planVMergeRowHeights,
  type RowVMergeLayoutOptions,
  type VMergeRowHeights,
} from '../table-vmerge-heights.ts';

const BORDERS = {
  top: { state: 'omitted' as const },
  left: { state: 'omitted' as const },
  bottom: { state: 'omitted' as const },
  right: { state: 'omitted' as const },
};

function cell(id: string, gridColumn: number, vMergeContinue = false): SemanticTableCell {
  return {
    id,
    gridSpan: 1,
    gridColumn,
    vMergeContinue,
    vAlign: 'top',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    borders: BORDERS,
    preferredWidth: { type: 'auto' },
    styleFormatting: {},
    blocks: [],
  } as unknown as SemanticTableCell;
}

function row(id: string, cells: readonly SemanticTableCell[]): SemanticTableRow {
  return {
    id,
    isHeader: false,
    cantSplit: false,
    height: { rule: 'auto' },
    cells,
  } as unknown as SemanticTableRow;
}

/**
 * Heights by cell id, standing in for row layout: the tallest cell wins, and a DETACHED cell
 * contributes nothing at all — not even an empty cell's line, which is the whole point of
 * passing the set through instead of blanking the cell's blocks.
 */
function probeFrom(
  heights: Readonly<Record<string, number>>
): (probed: SemanticTableRow, detached?: ReadonlySet<string>) => number {
  return (probed, detached) => {
    let tallest = 0;
    for (const probedCell of probed.cells) {
      if (detached?.has(probedCell.id)) continue;
      tallest = Math.max(tallest, heights[probedCell.id] ?? 10);
    }
    return tallest;
  };
}

/** A cell the probe gives an authored height to, as opposed to a bare continuation cell. */
function filled(id: string, gridColumn: number): SemanticTableCell {
  return { ...cell(id, gridColumn), blocks: [{} as never] };
}

describe('the vMerge plan hands out heights, never positions', () => {
  test('no option a row can outlive: nothing in them is an absolute coordinate', () => {
    const rows = [
      row('r0', [filled('head', 0), filled('side0', 1)]),
      row('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ head: 90, side0: 10, side1: 10 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);

    const options = plan.rowOptions(0)!;
    // The whole contract: a set of ids to detach, and a height. A `y` here would be read on
    // a page the row may already have left.
    expect(Object.keys(options).sort()).toEqual(['detachedSpanHeightPtByCellId', 'heightFloorPt']);
    expect([...(options.detachedSpanHeightPtByCellId ?? [])]).toEqual([['head', 90]]);
    expect(typeof options.heightFloorPt).toBe('number');
  });

  test('every covered row gets a floor, including one that still holds a declined head', () => {
    // Row 0 heads two merges. Column 0 covers rows 0-2, column 1 covers rows 0-1, and the
    // second is declined for starting in a row that already has one planned.
    // The declined head goes on sizing row 0, so row 0's floor has to include it — measuring
    // row 0 without it judged the row against a height nobody would ever place.
    const rows = [
      row('r0', [filled('longHead', 0), filled('shortHead', 1)]),
      row('r1', [cell('c0', 0, true), cell('c1', 1, true)]),
      row('r2', [cell('c2', 0, true), filled('plain', 1)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ longHead: 20, shortHead: 80, plain: 10 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);

    const head = plan.rowOptions(0)!;
    expect([...(head.detachedSpanHeightPtByCellId ?? []).keys()]).toEqual(['longHead']);
    // 80, not 10: the declined head is still in the row, so it is still in the floor.
    expect(head.heightFloorPt).toBe(80);
    // Row 1 holds only continuation cells and measures the probe's floor of 10; row 2 also
    // carries the span's surplus, since it is the last row the merge can grow. Pinned as
    // numbers, because "greater than zero" is true of anything this probe returns.
    const covered1: RowVMergeLayoutOptions | undefined = plan.rowOptions(1);
    const covered2: RowVMergeLayoutOptions | undefined = plan.rowOptions(2);
    expect(covered1?.heightFloorPt).toBe(10);
    expect(covered2?.heightFloorPt).toBe(20 - 10 - 10 + 10);
    expect(covered1?.detachedSpanHeightPtByCellId).toBeUndefined();
    expect(covered2?.detachedSpanHeightPtByCellId).toBeUndefined();
  });

  test('a detached head costs the row nothing, not even an empty cell line', () => {
    // The probe used to blank a head's blocks instead of detaching it, and row layout gives
    // an empty cell a line plus its insets. That phantom line became a hard floor on a
    // placement where the head contributes nothing at all.
    const rows = [
      row('r0', [filled('head', 0), filled('side0', 1)]),
      row('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const seen: (readonly string[] | undefined)[] = [];
    const plan = planVMergeRowHeights(rows, (probed, detached) => {
      seen.push(detached ? [...detached] : undefined);
      let tallest = 0;
      for (const probedCell of probed.cells) {
        if (detached?.has(probedCell.id)) continue;
        tallest = Math.max(tallest, probedCell.id === 'head' ? 90 : 12);
      }
      return tallest;
    })!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    // The head reached the probe as a DETACHED id, never as a cell with its blocks removed.
    expect(seen.some((ids) => ids?.includes('head'))).toBe(true);
    expect(rows[0]!.cells[0]!.blocks.length).toBe(1);
    // Row 0 is 12: exactly what the cell that stayed needs, with nothing charged for the
    // head. The span's shortfall lands on the last row that can grow, as always.
    expect(plan.rowOptions(0)!.heightFloorPt).toBe(12);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(90 - 12);
  });

  test('the thousandth table of a pass plans exactly like the first', () => {
    // The plan holds no pass-scoped state, so a table's heights cannot depend on how much
    // of the document came before it. That mattered because a resumed pass starts at the
    // first changed block: with any shared allowance, a table near the end could plan its
    // merges after an edit and not plan them on reload.
    //
    // A thousand plans is far past what any allowance this module ever carried would have
    // survived, so reintroducing one fails this rather than passing on a technicality —
    // which is what the budgeted version of this test did.
    const rows = [
      row('r0', [filled('head', 0), filled('side0', 1)]),
      row('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const planOnce = (): VMergeRowHeights => {
      const plan = planVMergeRowHeights(rows, probeFrom({ head: 90 }))!;
      for (const span of plan.spansAt(0)) plan.accept(span);
      return plan;
    };
    const first = planOnce();
    let last = first;
    for (let index = 0; index < 1000; index += 1) last = planOnce();

    expect(last.rowOptions(0)!.heightFloorPt).toBe(first.rowOptions(0)!.heightFloorPt);
    expect(last.rowOptions(1)!.heightFloorPt).toBe(first.rowOptions(1)!.heightFloorPt);
    expect(last.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('head')).toBe(
      first.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('head')
    );
  });

  test('merges over the same rows detach together and reserve the tallest head', () => {
    // Columns 1 and 2 both merge rows 0-1. Deciding them one at a time kept the second head
    // sizing row 0, and row 1 then stacked under that height instead of beside it.
    const planFor = (order: readonly [string, string]) => {
      const rows = [
        row('r0', [filled('side0', 0), filled(order[0], 1), filled(order[1], 2)]),
        row('r1', [filled('side1', 0), cell('c1', 1, true), cell('c2', 2, true)]),
      ];
      const plan = planVMergeRowHeights(
        rows,
        probeFrom({ side0: 12, side1: 36, short: 36, tall: 60 })
      )!;
      for (const span of plan.spansAt(0)) plan.accept(span);
      return plan;
    };
    for (const order of [
      ['short', 'tall'],
      ['tall', 'short'],
    ] as const) {
      const plan = planFor(order);
      const head = plan.rowOptions(0)!;
      // Both heads out of row 0, each bounded by the one shared span of 60.
      expect([...(head.detachedSpanHeightPtByCellId ?? [])].sort()).toEqual([
        ['short', 60],
        ['tall', 60],
      ]);
      // Row 0 is its own side cell; row 1 takes the 60 - 12 the tallest head still needs.
      expect(head.heightFloorPt).toBe(12);
      expect(plan.rowOptions(1)!.heightFloorPt).toBe(48);
    }
  });

  test('merges over the same rows add nothing when the rows already hold them', () => {
    const rows = [
      row('r0', [filled('side0', 0), filled('a', 1), filled('b', 2)]),
      row('r1', [filled('side1', 0), cell('c1', 1, true), cell('c2', 2, true)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ side0: 24, side1: 48, a: 24, b: 36 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    expect(plan.rowOptions(0)!.heightFloorPt).toBe(24);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(48);
    expect(plan.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('b')).toBe(72);
  });

  test('a merge ending at another row still sizes the head row beside a joint pair', () => {
    // Columns 1 and 2 merge rows 0-2; column 3 merges rows 0-1. The pair is decided together,
    // and the shorter span stays declined and in row 0, exactly as a lone longer span did.
    const rows = [
      row('r0', [filled('side0', 0), filled('a', 1), filled('b', 2), filled('shortHead', 3)]),
      row('r1', [
        filled('side1', 0),
        cell('a1', 1, true),
        cell('b1', 2, true),
        cell('s1', 3, true),
      ]),
      row('r2', [filled('side2', 0), cell('a2', 1, true), cell('b2', 2, true), filled('p', 3)]),
    ];
    const plan = planVMergeRowHeights(
      rows,
      probeFrom({ side0: 10, side1: 10, side2: 10, a: 50, b: 90, shortHead: 30, p: 10 })
    )!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    const head = plan.rowOptions(0)!;
    expect([...(head.detachedSpanHeightPtByCellId ?? []).keys()].sort()).toEqual(['a', 'b']);
    expect(head.heightFloorPt).toBe(30);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(10);
    expect(plan.rowOptions(2)!.heightFloorPt).toBe(90 - 30 - 10);
  });

  test('withdrawing a head row takes the whole joint decision back', () => {
    const rows = [
      row('r0', [filled('side0', 0), filled('a', 1), filled('b', 2)]),
      row('r1', [filled('side1', 0), cell('c1', 1, true), cell('c2', 2, true)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ side0: 12, side1: 12, a: 40, b: 70 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(58);
    plan.withdrawAt(0);
    expect(plan.rowOptions(0)).toBeUndefined();
    expect(plan.rowOptions(1)).toBeUndefined();
    // Offered again, it plans the same heights: no surplus was left behind on row 1.
    for (const span of plan.spansAt(0)) plan.accept(span);
    expect(plan.rowOptions(0)!.heightFloorPt).toBe(12);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(58);
  });

  test('merges over fixed rows detach together and clip the head the rows cannot hold', () => {
    // Every row is exact, so the rows keep their heights whichever heads detach. Both heads
    // flow through the span; only the tall one is clipped, at the span bottom.
    const exact = (id: string, cells: readonly SemanticTableCell[]): SemanticTableRow =>
      ({ ...row(id, cells), height: { rule: 'exact', valuePt: 20 } }) as SemanticTableRow;
    const rows = [
      exact('r0', [filled('fits', 0), filled('tooTall', 1)]),
      exact('r1', [cell('c0', 0, true), cell('c1', 1, true)]),
    ];
    const probe = (probed: SemanticTableRow, detached?: ReadonlySet<string>): number =>
      probed.height.rule === 'exact' ? 20 : probeFrom({ fits: 30, tooTall: 200 })(probed, detached);
    const plan = planVMergeRowHeights(rows, probe)!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    expect([...(plan.rowOptions(0)!.detachedSpanHeightPtByCellId ?? [])]).toEqual([
      ['fits', 40],
      ['tooTall', 40],
    ]);
    expect([...(plan.rowOptions(0)!.clippedSpanCellIds ?? [])]).toEqual(['tooTall']);
  });

  test('merges over a fixed last row leave the head row to the cells that stay in it', () => {
    // Only the last row is exact. The tall head is clipped at the span bottom, so it must not
    // size the head row either: both heads leave it, and every row keeps its own height.
    const rows = [
      row('r0', [filled('tall', 0), filled('short', 1), filled('side0', 2)]),
      {
        ...row('r1', [cell('c0', 0, true), cell('c1', 1, true), filled('side1', 2)]),
        height: { rule: 'exact', valuePt: 20 },
      } as SemanticTableRow,
    ];
    const probe = (probed: SemanticTableRow, detached?: ReadonlySet<string>): number =>
      probed.height.rule === 'exact'
        ? 20
        : probeFrom({ tall: 110, short: 25, side0: 10 })(probed, detached);
    const plan = planVMergeRowHeights(rows, probe)!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    const head = plan.rowOptions(0)!;
    expect(head.heightFloorPt).toBe(10);
    expect([...(head.detachedSpanHeightPtByCellId ?? [])]).toEqual([
      ['tall', 30],
      ['short', 30],
    ]);
    expect([...(head.clippedSpanCellIds ?? [])]).toEqual(['tall']);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(20);
  });

  test('every fitting head shares the same fixed-row span', () => {
    const exact = (id: string, cells: readonly SemanticTableCell[]): SemanticTableRow =>
      ({ ...row(id, cells), height: { rule: 'exact', valuePt: 20 } }) as SemanticTableRow;
    const rows = [
      exact('r0', [filled('a', 0), filled('b', 1)]),
      exact('r1', [cell('c0', 0, true), cell('c1', 1, true)]),
    ];
    const probe = (probed: SemanticTableRow, detached?: ReadonlySet<string>) =>
      probed.height.rule === 'exact' ? 20 : probeFrom({ a: 15, b: 30 })(probed, detached);
    const plan = planVMergeRowHeights(rows, probe)!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    expect([...(plan.rowOptions(0)!.detachedSpanHeightPtByCellId ?? [])]).toEqual([
      ['a', 40],
      ['b', 40],
    ]);
    expect(plan.rowOptions(0)!.heightFloorPt).toBe(20);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(20);
  });

  test('a span no row of which can grow keeps its rows and clips its head at the span bottom', () => {
    const exact = (id: string, cells: readonly SemanticTableCell[]): SemanticTableRow =>
      ({ ...row(id, cells), height: { rule: 'exact', valuePt: 20 } }) as SemanticTableRow;
    const rows = [
      exact('r0', [filled('head', 0), filled('side0', 1)]),
      exact('r1', [cell('cont', 0, true), filled('side1', 1)]),
    ];
    const plan = planVMergeRowHeights(rows, probeFrom({ head: 200, side0: 10, side1: 10 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    const options = plan.rowOptions(0)!;
    expect([...(options.detachedSpanHeightPtByCellId ?? [])]).toEqual([['head', 20]]);
    expect([...(options.clippedSpanCellIds ?? [])]).toEqual(['head']);
    expect(options.heightFloorPt).toBe(10);
    expect(plan.rowOptions(1)!.heightFloorPt).toBe(10);
    expect(plan.rowOptions(1)!.clippedSpanCellIds).toBeUndefined();
  });
});

/** One merge per entry, in its own column; every other cell is a plain 10pt cell. */
interface MergeShape {
  readonly column: number;
  readonly headRow: number;
  readonly endRow: number;
  readonly id: string;
}

function mergeRows(rowCount: number, columns: number, merges: readonly MergeShape[]) {
  return Array.from({ length: rowCount }, (_, rowIndex) =>
    row(
      `r${rowIndex}`,
      Array.from({ length: columns }, (_, column) => {
        const merge = merges.find((entry) => entry.column === column);
        if (merge?.headRow === rowIndex) return filled(merge.id, column);
        if (merge && rowIndex > merge.headRow && rowIndex <= merge.endRow) {
          return cell(`${merge.id}-${rowIndex}`, column, true);
        }
        return filled(`p${rowIndex}-${column}`, column);
      })
    )
  );
}

/** Offer every merge at its head row, top to bottom, the order the placers use. */
function acceptTopDown(plan: VMergeRowHeights, rowCount: number): void {
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (const span of plan.spansAt(rowIndex)) plan.accept(span);
  }
}

const floorsOf = (plan: VMergeRowHeights, rowCount: number) =>
  Array.from({ length: rowCount }, (_, rowIndex) => plan.rowOptions(rowIndex)?.heightFloorPt);

describe('a merge that contains merges in other columns', () => {
  const NESTED: readonly MergeShape[] = [
    { column: 0, headRow: 0, endRow: 5, id: 'outer' },
    { column: 1, headRow: 2, endRow: 3, id: 'inner' },
  ];

  test('is decided with them, and asks only for what its rows do not give', () => {
    const rows = mergeRows(6, 3, NESTED);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 60, inner: 20 }))!;
    // Before: the outer span read as unplaceable, and its head sized row 0 at 60.
    expect(plan.heightOf(plan.spansAt(0)[0]!)).toBe(60);
    acceptTopDown(plan, 6);
    expect(floorsOf(plan, 6)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(plan.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('outer')).toBe(60);
    expect(plan.rowOptions(2)!.detachedSpanHeightPtByCellId?.get('inner')).toBe(20);
  });

  test('rows under the outer head are held to its fragment, the nested head row too', () => {
    const rows = mergeRows(6, 3, NESTED);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 60, inner: 20 }))!;
    acceptTopDown(plan, 6);
    expect(plan.rowOptions(0)!.coveredFromAbove).toBeUndefined();
    for (const rowIndex of [1, 2, 3, 4, 5]) {
      expect(plan.rowOptions(rowIndex)!.coveredFromAbove).toBe(true);
    }
  });

  test('the inner surplus is in the rows before the outer one is taken', () => {
    const rows = mergeRows(6, 3, NESTED);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 90, inner: 35 }))!;
    expect(plan.heightOf(plan.spansAt(0)[0]!)).toBe(90);
    acceptTopDown(plan, 6);
    // Inner: 35 over rows of 10 + 10 puts 15 on row 3. Outer: 90 over 75 puts 15 on row 5.
    expect(floorsOf(plan, 6)).toEqual([10, 10, 10, 25, 10, 25]);
    expect(plan.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('outer')).toBe(90);
    expect(plan.rowOptions(2)!.detachedSpanHeightPtByCellId?.get('inner')).toBe(35);
  });

  test('an outer surplus on a nested row widens the nested bound with it', () => {
    // Both merges end on row 5, so the outer surplus lands inside the inner span. The inner
    // head's bound is its rows as placed, not the smaller height it was sized at.
    const rows = mergeRows(6, 3, [
      { column: 0, headRow: 0, endRow: 5, id: 'outer' },
      { column: 1, headRow: 3, endRow: 5, id: 'inner' },
    ]);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 100, inner: 20 }))!;
    acceptTopDown(plan, 6);
    expect(floorsOf(plan, 6)).toEqual([10, 10, 10, 10, 10, 50]);
    expect(plan.rowOptions(3)!.detachedSpanHeightPtByCellId?.get('inner')).toBe(70);
  });

  test('withdrawing the outer head row takes the nested decision back with it', () => {
    const rows = mergeRows(6, 3, NESTED);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 90, inner: 35 }))!;
    for (const span of plan.spansAt(0)) plan.accept(span);
    plan.withdrawAt(0);
    for (const rowIndex of [0, 1, 2, 3, 4, 5]) expect(plan.rowOptions(rowIndex)).toBeUndefined();
    // Offered again, it plans the same heights: no surplus was left behind.
    acceptTopDown(plan, 6);
    expect(floorsOf(plan, 6)).toEqual([10, 10, 10, 25, 10, 25]);
  });

  test('withdrawing a nested head row keeps the floors the outer head was placed on', () => {
    const rows = mergeRows(6, 3, NESTED);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 90, inner: 35 }))!;
    acceptTopDown(plan, 6);
    // Row 0 is placed first, against this bound; the nested withdrawal comes after it.
    expect(plan.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('outer')).toBe(90);
    plan.withdrawAt(2);
    const nestedRow = plan.rowOptions(2)!;
    expect(nestedRow.detachedSpanHeightPtByCellId).toBeUndefined();
    expect(nestedRow.heightFloorPt).toBe(10);
    expect(nestedRow.coveredFromAbove).toBe(true);
    // Every floor stays, so the rows still add up to at least that bound.
    expect(floorsOf(plan, 6)).toEqual([10, 10, 10, 25, 10, 25]);
  });

  test('a merge ending past the outer one joins its decision, which runs to its end', () => {
    // A staircase: the inner merge starts inside the outer one and ends after it.
    const rows = mergeRows(7, 3, [
      { column: 0, headRow: 0, endRow: 5, id: 'outer' },
      { column: 1, headRow: 2, endRow: 6, id: 'inner' },
    ]);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 90, inner: 100 }))!;
    // Outer: 90 over 50 puts 40 on row 5. Inner: 100 over rows 2-5 (70) puts 30 on row 6.
    expect(plan.heightOf(plan.spansAt(0)[0]!)).toBe(120);
    acceptTopDown(plan, 7);
    expect(floorsOf(plan, 7)).toEqual([10, 10, 10, 10, 10, 40, 30]);
    expect(plan.rowOptions(0)!.detachedSpanHeightPtByCellId?.get('outer')).toBe(90);
    expect(plan.rowOptions(2)!.detachedSpanHeightPtByCellId?.get('inner')).toBe(100);
    for (const rowIndex of [1, 2, 3, 4, 5, 6]) {
      expect(plan.rowOptions(rowIndex)!.coveredFromAbove).toBe(true);
    }
    // Withdrawing the outer head row takes back every row the decision covered.
    plan.withdrawAt(0);
    for (const rowIndex of [0, 1, 2, 3, 4, 5, 6]) {
      expect(plan.rowOptions(rowIndex)).toBeUndefined();
    }
  });

  test('two nested merges that partly overlap each other are decided with the outer one', () => {
    const rows = mergeRows(8, 4, [
      { column: 0, headRow: 0, endRow: 7, id: 'outer' },
      { column: 1, headRow: 1, endRow: 4, id: 'first' },
      { column: 2, headRow: 3, endRow: 6, id: 'second' },
    ]);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 60, first: 50, second: 50 }))!;
    // First: 50 over 40 puts 10 on row 4. Second then finds rows 3-6 at 50 already.
    expect(plan.heightOf(plan.spansAt(0)[0]!)).toBe(90);
    acceptTopDown(plan, 8);
    expect(floorsOf(plan, 8)).toEqual([10, 10, 10, 10, 20, 10, 10, 10]);
    expect(plan.rowOptions(3)!.detachedSpanHeightPtByCellId?.get('second')).toBe(50);
  });

  test('a head row with merges of two lengths below the outer head keeps it declined', () => {
    const rows = mergeRows(6, 4, [
      { column: 0, headRow: 0, endRow: 5, id: 'outer' },
      { column: 1, headRow: 2, endRow: 3, id: 'short' },
      { column: 2, headRow: 2, endRow: 4, id: 'long' },
    ]);
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 60 }))!;
    expect(plan.heightOf(plan.spansAt(0)[0]!)).toBe(Number.POSITIVE_INFINITY);
  });

  test('a nested merge over fixed rows is clipped inside the outer decision', () => {
    const rows = mergeRows(6, 3, NESTED).map((entry, rowIndex) =>
      rowIndex === 2 || rowIndex === 3
        ? ({ ...entry, height: { rule: 'exact', valuePt: 10 } } as SemanticTableRow)
        : entry
    );
    const plan = planVMergeRowHeights(rows, probeFrom({ outer: 60, inner: 30 }))!;
    expect(plan.heightOf(plan.spansAt(0)[0]!)).toBe(60);
    acceptTopDown(plan, 6);
    expect(floorsOf(plan, 6)).toEqual([10, 10, 10, 10, 10, 10]);
    expect([...(plan.rowOptions(2)!.clippedSpanCellIds ?? [])]).toEqual(['inner']);
    expect(plan.rowOptions(0)!.clippedSpanCellIds).toBeUndefined();
  });

  test('an exact last row takes no surplus: the row above it does not grow instead', () => {
    const rows = mergeRows(3, 2, [{ column: 0, headRow: 0, endRow: 2, id: 'head' }]).map(
      (entry, rowIndex) =>
        rowIndex === 2
          ? ({ ...entry, height: { rule: 'exact', valuePt: 10 } } as SemanticTableRow)
          : entry
    );
    const plan = planVMergeRowHeights(rows, probeFrom({ head: 60 }))!;
    acceptTopDown(plan, 3);
    expect(floorsOf(plan, 3)).toEqual([10, 10, 10]);
    expect([...(plan.rowOptions(0)!.clippedSpanCellIds ?? [])]).toEqual(['head']);
  });

  test('a nest deeper than the bound is declined, and one level less is planned', () => {
    // Column k merges rows k to (2n - 1 - k): each merge contains the next one.
    const nest = (levels: number): MergeShape[] =>
      Array.from({ length: levels }, (_, level) => ({
        column: level,
        headRow: level,
        endRow: 2 * levels - 1 - level,
        id: `m${level}`,
      }));
    const planFor = (levels: number) =>
      planVMergeRowHeights(mergeRows(2 * levels, levels, nest(levels)), probeFrom({}))!;
    const deep = planFor(65);
    expect(deep.heightOf(deep.spansAt(0)[0]!)).toBe(Number.POSITIVE_INFINITY);
    const bounded = planFor(64);
    expect(bounded.heightOf(bounded.spansAt(0)[0]!)).toBe(128 * 10);
  });
});
