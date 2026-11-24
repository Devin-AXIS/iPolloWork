import { unchangedLtrLine } from './unchanged-ltr-line.ts';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { isCollapsibleLineEndWhitespace } from './line-end-whitespace.ts';
import { reorderBidiSpans } from './rtl-paragraph.ts';
import type { StyleSpanRecord } from './semantic-records.ts';

const EDGE_TOLERANCE_PT = 1e-6;

/** Aligns logical spans in a measure `available` wide, `usedWidth` of it taken. */
type AlignContent = (
  content: readonly StyleSpanRecord[],
  available: number,
  usedWidth: number | undefined
) => readonly StyleSpanRecord[];

/**
 * The spaces that end a bidi line, and how alignment treats them.
 *
 * Trailing spaces keep their resolved bidi level, so they stand beside the text they follow:
 * on its right after left-to-right text, on its left after right-to-left text. Spaces that
 * hang leave the visible text aligned without them. Spaces that do not hang take room on the
 * line like text.
 *
 * At a line wrap the spaces hang when their resolved direction is their run's (`w:rtl`)
 * direction: a space between two right-to-left words of a left-to-right run takes room. At
 * the end of the paragraph they hang only when their run has the paragraph's direction.
 */
interface TrailingSpaces {
  /** Index of the first trailing space or zero-width break. */
  readonly from: number;
  readonly side: 'left' | 'right';
  readonly hangs: boolean;
}

/**
 * Where the spaces, and zero-width line and page breaks, after a line's last visible content
 * start. Returns `spans.length` when the line has none, or when it has no visible content.
 */
function trailingSpacesStart(spans: readonly StyleSpanRecord[]): number {
  let start = spans.length;
  while (
    start > 0 &&
    (isCollapsibleLineEndWhitespace(spans[start - 1]!.text) ||
      ((spans[start - 1]!.text === '\n' || spans[start - 1]!.text === PAGE_BREAK_CHAR) &&
        spans[start - 1]!.box.width === 0))
  )
    start--;
  return start === 0 ? spans.length : start;
}

/**
 * The trailing spaces of a shaped line whose layout the plain path gets wrong, or undefined.
 * The plain path hangs trailing spaces past the right edge, which is right only for spaces
 * that stand there and hang: those of a left-to-right paragraph's own direction.
 */
export function bidiTrailingSpaces(
  spans: readonly StyleSpanRecord[],
  paragraphRtl: boolean,
  isLastLine: boolean,
  pageBreaksIgnored: boolean
): TrailingSpaces | undefined {
  if (!paragraphRtl && unchangedLtrLine(spans)) return undefined;
  if (!spans.some((span) => span.style.shaping)) return undefined;
  const from = trailingSpacesStart(spans);
  if (from === spans.length) return undefined;
  // Which side reordering puts the spaces on. Their order does not depend on positions.
  const trial = reorderBidiSpans(spans, paragraphRtl, pageBreaksIgnored);
  let contentStart = Infinity;
  let contentEnd = -Infinity;
  let spacesStart = Infinity;
  let spacesEnd = -Infinity;
  let runRtl: boolean | undefined;
  let levelRtl = paragraphRtl;
  trial.forEach((span, index) => {
    if (index < from) {
      contentStart = Math.min(contentStart, span.box.x);
      contentEnd = Math.max(contentEnd, span.box.x + span.box.width);
    } else if (isCollapsibleLineEndWhitespace(span.text)) {
      spacesStart = Math.min(spacesStart, span.box.x);
      spacesEnd = Math.max(spacesEnd, span.box.x + span.box.width);
      if (runRtl !== undefined) return;
      const shaping = span.style.shaping;
      // Without run directions the line reorders by UAX #9 alone, whose rule L1 gives
      // line-end spaces the paragraph's level.
      runRtl = shaping?.runDirection === undefined ? paragraphRtl : shaping.runDirection === 'rtl';
      levelRtl = shaping?.runDirection === undefined ? paragraphRtl : shaping.level % 2 === 1;
    }
  });
  if (runRtl === undefined) {
    // Only breaks: they take the paragraph's direction, at its end side.
    return paragraphRtl ? { from, side: 'left', hangs: true } : undefined;
  }
  const side =
    spacesEnd <= contentStart + EDGE_TOLERANCE_PT
      ? 'left'
      : spacesStart >= contentEnd - EDGE_TOLERANCE_PT
        ? 'right'
        : undefined;
  // Spaces between two runs of text cannot hang off either edge.
  if (side === undefined) return { from, side: 'right', hangs: false };
  const hangs = isLastLine ? runRtl === paragraphRtl : levelRtl === runRtl;
  if (hangs && side === 'right' && !paragraphRtl) return undefined;
  return { from, side, hangs };
}

