// The body band of a footnote reference inside a body table: the referencing ROW.
//
// A body table's row boxes are in page-content coordinates, and a row moves between pages
// as one unit when nothing of it fits. So the band a note must stay below is the row that
// carries its reference, not the whole table fragment. Budgeting every table reference
// below the table's last row starved notes whose references sit in early rows: the notes
// were carried to the next page while every referencing row stayed behind.
//
// The row is the band only where the geometry proves it. Otherwise the caller keeps the
// whole-table band and never evicts (`'table'`):
// - positioned (`w:tblpPr`) and out-of-flow tables;
// - a reference in an authored header row, which moves with the table's opening rows;
// - a reference in a vertically merged cell that spans rows here, whose content can sit
//   in a lower row of the span;
// - a row that keeps with the next one through a resolved `w:keepNext` on the first
//   paragraph of a cell, because pushing the next row would take this row with it;
// - a reference line outside its row box (content an exact row height clips). Rotated
//   cells lay out on a local axis, so their row box alone bounds them.
// A vertical merge in ANOTHER cell does not disqualify the row: the paginator already
// carries a merge across a page break between two of its rows. Merged text carried past a
// head-row break sits in a zero-height head-row record above the row it breaks with; that
// record is neither a preceding row nor a split row, and its text counts as the carrying
// row's content (`table-carried-head-row.ts`).
//
// Inside the row, notes budget below the reference LINE only when the row can continue on
// the next page below that line: a direct horizontal cell line, in a row that does not place
// whole (`w:cantSplit`, an exact height; `placesWhole` on the record), with a legal break in
// every cell and content left below it ({@link referenceRowCut}). The band then ends at that
// break, the note stays whole on the reference page, and the rest of the row moves. A row
// the paginator already split at the page end (`hasContinuation`) takes the line itself. Every
// other row budgets below its whole box, which includes the cells' space after, bottom
// margins, and a minimum height. An eviction always moves the whole row: `top` is the row's.
// The reserve pass evicts a row only when its note would place fewer than two lines below the
// band ({@link evictsReferenceLine}); otherwise the note splits.
//
// `evictable` additionally needs the row to be movable as one unit to the next page without
// recreating the same shape there: it must not continue a split row, a body row of this
// fragment must precede it (a row under only header rows reopens the next page the same
// way), that row must not keep with it, and the page's blocks must stack in one column. The
// last row of a table that ends the page (`endsPage`) must also not be the head of a split
// row, which only the next page shows ({@link rowContinuesOn}).

import { isOutOfFlowFragment } from './fragment-flow.ts';
import { fragmentOwnsPosition, lineSegments, segmentOwnsAtomOffset } from './line-segments.ts';
import { paragraphKeeps } from './pagination-keeps.ts';
import { referenceRowCut } from './note-table-row-cut.ts';
import { isCarriedHeadRow, withCarriedHeads } from './table-carried-head-row.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  TableCellFragmentRecord,
  TableFragmentRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

interface NoteRefSite {
  readonly paragraphId: string;
  readonly atomOffset: number;
}

export interface TableReferenceRowBand {
  /** The row's top: an eviction moves the whole row. */
  readonly top: number;
  /**
   * When the row can continue on the next page below the reference line, the lowest legal
   * split point that keeps that line ({@link referenceRowCut}), or the line itself in a row
   * already split at the page end; else the row box's bottom, which includes the cells' space
   * after, bottom margins, and a minimum row height. Notes budget below it.
   */
  readonly bottom: number;
  /**
   * Where the row's content starts when it moves: the row's top minus the header rows that
   * repeat above it on the next page.
   */
  readonly blockTop: number;
  readonly evictable: boolean;
  /**
   * The row is the last row of a table that ends the page's flow, so it may be the head of
   * a split row. The eviction guard reads the next page to decide ({@link rowContinuesOn}).
   */
  readonly endsPage: boolean;
  /** The referencing row fragment. */
  readonly row: TableRowFragmentRecord;
}

/**
 * The referencing row's band in a table fragment on `page`: null when the table does not
 * hold the reference, `'table'` when it does but the row cannot be proven the band.
 */
export function tableReferenceRowBand(
  page: PageRecord,
  table: TableFragmentRecord,
  ref: NoteRefSite,
  compatibilityMode?: number
): TableReferenceRowBand | 'table' | null {
  if (table.floatingWrap || isOutOfFlowFragment(table) || table.nestingDepth !== 0) {
    return blocksOwn([table], ref) ? 'table' : null;
  }
  let headerHeight = 0;
  let leadingHeaders = true;
  let previous: TableRowFragmentRecord | undefined;
  // A zero-height head-row continuation directly above: its carried text is this row's.
  let carried: TableRowFragmentRecord | undefined;
  for (const row of table.rows) {
    leadingHeaders &&= row.isHeaderRepeat || row.isHeaderRow;
    if (leadingHeaders) headerHeight += row.box.height;
    // A repeated header row is painted furniture; its references belong to the authored row.
    if (row.isHeaderRepeat) continue;
    const cell = owningCell(row, ref);
    if (!cell) {
      // The carried head row is part of the row below it, never a row that precedes it.
      if (isCarriedHeadRow(row)) carried = row;
      else [previous, carried] = [row, undefined];
      continue;
    }
    if (row.isHeaderRow || (cell.rowSpan ?? 1) > 1 || rowKeepsWithNext(row)) return 'table';
    const lineBottom = referenceLineBottom(cell, row, ref);
    if (lineBottom === null) return 'table';
    const top = row.box.y;
    const evictable =
      row.isContinuation !== true &&
      previous !== undefined &&
      !previous.isHeaderRow &&
      !rowKeepsWithNext(previous) &&
      stacksInOneColumn(page);
    // A row the paginator split at the page end already continues below its reference line,
    // whatever its keeps say: its rest opens the next page.
    const cut =
      lineBottom === undefined
        ? null
        : row.hasContinuation === true
          ? lineBottom
          : referenceRowCut(withCarriedHeads(carried, row), cell, lineBottom, compatibilityMode);
    const bottom = cut ?? top + row.box.height;
    const endsPage = endsPageFlow(page, table, row);
    return { top, bottom, blockTop: top - headerHeight, evictable, endsPage, row };
  }
  return null;
}

