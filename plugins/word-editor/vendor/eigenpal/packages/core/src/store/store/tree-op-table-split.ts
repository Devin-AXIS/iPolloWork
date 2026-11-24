// Split one visual table cell into `rows` by `columns` cells.
//
// Columns split into equal widths. A new boundary that falls within a snap distance of an
// existing grid boundary uses it; any other boundary cuts that grid column in two, and every
// cell in other rows that covers a cut column widens its `w:gridSpan`, so those cells keep
// their width. A table without a readable `w:tblGrid` splits only along whole grid columns.
//
// Rows: a cell merged over several rows splits into bands of a divisor of them, each band its
// own `w:vMerge` chain. A one-row cell adds rows after its row, and every other cell of that
// row continues into them through `w:vMerge`, so only the split cell gains rows.
//
// The first new cell keeps the cell's node id and content. The others start with an empty
// paragraph formatted like the cell's first paragraph.

import { createNodeIdAllocator, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import type {
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
  OoxmlTableCellNode,
  OoxmlTableRowNode,
} from '../package/ooxml-tree.ts';
import { usedParaIds } from '../package/para-id.ts';
import {
  wmlFreshNamespaceContextAt,
  type WmlFreshNamespaceContext,
} from '../package/wml-namespace.ts';
import { MIN_TABLE_COLUMN_WIDTH_TWIPS, type TableTopologyLimits } from './table-constraints.ts';
import { fromEdit, TEXT_DEPS } from './tree-op-nodes.ts';
import type { PlacedCell } from './tree-op-table-cell-properties.ts';
import {
  cellHasRevision,
  cellPropertiesFor,
  cellWithProperties,
  declaredDxaWidth,
  gridWidthOver,
  MAX_CELL_SPLIT_COUNT,
  readMergeableTable,
  visualCellOf,
  type CellShape,
  type MergeableTable,
  type VisualCell,
} from './tree-op-table-cell-shape.ts';
import {
  cellBlocksStructureEdit,
  freshCellJoiningInsertion,
  rowJoiningInsertion,
} from './tree-op-table-pending-insertion.ts';
import { invalidRevisionAttribution } from './tree-op-revision-attribution.ts';
import { insertedCellParagraphContent } from './tree-op-table-row-paragraph.ts';
import { isWmlGridCol, wmlChildNamed } from './tree-op-table-shared.ts';
import {
  COLUMN_SAFE_TCPR_LEAVES,
  copySafePropertyContainer,
  emptyParagraph,
  freshGridCol,
  freshTableCell,
  freshTableRow,
  SAFE_TRPR_LEAVES,
  tableWithDeclaredWmlBinding,
} from './tree-op-tables.ts';
import type { TreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

type SplitTableCellOp = Extract<TreeDocOp, { op: 'splitTableCell' }>;

/** A new boundary this close to an existing grid boundary, in twips, uses the existing one. */
const SNAP_TWIPS = 20;

interface ColumnPlan {
  /** Positions in twips inside each old grid column where it is cut, ascending. */
  readonly cuts: ReadonlyMap<number, readonly number[]>;
  /** Each new cell's columns as old-grid-relative piece ranges, resolved after the cuts. */
  readonly parts: readonly {
    readonly from: number;
    readonly to: number;
    readonly width: number | null;
  }[];
  readonly gridLength: number;
}

interface SplitPlan {
  readonly table: MergeableTable;
  readonly visual: VisualCell;
  readonly rows: number;
  readonly columns: ColumnPlan;
  /** Old grid column index to the new indices of its first piece. */
  readonly newStart: readonly number[];
}

function splitCount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_CELL_SPLIT_COUNT
    ? value
    : null;
}

function startsOf(gridLength: number, cuts: ReadonlyMap<number, readonly number[]>): number[] {
  const starts: number[] = [];
  let at = 0;
  for (let col = 0; col <= gridLength; col += 1) {
    starts.push(at);
    at += 1 + (cuts.get(col)?.length ?? 0);
  }
  return starts;
}

function planGridColumns(
  table: MergeableTable,
  visual: VisualCell,
  count: number
):
  | { readonly ok: true; readonly plan: ColumnPlan }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  const widths = table.gridWidths;
  let gridLength = widths?.length ?? 0;
  if (!widths)
    for (const entry of table.index.placed) gridLength = Math.max(gridLength, entry.endCol + 1);
  const span = visual.colTo - visual.colFrom + 1;
  if (!widths) {
    // Without widths only whole grid columns can be shared out.
    if (span % count !== 0) return { ok: false, reason: 'split-needs-grid' };
    const own = declaredDxaWidth(visual.owner.cell);
    if (own !== null && own / count < MIN_TABLE_COLUMN_WIDTH_TWIPS) {
      return { ok: false, reason: 'cell-too-narrow' };
    }
    const step = span / count;
    const parts = Array.from({ length: count }, (_, k) => ({
      from: visual.colFrom + k * step,
      to: visual.colFrom + (k + 1) * step - 1,
      width: own === null ? null : own / count,
    }));
    return { ok: true, plan: { cuts: new Map(), parts, gridLength } };
  }

  const left = gridWidthOver(table, 0, visual.colFrom - 1) ?? 0;
  const total = gridWidthOver(table, visual.colFrom, visual.colTo)!;
  if (total / count < MIN_TABLE_COLUMN_WIDTH_TWIPS) return { ok: false, reason: 'cell-too-narrow' };
  // Boundary positions after each old column inside the cell.
  const edges: number[] = [];
  let at = left;
  for (let col = visual.colFrom; col <= visual.colTo; col += 1) {
    at += widths[col]!;
    edges.push(at);
  }
  const cuts = new Map<number, number[]>();
  const boundaries = [left];
  for (let k = 1; k < count; k += 1) {
    const target = left + Math.round((k * total) / count);
    const snapped = edges.find((edge) => Math.abs(edge - target) <= SNAP_TWIPS);
    if (snapped !== undefined) {
      boundaries.push(snapped);
      continue;
    }
    let colLeft = left;
    for (let col = visual.colFrom; col <= visual.colTo; col += 1) {
      const colRight = colLeft + widths[col]!;
      if (target > colLeft && target < colRight) {
        cuts.set(col, [...(cuts.get(col) ?? []), target - colLeft]);
        break;
      }
      colLeft = colRight;
    }
    boundaries.push(target);
  }
  boundaries.push(left + total);
  // Each cell's piece range in the new grid, found by walking the new column edges.
  const starts = startsOf(gridLength, cuts);
  const newEdges: number[] = [];
  let edge = left;
  for (let col = visual.colFrom; col <= visual.colTo; col += 1) {
    const pieces = [...(cuts.get(col) ?? []), widths[col]!];
    let previous = 0;
    for (const offset of pieces) {
      edge += offset - previous;
      previous = offset;
      newEdges.push(edge);
    }
  }
  const base = starts[visual.colFrom]!;
  const parts = [];
  for (let k = 0; k < count; k += 1) {
    const from = k === 0 ? base : base + newEdges.indexOf(boundaries[k]!) + 1;
    const to = base + newEdges.indexOf(boundaries[k + 1]!);
    if (to < from) return { ok: false, reason: 'cell-too-narrow' };
    parts.push({ from, to, width: boundaries[k + 1]! - boundaries[k]! });
  }
  return { ok: true, plan: { cuts, parts, gridLength } };
}

