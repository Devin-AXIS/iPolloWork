// Table addressing for the editor contract: which edges a border command targets, and how a
// row, column or divider is named when the caret alone is not enough.
//
// Split out of `editor.ts` because that file sits at its line cap and this is the one group
// in it that stands on its own — every member is about pointing at part of a table, and
// nothing here references a command, a query or a snapshot. `editor.ts` re-exports the lot,
// so the public surface is unchanged.

import type { ColorValue } from './types';

/** Where the caret sits inside a table: its shape and current cell. */
export interface TableContext {
  readonly rows: number;
  readonly columns: number;
  /** Zero-based, within the table. */
  readonly rowIndex: number;
  /** Zero-based, within the row. */
  readonly columnIndex: number;
}

/** Which cell edges a table border command targets. */
export type TableBorderTarget =
  'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right';

/** Concrete scopes that apply a complete border spec. */
export type TableBorderEdgeTarget = Exclude<TableBorderTarget, 'none'>;

/**
 * Allowlisted OOXML table border line styles.
 *
 * Kept identical to `store/table-border-style.ts`; `table-border-style-parity.test-d.ts`
 * fails if the contract and store vocabularies drift.
 */
export type TableBorderStyle = 'single' | 'dashed' | 'dotted' | 'double' | 'triple' | 'thick';

/** Complete border spec for {@link EditorCommands.setTableBorders}. Size is in eighths of a point. */
export interface TableBorderSpec {
  readonly style: TableBorderStyle;
  readonly size: number;
  readonly color: ColorValue;
}

/** Vertical placement of content inside selected table cells. @public */
export type TableCellVerticalAlignment = 'top' | 'center' | 'bottom';

/**
 * Adjacent grid columns addressed by an internal divider resize gesture.
 *
 * `sourceRevision` is the PACKAGE revision of the layout the target was read from — the number
 * `getDocumentHandle()` reports, never one story's own. Commit MUST refuse when it no longer
 * equals the current one, even if an older layout remains published for geometry.
 */
export interface TableColumnDividerResizeTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly leftGridColumnId: string;
  readonly rightGridColumnId: string;
  readonly isHeaderRepeat: boolean;
}

/**
 * Last grid column and table width addressed by an outer-right-edge resize gesture.
 *
 * `sourceRevision` follows the same rule as {@link TableColumnDividerResizeTarget}: the package
 * revision of the layout the target was read from, and commit refuses once it no longer equals
 * the current one.
 */
export interface TableRightEdgeResizeTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly gridColumnId: string;
  readonly isHeaderRepeat: boolean;
}

/** Explicit row occurrence. `sourceRevision` per {@link TableColumnDividerResizeTarget}. */
export interface TableRowOccurrenceTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly rowId: string;
  readonly isHeaderRepeat: boolean;
}

/** Explicit column occurrence. `sourceRevision` per {@link TableColumnDividerResizeTarget}. */
export interface TableColumnOccurrenceTarget {
  readonly sourceRevision: number;
  readonly tableId: string;
  readonly gridColumnId: string;
  readonly isHeaderRepeat: boolean;
}
