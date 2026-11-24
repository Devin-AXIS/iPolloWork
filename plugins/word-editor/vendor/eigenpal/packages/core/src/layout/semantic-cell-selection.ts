// Rectangular table-cell selection over semantic layout records.
//
// Dragging across cells does not mean the same thing as dragging across text. Sweeping from
// A1 to B2 selects FOUR CELLS, not the run of characters between the first and the last —
// which would take in everything painted in between and let a single delete unpick the table.
// A word processor selects the rectangle, and so does this.
//
// It is expressed as a SIBLING of the text selection rather than a variant of it. A union
// would push a narrowing branch into every reader of `SemanticSelection` — ordering, deletion,
// clipboard, formatting, viewport pinning, the DOM mirror — and each is one future edit away
// from forgetting it. Carrying an equivalent TEXT range inside the cell selection instead
// means every one of those keeps working untouched, and only the readers that genuinely want
// the rectangle ask for it.

import { paragraphTextFromLayout, type SemanticSelection } from './semantic-interaction.ts';
import { tableCaretContext } from './table-caret-context.ts';
import { fragmentParagraphs } from './line-segments.ts';
import type { TableCellAddress } from './semantic-hit-test.ts';
import {
  paragraphFragmentsOf,
  paragraphFragmentsOfBlocks,
  type BlockFragmentRecord,
  type PageRecord,
  type ParagraphFragmentRecord,
  type SemanticLayout,
  type StyleSpanRecord,
  type TableCellFragmentRecord,
  type TableRowFragmentRecord,
} from './semantic-records.ts';

/** A rectangle of table cells. */
export interface CellSelection {
  readonly kind: 'cells';
  /** Canonical node id of the `w:tbl`. */
  readonly tableId: string;
  /** Every selected `w:tc`, in document order, with merges resolved. */
  readonly cellIds: readonly string[];
  /** Inclusive row ordinals within the table. */
  readonly rows: { readonly from: number; readonly to: number };
  /** Inclusive grid columns. */
  readonly columns: { readonly from: number; readonly to: number };
  /**
   * The equivalent text range.
   *
   * Every existing reader of a selection — deletion, the clipboard, the DOM mirror, viewport
   * pinning — takes this and needs no knowledge that a rectangle produced it.
   */
  readonly text: SemanticSelection;
}

/** One painted occurrence of a cell, and where it sits. */
export interface PlacedCell {
  readonly pageIndex: number;
  readonly tableId: string;
  readonly row: TableRowFragmentRecord;
  readonly cell: TableCellFragmentRecord;
  /** Ordinal within the whole table, shared by a header row and every repeat of it. */
  readonly rowIndex: number;
  readonly isHeaderRepeat: boolean;
  /**
   * What to add to the cell's box to reach the page's content-box space.
   *
   * Zero for the body, whose fragments are already laid out from that box. A header's are laid
   * out from the header's own box, which sits ABOVE it, and a footer's from a box past the
   * bottom of it. `cellSelectionRects` promises page-content coordinates and the overlay
   * painter places what it returns against `page.contentBox`, so a story's raw box painted a
   * header's selection band down in the body text.
   */
  readonly offsetX: number;
  /** The vertical half of the same offset. See {@link PlacedCell.offsetX}. */
  readonly offsetY: number;
}

interface TableIndex {
  readonly columnCount: number;
  /** Every painted cell of a table, in document order, repeats included. */
  readonly placed: readonly PlacedCell[];
  /** The authored rows once each, in order, keyed by ordinal. */
  readonly rows: ReadonlyMap<number, readonly TableCellFragmentRecord[]>;
}

const tableIndexCache = new WeakMap<SemanticLayout, Map<string, TableIndex>>();

/**
 * Tables indexed by id, built once per layout.
 *
 * A table can span pages, and a `w:tblHeader` row is re-emitted at the top of each
 * continuation — so "the rows of this table" is not something any single fragment knows. The
 * ordinal is assigned from the first non-repeat occurrence, which is what makes a repeat on
 * page four resolve to the same row as the original on page one.
 */