function coversCuts(table: MergeableTable, cuts: ReadonlyMap<number, readonly number[]>): boolean {
  for (const col of cuts.keys()) {
    for (const entries of table.index.byRow.values()) {
      if (!entries.some((entry) => entry.startCol <= col && entry.endCol >= col)) return false;
    }
  }
  return true;
}

function planSplit(
  part: OoxmlPart,
  op: SplitTableCellOp,
  limits?: TableTopologyLimits
):
  | { readonly ok: true; readonly plan: SplitPlan }
  | { readonly ok: false; readonly reason: TreeOpRejection } {
  const rows = splitCount(op.rows);
  const columns = splitCount(op.columns);
  if (rows === null || columns === null || rows * columns < 2 || typeof op.cellId !== 'string') {
    return { ok: false, reason: 'invalidArgs' };
  }
  if (op.revision !== undefined && invalidRevisionAttribution(op.revision))
    return { ok: false, reason: 'invalid-property-value' };
  const read = readMergeableTable(part, op.tableId, limits);
  if (!read.ok) return read;
  const { table } = read;
  const entry = table.index.byId.get(op.cellId);
  if (!entry) return { ok: false, reason: 'invalidArgs' };
  const visual = visualCellOf(table, entry);
  for (let rowIndex = visual.rowFrom; rowIndex <= visual.rowTo; rowIndex += 1) {
    const member = memberAt(table, visual, rowIndex);
    if (!member) return { ok: false, reason: 'tree-invariant' };
    if (cellBlocksStructureEdit(table, member, op.revision?.author))
      return { ok: false, reason: 'cell-has-revision' };
  }
  const height = visual.rowTo - visual.rowFrom + 1;
  if (height > 1 && height % rows !== 0) return { ok: false, reason: 'split-rows-not-divisor' };
  if (height === 1 && table.topology.rows.length + rows - 1 > table.limits.maxRows) {
    return { ok: false, reason: 'resource-limit' };
  }
  const planned = planGridColumns(table, visual, columns);
  if (!planned.ok) return planned;
  const cutCount = [...planned.plan.cuts.values()].reduce((sum, list) => sum + list.length, 0);
  if (planned.plan.gridLength + cutCount > table.limits.maxColumns) {
    return { ok: false, reason: 'resource-limit' };
  }
  // A cut column must hold a cell in every row; a grid gap there has no cell to widen.
  if (!coversCuts(table, planned.plan.cuts)) return { ok: false, reason: 'row-hides-cell' };
  return {
    ok: true,
    plan: {
      table,
      visual,
      rows,
      columns: planned.plan,
      newStart: startsOf(planned.plan.gridLength, planned.plan.cuts),
    },
  };
}

