// Footnote admission: retain a legal split opening or move the reference with its note.

import type { NoteReferenceLineBand } from './note-fragment-geometry.ts';
import type { NoteStoryLayout } from './note-layout.ts';
import { MIN_FOOTNOTE_BODY_BAND_PT } from './note-reserves.ts';
import { paragraphKeeps } from './pagination-keeps.ts';
import { splitNoteFragments } from './note-splitting.ts';
import { rowContinuesOn } from './note-table-reference-band.ts';
import type { PageRecord } from './semantic-records.ts';

/**
 * Note lines a split head must place below a table row reference for the row to stay.
 * With fewer, the row moves to the next page with its note.
 */
export const TABLE_ROW_SPLIT_NOTE_MIN_LINES = 2;

export interface EvictionGuardContext {
  /** The reserve pass's carry-independent note column ({@link noteColumnBudgetPt}). */
  readonly keepWholeBudget: number;
  /** Top of the page's topmost body content ({@link firstBodyContentTopPt}). */
  readonly firstContentTop: number;
  /** The whole note column below the separator, for the split's retreat rule. */
  readonly fullNoteColumn: number;
  readonly evictionAllowed?: boolean;
  readonly paragraphSplitAllowed?: boolean;
  readonly allowOrphanDeferral?: boolean;
  /** The page after this one, which shows whether a row ending this page continues there. */
  readonly nextPage?: PageRecord;
}

/**
 * Whether the reserve must reach `band.top` so the reference moves to the next page with
 * its whole note, instead of the note splitting below the reference.
 *
 * In supported paragraph layouts, a legal note opening keeps the reference on this page.
 * Notes with keep-with-next boundaries or non-paragraph blocks retain whole-note admission.
 * When no legal opening fits, the reference moves if its whole note fits the destination.
 * Splitting remains available when moving cannot help:
 * - a note that does not fit the destination either, measured with the line's own BLOCK
 *   opening the next page (`band.bottom - band.blockTop` of content above the line),
 *   because a `w:keepLines` paragraph moves whole and a fixed column budget would re-evict
 *   there every round, minting a chain of near-blank pages;
 * - a reference in the page's TOPMOST body line, where pushing only re-creates the same
 *   shape (a section-opening paragraph keeps its `w:spacing w:before` at page top, so a
 *   fixed band threshold would re-fire there);
 * - a line inside the minimum body band, whose eviction reserve the
 *   {@link MIN_FOOTNOTE_BODY_BAND_PT} cap would clip into not evicting at all;
 * - a table row that ends the page and continues on the next one: moving that split head
 *   moves the whole row, and at its destination the rest of the row fills the band again;
 * - a table row reference whose note would place at least
 *   {@link TABLE_ROW_SPLIT_NOTE_MIN_LINES} lines below it: the row stays and the note
 *   continues on the next page.
 * Multi-column sections are a known approximation: an eviction for a column-1 reference
 * also shortens column 2; refs above the eviction point still reserve, and the loop
 * otherwise degrades to the envelope/exhaustion exit.
 */
export function evictsReferenceLine(
  band: NoteReferenceLineBand,
  laid: NoteStoryLayout,
  room: number,
  context: EvictionGuardContext
): boolean {
  return (
    band.evictable &&
    context.evictionAllowed !== false &&
    !(context.allowOrphanDeferral && band.preserveOrphanLine) &&
    laid.flowHeight > room + 0.001 &&
    laid.flowHeight <= context.keepWholeBudget - (band.bottom - band.blockTop) + 0.001 &&
    band.top > context.firstContentTop + 0.001 &&
    band.top >= MIN_FOOTNOTE_BODY_BAND_PT &&
    !(band.endsPageRowId !== undefined && rowContinuesOn(context.nextPage, band.endsPageRowId)) &&
    !(band.tableRow === true
      ? splitNoteKeepsTableRow(laid, room, context.fullNoteColumn)
      : context.paragraphSplitAllowed !== false &&
        splitNoteKeepsParagraphReference(laid, room, context.fullNoteColumn))
  );
}

/**
 * Whether splitting `laid` into `room` leaves at least
 * {@link TABLE_ROW_SPLIT_NOTE_MIN_LINES} note lines on the reference page. The split itself
 * decides, so a note paragraph's widow control counts exactly as the attach pass applies it.
 */
export function splitNoteKeepsTableRow(
  laid: NoteStoryLayout,
  room: number,
  fullNoteColumn: number
): boolean {
  return splitNoteHead(laid, room, fullNoteColumn).lines >= TABLE_ROW_SPLIT_NOTE_MIN_LINES;
}

/** Lines and height of the head a split of `laid` into `room` places. */
export function splitNoteHead(
  laid: NoteStoryLayout,
  room: number,
  fullNoteColumn: number
): { readonly lines: number; readonly height: number } {
  const split = splitNoteFragments(laid, Math.max(0, room), { fullContentHeight: fullNoteColumn });
  let lines = 0;
  for (const block of split.head) lines += block.kind === 'paragraph' ? block.lines.length : 1;
  return { lines, height: split.headHeight };
}

/** Whether a paragraph reference can retain a legal note opening on this page. */
export function splitNoteKeepsParagraphReference(
  laid: NoteStoryLayout,
  room: number,
  fullNoteColumn: number
): boolean {
  // Splitting does not yet enforce keep-with-next across note paragraphs. Preserve
  // whole-note admission for those stories until their split boundaries support it.
  if (
    laid.fragments.some(
      (block) => block.kind !== 'paragraph' || paragraphKeeps(block.props).keepNext
    )
  )
    return false;
  return splitNoteHead(laid, room, fullNoteColumn).lines > 0;
}
