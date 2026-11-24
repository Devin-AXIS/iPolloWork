// Merge Cells and Split Cells, from a command and the table anchor to one store op.
//
// Merge reads the cell rectangle the user selected; a caret alone has nothing to merge with.
// Split addresses the one cell the caret or the selection is in. The store decides whether the
// table allows either, so the reasons below are the store's refusals said for a reader.

import type { EditorCommand } from '../contracts/editor.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import {
  MAX_CELL_SPLIT_COUNT,
  readMergeableTable,
  visualCellOf,
} from '../store/store/tree-op-table-cell-shape.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/store/tree-op-types.ts';
import { isOwnPendingTableInsertion } from '../store/store/table-authoring-plan.ts';

/**
 * Suggesting refuses cell merge and split outside the author's own proposed table, where they
 * have no tracked form. The sentence is the i18n key for the disabled reason.
 */
export const SUGGESTING_CELL_STRUCTURE_REFUSAL =
  'suggesting cannot merge or split cells; stop suggesting to change the table structure';

export const MERGE_NEEDS_RECTANGLE = 'select two or more cells that form a rectangle to merge them';

/** A caret alone has nothing to merge with. */
export const MERGE_NEEDS_SELECTION = 'select two or more cells to merge them';

type Refusal = { readonly code: 'unsupported' | 'invalidArgs'; readonly reason: string };

/** The reader-facing refusal for a store rejection only merge and split produce. */
export function cellStructureRejection(reason: TreeOpRejection): Refusal | null {
  switch (reason) {
    case 'cells-not-rectangle':
      return { code: 'invalidArgs', reason: MERGE_NEEDS_RECTANGLE };
    case 'split-rows-not-divisor':
      return {
        code: 'invalidArgs',
        reason: 'a merged cell splits only into a number of rows that divides its rows',
      };
    case 'split-needs-grid':
      return {
        code: 'invalidArgs',
        reason:
          'this table has no column grid, so the cell splits only into a divisor of its columns',
      };
    case 'cell-too-narrow':
      return {
        code: 'invalidArgs',
        reason: 'the cell is too narrow to split into that many columns',
      };
    case 'cell-has-revision':
      return {
        code: 'unsupported',
        reason: 'the cells have a tracked change; accept or reject it first',
      };
    default:
      return null;
  }
}

function isSplitCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_CELL_SPLIT_COUNT
  );
}

/** Why a `splitCell` command's counts are invalid, or null when they are valid. */
export function splitCellShapeRefusal(
  command: Extract<EditorCommand, { type: 'splitCell' }>
): string | null {
  if (
    isSplitCount(command.rows) &&
    isSplitCount(command.cols) &&
    command.rows * command.cols >= 2
  ) {
    return null;
  }
  return `splitCell rows and cols must be whole numbers from 1 to ${MAX_CELL_SPLIT_COUNT}, and not both 1`;
}

/** The author while suggesting, for the planner's tracked merge and split. */
export function suggestingAuthorOf(surface: {
  author(): string | undefined;
  editingMode(): string;
}): { suggestingAuthor?: string } {
  const author = surface.author()?.trim();
  return surface.editingMode() === 'suggest' && author ? { suggestingAuthor: author } : {};
}

/**
 * The op as suggesting will write it, for validation. Suggesting attributes the op after
 * planning, and inside the author's own proposed table the store refuses an untracked one.
 */
export function asSuggested(part: OoxmlPart, op: TreeDocOp, author: string | undefined): TreeDocOp {
  if (!author || (op.op !== 'mergeTableCells' && op.op !== 'splitTableCell')) return op;
  return isOwnPendingTableInsertion(part.root, op.tableId, author)
    ? { ...op, revision: { author } }
    : op;
}

interface CellAnchor {
  readonly tableId: string;
  readonly cellId: string;
  readonly cellIds: readonly string[];
}

/** The store op for a merge or split command at `anchor`. */
export function cellStructureOp(
  command: Extract<EditorCommand, { type: 'mergeCells' | 'splitCell' }>,
  anchor: CellAnchor,
  hasCellSelection: boolean
): { readonly ok: true; readonly op: TreeDocOp } | ({ readonly ok: false } & Refusal) {
  if (command.type === 'mergeCells') {
    if (!hasCellSelection || anchor.cellIds.length < 2) {
      return { ok: false, code: 'invalidArgs', reason: MERGE_NEEDS_SELECTION };
    }
    return {
      ok: true,
      op: { op: 'mergeTableCells', tableId: anchor.tableId, cellIds: anchor.cellIds },
    };
  }
  if (anchor.cellIds.length > 1) {
    return { ok: false, code: 'invalidArgs', reason: 'select one cell to split it' };
  }
  return {
    ok: true,
    op: {
      op: 'splitTableCell',
      tableId: anchor.tableId,
      cellId: anchor.cellId,
      rows: command.rows,
      columns: command.cols,
    },
  };
}

/**
 * The top or bottom row the selected cells cover, merged cells included, or null when the
 * table cannot be placed on its grid. A row inserted above or below goes beside this row.
 */
export function outerRowOfSelection(
  part: OoxmlPart,
  anchor: CellAnchor,
  where: 'above' | 'below'
): string | null {
  const read = readMergeableTable(part, anchor.tableId);
  if (!read.ok) return null;
  let outer: number | null = null;
  for (const id of anchor.cellIds) {
    const entry = read.table.index.byId.get(id);
    if (!entry) continue;
    const visual = visualCellOf(read.table, entry);
    const row = where === 'above' ? visual.rowFrom : visual.rowTo;
    outer = outer === null ? row : where === 'above' ? Math.min(outer, row) : Math.max(outer, row);
  }
  return outer === null ? null : (read.table.topology.rows[outer]?.row.id ?? null);
}

/**
 * The leftmost or rightmost grid column the selected cells cover, merged cells included, or
 * null without a readable grid. A column inserted left or right goes beside this column.
 */
export function outerColumnOfSelection(
  part: OoxmlPart,
  anchor: CellAnchor,
  where: 'left' | 'right'
): string | null {
  const read = readMergeableTable(part, anchor.tableId);
  if (!read.ok) return null;
  let outer: number | null = null;
  for (const id of anchor.cellIds) {
    const entry = read.table.index.byId.get(id);
    if (!entry) continue;
    const visual = visualCellOf(read.table, entry);
    const column = where === 'left' ? visual.colFrom : visual.colTo;
    outer =
      outer === null
        ? column
        : where === 'left'
          ? Math.min(outer, column)
          : Math.max(outer, column);
  }
  return outer === null ? null : (read.table.topology.gridColumns[outer]?.id ?? null);
}
