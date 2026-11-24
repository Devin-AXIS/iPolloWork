// Kana compression (`compressPunctuationAndJapaneseKana`) beside a combining kana sound mark,
// U+3099 or U+309A, in a face that draws the mark in a cell of its own
// (`splitAtSpacedSoundMarks`). The base and its mark are one character of two cells.
import type { StyleSpanRecord } from './semantic-records.ts';

const SOUND_MARK = /^[\u3099\u309a]$/u;

/** Whether `span` holds one sound mark laid out in a cell of its own. */
export function isSpacedSoundMark(span: StyleSpanRecord): boolean {
  return SOUND_MARK.test(span.text) && span.box.width > 0.001;
}

/**
 * The character a line-start list is asked about for a group that ends with `tail` in `span`.
 * A spaced sound mark is the spacing mark it draws as (U+309B or U+309C), which the default
 * Japanese list forbids at a line start; a kana fit can then pull the base and its mark onto
 * a full line.
 */
export function lineStartCharacter(tail: string, span: StyleSpanRecord): string {
  if (!isSpacedSoundMark(span)) return tail;
  return tail === '\u3099' ? '\u309b' : '\u309c';
}

/**
 * The cells that share a kana fit, from the cells `isKana` admits. A kana followed by a spaced
 * sound mark gives its share through the mark, at the end of the pair, and keeps its own advance.
 */
export function kanaFitCells<Cell extends { readonly span: StyleSpanRecord }>(
  cells: readonly Cell[],
  isKana: (cell: Cell) => boolean
): Cell[] {
  const out: Cell[] = [];
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    const next = cells[index + 1];
    if (isSpacedSoundMark(cell.span)) {
      if (index > 0 && isKana(cells[index - 1]!)) out.push(cell);
    } else if (isKana(cell) && !(next && isSpacedSoundMark(next.span))) out.push(cell);
  }
  return out;
}

/**
 * The most a kana fit takes from one cell: a sixteenth of its em, and twice that from a spaced
 * sound mark, which gives its base's share and its own. See {@link kanaCapacityOf} for what the
 * pair adds to the line's capacity.
 */
export function kanaShareLimit(span: StyleSpanRecord): number {
  return (span.style.fontSizePt / 16) * (isSpacedSoundMark(span) ? 2 : 1);
}

/**
 * What `cell`, which can still give `share`, adds to the capacity a kana fit admits a line by:
 * a sixteenth of the em per kana, a kana and its spaced mark counting as one. The mark still
 * takes its own sixteenth first, and its base's equal share, when the line fits.
 */
export function kanaCapacityOf(cell: { readonly span: StyleSpanRecord }, share: number): number {
  return Math.min(share, cell.span.style.fontSizePt / 16);
}

/**
 * The part of `deficit` a spaced sound mark that ends the line gives before the kana share the
 * rest: a sixteenth of its em. Adds it to the cell's reduction and returns the rest.
 */
export function takeFinalSoundMarkShare(
  last: { readonly span: StyleSpanRecord; reduction: number },
  deficit: number
): number {
  if (!isSpacedSoundMark(last.span)) return deficit;
  const given = Math.min(deficit, last.span.style.fontSizePt / 16);
  last.reduction += given;
  return deficit - given;
}
