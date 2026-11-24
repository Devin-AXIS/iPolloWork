// The per-layout index behind hit testing (`semantic-hit-test.ts`): page tops, row ordinals,
// last lines, and the cell each empty cell occurrence resolves into.

import type {
  BlockFragmentRecord,
  SemanticLayout,
  TableCellFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

export interface LayoutHitIndex {
  /** Sheet-space top of each page, ascending — binary searched by `pageAtY`. */
  readonly pageTops: readonly number[];
  /** Row ordinal within its own table, by `w:tr` node id. */
  readonly rowIndexById: ReadonlyMap<string, number>;
  /** The id of the LAST line each paragraph occupies, for the soft-wrap end rule. */
  readonly lastLineIdOfParagraph: ReadonlyMap<string, string>;
  /**
   * The cell whose text an empty cell occurrence stands for: the cell a vertical-merge
   * continuation continues, or the later occurrence of the same cell that holds its text.
   *
   * Built across ALL pages, because a merged run routinely starts on one page and continues
   * on the next: a fragment-local walk finds nothing there and the click resolves into
   * whatever cell happens to be nearest — a different column.
   */
  readonly mergeOriginOf: ReadonlyMap<TableCellFragmentRecord, MergedCellOrigin>;
}

export interface MergedCellOrigin {
  readonly row: TableRowFragmentRecord;
  readonly cell: TableCellFragmentRecord;
}

/**
 * Built once per layout, not once per hit test.
 *
 * A published layout is immutable — a new revision is a new object — so a `WeakMap` keyed on
 * it is sound and collects with it. This matters because hit testing runs on every pointer
 * move of a drag: anything O(document) per call would make dragging through a long document
 * quadratic in its length.
 */
const hitIndexCache = new WeakMap<SemanticLayout, LayoutHitIndex>();

export function hitIndex(layout: SemanticLayout): LayoutHitIndex {
  const cached = hitIndexCache.get(layout);
  if (cached) return cached;

  const pageTops: number[] = [];
  const rowIndexById = new Map<string, number>();
  const lastLineIdOfParagraph = new Map<string, string>();
  const rowsSeenPerTable = new Map<string, number>();
  const mergeOriginOf = new Map<TableCellFragmentRecord, MergedCellOrigin>();
  /** The most recent non-continuation cell per table column, in document order. */
  const openMerge = new Map<string, MergedCellOrigin>();
  /** Each cell's first occurrence that holds blocks, by cell id. */
  const filledById = new Map<string, MergedCellOrigin>();
  /** Empty occurrences of cells that are not continuations: their text may be elsewhere. */
  const emptyOwn: TableCellFragmentRecord[] = [];

  const visitBlocks = (blocks: readonly BlockFragmentRecord[], inHeaderRepeat: boolean): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        // A repeated header row re-emits the SAME paragraph ids with DIFFERENT line ids, so
        // letting it write here leaves every earlier page's copy looking like it soft-wrapped
        // — and the end of that line becomes unreachable.
        if (!inHeaderRepeat) {
          for (const line of block.lines) {
            lastLineIdOfParagraph.set(line.range.paragraphId, line.id);
          }
        }
        continue;
      }
      for (const row of block.rows) {
        // A header row re-emitted on a continuation page is the SAME row: it must not consume
        // an ordinal, or every row below it would be numbered one too high.
        if (!row.isHeaderRepeat && !rowIndexById.has(row.id)) {
          const next = rowsSeenPerTable.get(block.tableId) ?? 0;
          rowIndexById.set(row.id, next);
          rowsSeenPerTable.set(block.tableId, next + 1);
        }
        for (const cell of row.cells) {
          // Repeats are copies, so they neither open a merge nor continue one.
          if (!row.isHeaderRepeat && !inHeaderRepeat) {
            const column = `${block.tableId}|${cell.gridColumn}`;
            // Keyed on what matters — this cell paints nothing — rather than on any one of
            // the flags layout uses to say so. A merge re-opened on a continuation page
            // reports `vMergeContinue: false` and still holds no blocks, so testing the flag
            // alone left exactly the cells that need an origin without one.
            if (cell.blocks.length === 0) {
              const origin = openMerge.get(column);
              if (origin) mergeOriginOf.set(cell, origin);
              if (!cell.vMergeContinue) emptyOwn.push(cell);
            } else {
              openMerge.set(column, { row, cell });
              if (!filledById.has(cell.id)) filledById.set(cell.id, { row, cell });
            }
          }
          visitBlocks(cell.blocks, inHeaderRepeat || row.isHeaderRepeat);
        }
      }
    }
  };

  for (const page of layout.pages) {
    pageTops.push(page.box.y);
    visitBlocks(page.fragments, false);
  }
  // An occurrence that paints none of its own cell's text, because that text was placed in a
  // later fragment, resolves to that text rather than to whatever the column held above it.
  for (const cell of emptyOwn) {
    const filled = filledById.get(cell.id);
    if (filled) mergeOriginOf.set(cell, filled);
  }

  const index: LayoutHitIndex = {
    pageTops,
    rowIndexById,
    lastLineIdOfParagraph,
    mergeOriginOf,
  };
  hitIndexCache.set(layout, index);
  return index;
}
