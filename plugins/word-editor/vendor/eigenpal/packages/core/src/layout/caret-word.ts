// The word a caret format or a format painter click reaches.
//
// A format picked at a caret strictly inside a word formats the whole word; at a word's edge
// it only arms the next typed text. The word here is letters, digits, combining marks,
// apostrophes, optional hyphens, and zero-width joiners: a hyphen, an underscore, a period, or
// a comma ends it, and so does any object a run holds, such as a picture or a note reference.
// Revision text the view hides (a tracked deletion in the proposed view) owns offsets but
// paints nothing, so it joins the visible letters on either side instead of splitting them.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { formattableRanges } from '../store/store/direct-properties.ts';
import type {
  FormattingDisplayMode,
  FormattingRevisionAuthorFilter,
} from '../store/store/formattable-runs.ts';
import { paragraphLinesFor } from './paragraph-lines.ts';
import { lineSegmentFor } from './line-segments.ts';
import { paragraphTextFromLayout, type SemanticPosition } from './semantic-interaction.ts';
import type { SemanticLayout } from './semantic-records.ts';
import { inlineControlEdges } from './word-navigation-boundaries.ts';
import { segmentWords } from './word-segment.ts';

// U+001F is the model's optional hyphen; U+00AD, ZWNJ and ZWJ also stay inside a word.
const CARET_WORD_CHARACTER = new RegExp(
  "^[\\p{L}\\p{M}\\p{N}'\\u2019\\u001F\\u00AD\\u200C\\u200D]$",
  'u'
);
/** Scripts written without spaces between words, segmented by dictionary. */
const DICTIONARY_SCRIPT = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** A range of canonical offsets: `start` inclusive, `end` exclusive. */
export interface CaretWordRange {
  readonly start: number;
  readonly end: number;
}

/** Whether the UTF-16 unit at `index` belongs to a word character, surrogate pairs whole. */
function isWordAt(text: string, index: number): boolean {
  const unit = text.charCodeAt(index);
  if (Number.isNaN(unit)) return false;
  // A low surrogate belongs to the code point that starts one unit earlier.
  const start = unit >= 0xdc00 && unit <= 0xdfff && index > 0 ? index - 1 : index;
  const codePoint = text.codePointAt(start);
  return codePoint !== undefined && CARET_WORD_CHARACTER.test(String.fromCodePoint(codePoint));
}

/**
 * The ranges of a paragraph that the view hides: gaps between the runs a formatting write
 * may reach. Pictures, note references, and other objects in runs are not gaps.
 */
export function hiddenRevisionRanges(
  part: OoxmlPart,
  paragraphId: string,
  length: number,
  displayMode: FormattingDisplayMode,
  authorFilter?: FormattingRevisionAuthorFilter
): readonly CaretWordRange[] {
  const hidden: CaretWordRange[] = [];
  let cursor = 0;
  for (const slice of formattableRanges(part, paragraphId, 0, length, displayMode, authorFilter)) {
    if (slice.start > cursor) hidden.push({ start: cursor, end: slice.start });
    cursor = Math.max(cursor, slice.end);
  }
  if (cursor < length) hidden.push({ start: cursor, end: length });
  return hidden;
}

/**
 * Paragraph text for word walks: objects spelled as one object character, hidden revision
 * text bridged.
 *
 * A note reference, a field, or an equation paints text of its own, such as a note number,
 * but it is one object, so it ends a word like a picture does. An offset in `hidden` reads as
 * a word character when the characters on both sides of its range are word characters, so a
 * walk crosses it. Every other offset reads as `paragraphTextFromLayout` gives it.
 */
