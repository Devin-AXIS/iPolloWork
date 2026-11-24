import { createTableReadCache } from './table-read-cache.ts';
// Bounded direct-child table topology for store validation (table-editing task 2).
//
// Walks only `w:tbl -> w:tr -> w:tc`, counting visited nodes before allocating result
// arrays. Merge topology is recorded for operation-specific validation rather than refused
// universally — row insertion may proceed beside unrelated vertical merges.

import {
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlTableCellNode,
  type OoxmlTableGridNode,
  type OoxmlTableNode,
  type OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import {
  DEFAULT_TABLE_TOPOLOGY_LIMITS,
  MAX_TABLE_COLUMNS,
  resolveTableTopologyLimits,
  type TableTopologyLimits,
} from './table-constraints.ts';
import {
  isWmlElement,
  isWmlGridCol,
  wmlAttributeValue,
  wmlChildNamed,
} from './tree-op-table-shared.ts';
import { cachedUniqueNode } from '../package/ooxml-edit.ts';
import { healedTableView } from './tree-op-table-heal.ts';

export interface EditableTableTopology {
  readonly table: OoxmlTableNode;
  /** Absent when the authored table omits `w:tblGrid` (common in Word exports). */
  readonly grid: OoxmlTableGridNode | undefined;
  readonly gridColumns: readonly OoxmlElement[];
  readonly rows: readonly {
    readonly row: OoxmlTableRowNode;
    readonly cells: readonly OoxmlTableCellNode[];
  }[];
  readonly hasMerge: boolean;
}

export type TableTopologyRejection =
  'unknown-table' | 'duplicate-property-container' | 'duplicate-node-id' | 'resource-limit';

export type EditableTableTopologyResult =
  | { readonly ok: true; readonly topology: EditableTableTopology }
  | { readonly ok: false; readonly reason: TableTopologyRejection; readonly detail?: string };

function hasDuplicateWmlProperty(container: OoxmlElement, localName: string): boolean {
  let seen = false;
  for (const child of container.children) {
    if (!isWmlElement(child, localName)) continue;
    if (seen) return true;
    seen = true;
  }
  return false;
}

function readGridSpan(cellProperties: OoxmlElement | undefined): number {
  const raw = cellProperties && wmlChildNamed(cellProperties, 'gridSpan');
  const value = raw && wmlAttributeValue(raw, 'val');
  if (!value || !/^\d{1,7}$/.test(value)) return 1;
  const span = Number(value);
  return Number.isInteger(span) && span > 1 ? Math.min(span, MAX_TABLE_COLUMNS) : 1;
}

function cellHasVMerge(cellProperties: OoxmlElement | undefined): boolean {
  return cellProperties !== undefined && wmlChildNamed(cellProperties, 'vMerge') !== undefined;
}

function cellHasHMerge(cellProperties: OoxmlElement | undefined): boolean {
  return cellProperties !== undefined && wmlChildNamed(cellProperties, 'hMerge') !== undefined;
}

function cellHasMerge(cell: OoxmlTableCellNode): boolean {
  const tcPr = wmlChildNamed(cell, 'tcPr');
  return readGridSpan(tcPr) > 1 || cellHasVMerge(tcPr) || cellHasHMerge(tcPr);
}

function countWmlGridColumns(grid: OoxmlTableGridNode): number {
  let count = 0;
  for (const child of grid.children) {
    if (isWmlGridCol(child)) count += 1;
  }
  return count;
}

function collectWmlGridColumns(grid: OoxmlTableGridNode, columnCount: number): OoxmlElement[] {
  const cols: OoxmlElement[] = [];
  for (const child of grid.children) {
    if (!isWmlGridCol(child)) continue;
    cols.push(child);
    if (cols.length >= columnCount) break;
  }
  return cols;
}

function hasDuplicateWmlGridColumnIds(grid: OoxmlTableGridNode): boolean {
  const seen = new Set<string>();
  for (const child of grid.children) {
    if (!isWmlGridCol(child)) continue;
    if (seen.has(child.id)) return true;
    seen.add(child.id);
  }
  return false;
}

function countDirectRows(table: OoxmlTableNode): number {
  let count = 0;
  for (const child of table.children) {
    if (child.kind === 'tableRow') count += 1;
  }
  return count;
}

function countDirectCells(row: OoxmlTableRowNode): number {
  let count = 0;
  for (const child of row.children) {
    if (child.kind === 'tableCell') count += 1;
  }
  return count;
}

function reject(reason: TableTopologyRejection, detail?: string): EditableTableTopologyResult {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

type LookupResult =
  | { readonly ok: true; readonly node: OoxmlNode }
  | { readonly ok: false; readonly reason: TableTopologyRejection; readonly detail?: string };

/** Iterative, budgeted lookup that rejects duplicate ids and stack recursion. */
function lookupNodeById(
  root: OoxmlElement,
  nodeId: string,
  maxTraversalNodes: number
): LookupResult {
  const stack: OoxmlNode[] = [root];
  let visits = 0;
  let match: OoxmlNode | undefined;

  while (stack.length > 0) {
    if (visits >= maxTraversalNodes) {
      return { ok: false, reason: 'resource-limit', detail: 'traversal' };
    }
    const node = stack.pop()!;
    visits += 1;
    if (node.id === nodeId) {
      if (match !== undefined) {
        return { ok: false, reason: 'duplicate-node-id', detail: nodeId };
      }
      match = node;
    }
    if (node.kind === 'textValue') continue;

    const childCount = node.children.length;
    const pendingCapacity = maxTraversalNodes - visits - stack.length;
    if (childCount > pendingCapacity) {
      return { ok: false, reason: 'resource-limit', detail: 'traversal' };
    }

    for (let index = childCount - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]!);
    }
  }

  if (match === undefined) return { ok: false, reason: 'unknown-table', detail: nodeId };
  return { ok: true, node: match };
}