function memberAt(
  table: MergeableTable,
  visual: VisualCell,
  rowIndex: number
): PlacedCell | undefined {
  return table.index.byRow
    .get(rowIndex)
    ?.find((entry) => entry.startCol === visual.colFrom && entry.endCol === visual.colTo);
}

export function validateSplitTableCell(
  part: OoxmlPart,
  op: SplitTableCellOp,
  limits?: TableTopologyLimits
): TreeOpRejection | null {
  const planned = planSplit(part, op, limits);
  return planned.ok ? null : planned.reason;
}

function newSpanOf(plan: SplitPlan, entry: PlacedCell): number {
  return plan.newStart[entry.endCol + 1]! - plan.newStart[entry.startCol]!;
}

function bandMerge(plan: SplitPlan, rowIndex: number): CellShape['vMerge'] {
  const height = plan.visual.rowTo - plan.visual.rowFrom + 1;
  const bandHeight = height === 1 ? 1 : height / plan.rows;
  if (bandHeight === 1) return 'none';
  return (rowIndex - plan.visual.rowFrom) % bandHeight === 0 ? 'restart' : 'continue';
}

interface Builder {
  readonly part: OoxmlPart;
  readonly tableNode: OoxmlElement;
  readonly nextId: () => string;
  readonly used: Set<string>;
  readonly wml: WmlFreshNamespaceContext;
  readonly created: string[];
  /** Inside a pending table insertion, every new row, cell, and paragraph mark joins it. */
  readonly joining: boolean;
}

function freshCellLike(
  builder: Builder,
  source: OoxmlTableCellNode,
  shape: CellShape,
  seed: string
): OoxmlTableCellNode {
  const { nextId, wml } = builder;
  const own = wmlChildNamed(source, 'tcPr');
  const copied = own ? copySafePropertyContainer(own, COLUMN_SAFE_TCPR_LEAVES, nextId, wml) : null;
  const tcPr = cellPropertiesFor(copied ?? undefined, shape, nextId, wml);
  const content = insertedCellParagraphContent(source, nextId, wml);
  const paragraph = emptyParagraph(
    builder.part,
    builder.tableNode,
    nextId,
    seed,
    builder.used,
    wml,
    content
  );
  const fresh = freshTableCell(nextId, [tcPr, paragraph], wml) as OoxmlTableCellNode;
  const cell = builder.joining ? freshCellJoiningInsertion(fresh, source, nextId, wml) : fresh;
  builder.created.push(cell.id, paragraph.id);
  return cell;
}

