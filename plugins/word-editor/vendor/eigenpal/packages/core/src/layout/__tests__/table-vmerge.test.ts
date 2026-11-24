// Bounded vMerge span resolution: linear/column-keyed work counters (no wall-clock),
// plus restart/continue/omitted/malformed regressions.

import { describe, expect, test } from 'bun:test';
import type { TableRowFragmentRecord } from '../semantic-records.ts';
import { MAX_TABLE_COLUMNS } from '../semantic-table.ts';
import {
  createTableVMergeResolveBudget,
  MAX_VMERGE_RESOLVE_CELLS,
  resolveVMergeSpans,
  type TableVMergeResolveWork,
} from '../table-vmerge.ts';

function cell(
  id: string,
  gridColumn: number,
  opts: { vMergeContinue?: boolean; gridSpan?: number; height?: number } = {}
): TableRowFragmentRecord['cells'][number] {
  const height = opts.height ?? 10;
  return {
    id,
    gridColumn,
    gridSpan: opts.gridSpan ?? 1,
    vMergeContinue: opts.vMergeContinue ?? false,
    ...(opts.vMergeContinue ? { paintInert: true as const } : {}),
    blocks: [],
    box: { x: gridColumn * 20, y: 0, width: (opts.gridSpan ?? 1) * 20, height },
  };
}

function row(
  id: string,
  cells: TableRowFragmentRecord['cells'],
  y: number,
  height = 10
): TableRowFragmentRecord {
  const width = cells.reduce((sum, c) => sum + c.box.width, 0) || 20;
  return {
    id,
    cells: cells.map((c) => ({
      ...c,
      box: { ...c.box, y, height },
    })),
    box: { x: 0, y, width, height },
  };
}

function emptyWork(): TableVMergeResolveWork {
  return { cellsVisited: 0, columnLookups: 0, restartsFinalized: 0 };
}

