// Line breaks at optional hyphens (`w:softHyphen`).
//
// An optional hyphen is one model character that lays out as U+00AD with no advance. It is
// also a break opportunity: when a word overflows, the line may end after the LAST optional
// hyphen of that word whose visible hyphen still fits, and the line then shows a hyphen there.
// The hyphen's advance counts toward the line, so alignment and justification include it.
// The span keeps its U+00AD text and one-character range, so copy, search, and offsets do not
// change. Only paint and export draw a different glyph, from `optionalHyphenBreak`.

import type { PendingLine } from './pending-line.ts';
import { joiningCutDelta, trimJoiningAtHyphen } from './optional-hyphen-joining.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import { carryPartialWord, type WordCarryContext, type WordStart } from './word-carry.ts';

/** How an optional hyphen lays out: U+00AD with no advance. */
const OPTIONAL_HYPHEN_GLYPH = '\u00ad';
/** The glyph drawn where a line breaks at an optional hyphen. */
export const VISIBLE_OPTIONAL_HYPHEN = '-';

/**
 * Whether a laid-out span is one optional hyphen element. Layout owns its glyph (`projected`),
 * which tells it apart from a literal U+00AD in `w:t`, an ordinary visible hyphen.
 */
export function isOptionalHyphenSpan(span: StyleSpanRecord): boolean {
  return (
    span.text === OPTIONAL_HYPHEN_GLYPH &&
    span.range.end - span.range.start === 1 &&
    span.projected === true
  );
}

/**
 * The text paint draws for a span, one character per model character: a hyphen where a line
 * breaks at an optional hyphen, nothing visible for any other optional hyphen, and a hyphen
 * for a literal U+00AD in `w:t`.
 */
export function paintedSpanText(span: StyleSpanRecord): string {
  if (span.optionalHyphenBreak) return VISIBLE_OPTIONAL_HYPHEN;
  if (isOptionalHyphenSpan(span) || !span.text.includes(OPTIONAL_HYPHEN_GLYPH)) return span.text;
  return span.text.replaceAll(OPTIONAL_HYPHEN_GLYPH, VISIBLE_OPTIONAL_HYPHEN);
}

function visibleHyphenWidth(span: StyleSpanRecord, measurer: TextMeasurer): number {
  return measurer.measure(VISIBLE_OPTIONAL_HYPHEN, styleForFontSlot(span.style, span.fontSlot));
}

/**
 * Where an overflowing word may break instead of moving whole: just after the last optional
 * hyphen at or after span `wordStart` whose visible hyphen fits on the line, with the letters
 * before it in their unjoined forms. The result is the start of the word's remainder, for
 * `carryPartialWord`. Null when no optional hyphen fits.
 */
export function optionalHyphenBreakStart(
  line: PendingLine,
  wordStart: number,
  lineOrigin: number,
  lineAvailable: number,
  measurer: TextMeasurer,
  tolerance: number
): WordStart | null {
  for (let index = line.spans.length - 1; index >= Math.max(0, wordStart); index -= 1) {
    const span = line.spans[index]!;
    if (!isOptionalHyphenSpan(span)) continue;
    const width = span.box.x + span.box.width - lineOrigin;
    const unjoined = joiningCutDelta(line.spans[index - 1], 'after', measurer);
    if (width + unjoined + visibleHyphenWidth(span, measurer) > lineAvailable + tolerance) {
      continue;
    }
    return {
      span: index + 1,
      width,
      end: span.range.end,
      height: line.height,
      baseline: line.baseline,
    };
  }
  return null;
}

/**
 * Show the optional hyphen that ends `line`: its box takes the visible hyphen's advance, and
 * the line grows by it. The span is layout-owned, so the caret reads this box, mirrored in
 * right-to-left text, and sits after the drawn hyphen.
 */
export function showOptionalHyphenAtLineEnd(line: PendingLine, measurer: TextMeasurer): void {
  if (!isOptionalHyphenSpan(line.spans.at(-1)!) || line.spans.at(-1)!.optionalHyphenBreak) return;
  trimJoiningAtHyphen(line, line.spans.length - 2, 'after', measurer);
  const last = line.spans.at(-1)!;
  const width = visibleHyphenWidth(last, measurer);
  line.spans[line.spans.length - 1] = {
    ...last,
    box: { ...last.box, width },
    optionalHyphenBreak: true,
  };
  line.width += width - last.box.width;
}

/**
 * `carryPartialWord`, with the word's optional hyphens as break opportunities.
 *
 * When the candidate overflows, the word breaks after its last optional hyphen that fits.
 * Without one, the word moves whole, and its remainder breaks again on the line it moved to
 * while it still overflows there.
 */
export function carryWordAtOptionalHyphens(
  context: WordCarryContext,
  start: WordStart,
  pendingWidth: number,
  overflows: boolean,
  tolerance: number
): WordStart {
  const atHyphen: WordCarryContext = {
    ...context,
    closeLine: () => {
      showOptionalHyphenAtLineEnd(context.line(), context.measurer);
      context.closeLine();
    },
  };
  const hyphenStart = (from: number): WordStart | null =>
    overflows && context.line().width + pendingWidth > context.lineAvailable() + tolerance
      ? optionalHyphenBreakStart(
          context.line(),
          from,
          context.lineOrigin(),
          context.lineAvailable(),
          context.measurer,
          tolerance
        )
      : null;
  let hyphen = hyphenStart(start.span);
  let next = hyphen ? start : carryPartialWord(context, start, pendingWidth);
  if (!hyphen) hyphen = hyphenStart(next.span);
  // Each break closes a line before the hyphen it used, so the loop ends.
  while (hyphen) {
    const line = context.line();
    next = carryPartialWord(atHyphen, hyphen, pendingWidth);
    if (context.line() === line) break;
    // The carried letters no longer join back across the hyphen; the next fit sees that.
    trimJoiningAtHyphen(context.line(), 0, 'before', context.measurer);
    hyphen = hyphenStart(next.span);
  }
  return next;
}
