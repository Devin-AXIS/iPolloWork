import type { HighlightRange } from '../contracts/editor-highlights.ts';
import type { ParagraphText } from '../contracts/editor-paragraph-text.ts';

/**
 * Highlight ranges for the `acceptedText` range from `from` to `to` (UTF-16 offsets, `to`
 * exclusive), with `expectedText` set so a range stops painting if its text changes.
 *
 * Accepted text leaves out tracked deletions and hidden text, so one checked word can cover
 * several stretches of the paragraph. You get one range for each stretch, and an empty
 * array when the range is empty or outside `acceptedText`. To mark a word with one mark,
 * cover the first range's start to the last range's end.
 *
 * @example
 * ```ts
 * const ranges = editor.getParagraphs().flatMap((paragraph) =>
 *   [...paragraph.acceptedText.matchAll(/\bteh\b/g)].flatMap((match) =>
 *     acceptedTextRanges(paragraph, match.index, match.index + match[0].length)
 *   )
 * );
 * editor.setHighlights('spelling', ranges);
 * ```
 * @public
 */
export function acceptedTextRanges(
  paragraph: ParagraphText,
  from: number,
  to: number
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const span of paragraph.acceptedSpans) {
    const acceptedStart = Math.max(from, span.acceptedStart);
    const acceptedEnd = Math.min(to, span.acceptedStart + span.length);
    if (acceptedStart >= acceptedEnd) continue;
    const start = span.start + acceptedStart - span.acceptedStart;
    const length = acceptedEnd - acceptedStart;
    const expectedText = paragraph.text.slice(start, start + length);
    ranges.push({ blockId: paragraph.blockId, start, length, expectedText });
  }
  return ranges;
}

/**
 * The `acceptedText` offset for a `ParagraphText.text` offset, such as the caret's
 * `getSelectionRange().head.offset`.
 *
 * An offset inside text that `acceptedText` leaves out, such as a tracked deletion, hidden
 * text, or a field read with `{ fields: 'result' }`, maps to the accepted offset where that
 * gap starts. An offset past either end is clamped to it.
 *
 * @example
 * ```ts
 * const caret = editor.getSelectionRange()?.head;
 * const paragraph = caret && editor.getParagraphText(caret.blockId);
 * const at = paragraph ? acceptedOffsetFromText(paragraph, caret.offset) : -1;
 * ```
 * @public
 */
export function acceptedOffsetFromText(paragraph: ParagraphText, offset: number): number {
  let accepted = 0;
  for (const span of paragraph.acceptedSpans) {
    if (offset < span.start) break;
    if (offset < span.start + span.length) return span.acceptedStart + offset - span.start;
    accepted = span.acceptedStart + span.length;
  }
  return Math.min(accepted, paragraph.acceptedText.length);
}

/**
 * The `ParagraphText.text` offset for an `acceptedText` offset, for example to place the
 * caret or to start a highlight.
 *
 * An offset at a gap, where `acceptedText` leaves out text, maps to the end of the accepted
 * text before the gap, so text inserted there follows the text before it. An offset inside
 * text that has no `text` offsets, a field read with `{ fields: 'result' }`, maps to the end
 * of the span before it. An offset past either end is clamped to it.
 * @public
 */
export function textOffsetFromAccepted(paragraph: ParagraphText, offset: number): number {
  let text = 0;
  for (const span of paragraph.acceptedSpans) {
    if (offset < span.acceptedStart) break;
    if (offset < span.acceptedStart + span.length) return span.start + offset - span.acceptedStart;
    text = span.start + span.length;
    if (offset === span.acceptedStart + span.length) return text;
  }
  return Math.min(text, paragraph.text.length);
}