const cachedTopology = createTableReadCache<OoxmlNode, EditableTableTopologyResult>();

/**
 * Read the bounded direct-child topology of one typed table node.
 *
 * Only `w:tr` and direct `w:tc` descendants participate. Nested tables inside cells remain
 * independent. Hostile row/column counts are bounded before any result arrays are allocated.
 */
export function readEditableTableTopology(
  root: OoxmlElement,
  tableId: string,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): EditableTableTopologyResult {
  const resolved = resolveTableTopologyLimits(limits);
  const table = cachedUniqueNode(root, tableId);
  // Only an existing unique-id index proves that another root has the same target.
  // Keep one revision under its stable properties, never one per undo-history root.
  const owner = table?.kind === 'table' ? wmlChildNamed(table, 'tblPr') : undefined;
  if (!owner || !table) return readTableTopology(root, tableId, resolved);
  return cachedTopology(owner, table, resolved, () => readTableTopology(root, tableId, resolved));
}

function readTableTopology(
  root: OoxmlElement,
  tableId: string,
  limits: TableTopologyLimits = DEFAULT_TABLE_TOPOLOGY_LIMITS
): EditableTableTopologyResult {
  const resolved = resolveTableTopologyLimits(limits);
  // The editor already indexes the whole part. Bound the addressed subtree instead
  // of rejecting a small table because unrelated document content exceeds the budget.
  const cached = cachedUniqueNode(root, tableId);
  if (cached === null) return reject('unknown-table', tableId);
  const lookup = lookupNodeById(
    cached && cached.kind !== 'textValue' ? cached : root,
    tableId,
    resolved.maxTraversalNodes
  );
  if (!lookup.ok) return reject(lookup.reason, lookup.detail);

  const target = lookup.node;
  if (target.kind !== 'table') return reject('unknown-table', tableId);

  // The table a table edit acts on: one that heals its repeated containers first.
  const table = healedTableView(target);
  if (hasDuplicateWmlProperty(table, 'tblPr')) {
    return reject('duplicate-property-container', 'tblPr');
  }
  if (hasDuplicateWmlProperty(table, 'tblGrid')) {
    return reject('duplicate-property-container', 'tblGrid');
  }

  const gridNode = wmlChildNamed(table, 'tblGrid');
  const grid = gridNode?.kind === 'tableGrid' ? gridNode : undefined;
  if (gridNode !== undefined && grid === undefined) {
    return reject('duplicate-property-container', 'tblGrid');
  }
  if (grid && hasDuplicateWmlGridColumnIds(grid)) {
    return reject('duplicate-node-id', 'gridCol');
  }

  const rowCount = countDirectRows(table);
  if (rowCount > resolved.maxRows) return reject('resource-limit', 'maxRows');

  let maxCellsInRow = 0;
  for (const child of table.children) {
    if (child.kind !== 'tableRow') continue;
    if (hasDuplicateWmlProperty(child, 'trPr')) {
      return reject('duplicate-property-container', 'trPr');
    }
    const cellCount = countDirectCells(child);
    if (cellCount > maxCellsInRow) maxCellsInRow = cellCount;
    for (const cellChild of child.children) {
      if (cellChild.kind !== 'tableCell') continue;
      if (hasDuplicateWmlProperty(cellChild, 'tcPr')) {
        return reject('duplicate-property-container', 'tcPr');
      }
    }
  }

  const gridColumnCount = grid ? countWmlGridColumns(grid) : 0;
  if (gridColumnCount > resolved.maxColumns || maxCellsInRow > resolved.maxColumns) {
    return reject('resource-limit', 'maxColumns');
  }

  const gridCols = grid ? collectWmlGridColumns(grid, gridColumnCount) : [];

  const rows: { row: OoxmlTableRowNode; cells: OoxmlTableCellNode[] }[] = [];
  let hasMerge = false;

  for (const child of table.children) {
    if (child.kind !== 'tableRow') continue;
    const cells: OoxmlTableCellNode[] = [];
    for (const cellChild of child.children) {
      if (cellChild.kind !== 'tableCell') continue;
      if (cellHasMerge(cellChild)) hasMerge = true;
      cells.push(cellChild);
    }
    rows.push({ row: child, cells });
  }

  return {
    ok: true,
    topology: {
      table,
      grid,
      gridColumns: gridCols,
      rows,
      hasMerge,
    },
  };
}
