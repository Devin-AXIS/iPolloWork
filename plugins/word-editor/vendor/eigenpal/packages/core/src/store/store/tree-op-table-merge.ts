// Merge table cells that cover one rectangle into its top-left cell.
//
// The rectangle is the union of the addressed visual cells, so a caller may name a merged cell
// by any of its parts. A cell that crosses the rectangle's edge makes it ragged, and the merge
// is refused rather than grown, because growing it would merge cells nobody selected.
//
// The top-left cell takes `w:gridSpan` for the columns and `w:vMerge="restart"` for the rows;
// the first cell of each lower row becomes its `w:vMerge` continuation and every other cell in
// the rectangle goes. The merged cell holds the blocks of every cell that had content, in
// reading order, moved with their node ids. Blank cells add nothing, so merging an empty
// column into a filled one does not leave empty paragraphs behind.

import { createNodeIdAllocator, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import type {
  OoxmlNode,
  OoxmlPart,
  OoxmlTableCellNode,
  OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { usedParaIds } from '../package/para-id.ts';
import { wmlFreshNamespaceContextAt } from '../package/wml-namespace.ts';
import type { TableTopologyLimits } from './table-constraints.ts';
import { paragraphIdsWithin } from './tree-op-blocks.ts';
import { fromEdit, TEXT_DEPS } from './tree-op-nodes.ts';
import type { PlacedCell } from './tree-op-table-cell-properties.ts';
import {
  cellBlocks,
  cellIsBlank,
  cellPropertiesFor,
  cellWithProperties,
  declaredDxaWidth,
  gridWidthOver,
  readMergeableTable,
  visualCellOf,
  type MergeableTable,
} from './tree-op-table-cell-shape.ts';
import {
  cellBlocksStructureEdit,
  freshCellJoiningInsertion,
  paragraphJoiningInsertion,
} from './tree-op-table-pending-insertion.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import { insertedCellParagraphContent } from './tree-op-table-row-paragraph.ts';
import { wmlChildNamed } from './tree-op-table-shared.ts';
import {
  COLUMN_SAFE_TCPR_LEAVES,
  copySafePropertyContainer,
  emptyParagraph,
  freshTableCell,
  tableWithDeclaredWmlBinding,
} from './tree-op-tables.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

type MergeTableCellsOp = Extract<TreeDocOp, { op: 'mergeTableCells' }>;

interface MergePlan {
  readonly table: MergeableTable;
  readonly rowFrom: number;
  readonly rowTo: number;
  readonly colFrom: number;
  readonly colTo: number;
  /** Cells inside the rectangle, row by row, each row left to right. */
  readonly rows: readonly (readonly PlacedCell[])[];
}

function readCellIds(op: MergeTableCellsOp): readonly string[] | null {
  const ids: unknown = op.cellIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return null;
    seen.add(id);
  }
  return ids as readonly string[];
}

function planMerge(
  part: OoxmlPart,
  op: MergeTableCellsOp,
  limits?: TableTopologyLimits,
  checkRevisions = true
):
  | { readonly ok: true; readonly plan: MergePlan }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  const ids = readCellIds(op);
  if (!ids) return { ok: false, reason: 'invalidArgs' };
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision))
    return { ok: false, reason: 'invalid-property-value' };
  const read = readMergeableTable(part, op.tableId, limits);
  if (!read.ok) return read;
  const { table } = read;
  if (ids.length > table.index.placed.length) return { ok: false, reason: 'invalidArgs' };

  let rowFrom = Number.POSITIVE_INFINITY;
  let rowTo = -1;
  let colFrom = Number.POSITIVE_INFINITY;
  let colTo = -1;
  for (const id of ids) {
    const entry = table.index.byId.get(id);
    if (!entry) return { ok: false, reason: 'invalidArgs' };
    const visual = visualCellOf(table, entry);
    rowFrom = Math.min(rowFrom, visual.rowFrom);
    rowTo = Math.max(rowTo, visual.rowTo);
    colFrom = Math.min(colFrom, visual.colFrom);
    colTo = Math.max(colTo, visual.colTo);
  }

  const rows: PlacedCell[][] = [];
  const owners = new Set<string>();
  for (let rowIndex = rowFrom; rowIndex <= rowTo; rowIndex += 1) {
    const inside: PlacedCell[] = [];
    let covered = 0;
    for (const entry of table.index.byRow.get(rowIndex) ?? []) {
      if (entry.endCol < colFrom || entry.startCol > colTo) continue;
      const visual = visualCellOf(table, entry);
      if (
        visual.colFrom < colFrom ||
        visual.colTo > colTo ||
        visual.rowFrom < rowFrom ||
        visual.rowTo > rowTo
      ) {
        return { ok: false, reason: 'cells-not-rectangle' };
      }
      if (checkRevisions && cellBlocksStructureEdit(table, entry, op.revision?.author))
        return { ok: false, reason: 'cell-has-revision' };
      inside.push(entry);
      owners.add(visual.owner.cell.id);
      covered += entry.span;
    }
    // A short row or a `w:gridBefore`/`w:gridAfter` gap leaves part of the rectangle empty.
    if (covered !== colTo - colFrom + 1) return { ok: false, reason: 'cells-not-rectangle' };
    rows.push(inside);
  }
  if (owners.size < 2) return { ok: false, reason: 'cells-not-rectangle' };
  return { ok: true, plan: { table, rowFrom, rowTo, colFrom, colTo, rows } };
}

