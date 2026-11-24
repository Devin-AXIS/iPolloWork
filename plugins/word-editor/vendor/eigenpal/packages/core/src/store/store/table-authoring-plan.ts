import type { RevisionAttributionInput } from './tree-op-revision-attribution.ts';
import { paragraphModelTextOf, withBreakReadText } from './paragraph-model-text.ts';
// Canonical table reads and host-neutral mutation plans. No browser/editor dependencies.
import { collectStoryParagraphs } from '../package/story-blocks.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../package/ooxml-tree.ts';
import { safeRowInsertion } from './table-authoring-row-insertion.ts';
import { readEditableTableTopology, type EditableTableTopology } from './tree-op-table-topology.ts';
import { readMergeableTable } from './tree-op-table-cell-shape.ts';
import { buildPlacedCellIndex } from './tree-op-table-cell-properties.ts';
import { DEFAULT_TABLE_TOPOLOGY_LIMITS } from './table-constraints.ts';
import { readTwipsMeasure } from '../units.ts';
import { wmlAttributeValue, wmlChildNamed } from './tree-op-table-shared.ts';
import { applyTreeOp, type TreeDocOp, type TreeOpEffect } from './tree-ops.ts';
interface AutomationStoryReads {
  readonly part: OoxmlPart;
  readonly root: OoxmlNode;
  rawText(id: string): string | null;
}

export type AutomationTableMutation =
  | {
      readonly kind: 'insertRows';
      readonly rowId: string;
      readonly location: 'before' | 'after';
      readonly count: number;
      readonly values?: readonly (readonly string[])[];
    }
  | { readonly kind: 'values'; readonly values: readonly (readonly string[])[] }
  | {
      readonly kind: 'addRows' | 'addColumns';
      readonly location: 'start' | 'end';
      readonly count: number;
      readonly values?: readonly (readonly string[])[];
    }
  | {
      readonly kind: 'deleteRows' | 'deleteColumns';
      readonly index: number;
      readonly count: number;
    }
  | {
      /** Merge the rectangle from one cell to another, by row and in-row cell index. */
      readonly kind: 'mergeCells';
      readonly topRow: number;
      readonly firstCell: number;
      readonly bottomRow: number;
      readonly lastCell: number;
    }
  | {
      readonly kind: 'splitCell';
      readonly cellId: string;
      readonly rowCount: number;
      readonly columnCount: number;
    }
  | { readonly kind: 'delete' }
  | { readonly kind: 'properties'; readonly styleId?: string; readonly headerRowCount?: number }
  | {
      readonly kind: 'cell';
      readonly cellId: string;
      readonly value?: string;
      readonly columnWidth?: number;
      readonly shadingColor?: string;
      readonly verticalAlignment?: 'Top' | 'Center' | 'Bottom';
    };
