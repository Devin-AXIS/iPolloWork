// Operation-specific table interaction targets sourced from semantic layout records.
//
// Each target carries the store revision at capture and provenance for repeated header
// copies. Commit compares `sourceRevision` to the current store revision.

import type {
  TableColumnDividerResizeTarget,
  TableRightEdgeResizeTarget,
} from '@docx-editor.dev/core/contracts/editor';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

/** Row occurrence provenance for explicit toolbar/furniture targets. */
export interface TableRowOccurrenceTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly rowId: string;
  readonly isHeaderRepeat: boolean;
}

/** Column occurrence provenance for explicit toolbar/furniture targets. */
export interface TableColumnOccurrenceTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly gridColumnId: string;
  readonly isHeaderRepeat: boolean;
}

/** A painted table row occurrence (authored or repeated copy). */
export interface TableOccurrenceRef {
  readonly table: TableFragmentRecord;
  readonly row: TableRowFragmentRecord;
  readonly rowIndex: number;
}

function visitTableBlocks(
  blocks: readonly BlockFragmentRecord[],
  visit: (table: TableFragmentRecord) => void
): void {
  for (const block of blocks) {
    if (block.kind !== 'table') continue;
    visit(block);
    for (const row of block.rows) {
      for (const cell of row.cells) {
        visitTableBlocks(cell.blocks, visit);
      }
    }
  }
}

/** Walk every table occurrence on every page, including nested tables in cells. */
export function visitTableOccurrences(
  layout: SemanticLayout,
  visit: (ref: TableOccurrenceRef) => void
): void {
  for (const page of layout.pages) {
    const take = (table: TableFragmentRecord): void => {
      for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
        visit({ table, row: table.rows[rowIndex]!, rowIndex });
      }
    };
    visitTableBlocks(page.fragments, take);
    // The header and footer stories, matching `tableInteractionIndex`. This walk carries no
    // geometry — it resolves a table and a row by identity — so a story needs no origin here,
    // only visiting.
    for (const story of [page.header, page.footer]) {
      if (story) visitTableBlocks(story.fragments, take);
    }
  }
}

/** Find the occurrence matching table/row ids and repeat provenance. */
export function findTableOccurrence(
  layout: SemanticLayout,
  tableId: string,
  rowId: string,
  isHeaderRepeat: boolean
): TableOccurrenceRef | null {
  let found: TableOccurrenceRef | null = null;
  visitTableOccurrences(layout, (ref) => {
    if (
      ref.table.tableId === tableId &&
      ref.row.id === rowId &&
      ref.row.isHeaderRepeat === isHeaderRepeat
    ) {
      found = ref;
    }
  });
  return found;
}

/** Emit a row occurrence target from a layout occurrence record. */
export function tableRowOccurrenceTargetFrom(
  storeRevision: number,
  ref: TableOccurrenceRef
): TableRowOccurrenceTarget {
  return {
    sourceRevision: storeRevision,
    tableId: ref.table.tableId,
    rowId: ref.row.id,
    isHeaderRepeat: ref.row.isHeaderRepeat,
  };
}

/** Locate a row occurrence by ids and repeat provenance. */
export function tableRowOccurrenceTargetOf(
  layout: SemanticLayout,
  storeRevision: number,
  tableId: string,
  rowId: string,
  isHeaderRepeat: boolean
): TableRowOccurrenceTarget | null {
  const ref = findTableOccurrence(layout, tableId, rowId, isHeaderRepeat);
  return ref ? tableRowOccurrenceTargetFrom(storeRevision, ref) : null;
}

/** Emit a column occurrence target from a row occurrence and cell record. */
export function tableColumnOccurrenceTargetFrom(
  storeRevision: number,
  ref: TableOccurrenceRef,
  cell: TableCellFragmentRecord
): TableColumnOccurrenceTarget | null {
  const gridColumnId = cell.gridColumnId;
  if (!gridColumnId) return null;
  return {
    sourceRevision: storeRevision,
    tableId: ref.table.tableId,
    gridColumnId,
    isHeaderRepeat: ref.row.isHeaderRepeat,
  };
}

/** Divider resize target from an occurrence and adjacent grid column ids. */
export function tableColumnDividerResizeTargetFrom(
  storeRevision: number,
  ref: TableOccurrenceRef,
  leftGridColumnId: string,
  rightGridColumnId: string
): TableColumnDividerResizeTarget {
  return {
    sourceRevision: storeRevision,
    tableId: ref.table.tableId,
    leftGridColumnId,
    rightGridColumnId,
    isHeaderRepeat: ref.row.isHeaderRepeat,
  };
}

/** Locate a divider resize target from layout occurrence records. */
export function tableColumnDividerResizeTargetOf(
  layout: SemanticLayout,
  storeRevision: number,
  tableId: string,
  rowId: string,
  isHeaderRepeat: boolean,
  leftGridColumnId: string,
  rightGridColumnId: string
): TableColumnDividerResizeTarget | null {
  const ref = findTableOccurrence(layout, tableId, rowId, isHeaderRepeat);
  if (!ref) return null;
  return tableColumnDividerResizeTargetFrom(
    storeRevision,
    ref,
    leftGridColumnId,
    rightGridColumnId
  );
}

/** Right-edge resize target from an occurrence and last grid column id. */
export function tableRightEdgeResizeTargetFrom(
  storeRevision: number,
  ref: TableOccurrenceRef,
  gridColumnId: string
): TableRightEdgeResizeTarget {
  return {
    sourceRevision: storeRevision,
    tableId: ref.table.tableId,
    gridColumnId,
    isHeaderRepeat: ref.row.isHeaderRepeat,
  };
}

/** Locate a right-edge resize target from layout occurrence records. */
export function tableRightEdgeResizeTargetOf(
  layout: SemanticLayout,
  storeRevision: number,
  tableId: string,
  rowId: string,
  isHeaderRepeat: boolean,
  gridColumnId: string
): TableRightEdgeResizeTarget | null {
  const ref = findTableOccurrence(layout, tableId, rowId, isHeaderRepeat);
  if (!ref) return null;
  return tableRightEdgeResizeTargetFrom(storeRevision, ref, gridColumnId);
}