function tableIndex(layout: SemanticLayout): Map<string, TableIndex> {
  const cached = tableIndexCache.get(layout);
  if (cached) return cached;

  const placed = new Map<string, PlacedCell[]>();
  const rows = new Map<string, Map<number, readonly TableCellFragmentRecord[]>>();
  const ordinals = new Map<string, Map<string, number>>();
  const columnCounts = new Map<string, number>();

  const visit = (
    blocks: readonly BlockFragmentRecord[],
    pageIndex: number,
    offsetX: number,
    offsetY: number
  ): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') continue;
      const id = block.tableId;
      columnCounts.set(
        id,
        Math.max(columnCounts.get(id) ?? 0, (block.columnEdges?.length ?? 1) - 1)
      );
      let rowOrdinals = ordinals.get(id);
      if (!rowOrdinals) {
        rowOrdinals = new Map();
        ordinals.set(id, rowOrdinals);
        placed.set(id, []);
        rows.set(id, new Map());
      }
      for (const row of block.rows) {
        let rowIndex = rowOrdinals.get(row.id);
        if (rowIndex === undefined) {
          // A repeat can only ever follow the original, so an unseen id here is a new row.
          rowIndex = rowOrdinals.size;
          rowOrdinals.set(row.id, rowIndex);
          rows.get(id)!.set(rowIndex, row.cells);
        }
        for (const cell of row.cells) {
          placed.get(id)!.push({
            pageIndex,
            tableId: id,
            row,
            cell,
            rowIndex,
            isHeaderRepeat: row.isHeaderRepeat,
            offsetX,
            offsetY,
          });
          visit(cell.blocks, pageIndex, offsetX, offsetY);
        }
      }
    }
  };

  // EVERY story a page draws, not `page.fragments` alone. A table inside a header, a footer or
  // a note is a table, and against the body's fragments the whole table lane answered "the
  // selection is not inside a table" for one the user was looking at — a message that states a
  // fact about the caret rather than the limit it actually hit.
  for (const page of layout.pages) {
    visit(page.fragments, page.index, 0, 0);
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      visit(
        story.fragments,
        page.index,
        story.box.x - page.contentBox.x,
        story.box.y - page.contentBox.y
      );
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      for (const note of area.notes) {
        visit(
          note.fragments,
          page.index,
          note.box.x - page.contentBox.x,
          note.box.y - page.contentBox.y
        );
      }
    }
  }

  const index = new Map<string, TableIndex>();
  for (const [id, cells] of placed) {
    index.set(id, {
      placed: cells,
      rows: rows.get(id) ?? new Map(),
      columnCount: columnCounts.get(id) ?? 0,
    });
  }
  tableIndexCache.set(layout, index);
  return index;
}

/** The number of grid columns a table spans, from the widest row. */
function columnCountOf(table: TableIndex): number {
  let columns = table.columnCount;
  for (const cells of table.rows.values()) {
    for (const cell of cells) columns = Math.max(columns, spans(cell).to + 1);
  }
  return columns;
}

/** Anything that occupies grid columns — a painted cell, or an address naming one. */
interface GridExtent {
  readonly gridColumn: number;
  readonly gridSpan: number;
}

const spans = (cell: GridExtent): { from: number; to: number } => ({
  from: cell.gridColumn,
  to: cell.gridColumn + Math.max(1, cell.gridSpan) - 1,
});

/**
 * The rectangle two cells define.
 *
 * Grown to a fixpoint rather than taken literally: a cell that spans two columns cannot be
 * half selected, and a vertically merged run cannot be selected in the middle. Word grows the
 * rectangle until every cell it touches is wholly inside it, so dragging into a merged cell
 * pulls the selection out to that cell's full extent.
 */
