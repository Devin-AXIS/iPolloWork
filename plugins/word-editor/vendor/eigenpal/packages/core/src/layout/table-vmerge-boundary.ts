// A two-row vertical merge (17.4.85 `w:vMerge`) whose page break falls right after its head row.
//
// A merge that does not fit the page from its head's top is declined by
// `table-vmerge-heights.ts`, and its head then sizes its own row: the row grows to the page
// bottom, places what fits of the merged text, and continues the rest on the next page ABOVE
// the row the merge continues into. In compatibility mode 15 and later, a merged text that
// cannot place a single line inside the head row's own height is laid out differently:
//
// - the head row keeps only its own cells and its own height on the first page;
// - the whole merged text starts in the continuation row on the next page, beside that row's
//   own cells, with its space before.
//
// "Cannot place a single line" includes the cell's widow and orphan rules: a paragraph whose
// first line alone fits the head row moves whole, as it does at any page break. The head row
// does not grow for the merged text even when the page has room below it.
//
// The rule is deliberately narrow. It applies only when every merge headed in the row ends in
// the next row, the next row starts no merge of its own, the next row cannot start on this
// page below the head row, and each merged head either fits the head row whole or places
// nothing there. A merged text that splits inside the head row, a merge over three or more
// rows, an exact-height row, a row at the page top, an earlier compatibility mode, and
// bottom-to-top text all keep the older path.
//
// The merged text stays the head cell's text on every page. The next row is placed with the
// head cell in its continuation's grid slot, so the text breaks as the head breaks it, and the
// row grows or splits to hold it. The head's margins, borders and fill paint it; its vertical
// alignment is the continuation cell's, the cell it is painted beside. Each fragment of that
// row is then published below a zero-height continuation of the head row
// (`publishCarriedMergedText`): the head cell's copy there holds the text and spans the row
// beside it, as any merge whose head continues onto a later page does, and the continuation
// cell stays an inert continuation (`table-carried-head-row.ts`). Every reader of
// cell records (selection, table commands, hit testing, Markdown, paint) then finds the text
// under the head cell and the head row, in document order.

