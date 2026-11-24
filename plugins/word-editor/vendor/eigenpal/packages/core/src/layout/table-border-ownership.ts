// Bounded per-row column ownership for collapsed border conflict resolution.
// Sparse half-open intervals (not dense row×column arrays) so hostile wide/empty
// grids cannot amplify memory. Kept separate from `table-borders.ts` for the
// max-lines gate.

import type { BorderGridCell } from './table-borders.ts';

/** Matches semantic-table `MAX_TABLE_COLUMNS` without an import cycle. */
const MAX_BORDER_GRID_COLUMNS = 1024;

/**
 * Aggregate ceiling on ownership intervals across one layout pass (all tables,
 * including nested finalize). Sparse build is already O(cells); this caps the
 * sum when many tables coexist. ~1M intervals ≈ ~1M cell claims.
 */
export const MAX_BORDER_OWNERSHIP_INTERVALS = 1_048_576;

interface ColumnOwner {
  readonly cell: BorderGridCell;
  readonly cellIndex: number;
}

/** Half-open [start, end) claim after first-wins overlap resolution. */
interface OwnershipInterval {
  readonly start: number;
  readonly end: number;
  readonly cell: BorderGridCell;
  readonly cellIndex: number;
}

/** Per-row sorted non-overlapping intervals; lookup is O(log intervals). */
export type ColumnOwnershipIndexes = readonly (readonly OwnershipInterval[])[];

/** Test-only mutable counters; omitted by production call sites. Not package-public. */
export interface TableBorderGridResolveWork {
  /** Sparse intervals emitted (not dense column slots). */
  ownershipSlotsWritten: number;
  columnLookups: number;
}

/** Shared remaining interval budget for nested table finalization in one layout. */
export interface TableBorderOwnershipBudget {
  intervalsRemaining: number;
}

export function createTableBorderOwnershipBudget(
  limit: number = MAX_BORDER_OWNERSHIP_INTERVALS
): TableBorderOwnershipBudget {
  const n = limit | 0;
  return { intervalsRemaining: n > 0 ? n : 0 };
}

/**
 * First-wins column coverage as sorted non-overlapping intervals.
 *
 * Overlapping hostile spans keep the earlier cell in reading order; later cells
 * only claim uncovered gaps. Empty columns allocate nothing.
 */
export function buildColumnOwnershipIndexes(
  rows: readonly (readonly BorderGridCell[])[],
  columnCount: number,
  work?: TableBorderGridResolveWork,
  budget?: TableBorderOwnershipBudget
): ColumnOwnershipIndexes {
  const cols = Math.max(0, Math.min(columnCount | 0, MAX_BORDER_GRID_COLUMNS));
  const indexes: OwnershipInterval[][] = new Array(rows.length);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (budget && budget.intervalsRemaining <= 0) {
      indexes[rowIndex] = [];
      continue;
    }
    indexes[rowIndex] = buildRowOwnership(rows[rowIndex]!, cols, work, budget);
  }
  return indexes;
}

/** Ordered, disjoint claims need no sweep events or active-owner map. */
function orderedClaims(row: readonly BorderGridCell[], cols: number): boolean {
  let previousEnd = 0;
  for (const cell of row) {
    const start = Math.max(0, cell.gridColumn | 0);
    const end = Math.min(cols, start + Math.max(0, cell.gridSpan | 0));
    if (start >= end) continue;
    if (start < previousEnd) return false;
    previousEnd = end;
  }
  return true;
}

function orderedOwnership(
  row: readonly BorderGridCell[],
  cols: number,
  work: TableBorderGridResolveWork | undefined,
  budget: TableBorderOwnershipBudget | undefined
): OwnershipInterval[] {
  const out: OwnershipInterval[] = [];
  for (
    let cellIndex = 0;
    cellIndex < row.length && (!budget || budget.intervalsRemaining > 0);
    cellIndex += 1
  ) {
    const cell = row[cellIndex]!;
    const start = Math.max(0, cell.gridColumn | 0);
    const end = Math.min(cols, start + Math.max(0, cell.gridSpan | 0));
    if (start >= end) continue;
    out.push({ start, end, cell, cellIndex });
    if (work) work.ownershipSlotsWritten += 1;
    if (budget) budget.intervalsRemaining -= 1;
  }
  return out;
}

function buildRowOwnership(
  row: readonly BorderGridCell[],
  cols: number,
  work: TableBorderGridResolveWork | undefined,
  budget: TableBorderOwnershipBudget | undefined
): OwnershipInterval[] {
  if (orderedClaims(row, cols)) return orderedOwnership(row, cols, work, budget);
  // Sweep events: resolve overlaps so earlier cellIndex wins on shared columns.
  type Event = {
    readonly x: number;
    readonly kind: 0 | 1; // 0 = end, 1 = start (ends first at same x)
    readonly cellIndex: number;
    readonly cell: BorderGridCell;
  };
  const events: Event[] = [];
  for (let cellIndex = 0; cellIndex < row.length; cellIndex += 1) {
    const cell = row[cellIndex]!;
    const start = Math.max(0, cell.gridColumn | 0);
    const end = Math.min(cols, start + Math.max(0, cell.gridSpan | 0));
    if (start >= end) continue;
    events.push({ x: start, kind: 1, cellIndex, cell });
    events.push({ x: end, kind: 0, cellIndex, cell });
  }
  if (events.length === 0) return [];

  events.sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.kind !== b.kind) return a.kind - b.kind;
    return a.cellIndex - b.cellIndex;
  });

  const active = new Map<number, ColumnOwner>();
  let winner: ColumnOwner | undefined;
  let prevX = events[0]!.x;
  const out: OwnershipInterval[] = [];

  const recomputeWinner = (): void => {
    winner = undefined;
    for (const owner of active.values()) {
      if (!winner || owner.cellIndex < winner.cellIndex) winner = owner;
    }
  };

  for (const event of events) {
    if (event.x > prevX && winner && (!budget || budget.intervalsRemaining > 0)) {
      // Merge adjacent runs with the same owner (one interval, not one per segment).
      const last = out[out.length - 1];
      if (
        last &&
        last.end === prevX &&
        last.cellIndex === winner.cellIndex &&
        last.cell === winner.cell
      ) {
        out[out.length - 1] = {
          start: last.start,
          end: event.x,
          cell: last.cell,
          cellIndex: last.cellIndex,
        };
      } else {
        out.push({
          start: prevX,
          end: event.x,
          cell: winner.cell,
          cellIndex: winner.cellIndex,
        });
        if (work) work.ownershipSlotsWritten += 1;
        if (budget) budget.intervalsRemaining -= 1;
      }
    }

    if (event.kind === 1) {
      active.set(event.cellIndex, { cell: event.cell, cellIndex: event.cellIndex });
    } else {
      active.delete(event.cellIndex);
    }
    recomputeWinner();
    prevX = event.x;
  }

  return out;
}

/** Upper bound: first index with interval.start > col. */
function upperBoundStart(intervals: readonly OwnershipInterval[], col: number): number {
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid]!.start <= col) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function ownerAt(
  indexes: ColumnOwnershipIndexes,
  rowIndex: number,
  gridColumn: number,
  work?: TableBorderGridResolveWork
): ColumnOwner | undefined {
  if (work) work.columnLookups += 1;
  const intervals = indexes[rowIndex];
  if (!intervals || gridColumn < 0) return undefined;
  const i = upperBoundStart(intervals, gridColumn) - 1;
  if (i < 0) return undefined;
  const interval = intervals[i]!;
  if (gridColumn >= interval.end) return undefined;
  return { cell: interval.cell, cellIndex: interval.cellIndex };
}