export function cellSelectionBetween(
  layout: SemanticLayout,
  anchor: TableCellAddress,
  head: TableCellAddress
): CellSelection | null {
  if (anchor.tableId !== head.tableId) return null;
  const table = tableIndex(layout).get(anchor.tableId);
  if (!table) return null;

  let rowFrom = Math.min(anchor.rowIndex, head.rowIndex);
  let rowTo = Math.max(anchor.rowIndex, head.rowIndex);
  let columnFrom = Math.min(spans(anchor).from, spans(head).from);
  let columnTo = Math.max(spans(anchor).to, spans(head).to);

  const overlapsColumns = (cell: TableCellFragmentRecord): boolean => {
    const { from, to } = spans(cell);
    return to >= columnFrom && from <= columnTo;
  };
  const continuesInRange = (rowIndex: number): boolean =>
    (table.rows.get(rowIndex) ?? []).some((cell) => cell.vMergeContinue && overlapsColumns(cell));

  // Loop until STABLE. A fixed pass count was wrong: column growth only propagates forward
  // through the row scan, so a cell in an earlier row that newly overlaps needs another pass,
  // and stopping early published a ragged selection whose `columns` disagreed with its own
  // `cellIds`. Both ranges only ever grow and are bounded by the table, so this terminates;
  // the counter is an assertion against a record set that says something impossible.
  const maxPasses = table.rows.size + columnCountOf(table) + 2;
  for (let pass = 0; ; pass += 1) {
    if (pass > maxPasses) break;
    let grew = false;
    // A cell spanning columns cannot be half selected: touching it pulls the rectangle out to
    // its full width.
    for (const [rowIndex, cells] of table.rows) {
      if (rowIndex < rowFrom || rowIndex > rowTo) continue;
      for (const cell of cells) {
        if (!overlapsColumns(cell)) continue;
        const { from, to } = spans(cell);
        if (from < columnFrom) {
          columnFrom = from;
          grew = true;
        }
        if (to > columnTo) {
          columnTo = to;
          grew = true;
        }
      }
    }
    // A vertical merge cannot be selected in the middle either. A continuation is the tail of
    // a run that starts higher up, so taking one means taking the whole run — otherwise a
    // delete would empty a cell that is still on screen.
    while (rowFrom > 0 && continuesInRange(rowFrom)) {
      rowFrom -= 1;
      grew = true;
    }
    while (continuesInRange(rowTo + 1)) {
      rowTo += 1;
      grew = true;
    }
    if (!grew) break;
  }

  const cellIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of table.placed) {
    if (entry.isHeaderRepeat) continue;
    if (entry.rowIndex < rowFrom || entry.rowIndex > rowTo) continue;
    const { from, to } = spans(entry.cell);
    if (to < columnFrom || from > columnTo) continue;
    if (seen.has(entry.cell.id)) continue;
    seen.add(entry.cell.id);
    cellIds.push(entry.cell.id);
  }
  if (cellIds.length === 0) return null;

  return {
    kind: 'cells',
    tableId: anchor.tableId,
    cellIds,
    rows: { from: rowFrom, to: rowTo },
    columns: { from: columnFrom, to: columnTo },
    text: textRangeOf(layout, anchor.tableId, cellIds),
  };
}

/** Every cell of a table, as one rectangle; null when the table is not laid out. */
export function wholeTableCellSelection(
  layout: SemanticLayout,
  tableId: string
): CellSelection | null {
  const table = tableIndex(layout).get(tableId);
  if (!table) return null;
  const cellIds: string[] = [];
  const seen = new Set<string>();
  let lastRow = 0;
  for (const entry of table.placed) {
    if (entry.isHeaderRepeat || seen.has(entry.cell.id)) continue;
    seen.add(entry.cell.id);
    cellIds.push(entry.cell.id);
    lastRow = Math.max(lastRow, entry.rowIndex);
  }
  if (cellIds.length === 0) return null;
  return {
    kind: 'cells',
    tableId,
    cellIds,
    rows: { from: 0, to: lastRow },
    columns: { from: 0, to: columnCountOf(table) - 1 },
    text: textRangeOf(layout, tableId, cellIds),
  };
}