describe('resolveVMergeSpans (bounded one-pass)', () => {
  test('restart + continue yields span 2; continue is not a restart key', () => {
    const rows = [
      row('r0', [cell('a', 0), cell('b', 1)], 0),
      row('r1', [cell('a-cont', 0, { vMergeContinue: true }), cell('c', 1)], 10),
    ];
    const spans = resolveVMergeSpans(rows);
    expect(spans.get('a')).toBe(2);
    expect(spans.get('b')).toBe(1);
    expect(spans.get('c')).toBe(1);
    expect(spans.has('a-cont')).toBe(false);
  });

  test('multi-row continue chain and mid-span restart split correctly', () => {
    const rows = [
      row('r0', [cell('r', 0)], 0),
      row('r1', [cell('c1', 0, { vMergeContinue: true })], 10),
      row('r2', [cell('r2', 0)], 20), // malformed restart ends prior merge
      row('r3', [cell('c2', 0, { vMergeContinue: true })], 30),
    ];
    const spans = resolveVMergeSpans(rows);
    expect(spans.get('r')).toBe(2);
    expect(spans.get('r2')).toBe(2);
  });

  test('omitted column ends a merge (same as historical .find miss)', () => {
    const rows = [
      row('r0', [cell('left', 0), cell('right', 1)], 0),
      row('r1', [cell('only-right', 1)], 10), // column 0 omitted
      row('r2', [cell('ghost', 0, { vMergeContinue: true }), cell('r2', 1)], 20),
    ];
    const spans = resolveVMergeSpans(rows);
    expect(spans.get('left')).toBe(1);
    // Orphan continue after the gap does not attach to `left`.
    expect(spans.get('right')).toBe(1);
    expect(spans.get('only-right')).toBe(1);
    expect(spans.get('r2')).toBe(1);
  });

  test('gridSpan is preserved on records; merge keys by gridColumn start only', () => {
    const rows = [
      row('r0', [cell('wide', 0, { gridSpan: 2 }), cell('side', 2)], 0),
      row('r1', [cell('cont', 0, { vMergeContinue: true, gridSpan: 2 }), cell('side2', 2)], 10),
    ];
    const spans = resolveVMergeSpans(rows);
    expect(spans.get('wide')).toBe(2);
    expect(rows[0]!.cells[0]!.gridSpan).toBe(2);
    expect(rows[1]!.cells[0]!.gridSpan).toBe(2);
    // Continue at a different start column does not extend `wide`.
    const mismatched = [
      row('r0', [cell('wide', 0, { gridSpan: 2 })], 0),
      row('r1', [cell('cont-col1', 1, { vMergeContinue: true })], 10),
    ];
    expect(resolveVMergeSpans(mismatched).get('wide')).toBe(1);
  });

  test('orphan continue without a restart is ignored', () => {
    const rows = [
      row('r0', [cell('ghost', 0, { vMergeContinue: true })], 0),
      row('r1', [cell('plain', 0)], 10),
    ];
    const spans = resolveVMergeSpans(rows);
    expect(spans.has('ghost')).toBe(false);
    expect(spans.get('plain')).toBe(1);
  });

  test('many rows × columns: work stays linear in total cells (not rows×cols²)', () => {
    const rowCount = 512;
    const colCount = 64;
    const rows: TableRowFragmentRecord[] = [];
    for (let r = 0; r < rowCount; r += 1) {
      const cells = Array.from({ length: colCount }, (_, c) =>
        cell(
          `r${r}c${c}`,
          c,
          r === 0 ? {} : { vMergeContinue: true } // every column merges the full height
        )
      );
      rows.push(row(`row-${r}`, cells, r * 10));
    }
    const totalCells = rowCount * colCount;
    const work = emptyWork();
    const spans = resolveVMergeSpans(rows, work);

    expect(work.cellsVisited).toBe(totalCells);
    // Lookups: continue get + close get/delete per restart flush — bounded, not quadratic.
    expect(work.columnLookups).toBeLessThanOrEqual(8 * totalCells);
    expect(work.columnLookups).toBeLessThan(totalCells * colCount);
    expect(work.restartsFinalized).toBe(colCount);
    for (let c = 0; c < colCount; c += 1) {
      expect(spans.get(`r0c${c}`)).toBe(rowCount);
    }
  });

  test('wide sparse table: spanning cells do not allocate dense column slots', () => {
    const cols = MAX_TABLE_COLUMNS;
    expect(cols).toBe(1024);
    const rowCount = 128;
    const rows: TableRowFragmentRecord[] = [];
    for (let r = 0; r < rowCount; r += 1) {
      rows.push(
        row(
          `row-${r}`,
          [
            cell(`span-${r}`, 0, {
              gridSpan: cols,
              ...(r === 0 ? {} : { vMergeContinue: true }),
            }),
          ],
          r * 10
        )
      );
    }
    const work = emptyWork();
    const spans = resolveVMergeSpans(rows, work);
    expect(work.cellsVisited).toBe(rowCount);
    expect(work.columnLookups).toBeLessThanOrEqual(8 * rowCount);
    // Must not grow with columnCount × rows (dense would be ≥ cols).
    expect(work.columnLookups).toBeLessThan(cols);
    expect(spans.get('span-0')).toBe(rowCount);
  });

  test('nested-like sequential resolves share a budget and stay soft on exhaustion', () => {
    expect(MAX_VMERGE_RESOLVE_CELLS).toBeGreaterThanOrEqual(1_048_576);
    const budget = createTableVMergeResolveBudget(6);
    const mk = (prefix: string) => [
      row(`${prefix}-0`, [cell(`${prefix}-a`, 0), cell(`${prefix}-b`, 1)], 0),
      row(
        `${prefix}-1`,
        [
          cell(`${prefix}-ac`, 0, { vMergeContinue: true }),
          cell(`${prefix}-bc`, 1, { vMergeContinue: true }),
        ],
        10
      ),
    ];
    const workA = emptyWork();
    const workB = emptyWork();
    const first = resolveVMergeSpans(mk('t0'), workA, budget);
    const second = resolveVMergeSpans(mk('t1'), workB, budget);
    expect(workA.cellsVisited).toBe(4);
    expect(first.get('t0-a')).toBe(2);
    expect(first.get('t0-b')).toBe(2);
    // Second table only gets the remaining 2 cell visits; fail soft → incomplete spans.
    expect(workB.cellsVisited).toBe(2);
    expect(budget.cellsRemaining).toBe(0);
    expect(second.get('t1-a') ?? 1).toBe(1);
  });

  test('many nested-like tables: aggregate visits track total cells, not nest×rows²×cols', () => {
    const nestCount = 64;
    const rowCount = 128;
    const colCount = 8;
    const budget = createTableVMergeResolveBudget();
    const aggregate = emptyWork();
    for (let n = 0; n < nestCount; n += 1) {
      const rows: TableRowFragmentRecord[] = [];
      for (let r = 0; r < rowCount; r += 1) {
        rows.push(
          row(
            `n${n}-r${r}`,
            Array.from({ length: colCount }, (_, c) =>
              cell(`n${n}-r${r}-c${c}`, c, r === 0 ? {} : { vMergeContinue: true })
            ),
            r * 10
          )
        );
      }
      const local = emptyWork();
      const spans = resolveVMergeSpans(rows, local, budget);
      aggregate.cellsVisited += local.cellsVisited;
      aggregate.columnLookups += local.columnLookups;
      expect(spans.get(`n${n}-r0-c0`)).toBe(rowCount);
    }
    const totalCells = nestCount * rowCount * colCount;
    expect(aggregate.cellsVisited).toBe(totalCells);
    expect(aggregate.columnLookups).toBeLessThanOrEqual(8 * totalCells);
    // Quadratic in rows per nest would be nest × rows² × cols ≈ 64×128²×8.
    expect(aggregate.columnLookups).toBeLessThan(nestCount * rowCount * rowCount);
    expect(budget.cellsRemaining).toBe(MAX_VMERGE_RESOLVE_CELLS - totalCells);
  });

  test('stable cell ids survive resolve (map keys are authored ids)', () => {
    const rows = [
      row('r0', [cell('stable-id', 0)], 0),
      row('r1', [cell('cont-id', 0, { vMergeContinue: true })], 10),
    ];
    const spans = resolveVMergeSpans(rows);
    expect([...spans.keys()]).toEqual(['stable-id']);
    expect(spans.get('stable-id')).toBe(2);
  });
});
