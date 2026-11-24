import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { SemanticTableRow, SemanticTableStructure } from './semantic-table.ts';
import type { TableRowFragmentRecord } from './semantic-records.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import { prepareTerminalBorderPlan, sameTerminalContent } from './table-terminal-border-plan.ts';
import { closingRowDeps, exactTerminalBorderPt } from './table-exact-terminal-border.ts';
import { firstRowContentDeps } from './table-fragment-content-insets.ts';

/** Enough vertical room to lay a positioned table as one visual object on its anchor sheet. */
export const POSITIONED_TABLE_LAYOUT_BOTTOM_PT = Number.MAX_SAFE_INTEGER / 1024;

/** A row fragment whose rest continues on the next page: the head of a split row. */
export function splitHead(record: TableRowFragmentRecord): TableRowFragmentRecord {
  return { ...record, hasContinuation: true };
}

/** Price each kept row once, with an optional already measured first row. */
export function cachedRowHeights(
  rows: readonly SemanticTableRow[],
  heightOf: (row: SemanticTableRow) => number,
  first?: [number, number]
): (at: number) => number {
  const heights = new Map<number, number>(first ? [first] : []);
  return (at) => {
    let height = heights.get(at);
    if (height === undefined) heights.set(at, (height = heightOf(rows[at]!)));
    return height;
  };
}

/**
 * The table deps a closing fragment is corrected and finalized with: its last row closes it
 * (`closingRowDeps`), and an exact body row that opens it keeps its opening extension.
 */
export function fragmentCloseDeps(
  structure: SemanticTableStructure,
  rows: readonly TableRowFragmentRecord[],
  sourceRows: readonly SemanticTableRow[],
  tableDeps: TableFlowDeps
): TableFlowDeps {
  const last = sourceRows.at(-1);
  if (!last || rows.at(-1)!.isContinuation) return tableDeps;
  const closing = closingRowDeps(structure, last, tableDeps);
  const first = rows[0]!;
  const opening =
    first.isHeaderRepeat || first.isContinuation
      ? undefined
      : firstRowContentDeps(structure, sourceRows[0]!, tableDeps).exactOpeningExtension;
  return opening ? { ...closing, exactOpeningExtension: opening } : closing;
}

/** Correct only the complete terminal row; a split row keeps its consumed content. */
export function refreshTerminalRow(
  structure: SemanticTableStructure,
  rows: TableRowFragmentRecord[],
  sourceRows: readonly SemanticTableRow[],
  completeSourceRows: ReadonlySet<SemanticTableRow>,
  occurrenceInsets: Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>,
  left: number,
  bottom: number,
  currentDeps: TableFlowDeps
): number | undefined {
  const index = rows.length - 1;
  const record = rows[index]!;
  const source = sourceRows[index]!;
  // A split fragment owns only part of its source row. Re-measuring the whole source
  // would repeat already consumed content, so only complete occurrences take this path.
  if (record.isContinuation || !completeSourceRows.has(source)) return undefined;
  const deps = {
    ...currentDeps,
    cellContentInsets: occurrenceInsets.get(record) ?? currentDeps.cellContentInsets,
  };
  // At the top of its page an exact row cannot move, so its closing rule crosses the margin.
  const atPageTop =
    record.box.y <= 0.001 || (index > 0 && rows.slice(0, index).every((row) => row.isHeaderRepeat));
  const terminal = prepareTerminalBorderPlan(
    structure,
    source,
    left,
    record.box.y,
    bottom + (atPageTop ? exactTerminalBorderPt(source, deps) : 0),
    deps
  );
  if (!terminal || !sameTerminalContent(record, terminal.probe)) return undefined;
  const corrected = {
    ...record,
    box: { ...record.box, height: terminal.height },
    cells: record.cells.map((cell) => ({
      ...cell,
      box: { ...cell.box, height: terminal.height - (cell.box.y - record.box.y) },
    })),
  };
  rows[index] = corrected;
  occurrenceInsets.delete(record);
  if (terminal.deps.cellContentInsets)
    occurrenceInsets.set(corrected, terminal.deps.cellContentInsets);
  return terminal.height - record.box.height;
}