export interface AutomationTableRead {
  readonly nodeId: string;
  readonly rowIds: readonly string[];
  readonly cellIds: readonly (readonly string[])[];
  readonly values: readonly (readonly string[])[];
  readonly styleId: string;
  readonly headerRowCount: number;
  readonly columnCount: number;
}
export interface AutomationTableCellRead {
  readonly nodeId: string;
  readonly tableId: string;
  readonly value: string;
  readonly columnWidth: number;
  readonly shadingColor: string;
  readonly verticalAlignment: 'Top' | 'Center' | 'Bottom';
  readonly paragraphIds: readonly string[];
}
export function tableNodes(root: OoxmlNode): readonly OoxmlElement[] {
  const out: OoxmlElement[] = [];
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    if (++visited > 100000) throw new Error('table traversal limit');
    const node = stack.pop()!;
    if (node.kind === 'table') {
      out.push(node);
      continue;
    }
    if (node.kind !== 'textValue') stack.push(...[...node.children].reverse());
  }
  return out;
}
function paragraphsOf(cell: OoxmlNode): OoxmlParagraphNode[] {
  const out: OoxmlNode[] = [];
  if (cell.kind !== 'textValue')
    collectStoryParagraphs(cell.kind === 'table' ? [cell] : cell.children, out, 0);
  return out.filter((p): p is OoxmlParagraphNode => p.kind === 'paragraph');
}
function cellText(cell: OoxmlNode): string {
  return paragraphsOf(cell)
    .map((p) => withBreakReadText(p, paragraphModelTextOf(p)))
    .join('\r');
}
function prop(
  node: OoxmlElement,
  container: string,
  name: string,
  attribute = 'val'
): string | undefined {
  const c = wmlChildNamed(node, container);
  const p = c && wmlChildNamed(c, name);
  return p && wmlAttributeValue(p, attribute);
}
export function tableRead(
  reads: AutomationStoryReads,
  tableId: string
): AutomationTableRead | null {
  const result = readEditableTableTopology(reads.root as OoxmlElement, tableId);
  if (!result.ok) return null;
  const { table, rows, gridColumns } = result.topology;
  let headers = 0;
  for (const { row } of rows) {
    const value = prop(row, 'trPr', 'tblHeader');
    const mark = wmlChildNamed(row, 'trPr');
    if (!mark || !wmlChildNamed(mark, 'tblHeader') || ['0', 'false', 'off'].includes(value ?? ''))
      break;
    headers++;
  }
  return {
    nodeId: tableId,
    rowIds: rows.map(({ row }) => row.id),
    cellIds: rows.map(({ cells }) => cells.map((c) => c.id)),
    values: rows.map(({ cells }) => cells.map(cellText)),
    styleId: prop(table, 'tblPr', 'tblStyle') ?? '',
    headerRowCount: headers,
    columnCount: gridColumns.length || rows[0]?.cells.length || 0,
  };
}
function gridWidthUnder(
  reads: AutomationStoryReads,
  topology: EditableTableTopology,
  tableId: string,
  cellId: string,
  index: number
): number | null {
  const placed = topology.hasMerge ? readMergeableTable(reads.part, tableId) : null;
  const entry = placed?.ok ? placed.table.index.byId.get(cellId) : undefined;
  let sum = 0;
  for (let column = entry?.startCol ?? index; column <= (entry?.endCol ?? index); column++) {
    const grid = topology.gridColumns[column];
    const width = grid ? readTwipsMeasure(wmlAttributeValue(grid, 'w')) : null;
    if (width === null) return null;
    sum += width;
  }
  return sum;
}

export function tableCellRead(
  reads: AutomationStoryReads,
  tableId: string,
  cellId: string
): AutomationTableCellRead | null {
  const result = readEditableTableTopology(reads.root as OoxmlElement, tableId);
  if (!result.ok) return null;
  for (const { cells } of result.topology.rows) {
    const index = cells.findIndex((c) => c.id === cellId);
    if (index < 0) continue;
    const cell = cells[index]!;
    // Without its own width, a cell is as wide as the grid columns it spans.
    const own = readTwipsMeasure(prop(cell, 'tcPr', 'tcW', 'w'));
    const width = own ?? gridWidthUnder(reads, result.topology, tableId, cellId, index);
    const align = prop(cell, 'tcPr', 'vAlign');
    return {
      nodeId: cellId,
      tableId,
      value: cellText(cell),
      columnWidth: width !== null && width >= 0 && width <= 9_999_999 ? width / 20 : 0,
      shadingColor: (() => {
        const fill = prop(cell, 'tcPr', 'shd', 'fill');
        return fill && /^[0-9a-fA-F]{6}$/.test(fill) ? `#${fill.toUpperCase()}` : (fill ?? 'auto');
      })(),
      verticalAlignment: align === 'center' ? 'Center' : align === 'bottom' ? 'Bottom' : 'Top',
      paragraphIds: paragraphsOf(cell).map((p) => p.id),
    };
  }
  return null;
}
export type TableMutationPlan =
  | {
      readonly ok: true;
      readonly ops: readonly TreeDocOp[];
      readonly createdRowIds: readonly string[];
      readonly resultPart: OoxmlPart;
      readonly effects: readonly TreeOpEffect[];
    }
  | { readonly ok: false; readonly reason: string };
