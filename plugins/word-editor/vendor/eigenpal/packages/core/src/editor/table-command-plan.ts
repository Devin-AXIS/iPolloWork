// Pure table-command planner — sole source for Editor.can and Editor.exec.
//
// Resolves caret or rectangular cell selection to canonical ids, builds complete
// TreeDocOps, validates without mutation, and declares post-edit selection policy.
// Execution adopts the committed store caret; planning never calls applyTreeOp.

import type {
  ColorValue,
  EditorCommand,
  TableColumnDividerResizeTarget,
  TableRightEdgeResizeTarget,
} from '@docx-editor.dev/core/contracts/editor';
import type { DocumentThemeColorEntry } from '../binding/document-theme.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { OoxmlTableCellNode } from '../store/package/ooxml-tree.ts';
import { validateTreeOp } from '../store/store/tree-ops.ts';
import {
  readEditableTableTopology,
  type EditableTableTopology,
} from '../store/store/tree-op-table-topology.ts';
import { wmlAttributeValue, wmlChildNamed } from '../store/store/tree-op-table-shared.ts';
import {
  asSuggested,
  cellStructureOp,
  cellStructureRejection,
  outerColumnOfSelection,
  outerRowOfSelection,
  splitCellShapeRefusal,
} from './table-cell-structure-plan.ts';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_BORDER_SIZE_EIGHTHS,
  MIN_TABLE_BORDER_SIZE_EIGHTHS,
  MIN_TABLE_COLUMN_WIDTH_TWIPS,
} from '../store/store/table-constraints.ts';
import { tableInteractionIndex } from '../layout/semantic-table-interaction.ts';
import { tableAnchorAt } from '../layout/semantic-cell-selection.ts';
import type { CellSelection } from '../layout/semantic-cell-selection.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';
import type {
  TableColumnOccurrenceTarget,
  TableRowOccurrenceTarget,
} from '../layout/table-interaction-targets.ts';
import { lowerColorValueForBorder, lowerColorValueForFill } from './color-value-lower.ts';
import type {
  TableBorderEdgeTarget,
  TableBorderSpecInput,
  TreeDocColorValue,
  TreeDocOp,
  TreeOpRejection,
} from '../store/store/tree-op-types.ts';
import { TABLE_BORDER_STYLES } from '../store/table-border-style.ts';
import { planSelectTableRegion } from './table-select-plan.ts';

function isVisualRtlTable(layout: SemanticLayout, tableId: string): boolean {
  return tableInteractionIndex(layout).occurrences.some(
    (occ) =>
      occ.table.tableId === tableId &&
      occ.row.cells.some((cell) => cell.logicalGridColumn !== undefined)
  );
}

function visualBorderTarget(target: TableBorderEdgeTarget, rtl: boolean): TableBorderEdgeTarget {
  return rtl ? (target === 'left' ? 'right' : target === 'right' ? 'left' : target) : target;
}

let plannerCallCount = 0;

/** Reset the planner invocation counter (tests only). */
export function resetTableCommandPlannerCallCount(): void {
  plannerCallCount = 0;
}

/** Return how many times `planTableCommand` has run since the last reset (tests only). */
export function tableCommandPlannerCallCount(): number {
  return plannerCallCount;
}

export interface TableCommandPlannerInput {
  readonly command: EditorCommand;
  readonly part: OoxmlPart;
  readonly layout: SemanticLayout;
  /**
   * The PACKAGE revision, never a story's own.
   *
   * Explicit targets carry `sourceRevision` copied from `layout.revision`, which layout
   * stamps from `session.packageRevision()`, and the staleness checks below compare the
   * two. A body-store revision here reads as permanently stale the moment a header/footer
   * or notes edit moves the package revision without moving the body's: every explicit
   * target is then refused as stale and the command mutates nothing.
   */
  readonly storeRevision: number;
  readonly selection: SemanticSelection;
  readonly cellSelection: CellSelection | null;
  readonly themeColors: readonly DocumentThemeColorEntry[];
  readonly editable: boolean;
  readonly viewing: boolean;
  /** The author while suggesting, whose own proposed table takes tracked merge and split. */
  readonly suggestingAuthor?: string;
}

export type TableCommandSelectionPolicy =
  | { readonly kind: 'preserveSelection' }
  | { readonly kind: 'adoptCommittedCaret' }
  | { readonly kind: 'selectCells'; readonly cells: CellSelection };

export type TableCommandPlan =
  | {
      readonly ok: true;
      readonly ops: readonly TreeDocOp[];
      readonly selection: TableCommandSelectionPolicy;
    }
  | {
      readonly ok: false;
      readonly code: 'unsupported' | 'invalidArgs' | 'locked';
      readonly reason: string;
    };

