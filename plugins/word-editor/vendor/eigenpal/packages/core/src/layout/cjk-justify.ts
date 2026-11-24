// East Asian justification of a line that holds East Asian text.
//
// The slack first fills each stretchable seam up to its capacity: a U+0020 space takes a
// bounded share of its own advance, and an automatic inter-script gap grows up to twice its
// natural size. The rest goes in equal steps to every slot: each boundary between two East
// Asian characters (punctuation and brackets included, whatever the line-break rules allow
// there), each boundary that holds an automatic inter-script gap, and each boundary after a
// space. A character is East Asian by its code point or by its East Asian font slot, so a
// symbol hinted to the East Asian face counts. Text of other scripts keeps its letters
// together, and so do Korean syllables, except on a distributed line. Inter-character justification uses
// real span geometry. Paint and exporters already consume the gaps between spans; no
// browser-only text-justify rule may move the caret.
import { endsWithSpaceSlot, withoutTrailingZeroWidthSpaces } from './trailing-spaces.ts';
import { segmentGraphemes } from './grapheme.ts';
import { hasCjkText, isCjk, isHangul } from './cjk-paragraph-breaks.ts';
import { lastCodePointOf } from './cjk-line-break.ts';
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
import { spaceSlackCapacity } from './distributed-character-spacing.ts';
import { fitTextGroupOf, insideFitTextGroup } from './fit-text-groups.ts';
import type { DistributedSpacing } from './distributed-spacing.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { isSplittableSpan, splitSpanParts, type SpanPart } from './span-parts.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** Characters that join their neighbours: no slot opens next to them. */
const JOINERS = /[\u00a0\u202f\u2060\ufeff]/u;

/** The placeholder character of an inline object, such as an inline picture. */
const INLINE_OBJECT = 0xfffc;

/**
 * Whether two adjacent code points are Korean syllables or jamo. Only a distributed line
 * opens a gap between them; a justified Korean line stretches its spaces.
 */
function koreanPair(before: number, after: number): boolean {
  return isHangul(before) && isHangul(after);
}

/**
 * Split a span where justification may open a gap: next to each East Asian character (every
 * character of a span in the East Asian font slot), and after each run of U+0020 spaces.
 * Right-to-left text keeps its spaces whole, and Korean words stay whole unless `distributed`.
 */
function slotParts(span: StyleSpanRecord, distributed: boolean): SpanPart[] {
  const clusters = segmentGraphemes(span.text);
  const rtl = span.style.shaping?.direction === 'rtl';
  const eastAsianSlot = span.fontSlot === 'eastAsia';
  const parts: SpanPart[] = [];
  let from = 0;
  for (let index = 1; index < clusters.length; index++) {
    const previous = clusters[index - 1]!.text;
    const current = clusters[index]!.text;
    const before = lastCodePointOf(previous)!;
    const after = current.codePointAt(0)!;
    if (!distributed && koreanPair(before, after)) continue;
    if (
      eastAsianSlot ||
      isCjk(before) ||
      isCjk(after) ||
      (!rtl && previous === ' ' && current !== ' ')
    ) {
      parts.push({ from, to: clusters[index]!.utf16From });
      from = clusters[index]!.utf16From;
    }
  }
  parts.push({ from, to: span.text.length });
  return parts;
}

/** The U+0020 spaces that close `text`, before any trailing zero-width space. */
function trailingSpaceCount(text: string): number {
  const visible = withoutTrailingZeroWidthSpaces(text);
  let count = 0;
  while (count < visible.length && visible[visible.length - 1 - count] === ' ') count += 1;
  return count;
}

/**
 * Justify a line holding East Asian text by `slack`. Returns null when the line holds no
 * East Asian text, the spans unchanged when it has no slot (the caller then sets it as it
 * would a line with nothing to stretch), and otherwise the spans with the gaps applied.
 * `spacing` selects the space share, as for a distributed line; ordinary justified lines
 * (`spacing` undefined) take the `'characters'` share and keep Korean words whole.
 */
export function justifyCjkSpans(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  spacing?: DistributedSpacing
): readonly StyleSpanRecord[] | null {
  if (!spans.some((span) => hasCjkText(span.text))) return null;
  // Tabs and float passages reserve exact positions, which justification must not cross.
  if (spans.some((span) => span.text.includes('\t') || span.wrapAdvanceBefore)) return spans;
  const share = spacing === 'legacyCharacters' ? 'legacyCharacters' : 'characters';
  const split: StyleSpanRecord[] = [];
  for (const span of spans) {
    // A fitted group keeps its own spacing, so it is never split into slots.
    const parts =
      isSplittableSpan(span) && fitTextGroupOf(span) === undefined
        ? slotParts(span, spacing !== undefined)
        : [];
    if (parts.length < 2) split.push(span);
    else split.push(...splitSpanParts(span, parts, measurer));
  }
  const slots = new Set<number>();
  /** Slack a slot takes before the equal steps: its spaces' share or its automatic gap. */
  const capacities = new Map<number, number>();
  let totalCapacity = 0;
  for (let index = 1; index < split.length; index++) {
    const previous = split[index - 1]!;
    const current = split[index]!;
    const before = lastCodePointOf(previous.text);
    const after = current.text.codePointAt(0);
    if (
      before === undefined ||
      after === undefined ||
      current.lineEndWhitespace ||
      current.text === '\n' ||
      insideFitTextGroup(previous, current) ||
      JOINERS.test(previous.text.slice(-1) + current.text[0])
    )
      continue;
    // An inline object (U+FFFC, such as an inline picture) takes the gaps of an East Asian
    // character beside East Asian text.
    const eastAsianBefore =
      isCjk(before) || before === INLINE_OBJECT || previous.fontSlot === 'eastAsia';
    const eastAsianAfter =
      isCjk(after) || after === INLINE_OBJECT || current.fontSlot === 'eastAsia';
    let capacity = 0;
    if (endsWithSpaceSlot(previous.text)) {
      const own = measureDisplayText(
        ' ',
        styleForFontSlot(previous.style, previous.fontSlot),
        measurer
      );
      capacity =
        trailingSpaceCount(previous.text) * spaceSlackCapacity(previous, own, measurer, share);
    } else if (current.text.startsWith(' ')) {
      // The space itself is the slot; the boundary before it opens nothing.
      continue;
    } else if (spacing === undefined && koreanPair(before, after)) {
      continue;
    } else if (!(eastAsianBefore && eastAsianAfter)) {
      // Between an East Asian character and other text, only an automatic gap stretches.
      const gap = eastAsianBefore || eastAsianAfter ? automaticTextSpacingBefore(current) : 0;
      if (gap <= 0) continue;
      capacity = gap;
    }
    slots.add(index);
    if (capacity > 0) {
      capacities.set(index, capacity);
      totalCapacity += capacity;
    }
  }
  if (slots.size === 0) return spans;
  const filled = totalCapacity > 0 ? Math.min(1, slack / totalCapacity) : 0;
  const step = (slack - filled * totalCapacity) / slots.size;
  let shift = 0;
  return split.map((span, index) => {
    if (slots.has(index)) shift += step + filled * (capacities.get(index) ?? 0);
    return shift === 0 ? span : { ...span, box: { ...span.box, x: span.box.x + shift } };
  });
}