function subCells(
  builder: Builder,
  plan: SplitPlan,
  member: OoxmlTableCellNode,
  vMerge: CellShape['vMerge'],
  keep: boolean,
  seed: string
): OoxmlTableCellNode[] {
  return plan.columns.parts.map((range, k) => {
    const shape: CellShape = { span: range.to - range.from + 1, vMerge, widthTwips: range.width };
    if (k === 0 && keep) {
      const tcPr = cellPropertiesFor(
        wmlChildNamed(member, 'tcPr'),
        shape,
        builder.nextId,
        builder.wml
      );
      return cellWithProperties(member, tcPr);
    }
    return freshCellLike(builder, member, shape, `${seed}:c${k}`);
  });
}

function rebuiltGrid(plan: SplitPlan, builder: Builder): OoxmlElement | null {
  const grid = plan.table.topology.grid;
  if (!grid || plan.columns.cuts.size === 0) return null;
  const widths = plan.table.gridWidths!;
  const children: OoxmlNode[] = [];
  let col = 0;
  for (const child of grid.children) {
    if (!isWmlGridCol(child)) {
      children.push(child);
      continue;
    }
    const cuts = plan.columns.cuts.get(col);
    if (!cuts) children.push(child);
    else {
      const offsets = [...cuts, widths[col]!];
      let previous = 0;
      offsets.forEach((offset, index) => {
        const width = String(offset - previous);
        previous = offset;
        const fresh = freshGridCol(builder.nextId, builder.wml, width);
        if (index === 0) {
          // The first piece keeps the column's node id.
          children.push(
            Object.freeze({ ...fresh, id: child.id, attributes: fresh.attributes }) as OoxmlElement
          );
        } else {
          builder.created.push(fresh.id);
          children.push(fresh);
        }
      });
    }
    col += 1;
  }
  return Object.freeze({ ...grid, children }) as OoxmlElement;
}

export function applySplitTableCell(
  part: OoxmlPart,
  op: SplitTableCellOp,
  options?: EditOptions,
  limits?: TableTopologyLimits
): TreeOpResult {
  const planned = planSplit(part, op, limits);
  if (!planned.ok) return { ok: false, reason: planned.reason };
  const { plan } = planned;
  const { topology } = plan.table;
  const wml = wmlFreshNamespaceContextAt(part, topology.table);
  const builder: Builder = {
    part,
    tableNode: tableWithDeclaredWmlBinding(topology.table, part, wml),
    nextId: createNodeIdAllocator(part),
    used: new Set(usedParaIds(part.root)),
    wml,
    created: [],
    joining: op.revision !== undefined,
  };
  const { visual } = plan;
  const height = visual.rowTo - visual.rowFrom + 1;
  const addsRows = height === 1 && plan.rows > 1;
  const dirty = new Set<string>([topology.table.id]);

  const rowFor = new Map<string, OoxmlNode[]>();
  topology.rows.forEach((entry, rowIndex) => {
    const inVisual = rowIndex >= visual.rowFrom && rowIndex <= visual.rowTo;
    const widens = plan.columns.cuts.size > 0;
    if (!inVisual && !widens && !(addsRows && rowIndex === visual.rowFrom)) return;
    const placed = plan.table.index.byRow.get(rowIndex) ?? [];
    const byId = new Map(placed.map((cell) => [cell.cell.id, cell]));
    const rows: OoxmlNode[][] = [[]];
    for (let extra = 1; extra < (addsRows && inVisual ? plan.rows : 1); extra += 1) rows.push([]);
    for (const child of entry.row.children) {
      const cell = byId.get(child.id);
      if (!cell) {
        // Row properties and other non-cell children stay on the original row.
        rows[0]!.push(child);
        continue;
      }
      if (inVisual && cell.startCol === visual.colFrom && cell.endCol === visual.colTo) {
        rows[0]!.push(
          ...subCells(builder, plan, cell.cell, bandMerge(plan, rowIndex), true, cell.cell.id)
        );
        for (let extra = 1; extra < rows.length; extra += 1) {
          rows[extra]!.push(
            ...subCells(builder, plan, cell.cell, 'none', false, `${cell.cell.id}:r${extra}`)
          );
        }
        dirty.add(cell.cell.id);
        continue;
      }
      const span = newSpanOf(plan, cell);
      const vMerge = rows.length > 1 && cell.vMergeKind === 'none' ? 'restart' : cell.vMergeKind;
      if (span !== cell.span || vMerge !== cell.vMergeKind) {
        const shape: CellShape = { span, vMerge, widthTwips: null };
        const tcPr = cellPropertiesFor(
          wmlChildNamed(cell.cell, 'tcPr'),
          shape,
          builder.nextId,
          wml
        );
        rows[0]!.push(cellWithProperties(cell.cell, tcPr));
        dirty.add(cell.cell.id);
      } else rows[0]!.push(child);
      for (let extra = 1; extra < rows.length; extra += 1) {
        const shape: CellShape = { span, vMerge: 'continue', widthTwips: null };
        rows[extra]!.push(freshCellLike(builder, cell.cell, shape, `${cell.cell.id}:r${extra}`));
      }
    }
    const replaced: OoxmlNode[] = [
      Object.freeze({ ...entry.row, children: rows[0]! }) as OoxmlTableRowNode,
    ];
    for (let extra = 1; extra < rows.length; extra += 1) {
      const trPr = wmlChildNamed(entry.row, 'trPr');
      const copied = trPr
        ? copySafePropertyContainer(trPr, SAFE_TRPR_LEAVES, builder.nextId, wml)
        : undefined;
      const fresh = freshTableRow(
        builder.nextId,
        copied ? [copied, ...rows[extra]!] : rows[extra]!,
        wml
      );
      const row = builder.joining
        ? rowJoiningInsertion(fresh, entry.row, builder.nextId, wml)
        : fresh;
      builder.created.push(row.id);
      replaced.push(row);
    }
    dirty.add(entry.row.id);
    rowFor.set(entry.row.id, replaced);
  });

  const grid = rebuiltGrid(plan, builder);
  if (grid) dirty.add(grid.id);
  const children = builder.tableNode.children.flatMap((child) => {
    if (grid && child.id === grid.id) return [grid];
    return rowFor.get(child.id) ?? [child];
  });
  const split = Object.freeze({ ...builder.tableNode, children }) as OoxmlElement;
  const caret = visual.owner.cell.children.find((child) => child.kind === 'paragraph');
  return fromEdit(replaceNode(part, topology.table.id, split, options), {
    dirty: [...dirty],
    created: builder.created,
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: 'flow-structural',
    ...(caret ? { caret: { paragraphId: caret.id } } : {}),
  });
}