export function validateMergeTableCells(
  part: OoxmlPart,
  op: MergeTableCellsOp,
  limits?: TableTopologyLimits
): TreeOpRejection | null {
  const planned = planMerge(part, op, limits);
  return planned.ok ? null : planned.reason;
}

/**
 * The cell a merge of `cellIds` merges into, or why its rectangle would be refused. Pending
 * revisions are left to the merge itself, which knows whether it is tracked.
 */
export function mergeTargetCell(
  part: OoxmlPart,
  tableId: string,
  cellIds: readonly string[]
):
  | { readonly ok: true; readonly cellId: string }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  const planned = planMerge(part, { op: 'mergeTableCells', tableId, cellIds }, undefined, false);
  return planned.ok ? { ok: true, cellId: planned.plan.rows[0]![0]!.cell.id } : planned;
}

function mergedWidth(plan: MergePlan): number | null {
  const fromGrid = gridWidthOver(plan.table, plan.colFrom, plan.colTo);
  if (fromGrid !== null) return fromGrid;
  let sum = 0;
  for (const entry of plan.rows[0]!) {
    const width = declaredDxaWidth(entry.cell);
    if (width === null) return null;
    sum += width;
  }
  return sum;
}

export function applyMergeTableCells(
  part: OoxmlPart,
  op: MergeTableCellsOp,
  options?: EditOptions,
  limits?: TableTopologyLimits
): TreeOpResult {
  const planned = planMerge(part, op, limits);
  if (!planned.ok) return { ok: false, reason: planned.reason };
  const { plan } = planned;
  const { topology } = plan.table;
  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const nextId = createNodeIdAllocator(part);
  const used = new Set(usedParaIds(part.root));
  const tableNode = tableWithDeclaredWmlBinding(topology.table, part, wml);
  const span = plan.colTo - plan.colFrom + 1;
  const height = plan.rowTo - plan.rowFrom + 1;
  const width = mergedWidth(plan);

  const head = plan.rows[0]![0]!;
  const filled = plan.rows.flat().filter((entry) => !cellIsBlank(entry.cell));
  const movedFrom = new Set(filled.map((entry) => entry.cell.id));
  const headBlocks: OoxmlNode[] =
    filled.length === 0 ? cellBlocks(head.cell) : filled.flatMap((entry) => cellBlocks(entry.cell));
  const created: string[] = [];
  const deleted: string[] = [];
  // A blank head gives way to the content moved into it.
  if (filled.length > 0 && !movedFrom.has(head.cell.id))
    deleted.push(...paragraphIdsWithin(head.cell));
  // Inside a pending table insertion, every new cell and paragraph mark joins that insertion.
  const joining = op.revision !== undefined;
  if (headBlocks.at(-1)?.kind !== 'paragraph') {
    const fresh = emptyParagraph(part, tableNode, nextId, `${head.cell.id}:merge:end`, used, wml);
    const end = joining ? paragraphJoiningInsertion(fresh, head.cell, nextId, wml) : fresh;
    headBlocks.push(end);
    created.push(end.id);
  }
  const replacements = new Map<string, OoxmlTableCellNode | null>();
  plan.rows.forEach((inside, offset) => {
    const [first, ...rest] = inside;
    const shape = {
      span,
      vMerge:
        height === 1
          ? ('none' as const)
          : offset === 0
            ? ('restart' as const)
            : ('continue' as const),
      widthTwips: width,
    };
    const tcPr = cellPropertiesFor(wmlChildNamed(first!.cell, 'tcPr'), shape, nextId, wml);
    if (offset === 0) {
      replacements.set(first!.cell.id, cellWithProperties(first!.cell, tcPr, headBlocks));
    } else if (movedFrom.has(first!.cell.id)) {
      // Its blocks moved into the head, so a fresh cell takes its place as the continuation.
      // Keeping the cell while its blocks leave it reads, to a replica, as removing those
      // blocks after they moved: the shared document would delete them from the head too.
      const own = wmlChildNamed(first!.cell, 'tcPr');
      const copied = own
        ? copySafePropertyContainer(own, COLUMN_SAFE_TCPR_LEAVES, nextId, wml)
        : null;
      const freshTcPr = cellPropertiesFor(copied ?? undefined, shape, nextId, wml);
      const content = insertedCellParagraphContent(first!.cell, nextId, wml);
      const paragraph = emptyParagraph(
        part,
        tableNode,
        nextId,
        `${first!.cell.id}:merge`,
        used,
        wml,
        content
      );
      const fresh = freshTableCell(nextId, [freshTcPr, paragraph], wml) as OoxmlTableCellNode;
      const continuation = joining
        ? freshCellJoiningInsertion(fresh, first!.cell, nextId, wml)
        : fresh;
      created.push(continuation.id, paragraph.id);
      deleted.push(first!.cell.id);
      replacements.set(first!.cell.id, continuation);
    } else {
      replacements.set(first!.cell.id, cellWithProperties(first!.cell, tcPr));
    }
    for (const entry of rest) {
      replacements.set(entry.cell.id, null);
      deleted.push(entry.cell.id);
      if (!movedFrom.has(entry.cell.id)) deleted.push(...paragraphIdsWithin(entry.cell));
    }
  });

  const rowIds = new Set(plan.rows.map((inside) => topology.rows[inside[0]!.rowIndex]!.row.id));
  const children = tableNode.children.map((child) => {
    if (child.kind !== 'tableRow' || !rowIds.has(child.id)) return child;
    const cells: OoxmlNode[] = [];
    for (const cell of child.children) {
      if (!replacements.has(cell.id)) cells.push(cell);
      else if (replacements.get(cell.id)) cells.push(replacements.get(cell.id)!);
    }
    return Object.freeze({ ...child, children: cells }) as OoxmlTableRowNode;
  });
  const merged = Object.freeze({ ...tableNode, children }) as typeof tableNode;

  const caret = headBlocks.find((block) => block.kind === 'paragraph')!;
  return fromEdit(replaceNode(part, topology.table.id, merged, options), {
    dirty: [
      topology.table.id,
      ...rowIds,
      ...[...replacements].filter(([id, cell]) => cell?.id === id).map(([id]) => id),
    ],
    created,
    deleted,
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    caret: { paragraphId: caret.id },
  });
}
