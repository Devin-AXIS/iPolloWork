import type { HeldCellBreak } from './cell-continuation-lines.ts';
import type { SemanticTableRow } from './semantic-table.ts';

/**
 * Per-cell progress through a row that may span pages. Indices are into the authored
 * cell.blocks list and the paragraph's broken lines — never DOM geometry.
 */
export interface CellPlaceCursor {
  readonly blockIndex: number;
  readonly lineIndex: number;
  /** Resume by model position when the next page changes line wrapping. */
  readonly startOffset?: number;
  /** The continued paragraph's line break, which the next page indexes instead of re-breaking. */
  readonly heldBreak?: HeldCellBreak;
  /** Continuation of the nested table at blockIndex. */
  readonly nestedTable?: NestedTableCursor;
  readonly previousSpaceAfter: number;
  readonly paragraphFragmentIndex: number;
  /**
   * Did the block before `blockIndex` actually PUT a table on the page?
   *
   * Carried rather than re-derived, because the only thing left to re-derive it from is the
   * source node's kind — and a `w:tbl` past the nesting ceiling, or one with no `w:tr` at
   * all, is a table that emits nothing. Reading the kind on a continuation would let the
   * terminator collapse behind a table that never appeared on that page.
   */
  readonly precededByEmittedTable: boolean;
}

/** Progress through a nested table: the next row, and its cell cursors when it was split. */
export interface NestedTableCursor {
  readonly nextRowIndex: number;
  readonly fragmentIndex: number;
  /** Set when row `nextRowIndex` continues from a page before. */
  readonly rowCursors?: readonly CellPlaceCursor[];
}

export function initialCellCursors(row: SemanticTableRow): CellPlaceCursor[] {
  return row.cells.map(initialCellCursor);
}

export function initialCellCursor(): CellPlaceCursor {
  return {
    blockIndex: 0,
    lineIndex: 0,
    previousSpaceAfter: 0,
    paragraphFragmentIndex: 0,
    precededByEmittedTable: false,
  };
}

/** The cursor for a paragraph that continues on the next page, carrying its line break. */
export function continuedCellCursor(
  blockIndex: number,
  placed: {
    readonly nextLineIndex: number;
    readonly nextStartOffset: number;
    readonly heldBreak?: HeldCellBreak;
  },
  paragraphFragmentIndex: number,
  precededByEmittedTable: boolean
): CellPlaceCursor {
  return {
    blockIndex,
    lineIndex: placed.nextLineIndex,
    startOffset: placed.nextStartOffset,
    ...(placed.heldBreak ? { heldBreak: placed.heldBreak } : {}),
    previousSpaceAfter: 0,
    paragraphFragmentIndex: paragraphFragmentIndex + 1,
    precededByEmittedTable,
  };
}

/** A continued paragraph that placed nothing on this page keeps its break for the next one. */
export function unplacedHeldBreak(
  cursor: CellPlaceCursor,
  blockIndex: number,
  startOffset: number | undefined
): { readonly heldBreak?: HeldCellBreak } {
  return cursor.heldBreak && blockIndex === cursor.blockIndex && startOffset !== undefined
    ? { heldBreak: cursor.heldBreak }
    : {};
}

/**
 * Whether the first line of a cell fragment is placed although it passes the band bottom.
 * On a fresh page (`rowAtPageStart`) with nothing placed above it, a line taller than the
 * band can never fit another page, so it is placed once and clipped to the cell. A line
 * pushed down by a wrap exclusion would fit a band without it, so the row still refuses.
 */
export function placesOversizedLine(
  options: { readonly aloneOnPage?: boolean } | undefined,
  deps: { readonly rowAtPageStart?: boolean },
  placedLines: number,
  skipBefore: number
): boolean {
  return (
    options?.aloneOnPage === true &&
    deps.rowAtPageStart === true &&
    placedLines === 0 &&
    skipBefore === 0
  );
}
