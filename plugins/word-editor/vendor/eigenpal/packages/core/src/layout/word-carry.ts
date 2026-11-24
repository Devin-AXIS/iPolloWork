// Moves a word that overflows at a run boundary inside it. Extracted from paragraph-flow so
// that module stays inside its line budget; it is the only consumer.

import { automaticTextSpacingBefore, withAutomaticTextSpacing } from './cjk-automatic-spacing.ts';
import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import { growLineMetricsForText, lineBandText, type PendingLine } from './pending-line.ts';
import { displayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** Where the word being placed opened on its line, and the line state before it. */
export interface WordStart {
  /** Index of the word's first span on the line. */
  readonly span: number;
  /** Pen position when the word opened. */
  readonly width: number;
  readonly end: number;
  /** Line metrics before the word, including drawings and equations it cannot regrow. */
  readonly height: number;
  readonly baseline: number;
}

/** The placement steps of the paragraph being broken, shared with its ordinary words. */
export interface WordCarryContext {
  readonly line: () => PendingLine;
  readonly measurer: TextMeasurer;
  readonly pageBreaksIgnored: boolean;
  /** Whether the line holds anything a word must follow. */
  readonly holdsContent: () => boolean;
  readonly closeLine: () => void;
  readonly ensurePlacementWidth: (width: number) => boolean;
  readonly tryAdvanceToNextPassage: () => boolean;
  readonly lineAvailable: () => number;
  readonly lineOrigin: () => number;
  readonly applyNarrowWrapSkipIfNeeded: (
    text: string,
    style: PendingLine['spans'][number]['style']
  ) => void;
  readonly setProbeWidth: (width: number) => void;
}

/** The word start of a line that holds nothing yet. */
export function wordStartOf(line: PendingLine, span = 0, width = 0): WordStart {
  return { span, width, end: line.end, height: line.height, baseline: line.baseline };
}

/** Whether only ignored page breaks, which hold no content, precede span `index`. */
function opensLine(line: PendingLine, index: number, pageBreaksIgnored: boolean): boolean {
  if (line.drawings.length > 0) return false;
  for (let before = 0; before < index; before += 1) {
    if (!pageBreaksIgnored || line.spans[before]!.text !== PAGE_BREAK_CHAR) return false;
  }
  return true;
}

/** Restore the line to where the word opened; its spans stay on the line. */
function restoreWordStart(line: PendingLine, start: WordStart): void {
  line.width = start.width;
  line.end = start.end;
  line.height = start.height;
  line.baseline = start.baseline;
}

/** Clear the destination line for the word's first glyph and snap the pen into its passage. */
function settlePen(context: WordCarryContext, first: StyleSpanRecord | undefined): void {
  if (first) {
    context.applyNarrowWrapSkipIfNeeded(first.text, styleForFontSlot(first.style, first.fontSlot));
  }
  context.lineAvailable();
}

/** Choose where a word goes on a line that holds nothing before it. */
function placeOpeningWord(
  context: WordCarryContext,
  wordWidth: number,
  first: StyleSpanRecord | undefined
): void {
  // `lineAvailable` is a capacity measured from the line origin, and reading it snaps the
  // pen into the first passage. The word needs the room ahead of that pen.
  const capacity = context.lineAvailable();
  if (wordWidth > capacity - context.line().width + 0.001) context.ensurePlacementWidth(wordWidth);
  settlePen(context, first);
}

/** Lay the word's spans again from the pen, regrowing the line metrics they set. */
function relayWord(context: WordCarryContext, carried: readonly StyleSpanRecord[]): void {
  const line = context.line();
  for (const [index, span] of carried.entries()) {
    const gap = index === 0 ? 0 : automaticTextSpacingBefore(span);
    line.width += gap;
    line.spans.push(
      withAutomaticTextSpacing(
        { ...span, box: { ...span.box, x: context.lineOrigin() + line.width } },
        gap
      )
    );
    line.width += span.box.width;
    line.end = span.range.end;
    // An ignored cell page break adds no height, as when first placed.
    if (context.pageBreaksIgnored && span.text === PAGE_BREAK_CHAR) continue;
    const style = styleForFontSlot(span.style, span.fontSlot);
    const text = lineBandText(span, displayText(span.text, style));
    growLineMetricsForText(line, context.measurer.lineMetrics(style, text), span.text, style);
  }
}

/**
 * Place a word that already opens its line without moving its spans when it stays put.
 *
 * Pieces that cannot be chopped (field results, note marks) keep one overflowing word on its
 * line, and each further piece carries the word again. Laying every span again per piece made
 * that quadratic. This runs the same placement steps against the line as it was when the word
 * opened, with the word's spans hidden, and lays them again only when the pen or the line's
 * clearance moved.
 *
 * Returns false when the word must be carried the ordinary way: it does not open its line, or
 * the pen is not at its last span's end (it left the word for a later passage).
 */
function settleOpeningWord(
  context: WordCarryContext,
  start: WordStart,
  pendingWidth: number
): boolean {
  const line = context.line();
  const placed = line.spans;
  const first = placed[start.span];
  const last = placed[placed.length - 1];
  const pen = context.lineOrigin() + line.width;
  if (
    !first ||
    !last ||
    Math.abs(pen - last.box.x - last.box.width) > 0.001 ||
    !opensLine(line, start.span, context.pageBreaksIgnored)
  ) {
    return false;
  }
  const kept = { width: line.width, end: line.end, height: line.height, baseline: line.baseline };
  const skip = line.exclusionSkipBefore;
  // The spans sit side by side, so the word is as wide as the distance from its first to the pen.
  const wordWidth = pen - first.box.x + pendingWidth;
  restoreWordStart(line, start);
  // Ignored page breaks before the word hold no content and block no passage, so the line
  // with no spans takes the same steps as the line with them.
  (line as { spans: StyleSpanRecord[] }).spans = [];
  context.setProbeWidth(wordWidth);
  placeOpeningWord(context, wordWidth, first);
  (line as { spans: StyleSpanRecord[] }).spans = placed;
  if (
    line.exclusionSkipBefore === skip &&
    Math.abs(context.lineOrigin() + line.width - first.box.x) <= 0.001
  ) {
    Object.assign(line, kept);
  } else {
    relayWord(context, placed.splice(start.span));
  }
  context.setProbeWidth(pendingWidth);
  return true;
}

/**
 * Place a word again, as a whole, when the run being added to it overflows.
 *
 * A run boundary is not a break opportunity, so the word must land where the same text in
 * one run would: the next passage on this line when the whole word fits there, otherwise
 * the next line, in the first passage wide enough for it. `pendingWidth` is the overflowing
 * candidate, which the caller places after the word's earlier spans.
 */
export function carryPartialWord(
  context: WordCarryContext,
  start: WordStart,
  pendingWidth: number
): WordStart {
  if (settleOpeningWord(context, start, pendingWidth)) return start;
  let line = context.line();
  const carried = line.spans.splice(start.span);
  restoreWordStart(line, start);
  const wordWidth = carried.reduce(
    (sum, span, index) =>
      sum + span.box.width + (index === 0 ? 0 : automaticTextSpacingBefore(span)),
    pendingWidth
  );
  context.setProbeWidth(wordWidth);
  let next = start;
  const first = carried[0];
  if (context.holdsContent()) {
    if (
      !context.tryAdvanceToNextPassage() ||
      line.width + wordWidth > context.lineAvailable() + 0.001
    ) {
      context.closeLine();
      line = context.line();
      context.ensurePlacementWidth(wordWidth);
      next = wordStartOf(line);
    }
    settlePen(context, first);
  } else {
    placeOpeningWord(context, wordWidth, first);
  }
  relayWord(context, carried);
  context.setProbeWidth(pendingWidth);
  return next;
}