import {
  initialCellCursors,
  layoutRowFragmentBounded,
  measureRowHeight,
  type CellPlaceCursor,
  type LayoutRowBoundedResult,
  type TableFlowDeps,
} from './semantic-table-layout.ts';
import type {
  SemanticTableCell,
  SemanticTableRow,
  SemanticTableStructure,
} from './semantic-table.ts';
import type { TableCellFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { probeRowFragmentProgress } from './table-row-progress-probe.ts';
import { stripAnchorSinksForProbe } from './table-probe-deps.ts';
import { readOnlyBreakCache } from './paragraph-cache-peek.ts';
import type { CellContentInsets } from './table-cell-geometry.ts';
import { isCarriedHeadRow } from './table-carried-head-row.ts';
import type { RowVMergeLayoutOptions, VMergeRowHeights } from './table-vmerge-heights.ts';

const EPSILON_PT = 0.001;

/** The head row placed without its merged text, and the row that paints that text. */
export interface DeferredMergedText {
  /** The head row to place: each deferred head holds no blocks. */
  readonly headRow: SemanticTableRow;
  /** Every head of the row detached, so none of them sizes it. */
  readonly options: RowVMergeLayoutOptions;
  /** The head row's height without its merged text. */
  readonly heightPt: number;
  /** The next row to place, with each deferred head in its continuation's slot. */
  readonly nextRow: SemanticTableRow;
  /** The authored continuation cell each deferred head stands in for, by head cell id. */
  readonly continuations: ReadonlyMap<string, SemanticTableCell>;
  /** The head row with each deferred head as placed beside the next row, for finalize. */
  readonly headSource: SemanticTableRow;
  /** The authored next row. */
  readonly nextSource: SemanticTableRow;
}

export interface DeferMergedTextInput {
  readonly plan: VMergeRowHeights | null;
  /** The rows the plan was built over, in placement order. */
  readonly rows: readonly SemanticTableRow[];
  readonly rowIndex: number;
  readonly structure: SemanticTableStructure;
  readonly left: number;
  readonly top: number;
  readonly contentBottom: number;
  /** The deps the head row is placed with. */
  readonly deps: TableFlowDeps;
  /** The deps a later row of this fragment is placed with. */
  readonly nextDeps: TableFlowDeps;
  readonly compatibilityMode: number | undefined;
  /** Measure rows at their page position: wrap bands cross this table. */
  readonly positioned: boolean;
}

/** Placement deps for a probe whose result is discarded: nothing published, nothing spent. */
function discardedDeps(deps: TableFlowDeps): TableFlowDeps {
  let lineCounter = 0;
  return {
    ...stripAnchorSinksForProbe(deps),
    // Reads only: a probe never retains a break, but it may reuse one placement measured.
    cache: readOnlyBreakCache(deps.cache),
    borderOwnershipBudget: undefined,
    vMergeResolveBudget: undefined,
    onCellBreakKey: undefined,
    nextLineId: () => `probe-deferred-merge-${lineCounter++}`,
  };
}

/** A cell that has nothing left to place after this fragment. */
const finished = (cell: SemanticTableCell, cursor: CellPlaceCursor | undefined): boolean =>
  cell.vMergeContinue || cursor === undefined || cursor.blockIndex >= cell.blocks.length;

/**
 * The heads whose text the probe left entirely behind, or `null` when any cell split: a head
 * that placed part of its text, or any other cell that did not finish.
 */
function deferredHeads(
  row: SemanticTableRow,
  headIds: ReadonlySet<string>,
  placed: LayoutRowBoundedResult
): Set<string> | null {
  const deferred = new Set<string>();
  const remainder = placed.remainder;
  if (remainder === null) return deferred;
  for (const [index, cell] of row.cells.entries()) {
    if (finished(cell, remainder[index])) continue;
    const record = placed.record.cells[index];
    if (!headIds.has(cell.id) || record === undefined || record.blocks.length > 0) return null;
    deferred.add(cell.id);
  }
  return deferred;
}

/**
 * The head row with each deferred head emptied, and the next row with each deferred head in
 * its continuation's slot. The text moves before either row is placed, so no placement can
 * leave it behind: the head row finishes, and the next row places every line.
 */
function carriedRows(
  head: SemanticTableRow,
  next: SemanticTableRow,
  deferred: ReadonlySet<string>
): Pick<DeferredMergedText, 'headRow' | 'nextRow' | 'continuations' | 'headSource'> {
  const heads = head.cells.filter((cell) => deferred.has(cell.id));
  const continuations = new Map<string, SemanticTableCell>();
  const placedHeads = new Map<string, SemanticTableCell>();
  const headRow = {
    ...head,
    cells: head.cells.map((cell) => (deferred.has(cell.id) ? { ...cell, blocks: [] } : cell)),
  };
  const nextRow = {
    ...next,
    cells: next.cells.map((cell) => {
      const source = cell.vMergeContinue
        ? heads.find((candidate) => candidate.gridColumn === cell.gridColumn)
        : undefined;
      if (source === undefined) return cell;
      continuations.set(source.id, cell);
      // The text aligns vertically in the cell it is painted beside.
      const placed = { ...source, vAlign: cell.vAlign };
      placedHeads.set(source.id, placed);
      return placed;
    }),
  };
  const headSource = {
    ...head,
    cells: head.cells.map((cell) => placedHeads.get(cell.id) ?? cell),
  };
  return { headRow, nextRow, continuations, headSource };
}

/**
 * Whether the head row's merged text moves whole into the next row, and how to place both.
 * See the top of this file for the rule; `null` keeps the ordinary path.
 */
export function deferMergedTextPastHeadRow(input: DeferMergedTextInput): DeferredMergedText | null {
  const { plan, rows, rowIndex, structure, left, top, contentBottom } = input;
  if (
    !hasCompatibilityRule(input.compatibilityMode, 'vMergeTextMovesPastHeadRow') ||
    plan === null ||
    top <= EPSILON_PT
  ) {
    return null;
  }
  const row = rows[rowIndex];
  const next = rows[rowIndex + 1];
  const spans = plan.spansAt(rowIndex);
  if (row === undefined || next === undefined || spans.length === 0) return null;
  // An exact row clips its content and never continues it; that path stays as it is.
  if (row.height.rule === 'exact' || next.height.rule === 'exact') return null;
  if (plan.spansAt(rowIndex + 1).length > 0) return null;
  if (spans.some((span) => span.endRow !== rowIndex + 1)) return null;
  const headIds = new Set(spans.map((span) => span.headCellId));
  for (const cell of row.cells) {
    if (!headIds.has(cell.id)) continue;
    const continuation = next.cells.find(
      (candidate) => candidate.vMergeContinue && candidate.gridColumn === cell.gridColumn
    );
    if (
      cell.textDirection === 'btLr' ||
      continuation === undefined ||
      continuation.gridSpan !== cell.gridSpan ||
      continuation.textDirection === 'btLr'
    ) {
      return null;
    }
  }

  const cols = structure.columnWidthsPt;
  const spacing = structure.cellSpacingPt;
  const unbounded = new Map([...headIds].map((id) => [id, Number.POSITIVE_INFINITY]));
  const at = (y: number) => (input.positioned ? y : undefined);
  const heightPt = measureRowHeight(
    row,
    cols,
    left,
    0,
    input.deps,
    spacing,
    { detachedSpanHeightPtByCellId: unbounded },
    at(top)
  );
  const nextTop = top + heightPt;
  if (heightPt <= EPSILON_PT || nextTop > contentBottom + EPSILON_PT) return null;

  // The next row has to lose this page on its own account; one that could start here would
  // take merged lines beside it, and that is a different layout.
  const nextHeight = measureRowHeight(
    next,
    cols,
    left,
    0,
    input.nextDeps,
    spacing,
    undefined,
    at(nextTop)
  );
  if (nextTop + nextHeight <= contentBottom + EPSILON_PT) return null;
  if (
    !next.cantSplit &&
    probeRowFragmentProgress(
      next,
      cols,
      left,
      nextTop,
      contentBottom,
      false,
      0,
      { ...input.nextDeps, rowAtPageStart: false },
      initialCellCursors(next),
      spacing,
      { requireEveryCell: true }
    )
  ) {
    return null;
  }

  // The heads, bounded by the row's own height, placed the way the row would place them. A
  // head's widow and orphan rules decide here whether its first line may stay alone.
  const options: RowVMergeLayoutOptions = {
    detachedSpanHeightPtByCellId: new Map([...headIds].map((id) => [id, heightPt])),
  };
  const probed = layoutRowFragmentBounded(
    row,
    cols,
    left,
    top,
    Number.POSITIVE_INFINITY,
    false,
    false,
    0,
    discardedDeps(input.deps),
    initialCellCursors(row),
    spacing,
    options,
    contentBottom
  );
  const deferred = deferredHeads(row, headIds, probed);
  if (deferred === null || deferred.size === 0) return null;
  return {
    ...carriedRows(row, next, deferred),
    options,
    heightPt,
    nextSource: next,
  };
}

/** The head row as placed on its page, and what its next row carries. */
interface CarriedMergedText {
  readonly deferred: DeferredMergedText;
  /** The head row's record on its own page, before the fragment is finalized. */
  readonly headRecord: TableRowFragmentRecord;
}

/** The inert continuation a carried head stood in for, in the slot the head was placed in. */
function continuationRecord(
  placed: TableCellFragmentRecord,
  authored: SemanticTableCell
): TableCellFragmentRecord {
  return {
    id: authored.id,
    gridColumn: placed.gridColumn,
    ...(placed.logicalGridColumn === undefined
      ? {}
      : { logicalGridColumn: placed.logicalGridColumn }),
    ...(authored.gridColumnId ? { gridColumnId: authored.gridColumnId } : {}),
    gridSpan: placed.gridSpan,
    vMergeContinue: true,
    paintInert: true,
    rowSpan: 1,
    ...(authored.shading === undefined ? {} : { shading: authored.shading }),
    blocks: [],
    box: placed.box,
  };
}

/** A zero-height cell without the bottom edge it shares with the row below. */
export function withoutZeroHeightBottomEdge(
  cell: TableCellFragmentRecord
): TableCellFragmentRecord {
  const borders = cell.borders;
  if (cell.box.height > 0 || !borders) return cell;
  const { bottom: _bottom, ...kept } = borders;
  return {
    ...cell,
    borders: {
      ...kept,
      ...(borders.edgeSegments
        ? { edgeSegments: borders.edgeSegments.filter((segment) => segment.side !== 'bottom') }
        : {}),
      ...(borders.strokes
        ? { strokes: borders.strokes.filter((stroke) => stroke.side !== 'bottom') }
        : {}),
    },
  };
}

/**
 * Publish each fragment of the carrying row below a zero-height continuation of the head row.
 *
 * The head cell's copy moves into that continuation, where it heads the merge over the row
 * beside it (`finalizeTableRows` gives it the row's height), and the carrying row gets its
 * authored continuation cell back. The other head-row cells are empty and zero-height. Rows
 * and their authored sources stay parallel, and both records reuse the carrying record's
 * content insets. Run after the terminal border step, which reads the carrying row's clone.
 */
function publishCarriedMergedText(
  carries: ReadonlyMap<string, CarriedMergedText>,
  rows: readonly TableRowFragmentRecord[],
  sources: readonly SemanticTableRow[],
  insets: Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>
): { rows: TableRowFragmentRecord[]; sources: SemanticTableRow[] } {
  const outRows: TableRowFragmentRecord[] = [];
  const outSources: SemanticTableRow[] = [];
  for (const [index, record] of rows.entries()) {
    const carry = record.isHeaderRepeat ? undefined : carries.get(record.id);
    const carried = carry
      ? record.cells.filter((cell) => carry.deferred.continuations.has(cell.id))
      : [];
    if (!carry || carried.length === 0) {
      outRows.push(record);
      outSources.push(sources[index]!);
      continue;
    }
    const { deferred, headRecord } = carry;
    const top = record.box.y;
    const head: TableRowFragmentRecord = {
      ...headRecord,
      isContinuation: true,
      ...(record.hasContinuation ? { hasContinuation: true } : {}),
      box: { ...headRecord.box, y: top, height: 0 },
      cells: headRecord.cells.map(
        (cell) =>
          carried.find((candidate) => candidate.id === cell.id) ?? {
            ...cell,
            blocks: [],
            box: { ...cell.box, y: top, height: 0 },
          }
      ),
    };
    const next: TableRowFragmentRecord = {
      ...record,
      cells: record.cells.map((cell) => {
        const authored = deferred.continuations.get(cell.id);
        return authored ? continuationRecord(cell, authored) : cell;
      }),
    };
    const recordInsets = insets.get(record);
    if (recordInsets) {
      insets.set(head, recordInsets);
      insets.set(next, recordInsets);
    }
    outRows.push(head, next);
    outSources.push(deferred.headSource, deferred.nextSource);
  }
  return { rows: outRows, sources: outSources };
}

/** A table's carried merged text, from the head row's placement to the last fragment. */
export interface MergedTextCarry {
  /** The row to place at `index`: the authored row, or the next row carrying merged text. */
  rowAt(index: number, authored: SemanticTableRow): SemanticTableRow;
  /** Record a head row placed without its merged text; the next row carries it. */
  commit(index: number, deferred: DeferredMergedText, headRecord: TableRowFragmentRecord): void;
  /**
   * A finalized fragment whose zero-height head-row continuations draw only their top edge.
   * Their bottom edge is the carrying row's top, and at the top of a fragment that edge is
   * the table's top rule, which the continuation already draws; an inside rule drawn over it
   * would add a line a table without a top border does not have.
   */
  finish(rows: TableRowFragmentRecord[]): TableRowFragmentRecord[];
  /** One fragment's rows and sources, with every carrying row published under its head row. */
  publish(
    rows: TableRowFragmentRecord[],
    sources: SemanticTableRow[],
    insets: Map<TableRowFragmentRecord, ReadonlyMap<string, CellContentInsets>>
  ): { rows: TableRowFragmentRecord[]; sources: SemanticTableRow[] };
}

export function createMergedTextCarry(): MergedTextCarry {
  // By the id of the row that carries the text.
  const carries = new Map<string, CarriedMergedText>();
  let pending: { readonly index: number; readonly row: SemanticTableRow } | null = null;
  return {
    rowAt(index, authored) {
      const row = pending?.index === index ? pending.row : authored;
      pending = null;
      return row;
    },
    commit(index, deferred, headRecord) {
      pending = { index: index + 1, row: deferred.nextRow };
      carries.set(deferred.nextRow.id, { deferred, headRecord });
    },
    finish(rows) {
      if (carries.size === 0) return rows;
      return rows.map((row) =>
        isCarriedHeadRow(row) ? { ...row, cells: row.cells.map(withoutZeroHeightBottomEdge) } : row
      );
    },
    publish(rows, sources, insets) {
      return carries.size === 0
        ? { rows, sources }
        : publishCarriedMergedText(carries, rows, sources, insets);
    },
  };
}
