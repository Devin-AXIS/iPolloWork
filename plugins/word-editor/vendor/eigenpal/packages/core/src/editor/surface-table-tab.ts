// Tab and Shift+Tab in a table cell move between cells: the cell they reach has its content
// selected, so typing replaces it. That holds from a caret, from text selected in the cell, from
// a whole selected cell, and in a list item (whose level stays). Tab in the last cell adds a row
// below and puts the caret in its first cell; Shift+Tab in the first cell stays. With several
// cells selected, both select the content of the first of them. A tab character in a cell takes
// Option+Tab or Ctrl+Tab, with or without Shift; browsers usually keep Ctrl+Tab for switching
// tabs. Over several selected cells those keys do nothing rather than clear the cells.
//
// Only the selection head counts. Tables in headers, footers, and notes behave the same;
// tables in text boxes are not indexed, so Tab there keeps the paragraph behavior. When the
// row cannot be added (a locked table, or suggesting mode with no author), Tab in the last
// cell does nothing.

import {
  cellAddressAt,
  cellInTabOrder,
  paragraphsInCells,
} from '../layout/semantic-cell-selection.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { paragraphLength } from '../store/store/tree-op-segments.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';
import { planTableCommand } from './table-command-plan.ts';

/** Whether a Tab key types a tab character in a cell instead of moving to the next one. */
export function tabTypesTabInCell(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey'>): boolean {
  return event.altKey || event.ctrlKey;
}

/** Whether the selection head sits in a table cell. */
export function selectionHeadInTableCell(surface: PaginatedSurface): boolean {
  return cellAddressAt(surface.layout(), surface.state().selection.head.paragraphId) !== null;
}

/**
 * Moves the selection to the next or previous cell of the table that holds its head, selecting
 * that cell's content. Answers false outside a table, so the caller keeps its own Tab.
 */
export function moveByTabInTable(
  surface: PaginatedSurface,
  direction: 'next' | 'previous'
): boolean {
  const { selection, cellSelection } = surface.state();
  const target = cellInTabOrder(surface.layout(), selection.head.paragraphId, direction);
  if (target === null) return false;
  const firstSelected =
    cellSelection && cellSelection.cellIds.length > 1 && cellSelection.cellIds[0];
  if (firstSelected) {
    selectCellContent(surface, paragraphsInCells(surface.layout(), [firstSelected]));
    return true;
  }
  if (target === 'end') {
    if (direction === 'next') addRowAndEnterIt(surface);
    return true;
  }
  selectCellContent(surface, target.paragraphIds);
  return true;
}

function selectCellContent(surface: PaginatedSurface, paragraphIds: readonly string[]): void {
  const first = paragraphIds[0];
  const last = paragraphIds.at(-1);
  if (first === undefined || last === undefined) return;
  const lastNode = findNode(partOfNodeId(surface.session, last) ?? surface.session.part(), last);
  const end = lastNode?.kind === 'paragraph' ? paragraphLength(lastNode) : 0;
  surface.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: last, offset: end },
  });
}

/** Tab in the last cell: a row below the head's row, with the caret in its first cell. */
function addRowAndEnterIt(surface: PaginatedSurface): void {
  const state = surface.state();
  const plan = planTableCommand({
    command: { type: 'insertRow', where: 'below' },
    part: partOfNodeId(surface.session, state.selection.head.paragraphId) ?? surface.session.part(),
    layout: surface.layout(),
    storeRevision: surface.session.packageRevision(),
    selection: state.selection,
    cellSelection: state.cellSelection,
    themeColors: surface.session.documentThemeColors(),
    editable: surface.session.editable,
    viewing: surface.editingMode() === 'view',
  });
  if (!surface.applyTableCommandPlan(plan).ok) return;
  const added = cellInTabOrder(surface.layout(), state.selection.head.paragraphId, 'next');
  const first = typeof added === 'object' ? added?.paragraphIds[0] : undefined;
  if (first !== undefined)
    surface.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 0 },
    });
}