function matrix(
  value: readonly (readonly string[])[] | undefined,
  rows: number,
  cols: number
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length !== rows) return false;
  let total = 0;
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (const cell of row) {
      if (typeof cell !== 'string' || /[\r\n\u0000-\u0008]/.test(cell)) return false;
      total += cell.length;
      if (total > 1_000_000) return false;
    }
  }
  return true;
}

function validMutation(value: AutomationTableMutation): boolean {
  if (!value || typeof value !== 'object') return false;
  const allowed: Record<string, readonly string[]> = {
    values: ['kind', 'values'],
    addRows: ['kind', 'location', 'count', 'values'],
    insertRows: ['kind', 'rowId', 'location', 'count', 'values'],
    addColumns: ['kind', 'location', 'count', 'values'],
    deleteRows: ['kind', 'index', 'count'],
    deleteColumns: ['kind', 'index', 'count'],
    delete: ['kind'],
    properties: ['kind', 'styleId', 'headerRowCount'],
    cell: ['kind', 'cellId', 'value', 'columnWidth', 'shadingColor', 'verticalAlignment'],
    mergeCells: ['kind', 'topRow', 'firstCell', 'bottomRow', 'lastCell'],
    splitCell: ['kind', 'cellId', 'rowCount', 'columnCount'],
  };
  if (value.kind === 'values' && !Array.isArray(value.values)) return false;
  const keys = allowed[value.kind];
  if (!keys || !Object.keys(value).every((key) => keys.includes(key))) return false;
  if (value.kind === 'mergeCells')
    return [value.topRow, value.firstCell, value.bottomRow, value.lastCell].every(
      (index) => Number.isInteger(index) && index >= 0
    );
  if (value.kind === 'splitCell')
    return (
      typeof value.cellId === 'string' &&
      Number.isInteger(value.rowCount) &&
      Number.isInteger(value.columnCount)
    );
  if (value.kind === 'cell')
    return (
      typeof value.cellId === 'string' &&
      (value.value === undefined || typeof value.value === 'string') &&
      (value.columnWidth === undefined ||
        (typeof value.columnWidth === 'number' &&
          Number.isFinite(value.columnWidth) &&
          value.columnWidth > 0)) &&
      (value.shadingColor === undefined || typeof value.shadingColor === 'string') &&
      (value.verticalAlignment === undefined ||
        ['Top', 'Center', 'Bottom'].includes(value.verticalAlignment))
    );
  return true;
}