/**
 * The most rows and columns `cellId` splits into, or null when the table refuses a split.
 *
 * A cell merged over several rows splits only into a divisor of them, so its row limit is its
 * row count and the dialog still asks the store about the count it picks.
 */
export function splitCellLimits(
  part: OoxmlPart,
  tableId: string,
  cellId: string,
  limits?: TableTopologyLimits
): { readonly maxRows: number; readonly maxCols: number } | null {
  const read = readMergeableTable(part, tableId, limits);
  if (!read.ok) return null;
  const { table } = read;
  const entry = table.index.byId.get(cellId);
  if (!entry) return null;
  const visual = visualCellOf(table, entry);
  for (let rowIndex = visual.rowFrom; rowIndex <= visual.rowTo; rowIndex += 1) {
    const member = memberAt(table, visual, rowIndex);
    if (!member || cellHasRevision(table, member)) return null;
  }
  const height = visual.rowTo - visual.rowFrom + 1;
  const maxRows =
    height > 1
      ? height
      : Math.min(MAX_CELL_SPLIT_COUNT, table.limits.maxRows - table.topology.rows.length + 1);
  const span = visual.colTo - visual.colFrom + 1;
  const width =
    gridWidthOver(table, visual.colFrom, visual.colTo) ?? declaredDxaWidth(visual.owner.cell);
  const byWidth =
    table.gridWidths && width !== null
      ? Math.floor(width / MIN_TABLE_COLUMN_WIDTH_TWIPS)
      : width === null
        ? span
        : Math.min(span, Math.floor(width / MIN_TABLE_COLUMN_WIDTH_TWIPS));
  const gridLength = table.gridWidths?.length ?? span;
  const maxCols = Math.max(
    1,
    Math.min(MAX_CELL_SPLIT_COUNT, byWidth, table.limits.maxColumns - gridLength + 1)
  );
  return { maxRows: Math.max(1, maxRows), maxCols };
}