/**
 * Align a line whose trailing spaces {@link bidiTrailingSpaces} places, and reorder it.
 *
 * Spaces that take room shorten the measure the text aligns in, and stand beside it. Spaces
 * that hang leave the text where alignment puts it, and stop at the edge of their side.
 */
export function alignBidiTrailingSpaces(
  split: readonly StyleSpanRecord[],
  trailing: TrailingSpaces,
  align: AlignContent,
  indentLeft: number,
  available: number,
  lineUsedWidth: number | undefined,
  paragraphRtl: boolean,
  pageBreaksIgnored: boolean
): readonly StyleSpanRecord[] {
  const { from, side, hangs } = trailing;
  const content = split.slice(0, from);
  const spacesWidth = split.slice(from).reduce((width, span) => width + span.box.width, 0);
  const aligned = align(
    content,
    hangs ? available : Math.max(0, available - spacesWidth),
    lineUsedWidth === undefined ? undefined : Math.max(0, lineUsedWidth - spacesWidth)
  );
  // CJK justification may split the content into more spans, so count them after alignment.
  const count = aligned.length;
  const end = (span: StyleSpanRecord) => span.box.x + span.box.width;
  const moved = end(aligned[count - 1]!) - end(content[from - 1]!);
  const spaces = split
    .slice(from)
    .map((span) => ({ ...span, box: { ...span.box, x: span.box.x + moved } }));
  const reordered = reorderBidiSpans([...aligned, ...spaces], paragraphRtl, pageBreaksIgnored);
  // Spaces that take room stand in the block reordering lays out from the aligned start.
  if (!hangs) return reordered;
  // Exclusion passages reorder on their own, and only the last one holds the line's end.
  // CJK justification leaves a line with passages unsplit, so these indexes match `content`.
  let passageStart = count - 1;
  while (passageStart > 0 && !((aligned[passageStart]!.wrapAdvanceBefore ?? 0) > 0)) passageStart--;
  let alignedStart = Infinity;
  let alignedEnd = -Infinity;
  let reorderedStart = Infinity;
  for (let index = passageStart; index < count; index++) {
    alignedStart = Math.min(alignedStart, aligned[index]!.box.x);
    alignedEnd = Math.max(alignedEnd, end(aligned[index]!));
    reorderedStart = Math.min(reorderedStart, reordered[index]!.box.x);
  }
  const shift = alignedStart - reorderedStart;
  // Hanging spaces stop at the line's edge on their side, or at the start of the passage
  // that holds them.
  const leftEdge = Math.min(
    passageStart === 0 ? indentLeft : content[passageStart]!.box.x,
    alignedStart
  );
  const rightEdge = Math.max(indentLeft + available, alignedEnd);
  const clip = (x: number) => (side === 'left' ? Math.max(x, leftEdge) : Math.min(x, rightEdge));
  return reordered.map((span, index) => {
    if (index < passageStart) return span;
    const x = span.box.x + shift;
    if (index < count) return shift === 0 ? span : { ...span, box: { ...span.box, x } };
    const start = clip(x);
    const width = Math.max(0, clip(x + span.box.width) - start);
    if (start === span.box.x && width === span.box.width) return span;
    const placed = { ...span, box: { ...span.box, x: start, width } };
    // Paint clips a space's ink to its box only when the span says it hangs.
    return width < span.box.width && isCollapsibleLineEndWhitespace(span.text)
      ? { ...placed, lineEndWhitespace: true as const }
      : placed;
  });
}
