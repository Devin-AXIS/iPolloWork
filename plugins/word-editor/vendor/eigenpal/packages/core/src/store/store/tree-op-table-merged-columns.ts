// Column insertion and deletion in a table with merged cells.
//
// A table with `w:gridSpan` or `w:vMerge` cells is placed on its grid first. Inserting a
// column at a grid boundary widens every cell that spans across it and gives every other row
// a new cell there; the new cells copy the vertical merge of the cell beside them, so a merged
// column gains a merged neighbor. Deleting a column narrows every cell that spans more than it
// and removes the cells that cover only it.
//
// A row that ends early, as concurrent structure edits can leave one, keeps ending there.
// Tables the grid cannot place stay refused: a legacy `w:hMerge`, authored `w:gridBefore` or
// `w:gridAfter` gaps, and a missing `w:tblGrid`.

import { createNodeIdAllocator, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
  OoxmlTableCellNode,
  OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { usedParaIds } from '../package/para-id.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import { readEditableTableTopology } from './tree-op-table-topology.ts';
import { paragraphIdsWithin } from './tree-op-blocks.ts';
import { fromEdit, TEXT_DEPS } from './tree-op-nodes.ts';
import type { PlacedCell } from './tree-op-table-cell-properties.ts';
import {
  cellPropertiesFor,
  cellWithProperties,
  gridWidthOver,
  readMergeableTable,
  type MergeableTable,
} from './tree-op-table-cell-shape.ts';
import { insertedCellParagraphContent } from './tree-op-table-row-paragraph.ts';
import { isWmlGridCol, wmlChildNamed } from './tree-op-table-shared.ts';
import {
  COLUMN_SAFE_TCPR_LEAVES,
  copySafePropertyContainer,
  emptyParagraph,
  freshGridCol,
  freshTableCell,
  tableWithDeclaredWmlBinding,
} from './tree-op-tables.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

type ColumnOp = Extract<TreeDocOp, { op: 'insertTableColumn' | 'deleteTableColumn' }>;

/** Whether the column op addresses a table with `w:gridSpan` or `w:vMerge` and no `w:hMerge`. */
export function addressesMergedColumns(part: OoxmlPart, op: ColumnOp): boolean {
  if (typeof op.tableId !== 'string') return false;
  const read = readEditableTableTopology(part.root, op.tableId);
  if (!read.ok) return false;
  let merged = false;
  for (const { cells } of read.topology.rows) {
    for (const cell of cells) {
      const tcPr = wmlChildNamed(cell, 'tcPr');
      if (!tcPr) continue;
      if (wmlChildNamed(tcPr, 'hMerge')) return false;
      if (wmlChildNamed(tcPr, 'gridSpan') || wmlChildNamed(tcPr, 'vMerge')) merged = true;
    }
  }
  return merged;
}

interface ColumnPlan {
  readonly table: MergeableTable;
  /** The grid column the op names. */
  readonly column: number;
  /** For an insert, the boundary the new column goes in front of. */
  readonly boundary: number;
}

function planColumn(
  part: OoxmlPart,
  op: ColumnOp
):
  | { readonly ok: true; readonly plan: ColumnPlan }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  if (op.op === 'insertTableColumn' && op.where !== 'left' && op.where !== 'right') {
    return { ok: false, reason: 'invalidArgs' };
  }
  const gridColumnId = (op as { gridColumnId?: unknown }).gridColumnId;
  if (typeof gridColumnId !== 'string' || gridColumnId.length === 0) {
    // A merged table without `w:tblGrid` has no column ids to address.
    return { ok: false, reason: 'unknown-grid-column' };
  }
  const read = readMergeableTable(part, op.tableId);
  if (!read.ok) return read;
  const { table } = read;
  if (!table.topology.grid) return { ok: false, reason: 'unknown-grid-column' };
  // A grid that is shorter than its cells, or has unreadable widths, cannot place them.
  if (!table.gridWidths) return { ok: false, reason: 'row-hides-cell' };
  const column = table.topology.gridColumns.findIndex((col) => col.id === gridColumnId);
  if (column === -1) return { ok: false, reason: 'unknown-grid-column' };
  const last = table.gridWidths.length - 1;
  for (let rowIndex = 0; rowIndex < table.topology.rows.length; rowIndex += 1) {
    const cells = table.index.byRow.get(rowIndex) ?? [];
    const trPr = wmlChildNamed(table.topology.rows[rowIndex]!.row, 'trPr');
    // A row starts at the first grid column. It can end early, as concurrent structure edits
    // can leave it, but an authored gap is a count this edit would have to rewrite.
    if (
      cells.length === 0 ||
      cells[0]!.startCol !== 0 ||
      (trPr && (wmlChildNamed(trPr, 'gridBefore') || wmlChildNamed(trPr, 'gridAfter')))
    ) {
      return { ok: false, reason: 'row-hides-cell' };
    }
    // Deleting the only cell of a short row would leave the row with none.
    if (
      op.op === 'deleteTableColumn' &&
      cells.length === 1 &&
      cells[0]!.span === 1 &&
      column === 0
    ) {
      return { ok: false, reason: 'block-required' };
    }
  }
  if (op.op === 'deleteTableColumn') {
    if (last === 0) return { ok: false, reason: 'block-required' };
    return { ok: true, plan: { table, column, boundary: column } };
  }
  if (last + 2 > table.limits.maxColumns) return { ok: false, reason: 'resource-limit' };
  return { ok: true, plan: { table, column, boundary: op.where === 'left' ? column : column + 1 } };
}