/** Whether `row` (a body-table row fragment) holds the reference in any of its cells. */
export function rowOwnsReference(row: TableRowFragmentRecord, ref: NoteRefSite): boolean {
  return owningCell(row, ref) !== null;
}

/**
 * Whether the page's body blocks stack in document order, as one column does. A block that
 * starts above its predecessor's bottom sits in another column or beside a float; lines
 * returning to such a page may change column, and a row moved off it may leave a column
 * that the reserve does not shorten.
 */
export function stacksInOneColumn(page: PageRecord): boolean {
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    if (fragment.box.y < previousBottom - 0.001) return false;
    previousBottom = fragment.box.y + fragment.box.height;
  }
  return true;
}

/**
 * Whether `row` is the last row of a table that ends the page's flow. Such a row may be the
 * head of a row split onto the next page. Moving a split head moves the whole row, and at
 * its destination the rest of the row still fills the band below the reference.
 */
function endsPageFlow(
  page: PageRecord,
  table: TableFragmentRecord,
  row: TableRowFragmentRecord
): boolean {
  if (table.rows[table.rows.length - 1] !== row) return false;
  const at = page.fragments.indexOf(table);
  for (let index = at + 1; index < page.fragments.length; index += 1) {
    const fragment = page.fragments[index]!;
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    return false;
  }
  return true;
}

/**
 * Whether `page` opens with the rest of the row `rowId`, split from the page before. Without
 * a next page, a row that ends the page cannot be proven whole, so it counts as continuing.
 */
export function rowContinuesOn(page: PageRecord | undefined, rowId: string): boolean {
  const opening = continuedRowId(page);
  return opening === null || opening === rowId;
}

/**
 * The id of the split row whose rest opens `page`: its first in-flow block is a table
 * continuation whose first body row continues a row. `''` when the page opens otherwise,
 * `null` without a page.
 */
export function continuedRowId(page: PageRecord | undefined): string | null {
  if (!page) return null;
  for (const fragment of page.fragments) {
    if (isOutOfFlowFragment(fragment)) continue;
    if (fragment.kind === 'paragraph' && fragment.positionedFrame) continue;
    if (fragment.kind !== 'table') return '';
    // A carried head row continues a merge, not a split row: its head row is complete.
    const first = fragment.rows.find(
      (candidate) => !candidate.isHeaderRepeat && !isCarriedHeadRow(candidate)
    );
    return first?.isContinuation === true ? first.id : '';
  }
  return '';
}

function owningCell(row: TableRowFragmentRecord, ref: NoteRefSite): TableCellFragmentRecord | null {
  for (const cell of row.cells) {
    if (blocksOwn(cell.blocks, ref)) return cell;
  }
  return null;
}

function blocksOwn(blocks: readonly BlockFragmentRecord[], ref: NoteRefSite): boolean {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      if (fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) return true;
      continue;
    }
    for (const row of block.rows) {
      if (row.isHeaderRepeat) continue;
      for (const cell of row.cells) {
        if (blocksOwn(cell.blocks, ref)) return true;
      }
    }
  }
  return false;
}

/**
 * The row keeps with the next one (`table-row-keeps.ts`) when the first paragraph of its
 * first cell resolves `w:keepNext`. Fragment props are the paragraph's resolved properties,
 * so a keep from a paragraph style counts here as a direct one does. Any cell counts, which
 * errs toward the table band.
 */
export function rowKeepsWithNext(row: TableRowFragmentRecord): boolean {
  for (const cell of row.cells) {
    const first = cell.blocks[0];
    if (first?.kind === 'paragraph' && paragraphKeeps(first.props).keepNext) return true;
  }
  return false;
}

/**
 * The bottom of the reference's line when it is a direct paragraph line of a horizontal
 * cell, which is laid out in page-content coordinates; `undefined` when only the row box
 * bounds the reference (nested tables, rotated cells); `null` when the line lies outside
 * the row box (content an exact row height clips).
 */
function referenceLineBottom(
  cell: TableCellFragmentRecord,
  row: TableRowFragmentRecord,
  ref: NoteRefSite
): number | null | undefined {
  if (cell.textDirection) return undefined;
  for (const block of cell.blocks) {
    if (block.kind !== 'paragraph') continue;
    if (!fragmentOwnsPosition(block, ref.paragraphId, ref.atomOffset)) continue;
    for (const line of block.lines) {
      for (const segment of lineSegments(line)) {
        if (!segmentOwnsAtomOffset(segment, ref.paragraphId, ref.atomOffset)) continue;
        const bottom = line.box.y + line.box.height;
        const inside =
          line.box.y >= row.box.y - 0.001 && bottom <= row.box.y + row.box.height + 0.001;
        return inside ? bottom : null;
      }
    }
    return null;
  }
  return undefined;
}
