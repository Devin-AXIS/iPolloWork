// Whole-table selection and its Backspace deletion. Selecting plans no ops, so it is allowed
// while viewing.

import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import {
  coversWholeTable,
  tableContextAt,
  wholeTableCellSelection,
  type CellSelection,
} from '../layout/semantic-cell-selection.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';
import type { TableCommandPlan, TableCommandPlannerInput } from './table-command-plan.ts';

type SelectTableRegion = Extract<EditorCommand, { type: 'selectTableRegion' }>;

export function planSelectTableRegion(
  input: TableCommandPlannerInput,
  command: SelectTableRegion
): TableCommandPlan {
  if (command.region !== 'table') {
    return {
      ok: false,
      code: 'unsupported',
      reason: `selecting a table ${command.region} is not supported yet`,
    };
  }
  const tableId =
    input.cellSelection?.tableId ??
    tableContextAt(input.layout, input.selection.head.paragraphId)?.tableId;
  const cells = tableId === undefined ? null : wholeTableCellSelection(input.layout, tableId);
  if (!cells)
    return { ok: false, code: 'unsupported', reason: 'the selection is not inside a table' };
  return { ok: true, ops: [], selection: { kind: 'selectCells', cells } };
}

/**
 * Backspace on a whole-table selection deletes the table; Delete only empties its cells.
 * Suggesting keeps the tracked strike of the cell text, because deleting a table has no tracked form.
 */
export function wholeTableDeletionPlan(
  layout: SemanticLayout,
  cellSelection: CellSelection | null,
  mode: SurfaceEditingMode
): TableCommandPlan | null {
  if (mode === 'suggest' || !cellSelection || !coversWholeTable(layout, cellSelection)) return null;
  return {
    ok: true,
    ops: [{ op: 'deleteBlock', blockId: cellSelection.tableId }],
    selection: { kind: 'adoptCommittedCaret' },
  };
}