export function wordTextFromLayout(
  layout: SemanticLayout,
  paragraphId: string,
  hidden: readonly CaretWordRange[]
): string {
  const characters = paragraphTextFromLayout(layout, paragraphId).split('');
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      if (!(span.fieldAtom || span.noteNav || span.equation || span.unsupported)) continue;
      const end = Math.min(span.range.end, characters.length);
      for (let offset = span.range.start; offset < end; offset += 1) characters[offset] = OBJECT;
    }
  }
  const text = characters.join('');
  for (const { start, end } of hidden) {
    const to = Math.min(end, characters.length);
    if (start <= 0 || to >= characters.length || start >= to) continue;
    if (!isWordAt(text, start - 1) || !isWordAt(text, to)) continue;
    for (let offset = start; offset < to; offset += 1) characters[offset] = 'a';
  }
  return characters.join('');
}

const OBJECT = '￼';

/**
 * The word a format at a collapsed caret reaches, or null when the caret is not inside one.
 *
 * Inside means a word character on both sides of the caret, with no stop at the caret. A
 * stop (an inline control edge) also ends the word on either side.
 */
export function caretWordRange(
  text: string,
  offset: number,
  stops: ReadonlySet<number>
): CaretWordRange | null {
  const isWord = (index: number) => isWordAt(text, index);
  if (offset <= 0 || offset >= text.length || stops.has(offset)) return null;
  if (!isWord(offset - 1) || !isWord(offset)) return null;
  let start = offset - 1;
  while (start > 0 && isWord(start - 1) && !stops.has(start)) start -= 1;
  let end = offset + 1;
  while (end < text.length && isWord(end) && !stops.has(end)) end += 1;
  const narrowed = dictionaryWord(text, start, end, offset);
  return narrowed === undefined ? { start, end } : narrowed;
}

/**
 * The word a format at a collapsed caret formats in a laid-out paragraph, or null.
 *
 * Null as well when the caret sits inside visible tracked deleted text: a format picked there
 * is for the text typed next, which lands past the deletion, not for the deleted word.
 */
export function caretWordAt(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number,
  hidden: readonly CaretWordRange[]
): CaretWordRange | null {
  if (insideDeletion(layout, paragraphId, offset)) return null;
  return caretWordRange(
    wordTextFromLayout(layout, paragraphId, hidden),
    offset,
    inlineControlEdges(layout, paragraphId)
  );
}

/**
 * The word a collapsed selection sits inside, as a range to select, or null.
 *
 * Commands that act on a word when nothing is selected (a new link, a new comment) select
 * this range first. Inside means the same as for formatting at the caret.
 */
export function caretWordSelection(
  layout: SemanticLayout,
  selection: { readonly anchor: SemanticPosition; readonly head: SemanticPosition }
): { readonly from: SemanticPosition; readonly to: SemanticPosition } | null {
  const { anchor, head } = selection;
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  const word = caretWordAt(layout, head.paragraphId, head.offset, []);
  if (!word) return null;
  return {
    from: { paragraphId: head.paragraphId, offset: word.start },
    to: { paragraphId: head.paragraphId, offset: word.end },
  };
}

function insideDeletion(layout: SemanticLayout, paragraphId: string, offset: number): boolean {
  for (const { line } of paragraphLinesFor(layout, paragraphId) ?? []) {
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      // A span touching the character on either side of the caret.
      const { start, end } = span.range;
      if (start === end || start > offset || end < offset) continue;
      if (span.revisions?.some((entry) => entry.kind === 'delete' || entry.kind === 'moveFrom')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Narrow a run of dictionary-script text to the dictionary word holding the caret.
 *
 * Undefined when the run has no such script; null when the caret falls on a word boundary
 * inside the run, which is an edge rather than the inside of a word.
 */
function dictionaryWord(
  text: string,
  start: number,
  end: number,
  offset: number
): CaretWordRange | null | undefined {
  const run = text.slice(start, end);
  if (!DICTIONARY_SCRIPT.test(run)) return undefined;
  for (const segment of segmentWords(run)) {
    const segmentStart = start + segment.utf16From;
    const segmentEnd = start + segment.utf16To;
    if (offset === segmentStart) return null;
    if (offset > segmentStart && offset < segmentEnd) {
      return { start: segmentStart, end: segmentEnd };
    }
  }
  return null;
}
