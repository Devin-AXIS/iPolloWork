// Joining across optional hyphens.
//
// Inside a line, bidi resolution keeps an optional hyphen's U+00AD in the joining context of
// the letters around it (`withJoiningContext`), and the shaper treats it as transparent, so
// the letters join. Where a line breaks at the hyphen they must not: the context is cut at
// the hyphen on both sides, and the letters take their unjoined forms, which have their own
// widths.

import type { PendingLine } from './pending-line.ts';
import { displayText, type ResolvedRunStyle } from './run-style.ts';
import { styleForFontSlot, type FontSlot } from './script-itemization.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

const OPTIONAL_HYPHEN_GLYPH = '\u00ad';

/**
 * `style` with its joining context cut at an optional hyphen on `side`, or null when the
 * context does not reach across one there.
 */
export function styleCutAtHyphen(
  style: ResolvedRunStyle,
  side: 'before' | 'after'
): ResolvedRunStyle | null {
  const shaping = style.shaping;
  const context = shaping?.context;
  if (!shaping || !context) return null;
  const text = context[side];
  const reaches =
    side === 'after'
      ? text.startsWith(OPTIONAL_HYPHEN_GLYPH)
      : text.endsWith(OPTIONAL_HYPHEN_GLYPH);
  if (!reaches) return null;
  const trimmed = { ...context, [side]: '' };
  const { context: _cut, ...unjoined } = shaping;
  return {
    ...style,
    shaping: trimmed.before || trimmed.after ? { ...unjoined, context: trimmed } : unjoined,
  };
}

/** The advance of `text` in `style`, as layout measures it. */
export function measuredWidth(
  text: string,
  style: ResolvedRunStyle,
  fontSlot: FontSlot | undefined,
  measurer: TextMeasurer
): number {
  const face = styleForFontSlot(style, fontSlot);
  return measurer.measure(displayText(text, face), face);
}

/** How much wider `span` gets when its context is cut on `side`; zero when it is not. */
export function joiningCutDelta(
  span: StyleSpanRecord | undefined,
  side: 'before' | 'after',
  measurer: TextMeasurer
): number {
  const style = span && styleCutAtHyphen(span.style, side);
  if (!span || !style) return 0;
  return measuredWidth(span.text, style, span.fontSlot, measurer) - span.box.width;
}

/**
 * Cut the joining context of span `index` on `side`, measure it again, and move the spans
 * after it on the line by the change.
 */
export function trimJoiningAtHyphen(
  line: PendingLine,
  index: number,
  side: 'before' | 'after',
  measurer: TextMeasurer
): void {
  const span = line.spans[index];
  const style = span && styleCutAtHyphen(span.style, side);
  if (!span || !style) return;
  const width = measuredWidth(span.text, style, span.fontSlot, measurer);
  const delta = width - span.box.width;
  line.spans[index] = { ...span, style, box: { ...span.box, width } };
  for (let after = index + 1; after < line.spans.length; after += 1) {
    const moved = line.spans[after]!;
    line.spans[after] = { ...moved, box: { ...moved.box, x: moved.box.x + delta } };
  }
  line.width += delta;
}