/** Whether a rectangle holds every cell of its table. */
export function coversWholeTable(layout: SemanticLayout, selection: CellSelection): boolean {
  const whole = wholeTableCellSelection(layout, selection.tableId);
  if (!whole) return false;
  const selected = new Set(selection.cellIds);
  return whole.cellIds.every((id) => selected.has(id));
}

/**
 * Paragraph ids that are DIRECT children of the cells — nested tables excluded — in
 * document order, each once.
 *
 * The recursive walk answers "what does deleting these cells clear"; this one answers
 * "which paragraphs are the cell's OWN". A replacement landing computed from the recursive
 * list drifted into a nested table whenever one sat past the cell's last own paragraph.
 */
export function directParagraphsInCells(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly string[] {
  return cellParagraphIds(layout, cellIds, true);
}

/** Paragraph ids inside a set of cells, in document order, each once. */
export function paragraphsInCells(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly string[] {
  return cellParagraphIds(layout, cellIds, false);
}

/** The one placed-cell walk both readers share; `directOnly` skips nested tables. */
function cellParagraphIds(
  layout: SemanticLayout,
  cellIds: readonly string[],
  directOnly: boolean
): readonly string[] {
  const wanted = new Set(cellIds);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const table of tableIndex(layout).values()) {
    for (const entry of table.placed) {
      if (entry.isHeaderRepeat || !wanted.has(entry.cell.id)) continue;
      for (const block of entry.cell.blocks) {
        if (directOnly && block.kind !== 'paragraph') continue;
        collectParagraphs(block, found, seen);
      }
    }
  }
  return found;
}

function collectParagraphs(block: BlockFragmentRecord, into: string[], seen: Set<string>): void {
  if (block.kind === 'paragraph') {
    // EVERY paragraph the fragment draws, not just the one it is named after. A resolved
    // display mode merges a run into the survivor's fragment, and a cell selection that
    // listed the survivor alone deleted half of what the reader had highlighted: the
    // absorbed members' text stayed behind in a cell reported as emptied.
    for (const paragraphId of fragmentParagraphs(block)) {
      if (seen.has(paragraphId)) continue;
      seen.add(paragraphId);
      into.push(paragraphId);
    }
    return;
  }
  for (const row of block.rows) {
    if (row.isHeaderRepeat) continue;
    for (const cell of row.cells) {
      for (const nested of cell.blocks) collectParagraphs(nested, into, seen);
    }
  }
}

/**
 * The text range a cell selection stands in for.
 *
 * From the first selected paragraph's start to the last one's end, so deletion, the clipboard
 * and the DOM mirror can act on a cell selection without knowing it is one. A rectangle whose
 * cells are all empty still has to name a position, or those readers would have nothing.
 */
function textRangeOf(
  layout: SemanticLayout,
  tableId: string,
  cellIds: readonly string[]
): SemanticSelection {
  const paragraphs = paragraphsInCells(layout, cellIds);
  const first = paragraphs[0];
  const last = paragraphs[paragraphs.length - 1];
  if (!first || !last) return nearestPositionInTable(layout, tableId);
  return {
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: last, offset: paragraphTextFromLayout(layout, last).length },
  };
}

/**
 * A position for a rectangle whose cells are all empty.
 *
 * Inside the SAME table. Falling back to the document's first paragraph put the caret outside
 * the table entirely, so the next keystroke typed at the top of the document — a rectangle
 * that selects nothing must still not aim somewhere else.
 */