/** Keep another author's pending edits when configuring a proposed table. */
function hasForeignRevision(root: OoxmlNode, author: string): boolean {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    const revisionAuthor = wmlAttributeValue(node, 'author');
    if (revisionAuthor !== undefined && revisionAuthor !== author) return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

/**
 * Whether every row of the table is `author`'s pending insertion and no other author has a
 * pending edit inside it: the table is that author's own proposal.
 */
export function isOwnPendingTableInsertion(
  root: OoxmlNode,
  tableId: string,
  author: string
): boolean {
  const topology = readEditableTableTopology(root as OoxmlElement, tableId);
  return (
    topology.ok &&
    topology.topology.rows.length > 0 &&
    !hasForeignRevision(topology.topology.table, author) &&
    topology.topology.rows.every(({ row }) => {
      const trPr = wmlChildNamed(row, 'trPr');
      const ins = trPr && wmlChildNamed(trPr, 'ins');
      return ins && wmlAttributeValue(ins, 'author') === author;
    })
  );
}

/** Simulate ordered canonical operations privately so newly allocated cells can receive values atomically. */
export function planTableMutation(
  reads: AutomationStoryReads,
  tableId: string,
  mutation: AutomationTableMutation,
  revision?: RevisionAttributionInput
): TableMutationPlan {
  if (!validMutation(mutation)) return { ok: false, reason: 'invalid-table-mutation' };
  const topology = readEditableTableTopology(reads.root as OoxmlElement, tableId);
  // Properties and structure belong to an author's complete pending table insertion.
  // Rejecting that insertion removes them with the table; existing tables still refuse.
  // Cell merge and split keep the attribution: the cells, rows, and paragraph marks they add
  // join that insertion, so rejecting it still removes the whole table.
  const ownInsertion =
    revision !== undefined && isOwnPendingTableInsertion(reads.root, tableId, revision.author);
  const ownStructure = ['mergeCells', 'splitCell'];
  if (
    ownInsertion &&
    !['addRows', 'insertRows', 'deleteRows', 'values', ...ownStructure].includes(mutation.kind)
  )
    revision = undefined;
  if (
    revision &&
    !['addRows', 'insertRows', 'deleteRows', 'values', 'cell'].includes(mutation.kind) &&
    !(ownInsertion && ownStructure.includes(mutation.kind))
  )
    return { ok: false, reason: 'unsupported-tracked-table-operation' };
  if (
    revision &&
    mutation.kind === 'cell' &&
    (mutation.columnWidth !== undefined ||
      mutation.shadingColor !== undefined ||
      mutation.verticalAlignment !== undefined)
  )
    return { ok: false, reason: 'unsupported-tracked-table-operation' };
  const initial = topology;
  if (!initial.ok) return { ok: false, reason: initial.reason };
  // Row deletion hands a vertical merge that starts in a removed row to the row below.
  // Columns are placed on the grid, so merged cells widen or narrow. Values and a cell's column
  // width are read by cell index, which merged cells do not keep.
  const merged = initial.topology.hasMerge;
  if (
    merged &&
    (![
      'delete',
      'properties',
      'addRows',
      'insertRows',
      'deleteRows',
      'addColumns',
      'deleteColumns',
      'cell',
      'mergeCells',
      'splitCell',
    ].includes(mutation.kind) ||
      (mutation.kind === 'addColumns' && mutation.values !== undefined))
  )
    return { ok: false, reason: 'table-has-merge' };
  let part: OoxmlPart = reads.part;
  const ops: TreeDocOp[] = [];
  const effects: TreeOpEffect[] = [];
  const createdRowIds: string[] = [];
  const apply = (op: TreeDocOp): string | null => {
    const result = applyTreeOp(part, op);
    if (!result.ok) return result.reason;
    part = result.part;
    effects.push(result.effect);
    ops.push(op);
    return null;
  };
  const topo = () => {
    const r = readEditableTableTopology(part.root, tableId);
    return r.ok ? r.topology : null;
  };
  const writeCell = (cell: OoxmlElement, text: string): string | null => {
    const paragraphs = paragraphsOf(cell);
    if (
      paragraphs.length !== 1 ||
      cell.children.some(
        (n) => n.kind !== 'paragraph' && !(n.kind !== 'textValue' && n.localName === 'tcPr')
      )
    )
      return 'unsupported-cell-content';
    const p = paragraphs[0]!;
    // Compared as a read spells it, so a value read back unchanged is not rewritten.
    const old = withBreakReadText(p, paragraphModelTextOf(p));
    if (old === text) return null;
    let error: string | null = null;
    // Insert while the original first run still supplies its formatting. Deleting
    // every original character first would leave no run properties to inherit.
    if (text.length)
      error = apply({
        op: 'insertText',
        paragraphId: p.id,
        offset: 0,
        text,
        ...(revision ? { revision } : {}),
      });
    if (error) return error;
    if (old.length)
      return apply({
        op: 'deleteText',
        paragraphId: p.id,
        start: text.length,
        end: text.length + old.length,
        ...(revision ? { revision } : {}),
      });
    return null;
  };
  let error: string | null = null;
  const current = initial.topology;
  const cols = current.gridColumns.length || current.rows[0]?.cells.length || 0;
  if (
    current.gridColumns.length === 0 &&
    (mutation.kind === 'addColumns' ||
      (mutation.kind === 'deleteColumns' && mutation.count !== cols))
  )
    return { ok: false, reason: 'unsupported-table-topology' };
  if (
    mutation.kind !== 'delete' &&
    mutation.kind !== 'properties' &&
    mutation.kind !== 'addRows' &&
    mutation.kind !== 'insertRows' &&
    mutation.kind !== 'deleteRows' &&
    mutation.kind !== 'mergeCells' &&
    mutation.kind !== 'splitCell' &&
    !merged &&
    current.rows.some(({ cells }) => cells.length !== cols)
  )
    return { ok: false, reason: 'nonrectangular-table' };
  if (mutation.kind === 'mergeCells') {
    // Corners by row and in-row cell index, the way the cell collections list them.
    const first = current.rows[mutation.topRow]?.cells[mutation.firstCell];
    const last = current.rows[mutation.bottomRow]?.cells[mutation.lastCell];
    if (!first || !last || mutation.bottomRow < mutation.topRow)
      return { ok: false, reason: 'invalid-table-index' };
    // One cell named twice is a rectangle of one cell, which the merge refuses as such.
    const cellIds = first.id === last.id ? [first.id] : [first.id, last.id];
    error = apply({ op: 'mergeTableCells', tableId, cellIds, ...(revision ? { revision } : {}) });
  } else if (mutation.kind === 'splitCell') {
    if (!current.rows.some(({ cells }) => cells.some((cell) => cell.id === mutation.cellId)))
      return { ok: false, reason: 'unknown-cell' };
    error = apply({
      op: 'splitTableCell',
      tableId,
      cellId: mutation.cellId,
      rows: mutation.rowCount,
      columns: mutation.columnCount,
      ...(revision ? { revision } : {}),
    });
  } else if (mutation.kind === 'delete') error = apply({ op: 'deleteBlock', blockId: tableId });
  else if (mutation.kind === 'properties')
    error = apply({
      op: 'setTableProperties',
      tableId,
      ...(mutation.styleId === undefined ? {} : { styleId: mutation.styleId }),
      ...(mutation.headerRowCount === undefined ? {} : { headerRowCount: mutation.headerRowCount }),
    });
  else if (mutation.kind === 'values') {
    if (!matrix(mutation.values, current.rows.length, cols))
      return { ok: false, reason: 'invalid-table-values' };
    for (let r = 0; r < current.rows.length && !error; r++)
      for (let c = 0; c < cols && !error; c++)
        error = writeCell(current.rows[r]!.cells[c]!, mutation.values[r]![c]!);
  } else if (mutation.kind === 'cell') {
    const row = current.rows.find(({ cells }) => cells.some((cell) => cell.id === mutation.cellId));
    const index = row?.cells.findIndex((cell) => cell.id === mutation.cellId) ?? -1;
    const cell = row?.cells[index];
    if (!cell) return { ok: false, reason: 'unknown-cell' };
    if (mutation.value !== undefined) {
      if (!matrix([[mutation.value]], 1, 1)) return { ok: false, reason: 'invalid-cell-value' };
      error = writeCell(cell, mutation.value);
    }
    // Cell formatting covers the whole merged cell: a vertical merge's lower parts take it too.
    const visual = (): string[] => {
      const t = topo();
      const placed = t && buildPlacedCellIndex(t, DEFAULT_TABLE_TOPOLOGY_LIMITS);
      const members = placed?.ok ? placed.index.visualMembersByOwnerId.get(cell.id) : undefined;
      return members ? [...members] : [cell.id];
    };
    if (!error && mutation.shadingColor !== undefined) {
      const color = mutation.shadingColor.replace(/^#/, '');
      if (color !== 'auto' && !/^[a-fA-F0-9]{6}$/.test(color))
        return { ok: false, reason: 'invalid-color' };
      error = apply({
        op: 'setTableCellFill',
        tableId,
        cellIds: visual(),
        color: color === 'auto' ? null : { kind: 'hex', value: color },
      });
    }
    if (!error && mutation.verticalAlignment !== undefined)
      error = apply({
        op: 'setTableCellVerticalAlignment',
        tableId,
        cellIds: visual(),
        alignment: mutation.verticalAlignment.toLowerCase() as 'top' | 'center' | 'bottom',
      });
    if (!error && mutation.columnWidth !== undefined) {
      const widths = current.gridColumns.map(
        (c) => readTwipsMeasure(wmlAttributeValue(c, 'w')) ?? 0
      );
      // The grid columns under the cell: a merged cell spans several, and its index in the
      // row is not its grid column. The last column it spans takes the change.
      const placed = merged ? readMergeableTable(part, tableId) : null;
      if (placed && !placed.ok) return { ok: false, reason: placed.reason };
      const entry = placed?.table.index.byId.get(cell.id);
      const from = entry ? entry.startCol : index;
      const to = entry ? entry.endCol : index;
      let others = 0;
      for (let column = from; column < to; column++) others += widths[column] ?? 0;
      widths[to] = Math.round(mutation.columnWidth * 20) - others;
      error = apply({ op: 'setTableProperties', tableId, columnWidthsTwips: widths });
    }
  } else if (mutation.kind === 'deleteRows' || mutation.kind === 'deleteColumns') {
    const size = mutation.kind === 'deleteRows' ? current.rows.length : cols;
    if (
      !Number.isInteger(mutation.index) ||
      !Number.isInteger(mutation.count) ||
      mutation.index < 0 ||
      mutation.count < 1 ||
      mutation.index + mutation.count > size
    )
      return { ok: false, reason: 'invalid-table-index' };
    if (revision && mutation.count === size)
      return { ok: false, reason: 'tracked-table-deletion-unsupported' };
    // Pending row deletions remain in the tree until review. They cannot keep the table alive.
    if (
      revision &&
      mutation.kind === 'deleteRows' &&
      !current.rows.some(({ row }, index) => {
        if (index >= mutation.index && index < mutation.index + mutation.count) return false;
        const properties = wmlChildNamed(row, 'trPr');
        return !properties || !wmlChildNamed(properties, 'del');
      })
    )
      return { ok: false, reason: 'tracked-table-deletion-unsupported' };
    if (mutation.count === size) error = apply({ op: 'deleteBlock', blockId: tableId });
    else
      for (let i = mutation.index + mutation.count - 1; i >= mutation.index && !error; i--)
        error =
          mutation.kind === 'deleteRows'
            ? apply({
                op: 'deleteTableRow',
                tableId,
                rowId: current.rows[i]!.row.id,
                ...(revision ? { revision } : {}),
              })
            : apply({ op: 'deleteTableColumn', tableId, gridColumnId: current.gridColumns[i]!.id });
  } else if (
    mutation.kind === 'addRows' ||
    mutation.kind === 'insertRows' ||
    mutation.kind === 'addColumns'
  ) {
    if (
      !Number.isInteger(mutation.count) ||
      mutation.count < 1 ||
      mutation.count > 1000 ||
      !(mutation.kind === 'insertRows' ? ['before', 'after'] : ['start', 'end']).includes(
        mutation.location
      )
    )
      return { ok: false, reason: 'invalid-table-count' };
    const isRows = mutation.kind !== 'addColumns';
    const sourceIndex =
      mutation.kind === 'insertRows'
        ? current.rows.findIndex(({ row }) => row.id === mutation.rowId)
        : mutation.location === 'start'
          ? 0
          : current.rows.length - 1;
    const before = mutation.location === 'start' || mutation.location === 'before';
    if (isRows && !safeRowInsertion(current, sourceIndex, before, cols))
      return { ok: false, reason: 'unsupported-row-insertion-geometry' };
    const insertionIndex = sourceIndex + (before ? 0 : 1);
    if (
      !matrix(
        mutation.values,
        isRows ? mutation.count : current.rows.length,
        isRows ? cols : mutation.count
      )
    )
      return { ok: false, reason: 'invalid-table-values' };
    const oldRows = new Set(current.rows.map(({ row }) => row.id));
    for (let i = 0; i < mutation.count && !error; i++) {
      const t = topo()!;
      const first = mutation.location === 'start';
      error = isRows
        ? apply({
            op: 'insertTableRow',
            tableId,
            rowId: current.rows[sourceIndex]!.row.id,
            where: before ? 'above' : 'below',
            ...(revision ? { revision } : {}),
          })
        : apply({
            op: 'insertTableColumn',
            tableId,
            gridColumnId: t.gridColumns[first ? 0 : t.gridColumns.length - 1]!.id,
            where: first ? 'left' : 'right',
          });
    }
    if (!error) {
      const t = topo()!;
      createdRowIds.push(
        ...t.rows.filter(({ row }) => !oldRows.has(row.id)).map(({ row }) => row.id)
      );
      if (mutation.values)
        for (let r = 0; r < mutation.values.length && !error; r++)
          for (let c = 0; c < mutation.values[r]!.length && !error; c++) {
            const ri = isRows ? insertionIndex + r : r;
            const ci = !isRows && mutation.location === 'end' ? cols + c : c;
            // A row copied from merged cells has fewer cells than the grid has columns.
            const target = t.rows[ri]?.cells[ci];
            error = target ? writeCell(target, mutation.values[r]![c]!) : 'nonrectangular-table';
          }
    }
  }
  return error
    ? { ok: false, reason: error }
    : { ok: true, ops, createdRowIds, resultPart: part, effects };
}

/** Range ends a table may follow without leaving the range: not a permission range's end. */
const PASSABLE_RANGE_ENDS = new Set(['bookmarkEnd', 'commentRangeEnd']);
/** A pending revision on a paragraph mark. */
const MARK_REVISIONS = ['ins', 'del', 'moveFrom', 'moveTo'];

/**
 * The paragraph that follows `paragraphId` in the same container, past range ends, when a
 * table may go in front of it instead of splitting `paragraphId`.
 *
 * Only when the anchor's mark stays where it is through every decision. A mark that ends a
 * section keeps the split, so the table stays in that section. A mark with a pending revision
 * keeps it too: deciding that revision joins the anchor with whatever follows its mark, and
 * that must be the empty paragraph a split leaves, not the table's first cell.
 */
function nextParagraphSibling(part: OoxmlPart, paragraphId: string): string | undefined {
  const parent = parentNodeOf(part, paragraphId);
  if (!parent) return undefined;
  const index = parent.children.findIndex((child) => child.id === paragraphId);
  const anchor = parent.children[index];
  if (!anchor || anchor.kind !== 'paragraph') return undefined;
  const properties = wmlChildNamed(anchor, 'pPr');
  const mark = properties && wmlChildNamed(properties, 'rPr');
  if (properties && wmlChildNamed(properties, 'sectPr')) return undefined;
  if (mark && MARK_REVISIONS.some((name) => wmlChildNamed(mark, name))) return undefined;
  // A range that starts at the end of the anchor continues past its mark; a split keeps the
  // table out of it by moving the start into the new paragraph.
  const last = anchor.children.at(-1);
  if (last?.localName.endsWith('Start')) return undefined;
  for (let at = index + 1; at < parent.children.length; at++) {
    const next = parent.children[at]!;
    if (next.kind === 'paragraph') return next.id;
    if (
      next.kind === 'textValue' ||
      next.namespaceUri !== WML_NAMESPACE_URI ||
      !PASSABLE_RANGE_ENDS.has(next.localName)
    )
      return undefined;
  }
  return undefined;
}

/** Insert beside a range endpoint, splitting its paragraph when needed. */
export function planInsertTable(
  reads: AutomationStoryReads,
  paragraphId: string,
  offset: number,
  rowCount: number,
  columnCount: number,
  values?: readonly (readonly string[])[],
  revision?: RevisionAttributionInput
):
  | {
      readonly ok: true;
      readonly ops: readonly TreeDocOp[];
      readonly tableId: string;
      readonly splitParagraphId?: string;
      readonly resultPart: OoxmlPart;
      readonly effects: readonly TreeOpEffect[];
    }
  | { readonly ok: false; readonly reason: string } {
  if (
    !Number.isInteger(rowCount) ||
    !Number.isInteger(columnCount) ||
    rowCount < 1 ||
    columnCount < 1 ||
    rowCount > 1000 ||
    columnCount > 63 ||
    rowCount * columnCount > 10000 ||
    !matrix(values, rowCount, columnCount)
  )
    return { ok: false, reason: 'invalid-table-dimensions' };
  const length = reads.rawText(paragraphId)?.length;
  if (length === undefined || !Number.isInteger(offset) || offset < 0 || offset > length)
    return { ok: false, reason: 'invalid-offset' };
  if (tableNodes(reads.root).some((table) => paragraphsOf(table).some((p) => p.id === paragraphId)))
    return { ok: false, reason: 'nested-table-authoring' };
  const existing = new Set(tableNodes(reads.root).map((node) => node.id));
  let part = reads.part;
  const ops: TreeDocOp[] = [];
  const effects: TreeOpEffect[] = [];
  let anchor = paragraphId;
  let splitParagraphId: string | undefined;
  // At the end of a paragraph, the table goes before the next paragraph and no paragraph mark
  // changes. A split there would mint a new mark after the text, and a tracked split marks
  // that mark inserted, so rejecting the table also joined the text with what follows.
  const following =
    offset > 0 && offset === length ? nextParagraphSibling(part, paragraphId) : undefined;
  if (following) anchor = following;
  else if (offset > 0) {
    const op: TreeDocOp = revision
      ? { op: 'splitParagraphMany', paragraphId, offsets: [offset], revision }
      : { op: 'splitParagraph', paragraphId, offset };
    const result = applyTreeOp(part, op);
    if (!result.ok) return { ok: false, reason: result.reason };
    part = result.part;
    effects.push(result.effect);
    ops.push(op);
    const created = result.effect.created.find((id) => {
      const stack: OoxmlNode[] = [part.root];
      while (stack.length) {
        const n = stack.pop()!;
        if (n.id === id) return n.kind === 'paragraph';
        if (n.kind !== 'textValue') stack.push(...n.children);
      }
      return false;
    });
    if (!created) return { ok: false, reason: 'missing-insert-anchor' };
    anchor = created;
    splitParagraphId = created;
  }
  const op: TreeDocOp = {
    op: 'insertTable',
    beforeParagraphId: anchor,
    rows: rowCount,
    cols: columnCount,
    columnWidthTwips: Math.max(120, Math.floor(9360 / columnCount)),
    ...(revision ? { revision } : {}),
  };
  const result = applyTreeOp(part, op);
  if (!result.ok) return { ok: false, reason: result.reason };
  part = result.part;
  effects.push(result.effect);
  ops.push(op);
  const table = tableNodes(part.root).find((n) => !existing.has(n.id));
  if (!table) return { ok: false, reason: 'missing-inserted-table' };
  if (values) {
    // Tracked values are inserted text inside the inserted table, so rejecting it removes them.
    const seeded = planTableMutation(
      { ...reads, part, root: part.root },
      table.id,
      { kind: 'values', values },
      revision
    );
    if (!seeded.ok) return seeded;
    ops.push(...seeded.ops);
    part = seeded.resultPart;
    effects.push(...seeded.effects);
  }
  return {
    ok: true,
    ops,
    tableId: table.id,
    resultPart: part,
    effects,
    ...(splitParagraphId ? { splitParagraphId } : {}),
  };
}