export function validateMergedColumnOp(part: OoxmlPart, op: ColumnOp): TreeOpRejection | null {
  const planned = planColumn(part, op);
  return planned.ok ? null : planned.reason;
}

function firstParagraphIdOf(cell: OoxmlTableCellNode): string | undefined {
  return cell.children.find((child) => child.kind === 'paragraph')?.id;
}

function covering(cells: readonly PlacedCell[], column: number): PlacedCell | undefined {
  return cells.find((entry) => entry.startCol <= column && entry.endCol >= column);
}

/** The cell with `span` columns, its width the grid's over them: a declared width can disagree. */
function withSpan(
  table: MergeableTable,
  entry: PlacedCell,
  span: number,
  deltaTwips: number,
  nextId: () => string,
  wml: ReturnType<typeof wmlFreshNamespaceContextAt>
): OoxmlTableCellNode {
  const width = gridWidthOver(table, entry.startCol, entry.endCol);
  const tcPr = cellPropertiesFor(
    wmlChildNamed(entry.cell, 'tcPr'),
    { span, vMerge: entry.vMergeKind, widthTwips: width === null ? null : width + deltaTwips },
    nextId,
    wml
  );
  return cellWithProperties(entry.cell, tcPr);
}

export function applyMergedColumnOp(
  part: OoxmlPart,
  op: ColumnOp,
  options?: EditOptions
): TreeOpResult {
  const planned = planColumn(part, op);
  if (!planned.ok) return { ok: false, reason: planned.reason };
  const { table, column, boundary } = planned.plan;
  const { topology } = table;
  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const nextId = createNodeIdAllocator(part);
  const used = new Set(usedParaIds(part.root));
  const tableNode = tableWithDeclaredWmlBinding(topology.table, part, wml);
  const width = table.gridWidths![column]!;
  const inserting = op.op === 'insertTableColumn';
  const created: string[] = [];
  const deleted: string[] = [];
  const dirty = new Set<string>([topology.table.id, topology.grid!.id]);
  let caret: string | undefined;

  const rows = new Map<string, OoxmlTableRowNode>();
  topology.rows.forEach((entry, rowIndex) => {
    const cells = table.index.byRow.get(rowIndex)!;
    const changed = new Map<string, OoxmlTableCellNode | null>();
    let insertBefore: string | null = null;
    let fresh: OoxmlTableCellNode | null = null;
    if (inserting) {
      const across = cells.find((cell) => cell.startCol < boundary && cell.endCol >= boundary);
      const rowEnd = cells.at(-1)!.endCol;
      if (across)
        changed.set(across.cell.id, withSpan(table, across, across.span + 1, width, nextId, wml));
      else if (boundary <= rowEnd + 1) {
        // A short row ending before the boundary keeps ending there; at its end it grows.
        const beside = covering(cells, column) ?? cells.at(-1)!;
        const own = wmlChildNamed(beside.cell, 'tcPr');
        const copied = own
          ? copySafePropertyContainer(own, COLUMN_SAFE_TCPR_LEAVES, nextId, wml)
          : null;
        const tcPr = cellPropertiesFor(
          copied ?? undefined,
          { span: 1, vMerge: beside.vMergeKind, widthTwips: width },
          nextId,
          wml
        );
        const content = insertedCellParagraphContent(beside.cell, nextId, wml);
        const paragraph = emptyParagraph(
          part,
          tableNode,
          nextId,
          `${beside.cell.id}:col`,
          used,
          wml,
          content
        );
        fresh = freshTableCell(nextId, [tcPr, paragraph], wml) as OoxmlTableCellNode;
        created.push(fresh.id, paragraph.id);
        if (caret === undefined && beside.vMergeKind !== 'continue') caret = paragraph.id;
        insertBefore = cells.find((cell) => cell.startCol === boundary)?.cell.id ?? null;
      }
    } else {
      const cell = covering(cells, column);
      // A short row that ends before the column loses nothing.
      if (!cell) {
        if (rowIndex === 0) caret = firstParagraphIdOf(cells[0]!.cell);
        rows.set(entry.row.id, entry.row);
        return;
      }
      let landing = cell;
      if (cell.span > 1)
        changed.set(cell.cell.id, withSpan(table, cell, cell.span - 1, -width, nextId, wml));
      else {
        changed.set(cell.cell.id, null);
        deleted.push(cell.cell.id, ...paragraphIdsWithin(cell.cell));
        landing = cells.find((other) => other.startCol > column) ?? cells.at(-2)!;
      }
      // The caret lands where the deleted column was, in the first row.
      if (rowIndex === 0) caret = firstParagraphIdOf(landing.cell);
    }
    const children: OoxmlNode[] = [];
    for (const child of entry.row.children) {
      if (fresh && child.id === insertBefore) children.push(fresh);
      if (!changed.has(child.id)) children.push(child);
      else if (changed.get(child.id)) {
        children.push(changed.get(child.id)!);
        dirty.add(child.id);
      }
    }
    if (fresh && insertBefore === null) children.push(fresh);
    rows.set(entry.row.id, Object.freeze({ ...entry.row, children }) as OoxmlTableRowNode);
    dirty.add(entry.row.id);
  });

  const gridChildren: OoxmlNode[] = [];
  let gridIndex = 0;
  for (const child of topology.grid!.children) {
    if (!isWmlGridCol(child)) {
      gridChildren.push(child);
      continue;
    }
    if (inserting && gridIndex === boundary) {
      const col = freshGridCol(nextId, wml, String(width));
      created.push(col.id);
      gridChildren.push(col);
    }
    if (inserting || gridIndex !== column) gridChildren.push(child);
    else deleted.push(child.id);
    gridIndex += 1;
  }
  if (inserting && boundary === gridIndex) {
    const col = freshGridCol(nextId, wml, String(width));
    created.push(col.id);
    gridChildren.push(col);
  }
  const grid = Object.freeze({ ...topology.grid!, children: gridChildren }) as OoxmlElement;
  const children = tableNode.children.map((child) =>
    child.id === grid.id ? grid : (rows.get(child.id) ?? child)
  );
  const next = Object.freeze({ ...tableNode, children }) as OoxmlElement;

  return fromEdit(replaceNode(part, topology.table.id, next, options), {
    dirty: [...dirty],
    created,
    deleted,
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    ...(caret ? { caret: { paragraphId: caret } } : {}),
  });
}