function nearestPositionInTable(layout: SemanticLayout, tableId: string): SemanticSelection {
  const table = tableIndex(layout).get(tableId);
  for (const entry of table?.placed ?? []) {
    if (entry.isHeaderRepeat) continue;
    const found: string[] = [];
    for (const block of entry.cell.blocks) collectParagraphs(block, found, new Set());
    const paragraphId = found[0];
    if (paragraphId) {
      const at = { paragraphId, offset: 0 };
      return { anchor: at, head: at };
    }
  }
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      const at = { paragraphId: fragment.paragraphId, offset: 0 };
      return { anchor: at, head: at };
    }
  }
  const nowhere = { paragraphId: '', offset: 0 };
  return { anchor: nowhere, head: nowhere };
}

/**
 * Paragraph fragments of every story a page draws, in reading order.
 *
 * `paragraphFragmentsOf` covers the body. A header, a footer and a note story keep their
 * fragments on their own record, so a read that wants "the paragraphs painted on this page"
 * has to visit each. No memo of its own: each list it flattens is memoized already, and this
 * only concatenates them.
 */
function paragraphFragmentsEverywhereOn(page: PageRecord): ParagraphFragmentRecord[] {
  const found = [...paragraphFragmentsOf(page)];
  for (const story of [page.header, page.footer]) {
    if (story) found.push(...paragraphFragmentsOfBlocks(story.fragments));
  }
  for (const area of [page.footnotes, page.endnotes]) {
    if (!area) continue;
    for (const note of area.notes) found.push(...paragraphFragmentsOfBlocks(note.fragments));
  }
  return found;
}

