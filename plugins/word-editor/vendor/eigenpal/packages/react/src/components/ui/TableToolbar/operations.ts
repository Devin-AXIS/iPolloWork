/**
 * Table-toolbar selection helpers — pure functions over the toolbar's
 * `TableSelection` plus action labeling and shortcuts.
 *
 * Table STRUCTURE edits (rows, columns, merge, split) are not computed here:
 * they are `Editor.exec` table commands (`insertRow`, `deleteColumn`,
 * `mergeCells`, `splitCell`, …), and the engine refuses what it cannot apply.
 * The former document-model mutation and split-layout computation path was
 * removed with the compatibility layer.
 */

import type { TableAction, TableContext, TableSelection } from '../TableToolbar';

// ============================================================================
// SELECTION HELPERS
// ============================================================================

/**
 * Check if a selection spans multiple cells
 */
export function isMultiCellSelection(selection: TableSelection): boolean {
  if (!selection.selectedCells) return false;
  const { startRow, startCol, endRow, endCol } = selection.selectedCells;
  return startRow !== endRow || startCol !== endCol;
}

/**
 * Get the bounds of a selection
 */
export function getSelectionBounds(selection: TableSelection): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} {
  if (selection.selectedCells) {
    return selection.selectedCells;
  }
  return {
    startRow: selection.rowIndex,
    startCol: selection.columnIndex,
    endRow: selection.rowIndex,
    endCol: selection.columnIndex,
  };
}

/**
 * Check if a cell is within a selection
 */
export function isCellInSelection(
  rowIndex: number,
  colIndex: number,
  selection: TableSelection
): boolean {
  const bounds = getSelectionBounds(selection);
  return (
    rowIndex >= bounds.startRow &&
    rowIndex <= bounds.endRow &&
    colIndex >= bounds.startCol &&
    colIndex <= bounds.endCol
  );
}

// ============================================================================
// ACTION HELPERS
// ============================================================================

/** Simple (string) table actions */
type SimpleTableAction = Exclude<TableAction, { type: string }>;

/**
 * Get action label for display
 */
export function getActionLabel(action: TableAction): string {
  if (typeof action === 'object') {
    if (action.type === 'cellFillColor') return 'Cell Fill Color';
    if (action.type === 'borderColor') return 'Border Color';
    return 'Unknown Action';
  }

  const labels: Record<SimpleTableAction, string> = {
    addRowAbove: 'Insert Row Above',
    addRowBelow: 'Insert Row Below',
    addColumnLeft: 'Insert Column Left',
    addColumnRight: 'Insert Column Right',
    deleteRow: 'Delete Row',
    deleteColumn: 'Delete Column',
    mergeCells: 'Merge Cells',
    splitCell: 'Split Cell',
    deleteTable: 'Delete Table',
    selectTable: 'Select Table',
    selectRow: 'Select Row',
    selectColumn: 'Select Column',
    borderAll: 'All Borders',
    borderOutside: 'Outside Borders',
    borderInside: 'Inside Borders',
    borderNone: 'No Borders',
    borderTop: 'Top Border',
    borderBottom: 'Bottom Border',
    borderLeft: 'Left Border',
    borderRight: 'Right Border',
  };
  return labels[action];
}

/**
 * Check if an action is a delete action
 */
export function isDeleteAction(action: TableAction): boolean {
  return (
    typeof action === 'string' &&
    (action === 'deleteRow' || action === 'deleteColumn' || action === 'deleteTable')
  );
}

/**
 * Handle keyboard shortcuts for table actions
 */
export function handleTableShortcut(
  _event: KeyboardEvent,
  context: TableContext | null
): TableAction | null {
  if (!context) return null;

  // No default keyboard shortcuts defined for table operations
  // This function can be extended to add shortcuts like:
  // - Ctrl+Shift+R for add row
  // - Ctrl+Shift+C for add column
  // etc.

  return null;
}
