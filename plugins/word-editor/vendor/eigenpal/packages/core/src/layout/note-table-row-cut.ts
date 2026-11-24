// Where a body-table row can split below a footnote reference, read off the row fragment.
//
// A note may budget below its reference LINE only when the row can really continue on the
// next page below that line. Some later line in the row is not enough: a split row opens every
// cell, and a cell paragraph breaks only where its keeps allow. A three-line paragraph under
// widow control has no legal break at all, so a row holding one moves or stays whole, and a
// note budgeted below the reference line pushes the whole row off the page.

import { adjustedBreakIndex, paragraphKeeps } from './pagination-keeps.ts';
import type { TableCellFragmentRecord, TableRowFragmentRecord } from './semantic-records.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';

/**
 * The lowest point the head of `row` must reach to keep the reference line of `owning` on this
 * page when the row splits there, or `null` when the row cannot continue below that line.
 *
 * The head reaches the first legal cut at or below `lineBottom` in the referencing cell, and at
 * least the first legal cut of every other cell, because a split row opens every cell. The row
 * continues only when some cell holds content below that point. `null` as well for a row that
 * places whole (`w:cantSplit`, an exact height) and has not split already, and for a row with
 * a rotated cell. Cells that merge vertically across rows are skipped: their content belongs to
 * the merge, which the paginator carries across a page break.
 */
export function referenceRowCut(
  row: TableRowFragmentRecord,
  owning: TableCellFragmentRecord,
  lineBottom: number,
  compatibilityMode?: number
): number | null {
  const cellKeeps = hasCompatibilityRule(compatibilityMode, 'noteTableCellKeeps');
  if (row.placesWhole === true && row.isContinuation !== true) return null;
  let head = lineBottom;
  let contentEnd = 0;
  for (const cell of row.cells) {
    if (cell.textDirection) return null;
    if (cell.vMergeContinue || (cell.rowSpan ?? 1) > 1) continue;
    const cuts = legalCuts(cell, cellKeeps);
    if (cuts.length === 0) continue;
    contentEnd = Math.max(contentEnd, cuts[cuts.length - 1]!);
    const opening =
      cell === owning ? cuts.find((cut) => cut >= lineBottom - 0.001) : (cuts[0] as number);
    if (opening === undefined) return null;
    head = Math.max(head, opening);
  }
  return contentEnd > head + 0.001 ? head : null;
}

/**
 * The bottoms (page-content pt) at which a cell's content may break, in order; the last is the
 * content's end. A paragraph breaks between lines only where widow control allows
 * ({@link adjustedBreakIndex}), never inside `w:keepLines`, and not after itself when it keeps
 * with a following block of the cell. A nested table breaks only below itself. Widow control
 * and `w:keepLines` bind cell paragraphs only in compatibility mode 15 and later; earlier modes
 * break a cell paragraph at any line.
 */
function legalCuts(cell: TableCellFragmentRecord, cellKeeps: boolean): number[] {
  const cuts: number[] = [];
  cell.blocks.forEach((block, index) => {
    if (block.kind !== 'paragraph' || block.lines.length === 0) {
      cuts.push(block.box.y + block.box.height);
      return;
    }
    const authored = paragraphKeeps(block.props);
    const keeps = {
      ...authored,
      widowControl: authored.widowControl && cellKeeps,
      keepLines: authored.keepLines && cellKeeps,
    };
    const count = block.lines.length;
    const followed = index < cell.blocks.length - 1;
    for (let lines = 1; lines <= count; lines += 1) {
      if (lines < count && adjustedBreakIndex(lines, 0, count, keeps, false) !== lines) continue;
      if (lines === count && followed && keeps.keepNext) continue;
      const line = block.lines[lines - 1]!;
      cuts.push(line.box.y + line.box.height);
    }
  });
  return cuts;
}