/** The style spans a cell selection covers, for reporting active formatting. */
export function spansInCells(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly StyleSpanRecord[] {
  const wanted = new Set(paragraphsInCells(layout, cellIds));
  const found: StyleSpanRecord[] = [];
  const seen = new Set<string>();
  // EVERY story, matching `tableIndex`. Reading `page.fragments` alone reported no spans at
  // all for a cell selection in a header, so the toolbar showed a fully bold selection as not
  // bold. This walk carries no geometry — it collects style spans by paragraph id — so a story
  // needs no origin here, only visiting.
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsEverywhereOn(page)) {
      if (!wanted.has(fragment.paragraphId)) continue;
      for (const line of fragment.lines) {
        for (const span of line.spans) {
          // A paragraph that crosses a page repeats its spans across fragments.
          const key = `${span.range.paragraphId}:${span.range.start}:${span.range.end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push(span);
        }
      }
    }
  }
  return found;
}

/** One rectangle per painted occurrence of a selected cell, in page-content coordinates. */
export function cellSelectionRects(
  layout: SemanticLayout,
  cellIds: readonly string[]
): readonly { pageIndex: number; x: number; y: number; width: number; height: number }[] {
  const wanted = new Set(cellIds);
  const rects: { pageIndex: number; x: number; y: number; width: number; height: number }[] = [];
  for (const table of tableIndex(layout).values()) {
    for (const entry of table.placed) {
      // Repeats included on purpose: a repeated header row IS drawn on that page, and leaving
      // it unhighlighted would show a selected row that looks unselected on every page but
      // the first.
      if (!wanted.has(entry.cell.id)) continue;
      rects.push({
        pageIndex: entry.pageIndex,
        x: entry.cell.box.x + entry.offsetX,
        y: entry.cell.box.y + entry.offsetY,
        width: entry.cell.box.width,
        height: entry.cell.box.height,
      });
    }
  }
  return rects;
}

/**
 * A cell selection as plain text: tabs between cells, newlines between rows.
 *
 * What a spreadsheet and every other word processor put on the clipboard for a rectangle, and
 * the only shape that survives the trip: the text range a rectangle stands in for would paste
 * back as one run of characters with the grid gone.
 */
export function cellSelectionText(
  layout: SemanticLayout,
  selection: CellSelection,
  paragraphText: (layout: SemanticLayout, paragraphId: string) => string = paragraphTextFromLayout
): string {
  const table = tableIndex(layout).get(selection.tableId);
  if (!table) return '';
  const wanted = new Set(selection.cellIds);
  const rtl = table.placed.some((entry) => entry.cell.logicalGridColumn !== undefined);
  const rows = new Map<number, Map<number, string>>();
  const seen = new Set<string>();
  for (const entry of table.placed) {
    if (entry.isHeaderRepeat || !wanted.has(entry.cell.id) || seen.has(entry.cell.id)) continue;
    seen.add(entry.cell.id);
    // Every placement of the cell, not just the first: a row that splits mid-content across
    // pages puts the rest of its paragraphs in a later fragment, and reading one placement
    // silently dropped that tail from the clipboard.
    const text = paragraphsInCells(layout, [entry.cell.id])
      .map((id) => paragraphText(layout, id))
      .join('\n');
    const row = rows.get(entry.rowIndex);
    // Merged text starts at the logical leading slot, which is physically rightmost in RTL.
    const column = entry.cell.gridColumn + (rtl ? Math.max(1, entry.cell.gridSpan) - 1 : 0);
    if (row) row.set(column, text);
    else rows.set(entry.rowIndex, new Map([[column, text]]));
  }
  return [...rows.keys()]
    .sort((left, right) => left - right)
    .map((index) => {
      const row = rows.get(index)!;
      const fields: string[] = [];
      // One field per GRID COLUMN, not per present cell. A row with `w:gridBefore`, or any
      // interior gap, otherwise shifts every later column one place left and the grid no
      // longer lines up when it is pasted.
      for (let offset = 0; offset <= selection.columns.to - selection.columns.from; offset += 1) {
        const column = rtl ? selection.columns.to - offset : selection.columns.from + offset;
        fields.push(row.get(column) ?? '');
      }
      return fields.join('\t');
    })
    .join('\n');
}

/** Where a paragraph sits in a table, if it sits in one. */
export interface TableCellContext {
  readonly tableId: string;
  readonly rows: number;
  readonly columns: number;
  readonly rowIndex: number;
  readonly columnIndex: number;
}

/**
 * The table context of one paragraph — what a toolbar reflects when the caret is in a cell.
 *
 * Answers for a plain caret, not only for a cell selection, because "am I in a table" is a
 * question about where the caret is and a toolbar that only knew during a rectangle drag
 * would show its table controls disabled while the user was typing in a cell.
 */
export function tableContextAt(
  layout: SemanticLayout,
  paragraphId: string
): TableCellContext | null {
  return tableCaretContext(layout, paragraphId);
}

/** Canonical table/row/cell ids for a caret or rectangular cell selection. */
export function tableAnchorAt(
  layout: SemanticLayout,
  paragraphId: string,
  cellSelection?: CellSelection | null
): {
  readonly tableId: string;
  readonly rowId: string;
  readonly cellId: string;
  readonly cellIds: readonly string[];
  readonly gridColumnIndex: number;
  /** The authored `w:gridCol` the cell starts at, where the grid states one. */
  readonly gridColumnId?: string;
  readonly isHeaderRepeat: boolean;
} | null {
  if (cellSelection) {
    const ctx = tableContextAt(layout, paragraphId);
    if (!ctx || ctx.tableId !== cellSelection.tableId) return null;
    const firstCellId = cellSelection.cellIds[0];
    if (!firstCellId) return null;
    const table = tableIndex(layout).get(cellSelection.tableId);
    if (!table) return null;
    for (const entry of table.placed) {
      if (entry.cell.id !== firstCellId) continue;
      return {
        tableId: cellSelection.tableId,
        rowId: entry.row.id,
        cellId: firstCellId,
        cellIds: cellSelection.cellIds,
        gridColumnIndex: entry.cell.logicalGridColumn ?? entry.cell.gridColumn,
        ...(entry.cell.gridColumnId ? { gridColumnId: entry.cell.gridColumnId } : {}),
        isHeaderRepeat: entry.isHeaderRepeat,
      };
    }
    return null;
  }
  const ctx = tableContextAt(layout, paragraphId);
  if (!ctx) return null;
  const table = tableIndex(layout).get(ctx.tableId);
  if (!table) return null;
  for (const entry of table.placed) {
    if (entry.isHeaderRepeat) continue;
    const found: string[] = [];
    for (const block of entry.cell.blocks) collectParagraphs(block, found, new Set());
    if (!found.includes(paragraphId)) continue;
    return {
      tableId: ctx.tableId,
      rowId: entry.row.id,
      cellId: entry.cell.id,
      cellIds: [entry.cell.id],
      gridColumnIndex: entry.cell.logicalGridColumn ?? entry.cell.gridColumn,
      ...(entry.cell.gridColumnId ? { gridColumnId: entry.cell.gridColumnId } : {}),
      isHeaderRepeat: entry.row.isHeaderRepeat,
    };
  }
  return null;
}

const cellAddressIndexCache = new WeakMap<SemanticLayout, ReadonlyMap<string, TableCellAddress>>();

/**
 * The innermost table cell that contains this paragraph, or null outside a table.
 *
 * Built once per layout so presence paint can resolve two corner paragraphs without walking
 * every cell again on each caret move.
 */
export function cellAddressAt(
  layout: SemanticLayout,
  paragraphId: string
): TableCellAddress | null {
  const cached = cellAddressIndexCache.get(layout);
  if (cached) return cached.get(paragraphId) ?? null;
  const index = new Map<string, TableCellAddress>();
  for (const [tableId, table] of tableIndex(layout)) {
    for (const entry of table.placed) {
      if (entry.isHeaderRepeat) continue;
      const found: string[] = [];
      for (const block of entry.cell.blocks) collectParagraphs(block, found, new Set());
      const address: TableCellAddress = {
        tableId,
        rowId: entry.row.id,
        cellId: entry.cell.id,
        rowIndex: entry.rowIndex,
        gridColumn: entry.cell.gridColumn,
        gridSpan: entry.cell.gridSpan,
      };
      for (const id of found) {
        const previous = index.get(id);
        // The innermost table wins, matching `tableContextAt`.
        if (previous && previous.tableId.length >= tableId.length) continue;
        index.set(id, address);
      }
    }
  }
  cellAddressIndexCache.set(layout, index);
  return index.get(paragraphId) ?? null;
}

/**
 * The cell Tab (`next`) or Shift+Tab (`previous`) moves to from the innermost cell holding
 * `paragraphId`: the table's cells in document order, each once (a cell split across pages
 * included), skipping the cells a vertical merge continues and the empty stand-in a merge that
 * crosses a page paints at the top of the next page. Its paragraphs come with it, in document
 * order, nested tables included. `end` when no cell follows in that direction, null outside a
 * table.
 */
export function cellInTabOrder(
  layout: SemanticLayout,
  paragraphId: string,
  direction: 'next' | 'previous'
): { readonly cellId: string; readonly paragraphIds: readonly string[] } | 'end' | null {
  const address = cellAddressAt(layout, paragraphId);
  if (!address) return null;
  const table = tableIndex(layout).get(address.tableId);
  if (!table) return null;
  const order = new Set<string>();
  for (const entry of table.placed)
    if (!entry.isHeaderRepeat && !entry.cell.vMergeContinue && entry.cell.blocks.length > 0)
      order.add(entry.cell.id);
  const cells = [...order];
  // A paragraph in a cell a vertical merge continues has no place in the order.
  const from = cells.indexOf(address.cellId);
  if (from < 0) return null;
  const step = direction === 'next' ? 1 : -1;
  for (let at = from + step; at >= 0 && at < cells.length; at += step) {
    const paragraphIds = paragraphsInCells(layout, [cells[at]!]);
    if (paragraphIds.length > 0) return { cellId: cells[at]!, paragraphIds };
  }
  return 'end';
}
