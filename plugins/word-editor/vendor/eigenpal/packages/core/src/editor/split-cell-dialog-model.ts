/** Shared count reading and defaults for Split cells dialogs. */
import type { CanResult, EditorCommand } from '../contracts/editor.ts';

/** The most rows and columns a cell splits into, as `splitCellConfig` answers. @public */
export interface SplitCellLimits {
  readonly maxRows: number;
  readonly maxCols: number;
}

/** The highest count a dialog offers when the editor gives no limit. @public */
export const SPLIT_CELL_FALLBACK_MAX = 63;

/** Why typed counts cannot split, before the engine is asked. @public */
export type SplitCellCountProblem =
  | { readonly kind: 'range'; readonly field: 'columns' | 'rows'; readonly max: number }
  | { readonly kind: 'oneCell' };

/** Typed split counts read against the cell's limits. @public */
export interface SplitCellCounts {
  /** The counts to ask the engine about, or null while a problem stands. */
  readonly counts: { readonly rows: number; readonly cols: number } | null;
  readonly problem: SplitCellCountProblem | null;
}

function readCount(value: string): number | null {
  return /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
}

/** Read the typed column and row counts of a Split cells dialog. @public */
export function readSplitCellCounts(
  columns: string,
  rows: string,
  limits: SplitCellLimits | null
): SplitCellCounts {
  const maxCols = limits?.maxCols ?? SPLIT_CELL_FALLBACK_MAX;
  const maxRows = limits?.maxRows ?? SPLIT_CELL_FALLBACK_MAX;
  const cols = readCount(columns);
  const rowCount = readCount(rows);
  if (cols === null || cols < 1 || cols > maxCols) {
    return { counts: null, problem: { kind: 'range', field: 'columns', max: maxCols } };
  }
  if (rowCount === null || rowCount < 1 || rowCount > maxRows) {
    return { counts: null, problem: { kind: 'range', field: 'rows', max: maxRows } };
  }
  if (cols * rowCount < 2) return { counts: null, problem: { kind: 'oneCell' } };
  return { counts: { rows: rowCount, cols }, problem: null };
}

/**
 * The counts a Split cells dialog opens with: two columns, else two rows, else as many rows as
 * a merged cell spans, whichever the engine honours first.
 * @public
 */
export function initialSplitCellCounts(
  limits: SplitCellLimits | null,
  can: (command: Extract<EditorCommand, { type: 'splitCell' }>) => CanResult
): { readonly columns: string; readonly rows: string } {
  const candidates: (readonly [number, number])[] = [
    [1, 2],
    [2, 1],
    [limits?.maxRows ?? 2, 1],
  ];
  for (const [rows, cols] of candidates) {
    if (rows * cols >= 2 && can({ type: 'splitCell', rows, cols }).ok) {
      return { columns: String(cols), rows: String(rows) };
    }
  }
  return { columns: '2', rows: '1' };
}