interface ResolvedAnchor {
  readonly tableId: string;
  readonly rowId: string;
  readonly cellId: string;
  readonly cellIds: readonly string[];
  readonly gridColumnIndex: number;
  /** The anchor cell's authored grid column: layout indexes only the columns cells reach. */
  readonly gridColumnId?: string;
  readonly isHeaderRepeat: boolean;
}

const TABLE_COMMANDS = new Set([
  'insertRow',
  'deleteRow',
  'insertColumn',
  'deleteColumn',
  'deleteTable',
  'setCellFill',
  'setTableCellVerticalAlignment',
  'setTableBorders',
  'commitTableColumnDividerResize',
  'commitTableRightEdgeResize',
  'mergeCells',
  'splitCell',
  'toggleHeaderRow',
  'selectTableRegion',
  'setTableProperties',
]);

export function isTableEditorCommand(command: EditorCommand): boolean {
  return TABLE_COMMANDS.has(command.type);
}

function refusal(code: 'unsupported' | 'invalidArgs' | 'locked', reason: string): TableCommandPlan {
  return { ok: false, code, reason };
}

function mapStoreRejection(reason: TreeOpRejection, detail?: string): TableCommandPlan {
  const cellStructure = cellStructureRejection(reason);
  if (cellStructure) return refusal(cellStructure.code, cellStructure.reason);
  switch (reason) {
    case 'unknown-table':
    case 'unknown-row':
    case 'unknown-grid-column':
      return refusal('invalidArgs', 'the table target is no longer valid');
    case 'table-has-merge':
      return refusal(
        'unsupported',
        'this table uses a legacy horizontal merge the editor cannot change'
      );
    case 'row-hides-cell':
    case 'tree-invariant':
      return refusal('unsupported', 'this table has a cell the editor cannot place in the grid');
    case 'block-required':
      return refusal('unsupported', 'the table must keep at least one row or column');
    case 'resource-limit':
      return refusal('unsupported', 'the table has reached the supported size limit');
    case 'invalidArgs':
    case 'invalid-property-value':
    case 'unsupported-property':
      return refusal('invalidArgs', detail ?? 'the table command arguments are invalid');
    default:
      return refusal('unsupported', detail ?? `the table operation was refused (${reason})`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownKeysExactly(value: unknown, allowed: readonly string[]): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== allowed.length) return false;
  return allowed.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validateColorValue(value: unknown): value is ColorValue {
  if (!isPlainObject(value)) return false;
  const kind = value.kind;
  if (kind === 'hex') {
    return ownKeysExactly(value, ['kind', 'value']) && typeof value.value === 'string';
  }
  if (kind === 'auto') return ownKeysExactly(value, ['kind']);
  if (kind === 'theme') {
    if (typeof value.slot !== 'string') return false;
    const keys = ['kind', 'slot'];
    if (value.tint !== undefined) {
      if (typeof value.tint !== 'number' || !Number.isFinite(value.tint)) return false;
      keys.push('tint');
    }
    if (value.shade !== undefined) {
      if (typeof value.shade !== 'number' || !Number.isFinite(value.shade)) return false;
      keys.push('shade');
    }
    return ownKeysExactly(value, keys);
  }
  return false;
}

function validateRowOccurrenceTarget(value: unknown): value is TableRowOccurrenceTarget {
  return (
    isPlainObject(value) &&
    ownKeysExactly(value, ['sourceRevision', 'tableId', 'rowId', 'isHeaderRepeat']) &&
    typeof value.sourceRevision === 'number' &&
    Number.isInteger(value.sourceRevision) &&
    typeof value.tableId === 'string' &&
    value.tableId.length > 0 &&
    typeof value.rowId === 'string' &&
    value.rowId.length > 0 &&
    typeof value.isHeaderRepeat === 'boolean'
  );
}

function validateColumnOccurrenceTarget(value: unknown): value is TableColumnOccurrenceTarget {
  return (
    isPlainObject(value) &&
    ownKeysExactly(value, ['sourceRevision', 'tableId', 'gridColumnId', 'isHeaderRepeat']) &&
    typeof value.sourceRevision === 'number' &&
    Number.isInteger(value.sourceRevision) &&
    typeof value.tableId === 'string' &&
    value.tableId.length > 0 &&
    typeof value.gridColumnId === 'string' &&
    value.gridColumnId.length > 0 &&
    typeof value.isHeaderRepeat === 'boolean'
  );
}

function validateDividerResizeTarget(value: unknown): value is TableColumnDividerResizeTarget {
  return (
    isPlainObject(value) &&
    ownKeysExactly(value, [
      'sourceRevision',
      'tableId',
      'leftGridColumnId',
      'rightGridColumnId',
      'isHeaderRepeat',
    ]) &&
    typeof value.sourceRevision === 'number' &&
    Number.isInteger(value.sourceRevision) &&
    typeof value.tableId === 'string' &&
    typeof value.leftGridColumnId === 'string' &&
    typeof value.rightGridColumnId === 'string' &&
    typeof value.isHeaderRepeat === 'boolean'
  );
}

function validateRightEdgeResizeTarget(value: unknown): value is TableRightEdgeResizeTarget {
  return (
    isPlainObject(value) &&
    ownKeysExactly(value, ['sourceRevision', 'tableId', 'gridColumnId', 'isHeaderRepeat']) &&
    typeof value.sourceRevision === 'number' &&
    Number.isInteger(value.sourceRevision) &&
    typeof value.tableId === 'string' &&
    typeof value.gridColumnId === 'string' &&
    typeof value.isHeaderRepeat === 'boolean'
  );
}

function validateBorderSpec(
  value: unknown
): value is { style: string; size: number; color: ColorValue } {
  if (!isPlainObject(value) || !ownKeysExactly(value, ['style', 'size', 'color'])) return false;
  return (
    typeof value.style === 'string' &&
    typeof value.size === 'number' &&
    Number.isInteger(value.size) &&
    validateColorValue(value.color)
  );
}

function validateOptionalRowTarget(command: Record<string, unknown>): boolean {
  return (
    !('target' in command) ||
    command.target === undefined ||
    validateRowOccurrenceTarget(command.target)
  );
}

function validateOptionalColumnTarget(command: Record<string, unknown>): boolean {
  return (
    !('target' in command) ||
    command.target === undefined ||
    validateColumnOccurrenceTarget(command.target)
  );
}

function validateTableCommandShape(command: EditorCommand): TableCommandPlan | null {
  switch (command.type) {
    case 'splitCell': {
      const invalid = splitCellShapeRefusal(command);
      return invalid ? refusal('invalidArgs', invalid) : null;
    }
    case 'insertRow':
      if (!isPlainObject(command) || command.type !== 'insertRow') {
        return refusal('invalidArgs', 'insertRow command shape is invalid');
      }
      if (command.where !== 'above' && command.where !== 'below') {
        return refusal('invalidArgs', 'insertRow where must be above or below');
      }
      if (!validateOptionalRowTarget(command)) {
        return refusal('invalidArgs', 'insertRow target shape is invalid');
      }
      return null;
    case 'deleteRow':
      if (!isPlainObject(command) || command.type !== 'deleteRow') {
        return refusal('invalidArgs', 'deleteRow command shape is invalid');
      }
      if (!validateOptionalRowTarget(command)) {
        return refusal('invalidArgs', 'deleteRow target shape is invalid');
      }
      return null;
    case 'insertColumn':
      if (!isPlainObject(command) || command.type !== 'insertColumn') {
        return refusal('invalidArgs', 'insertColumn command shape is invalid');
      }
      if (command.where !== 'left' && command.where !== 'right') {
        return refusal('invalidArgs', 'insertColumn where must be left or right');
      }
      if (!validateOptionalColumnTarget(command)) {
        return refusal('invalidArgs', 'insertColumn target shape is invalid');
      }
      return null;
    case 'deleteColumn':
      if (!isPlainObject(command) || command.type !== 'deleteColumn') {
        return refusal('invalidArgs', 'deleteColumn command shape is invalid');
      }
      if (!validateOptionalColumnTarget(command)) {
        return refusal('invalidArgs', 'deleteColumn target shape is invalid');
      }
      return null;
    case 'deleteTable':
      return !isPlainObject(command) || !ownKeysExactly(command, ['type'])
        ? refusal('invalidArgs', 'deleteTable command shape is invalid')
        : null;
    case 'setCellFill':
      if (!isPlainObject(command) || !ownKeysExactly(command, ['type', 'color'])) {
        return refusal('invalidArgs', 'setCellFill command shape is invalid');
      }
      if (command.color !== null && !validateColorValue(command.color)) {
        return refusal('invalidArgs', 'setCellFill color shape is invalid');
      }
      return null;
    case 'setTableCellVerticalAlignment':
      if (
        !isPlainObject(command) ||
        !ownKeysExactly(command, ['type', 'alignment']) ||
        !['top', 'center', 'bottom'].includes(command.alignment)
      ) {
        return refusal('invalidArgs', 'cell vertical alignment command shape is invalid');
      }
      return null;
    case 'setTableBorders':
      if (!isPlainObject(command) || command.type !== 'setTableBorders') {
        return refusal('invalidArgs', 'setTableBorders command shape is invalid');
      }
      if (command.scope === 'none') {
        if (typeof command.target !== 'string') {
          return refusal('invalidArgs', 'border none scope requires a target edge');
        }
        return null;
      }
      if (!('spec' in command) || !validateBorderSpec(command.spec)) {
        return refusal('invalidArgs', 'concrete border scopes require a complete spec');
      }
      return null;
    case 'commitTableColumnDividerResize':
      if (
        !isPlainObject(command) ||
        !ownKeysExactly(command, ['type', 'target', 'leftWidthTwips', 'rightWidthTwips']) ||
        !validateDividerResizeTarget(command.target) ||
        typeof command.leftWidthTwips !== 'number' ||
        typeof command.rightWidthTwips !== 'number'
      ) {
        return refusal('invalidArgs', 'column divider resize command shape is invalid');
      }
      return null;
    case 'commitTableRightEdgeResize':
      if (
        !isPlainObject(command) ||
        !ownKeysExactly(command, ['type', 'target', 'columnWidthTwips', 'tableWidthTwips']) ||
        !validateRightEdgeResizeTarget(command.target) ||
        typeof command.columnWidthTwips !== 'number' ||
        typeof command.tableWidthTwips !== 'number'
      ) {
        return refusal('invalidArgs', 'right-edge resize command shape is invalid');
      }
      return null;
    default:
      return null;
  }
}

function rowOccurrenceTargetOf(command: EditorCommand): TableRowOccurrenceTarget | null {
  if (!('target' in command) || command.target === undefined) return null;
  return validateRowOccurrenceTarget(command.target) ? command.target : null;
}

function columnOccurrenceTargetOf(command: EditorCommand): TableColumnOccurrenceTarget | null {
  if (!('target' in command) || command.target === undefined) return null;
  return validateColumnOccurrenceTarget(command.target) ? command.target : null;
}

/**
 * The rows a cell RECTANGLE covers, in table order.
 *
 * A rectangle is a set of cells, and Delete Rows read only the row of its first one — so
 * dragging across two rows and deleting removed one of them and reported success. Answers a
 * single-element list for an ordinary caret, which is the same command with a smaller set.
 */
function rowIdsOfSelection(
  part: OoxmlPart,
  anchor: ResolvedAnchor
): { readonly rowIds: readonly string[]; readonly wholeTable: boolean } {
  const topo = readEditableTableTopology(part.root, anchor.tableId);
  if (!topo.ok) return { rowIds: [anchor.rowId], wholeTable: false };
  const selected = new Set(anchor.cellIds);
  const rowIds = topo.topology.rows
    .filter((entry) => entry.cells.some((cell) => selected.has(cell.id)))
    .map((entry) => entry.row.id);
  if (rowIds.length === 0) return { rowIds: [anchor.rowId], wholeTable: false };
  // A table has to keep one row (`CT_Tbl`), and `deleteTableRow` says so by refusing the
  // last one — a refusal that takes the whole transaction, so selecting every row and
  // pressing Delete Rows would delete NOTHING. Word deletes the table.
  return { rowIds, wholeTable: rowIds.length === topo.topology.rows.length };
}

/** The grid columns a cell rectangle covers, by id, left to right. */
function gridColumnIdsOfSelection(
  part: OoxmlPart,
  anchor: ResolvedAnchor
): { readonly gridColumnIds: readonly string[]; readonly wholeTable: boolean } {
  const topo = readEditableTableTopology(part.root, anchor.tableId);
  if (!topo.ok || !topo.topology.grid) return { gridColumnIds: [], wholeTable: false };
  const selected = new Set(anchor.cellIds);
  const columns = new Set<string>();
  for (const entry of topo.topology.rows) {
    // The grid position is the running sum of the spans before it — the same walk
    // `anchorForGridColumn` does, because a merged cell occupies more than one column.
    let cursor = 0;
    for (const cell of entry.cells) {
      const span = readCellGridSpan(cell);
      if (selected.has(cell.id)) {
        for (let step = 0; step < span; step += 1) {
          const column = topo.topology.gridColumns[cursor + step];
          if (column) columns.add(column.id);
        }
      }
      cursor += span;
    }
  }
  // The last column is refused for the reason the last row is, and would veto the whole
  // transaction with it. Word deletes the table.
  return {
    gridColumnIds: [...columns],
    wholeTable: columns.size > 0 && columns.size === topo.topology.gridColumns.length,
  };
}

function gridColumnIdAt(part: OoxmlPart, tableId: string, columnIndex: number): string | null {
  const topo = readEditableTableTopology(part.root, tableId);
  if (!topo.ok || !topo.topology.grid) return null;
  const col = topo.topology.gridColumns[columnIndex];
  return col?.id ?? null;
}

function resolveAnchor(input: TableCommandPlannerInput): ResolvedAnchor | null {
  const anchor = tableAnchorAt(input.layout, input.selection.head.paragraphId, input.cellSelection);
  if (!anchor) return null;
  return {
    tableId: anchor.tableId,
    rowId: anchor.rowId,
    cellId: anchor.cellId,
    cellIds: [...anchor.cellIds],
    gridColumnIndex: anchor.gridColumnIndex,
    ...(anchor.gridColumnId ? { gridColumnId: anchor.gridColumnId } : {}),
    isHeaderRepeat: anchor.isHeaderRepeat,
  };
}

function readCellGridSpan(cell: OoxmlTableCellNode): number {
  const tcPr = wmlChildNamed(cell, 'tcPr');
  const raw = tcPr && wmlChildNamed(tcPr, 'gridSpan');
  const value = raw && wmlAttributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 1;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, MAX_TABLE_COLUMNS) : 1;
}

function anchorForGridColumn(
  topology: EditableTableTopology,
  tableId: string,
  gridColumnId: string
): ResolvedAnchor | null {
  const colIndex = topology.gridColumns.findIndex((column) => column.id === gridColumnId);
  if (colIndex === -1) return null;
  for (const { row, cells } of topology.rows) {
    let cursor = 0;
    for (const cell of cells) {
      const span = readCellGridSpan(cell);
      if (colIndex >= cursor && colIndex < cursor + span) {
        return {
          tableId,
          rowId: row.id,
          cellId: cell.id,
          cellIds: [cell.id],
          gridColumnIndex: colIndex,
          isHeaderRepeat: false,
        };
      }
      cursor += span;
    }
  }
  return null;
}

function resolveExplicitRowAnchor(
  input: TableCommandPlannerInput,
  target: TableRowOccurrenceTarget
): ResolvedAnchor | null {
  if (target.sourceRevision !== input.storeRevision) return null;
  if (target.isHeaderRepeat) return null;
  const topo = readEditableTableTopology(input.part.root, target.tableId);
  if (!topo.ok) return null;
  const rowIndex = topo.topology.rows.findIndex((entry) => entry.row.id === target.rowId);
  if (rowIndex === -1) return null;
  const row = topo.topology.rows[rowIndex]!;
  const cell = row.cells[0];
  if (!cell) return null;
  return {
    tableId: target.tableId,
    rowId: target.rowId,
    cellId: cell.id,
    cellIds: [cell.id],
    gridColumnIndex: 0,
    isHeaderRepeat: false,
  };
}

function resolveExplicitColumnAnchor(
  input: TableCommandPlannerInput,
  target: TableColumnOccurrenceTarget
): ResolvedAnchor | null {
  if (target.sourceRevision !== input.storeRevision) return null;
  if (target.isHeaderRepeat) return null;
  const topo = readEditableTableTopology(input.part.root, target.tableId);
  if (!topo.ok) return null;
  return anchorForGridColumn(topo.topology, target.tableId, target.gridColumnId);
}

function validateOps(part: OoxmlPart, ops: readonly TreeDocOp[]): TableCommandPlan | null {
  for (const op of ops) {
    const rejection = validateTreeOp(part, op);
    if (rejection) return mapStoreRejection(rejection);
  }
  return null;
}

function planValidated(
  part: OoxmlPart,
  ops: readonly TreeDocOp[],
  selection: TableCommandSelectionPolicy
): TableCommandPlan {
  const invalid = validateOps(part, ops);
  if (invalid) return invalid;
  return { ok: true, ops, selection };
}

function lowerBorderSpec(
  spec: { style: string; size: number; color: ColorValue },
  themeColors: readonly DocumentThemeColorEntry[]
): { ok: true; spec: TableBorderSpecInput } | { ok: false; reason: string } {
  if (!(TABLE_BORDER_STYLES as readonly string[]).includes(spec.style)) {
    return { ok: false, reason: 'border style is not allowlisted' };
  }
  if (!Number.isInteger(spec.size) || spec.size < MIN_TABLE_BORDER_SIZE_EIGHTHS) {
    return { ok: false, reason: 'border size is out of range' };
  }
  if (spec.size > MAX_TABLE_BORDER_SIZE_EIGHTHS) {
    return { ok: false, reason: 'border size is out of range' };
  }
  const color = lowerColorValueForBorder(spec.color, themeColors);
  if (!color.ok) return { ok: false, reason: color.reason };
  return {
    ok: true,
    spec: {
      style: spec.style as TableBorderSpecInput['style'],
      size: spec.size,
      color: color.color,
    },
  };
}

function revalidateExplicitStoreTarget(
  input: Pick<TableCommandPlannerInput, 'part' | 'storeRevision'>,
  tableId: string,
  layoutSourceRevision: number
): TableCommandPlan | null {
  if (layoutSourceRevision !== input.storeRevision) {
    return refusal('invalidArgs', 'the table target is stale');
  }
  const topo = readEditableTableTopology(input.part.root, tableId);
  if (!topo.ok) return refusal('invalidArgs', 'the table target is no longer valid');
  return null;
}

function refuseRepeatedOccurrence(
  target: { readonly isHeaderRepeat: boolean } | null
): TableCommandPlan | null {
  if (target?.isHeaderRepeat) {
    return refusal('unsupported', 'repeated header rows cannot be edited');
  }
  return null;
}

function planResizeDivider(
  input: TableCommandPlannerInput,
  target: TableColumnDividerResizeTarget,
  leftWidthTwips: number,
  rightWidthTwips: number
): TableCommandPlan {
  const stale = revalidateExplicitStoreTarget(input, target.tableId, target.sourceRevision);
  if (stale) return stale;
  if (target.isHeaderRepeat) {
    return refusal('unsupported', 'repeated header rows cannot be edited');
  }
  if (!Number.isInteger(leftWidthTwips) || !Number.isInteger(rightWidthTwips)) {
    return refusal('invalidArgs', 'column widths must be whole twips');
  }
  if (
    leftWidthTwips < MIN_TABLE_COLUMN_WIDTH_TWIPS ||
    rightWidthTwips < MIN_TABLE_COLUMN_WIDTH_TWIPS
  ) {
    return refusal('invalidArgs', 'column widths are below the minimum');
  }
  const topo = readEditableTableTopology(input.part.root, target.tableId);
  if (!topo.ok) {
    const reason = topo.reason === 'duplicate-node-id' ? 'unknown-table' : topo.reason;
    return mapStoreRejection(reason);
  }
  const left = topo.topology.gridColumns.find((c) => c.id === target.leftGridColumnId);
  const right = topo.topology.gridColumns.find((c) => c.id === target.rightGridColumnId);
  if (!left || !right) return refusal('invalidArgs', 'the table target is no longer valid');
  const leftIndex = topo.topology.gridColumns.indexOf(left);
  const rightIndex = topo.topology.gridColumns.indexOf(right);
  if (Math.abs(rightIndex - leftIndex) !== 1) {
    return refusal('invalidArgs', 'the column divider target is not adjacent');
  }
  const op: TreeDocOp = {
    op: 'setTableColumnWidths',
    tableId: target.tableId,
    // Pointer targets use visual left/right; the store operates in document order.
    leftGridColumnId: leftIndex < rightIndex ? target.leftGridColumnId : target.rightGridColumnId,
    rightGridColumnId: leftIndex < rightIndex ? target.rightGridColumnId : target.leftGridColumnId,
    leftWidthTwips: leftIndex < rightIndex ? leftWidthTwips : rightWidthTwips,
    rightWidthTwips: leftIndex < rightIndex ? rightWidthTwips : leftWidthTwips,
  };
  return planValidated(input.part, [op], { kind: 'preserveSelection' });
}

function planResizeRightEdge(
  input: TableCommandPlannerInput,
  target: TableRightEdgeResizeTarget,
  columnWidthTwips: number,
  tableWidthTwips: number
): TableCommandPlan {
  const stale = revalidateExplicitStoreTarget(input, target.tableId, target.sourceRevision);
  if (stale) return stale;
  if (target.isHeaderRepeat) {
    return refusal('unsupported', 'repeated header rows cannot be edited');
  }
  if (!Number.isInteger(columnWidthTwips) || !Number.isInteger(tableWidthTwips)) {
    return refusal('invalidArgs', 'column widths must be whole twips');
  }
  if (columnWidthTwips < MIN_TABLE_COLUMN_WIDTH_TWIPS) {
    return refusal('invalidArgs', 'column widths are below the minimum');
  }
  const topo = readEditableTableTopology(input.part.root, target.tableId);
  if (!topo.ok) {
    const reason = topo.reason === 'duplicate-node-id' ? 'unknown-table' : topo.reason;
    return mapStoreRejection(reason);
  }
  const last = topo.topology.gridColumns[topo.topology.gridColumns.length - 1];
  if (!last || last.id !== target.gridColumnId) {
    return refusal('invalidArgs', 'the resize target is not the table right edge');
  }
  const op: TreeDocOp = {
    op: 'setTableRightEdgeWidth',
    tableId: target.tableId,
    gridColumnId: target.gridColumnId,
    columnWidthTwips,
    tableWidthTwips,
  };
  return planValidated(input.part, [op], { kind: 'preserveSelection' });
}

/** Plan a pointer-driven row-height resize without widening the public command surface. */
export function planTableRowHeightResize(
  input: Omit<TableCommandPlannerInput, 'command'>,
  target: TableRowOccurrenceTarget,
  heightTwips: number
): TableCommandPlan {
  if (input.viewing || !input.editable) {
    return refusal('locked', 'the document is open for viewing');
  }
  const stale = revalidateExplicitStoreTarget(input, target.tableId, target.sourceRevision);
  if (stale) return stale;
  if (target.isHeaderRepeat) {
    return refusal('unsupported', 'repeated header rows cannot be edited');
  }
  if (!Number.isInteger(heightTwips) || heightTwips < 20 || heightTwips > 31_680) {
    return refusal('invalidArgs', 'row height is outside the supported range');
  }
  const op: TreeDocOp = {
    op: 'setTableRowHeight',
    tableId: target.tableId,
    rowId: target.rowId,
    heightTwips,
  };
  return planValidated(input.part, [op], { kind: 'preserveSelection' });
}

export function planTableCommand(input: TableCommandPlannerInput): TableCommandPlan {
  plannerCallCount += 1;
  const { command, part, viewing, editable } = input;
  if (command.type === 'selectTableRegion') return planSelectTableRegion(input, command);

  if (viewing || !editable) {
    return refusal('locked', 'the document is open for viewing');
  }

  switch (command.type) {
    case 'toggleHeaderRow':
    case 'setTableProperties':
      return refusal(
        'unsupported',
        `command '${command.type}' is not supported by the tree editor`
      );
    default:
      break;
  }

  const shapeError = validateTableCommandShape(command);
  if (shapeError) return shapeError;

  const rowTarget = rowOccurrenceTargetOf(command);
  const columnTarget = columnOccurrenceTargetOf(command);
  const repeatedRefusal = refuseRepeatedOccurrence(rowTarget ?? columnTarget);
  if (repeatedRefusal) return repeatedRefusal;

  if (rowTarget) {
    const stale = revalidateExplicitStoreTarget(input, rowTarget.tableId, rowTarget.sourceRevision);
    if (stale) return stale;
  }
  if (columnTarget) {
    const stale = revalidateExplicitStoreTarget(
      input,
      columnTarget.tableId,
      columnTarget.sourceRevision
    );
    if (stale) return stale;
  }

  const anchor =
    rowTarget !== null
      ? resolveExplicitRowAnchor(input, rowTarget)
      : columnTarget !== null
        ? resolveExplicitColumnAnchor(input, columnTarget)
        : resolveAnchor(input);

  if (
    command.type !== 'commitTableColumnDividerResize' &&
    command.type !== 'commitTableRightEdgeResize' &&
    !anchor
  ) {
    if (rowTarget || columnTarget) {
      return refusal('invalidArgs', 'the table target is no longer valid');
    }
    return refusal('unsupported', 'the selection is not inside a table');
  }

  if (anchor?.isHeaderRepeat) {
    return refusal('unsupported', 'repeated header rows cannot be edited');
  }

  switch (command.type) {
    case 'mergeCells':
    case 'splitCell': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      const planned = cellStructureOp(command, anchor, input.cellSelection !== null);
      if (!planned.ok) return refusal(planned.code, planned.reason);
      const tracked = asSuggested(part, planned.op, input.suggestingAuthor);
      const invalid = validateOps(part, [tracked]);
      return invalid ?? { ok: true, ops: [planned.op], selection: { kind: 'adoptCommittedCaret' } };
    }
    case 'insertRow': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      // Beside the selection's outer row: below a cell merged down several rows is below its
      // last row, not inside the merge. An explicit occurrence target keeps its row.
      const rowId =
        (rowTarget ? null : outerRowOfSelection(part, anchor, command.where)) ?? anchor.rowId;
      const op: TreeDocOp = {
        op: 'insertTableRow',
        tableId: anchor.tableId,
        rowId,
        where: command.where,
      };
      return planValidated(part, [op], { kind: 'adoptCommittedCaret' });
    }
    case 'deleteRow': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      // EVERY row the selection covers. One op named the anchor's row alone, so a rectangle
      // spanning two rows lost one of them and the command still answered `ok: true`.
      const selectedRows = rowIdsOfSelection(part, anchor);
      const ops: TreeDocOp[] = selectedRows.wholeTable
        ? [{ op: 'deleteBlock', blockId: anchor.tableId }]
        : selectedRows.rowIds.map((rowId) => ({
            op: 'deleteTableRow',
            tableId: anchor.tableId,
            rowId,
            ...(rowId === anchor.rowId ? { referenceCellId: anchor.cellId } : {}),
          }));
      return planValidated(part, ops, { kind: 'adoptCommittedCaret' });
    }
    case 'insertColumn': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      const tableId = columnTarget?.tableId ?? anchor.tableId;
      const where = isVisualRtlTable(input.layout, tableId)
        ? command.where === 'left'
          ? 'right'
          : 'left'
        : command.where;
      // Beside the selection's outer column on that side: right of a merged cell is right of
      // the last column it spans, not inside it.
      const gridColumnId =
        columnTarget?.gridColumnId ??
        outerColumnOfSelection(part, anchor, where) ??
        anchor.gridColumnId ??
        gridColumnIdAt(part, tableId, anchor.gridColumnIndex);
      const op: TreeDocOp = gridColumnId
        ? {
            op: 'insertTableColumn',
            tableId,
            where,
            gridColumnId,
          }
        : {
            op: 'insertTableColumn',
            tableId,
            where,
            referenceCellId: anchor.cellId,
          };
      return planValidated(part, [op], { kind: 'adoptCommittedCaret' });
    }
    case 'deleteColumn': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      const tableId = columnTarget?.tableId ?? anchor.tableId;
      const gridColumnId =
        columnTarget?.gridColumnId ??
        anchor.gridColumnId ??
        gridColumnIdAt(part, tableId, anchor.gridColumnIndex);
      if (!gridColumnId) {
        return refusal('invalidArgs', 'the table has no grid column to delete');
      }
      // Every column the rectangle covers, for the reason Delete Rows states above. An
      // explicit occurrence target names one column on purpose and keeps it.
      const selectedColumns =
        columnTarget?.gridColumnId === undefined
          ? gridColumnIdsOfSelection(part, anchor)
          : { gridColumnIds: [gridColumnId], wholeTable: false };
      if (selectedColumns.wholeTable) {
        return planValidated(part, [{ op: 'deleteBlock', blockId: tableId }], {
          kind: 'adoptCommittedCaret',
        });
      }
      const ids =
        selectedColumns.gridColumnIds.length > 0 ? selectedColumns.gridColumnIds : [gridColumnId];
      const ops: TreeDocOp[] = ids.map((id) => ({
        op: 'deleteTableColumn',
        tableId,
        gridColumnId: id,
      }));
      return planValidated(part, ops, { kind: 'adoptCommittedCaret' });
    }
    case 'deleteTable': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      const op: TreeDocOp = { op: 'deleteBlock', blockId: anchor.tableId };
      return planValidated(part, [op], { kind: 'adoptCommittedCaret' });
    }
    case 'setCellFill': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      let storeColor: TreeDocColorValue | null;
      if (command.color === null) {
        storeColor = null;
      } else {
        const lowered = lowerColorValueForFill(command.color, input.themeColors);
        if (!lowered.ok) return refusal('invalidArgs', lowered.reason);
        storeColor = lowered.color;
      }
      const op: TreeDocOp = {
        op: 'setTableCellFill',
        tableId: anchor.tableId,
        cellIds: anchor.cellIds,
        color: storeColor,
      };
      return planValidated(part, [op], { kind: 'preserveSelection' });
    }
    case 'setTableCellVerticalAlignment': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      const op: TreeDocOp = {
        op: 'setTableCellVerticalAlignment',
        tableId: anchor.tableId,
        cellIds: anchor.cellIds,
        alignment: command.alignment,
      };
      return planValidated(part, [op], { kind: 'preserveSelection' });
    }
    case 'setTableBorders': {
      if (!anchor) return refusal('unsupported', 'the selection is not inside a table');
      if (command.scope === 'none') {
        const op: TreeDocOp = {
          op: 'setTableCellBorders',
          tableId: anchor.tableId,
          cellIds: anchor.cellIds,
          scope: 'none',
          target: visualBorderTarget(
            command.target as TableBorderEdgeTarget,
            isVisualRtlTable(input.layout, anchor.tableId)
          ),
        };
        return planValidated(part, [op], { kind: 'preserveSelection' });
      }
      const lowered = lowerBorderSpec(command.spec, input.themeColors);
      if (!lowered.ok) return refusal('invalidArgs', lowered.reason);
      const op: TreeDocOp = {
        op: 'setTableCellBorders',
        tableId: anchor.tableId,
        cellIds: anchor.cellIds,
        scope: visualBorderTarget(command.scope, isVisualRtlTable(input.layout, anchor.tableId)),
        spec: lowered.spec,
      };
      return planValidated(part, [op], { kind: 'preserveSelection' });
    }
    case 'commitTableColumnDividerResize':
      return planResizeDivider(
        input,
        command.target,
        command.leftWidthTwips,
        command.rightWidthTwips
      );
    case 'commitTableRightEdgeResize':
      return planResizeRightEdge(
        input,
        command.target,
        command.columnWidthTwips,
        command.tableWidthTwips
      );
    default:
      return refusal('unsupported', `command '${command.type}' is not a table command`);
  }
}

export function tableCommandCanSupport(command: EditorCommand): {
  supported: boolean;
  reason?: string;
} {
  if (!isTableEditorCommand(command)) {
    return { supported: false, reason: `command '${command.type}' is not a table command` };
  }
  switch (command.type) {
    case 'toggleHeaderRow':
    case 'setTableProperties':
      return {
        supported: false,
        reason: `command '${command.type}' is not supported by the tree editor`,
      };
    default:
      return { supported: true };
  }
}
