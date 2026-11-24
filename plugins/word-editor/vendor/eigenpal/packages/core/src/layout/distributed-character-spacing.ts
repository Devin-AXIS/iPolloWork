// Character distribution for the lines of a distributed paragraph.
//
// When the document selects it (`distributed-spacing.ts`), a distributed paragraph (`w:jc
// w:val="distribute"`) sets every line across its measure character by character: each space
// first takes a bounded share of the slack, and the rest goes in equal steps after every
// character. A line whose slack its spaces can absorb therefore sets as a justified line. The
// gaps are real span geometry, as in East Asian justification, so paint, PDF export, the caret
// and hit testing read one layout.
import { isBalancedSpace, unwidenedStyle } from './balanced-space-widths.ts';
import { authoredCjkGapMetric } from './cjk-auto-spacing-metric-port.ts';
import { automaticTextSpacingBefore } from './cjk-automatic-spacing.ts';
import { knownFamilyReverseGap } from './authored-average-widths.ts';
import { fitTextGroupOf, insideFitTextGroup } from './fit-text-groups.ts';
import type { DistributedSpacing } from './distributed-spacing.ts';
import { segmentGraphemes } from './grapheme.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { isSplittableSpan, splitSpanParts } from './span-parts.ts';
import { isCjk } from './cjk-paragraph-breaks.ts';
import { lastCodePointOf } from './cjk-line-break.ts';
import { isRunKerningEnabled } from './run-kerning.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';

/** In `'characters'` spacing, how much of its own advance a U+0020 takes from the slack first. */
export const SPACE_SHARE_LIMIT = 0.45;

/**
 * How much of the slack one U+0020 of advance `own` takes before any character gap does. In
 * `'legacyCharacters'` spacing it is the face's average character width less the space's own
 * advance; a face with no known average width takes the `'characters'` share instead.
 */
export function spaceSlackCapacity(
  space: StyleSpanRecord,
  own: number,
  measurer: TextMeasurer,
  spacing: Exclude<DistributedSpacing, 'spaces'>
): number {
  if (spacing === 'characters') {
    // Balanced width affects fitting, but the distribution limit uses the original glyph.
    // This capacity can be negative when balancing already exceeds that limit.
    if (isBalancedSpace(space)) {
      const style = styleForFontSlot(unwidenedStyle(space.style), space.fontSlot);
      const natural = measureDisplayText(' ', style, measurer);
      return (1 + SPACE_SHARE_LIMIT) * natural - own;
    }
    return SPACE_SHARE_LIMIT * own;
  }
  const style = styleForFontSlot(space.style, space.fontSlot);
  // Both metrics return half the face's average character width (the East Asian automatic
  // spacing gap), so double it.
  const half = authoredCjkGapMetric(measurer, style) ?? knownFamilyReverseGap(style);
  return half === undefined ? SPACE_SHARE_LIMIT * own : Math.max(0, 2 * half - own);
}

const VISIBLE_WIDTH_PT = 1e-6;

/** Characters that take no room and open no gap. */
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/u;

/**
 * Whether the spaces of `spans[0, contentEnd)` can take all of `slack` within their share. The
 * line then sets as a justified line with no character gap, so the caller stretches its spaces
 * and splits nothing. Reads the spans as {@link distributeLineCharacters} would split them.
 */
export function spacesAbsorbSlack(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  contentEnd: number,
  spacing: Exclude<DistributedSpacing, 'spaces'>
): boolean {
  let capacity = 0;
  let pending = 0;
  let seen = false;
  for (let index = 0; index < contentEnd; index++) {
    const span = spans[index]!;
    if (!isSplittableSpan(span) || span.style.shaping?.direction === 'rtl') {
      if (span.box.width > VISIBLE_WIDTH_PT) {
        if (seen) capacity += pending;
        pending = 0;
        seen = true;
      }
      continue;
    }
    let own: number | undefined;
    const fitted = fitTextGroupOf(span) !== undefined;
    for (const character of span.text) {
      if (character === ' ') {
        // A space inside a fitted group takes no share: the group keeps its stated width.
        if (!seen || fitted) continue;
        own ??= measureDisplayText(' ', styleForFontSlot(span.style, span.fontSlot), measurer);
        pending += spaceSlackCapacity(span, own, measurer, spacing);
      } else if (!ZERO_WIDTH.test(character)) {
        if (seen) capacity += pending;
        pending = 0;
        seen = true;
      }
    }
  }
  return capacity > 0 && slack <= capacity;
}

/** Only U+0020 takes a space share; other spaces act as characters. */
function isSpace(span: StyleSpanRecord): boolean {
  return span.text === ' ';
}

function isVisible(span: StyleSpanRecord): boolean {
  return span.box.width > VISIBLE_WIDTH_PT;
}

/**
 * Whether `span` keeps its letters together on a `'characters'` line: pair kerning is on for
 * the run (`w:kern` not 0 and at most the run's size) and the text is not East Asian. Such a
 * run stretches only at its spaces and its East Asian characters. `'legacyCharacters'`
 * spacing spreads every run.
 */
function holdsLetters(
  span: StyleSpanRecord,
  spacing: Exclude<DistributedSpacing, 'spaces'>
): boolean {
  return (
    spacing === 'characters' &&
    span.fontSlot !== 'eastAsia' &&
    isRunKerningEnabled(styleForFontSlot(span.style, span.fontSlot))
  );
}

function isCjkCluster(text: string, end: 'first' | 'last'): boolean {
  const codePoint = end === 'first' ? text.codePointAt(0) : lastCodePointOf(text);
  return codePoint !== undefined && isCjk(codePoint);
}

/** A piece of a distributed line, and whether its run keeps its letters together. */
interface CharacterPiece {
  readonly span: StyleSpanRecord;
  readonly held: boolean;
}

/**
 * Split each span into its grapheme clusters. Right-to-left text keeps its letters joined, and
 * spans that cannot split ({@link isSplittableSpan}) stay whole and act as one character. A
 * span that {@link holdsLetters} splits only around its spaces and East Asian characters, so
 * its words keep their kerned widths.
 */
function characterPieces(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  spacing: Exclude<DistributedSpacing, 'spaces'>
): CharacterPiece[] {
  const pieces: CharacterPiece[] = [];
  for (const span of spans) {
    // A fitted group is not held: its edges take a gap like any other characters.
    const held = fitTextGroupOf(span) === undefined && holdsLetters(span, spacing);
    // A fitted group keeps its own spacing, so its characters are never split apart.
    const clusters =
      isSplittableSpan(span) &&
      span.style.shaping?.direction !== 'rtl' &&
      fitTextGroupOf(span) === undefined
        ? segmentGraphemes(span.text)
        : [];
    const cuts = clusters.filter((cluster, index) => {
      if (index === 0 || !held) return true;
      const before = clusters[index - 1]!.text;
      return (
        before === ' ' ||
        cluster.text === ' ' ||
        isCjkCluster(before, 'last') ||
        isCjkCluster(cluster.text, 'first')
      );
    });
    if (cuts.length < 2) {
      pieces.push({ span, held });
      continue;
    }
    const parts = cuts.map((cluster, index) => ({
      from: cluster.utf16From,
      to: cuts[index + 1]?.utf16From ?? span.text.length,
    }));
    for (const part of splitSpanParts(span, parts, measurer)) pieces.push({ span: part, held });
  }
  return pieces;
}

/** Whether a piece starts or ends East Asian: by code point, or by its East Asian font slot. */
function isEastAsianEnd(span: StyleSpanRecord, end: 'first' | 'last'): boolean {
  return span.fontSlot === 'eastAsia' || isCjkCluster(span.text, end);
}

/**
 * Whether a gap opens between two adjacent visible pieces. One always opens after a space, and
 * where both sides spread their letters. A kerned run opens no gap inside its words, none
 * against the text beside it, and none before its spaces. It still opens one next to an East
 * Asian character.
 */
function opensGap(before: CharacterPiece, after: CharacterPiece): boolean {
  if (insideFitTextGroup(before.span, after.span)) return false;
  if (isSpace(before.span)) return true;
  if (!before.held && !after.held) return true;
  if (isSpace(after.span)) return false;
  return isEastAsianEnd(before.span, 'last') || isEastAsianEnd(after.span, 'first');
}

/**
 * Spread `slack` over the characters of `spans[0, contentEnd)`, the line's content without
 * its hanging whitespace and closing breaks, with the space share `spacing` selects. Spaces before the first character and after the
 * last one keep their natural advance. The spans from `contentEnd` on move with the last
 * character.
 *
 * Returns null when the content has no gap between two characters, such as a single
 * character, a single right-to-left word, or a single kerned word. The caller then centers
 * the line.
 */
export function distributeLineCharacters(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  slack: number,
  contentEnd: number,
  spacing: Exclude<DistributedSpacing, 'spaces'> = 'characters'
): readonly StyleSpanRecord[] | null {
  const characters = characterPieces(spans.slice(0, contentEnd), measurer, spacing);
  const pieces = characters.map((character) => character.span);
  let first = -1;
  let last = -1;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!;
    if (!isVisible(piece) || isSpace(piece)) continue;
    if (first < 0) first = index;
    last = index;
  }
  if (first < 0 || first === last) return null;
  // A gap opens before a visible character after the first, where {@link opensGap} allows.
  let gaps = 0;
  const opens = new Set<number>();
  let previous = first;
  // Slack a space takes after itself, and an automatic inter-script gap before its piece.
  const capacities = new Map<number, number>();
  const gapCapacities = new Map<number, number>();
  let totalCapacity = 0;
  for (let index = first + 1; index <= last; index++) {
    const piece = pieces[index]!;
    if (!isVisible(piece)) continue;
    if (opensGap(characters[previous]!, characters[index]!)) {
      opens.add(index);
      gaps += 1;
    }
    previous = index;
    if (index < last && isSpace(piece) && fitTextGroupOf(piece) === undefined) {
      const capacity = spaceSlackCapacity(piece, piece.box.width, measurer, spacing);
      capacities.set(index, capacity);
      totalCapacity += capacity;
    }
    // An automatic gap between East Asian and other text grows up to twice its size.
    const automatic = automaticTextSpacingBefore(piece);
    if (automatic > 0) {
      gapCapacities.set(index, automatic);
      totalCapacity += automatic;
    }
  }
  // Nothing can spread, such as one kerned word: the caller centers the line.
  if (gaps === 0) return null;
  // Spaces and automatic gaps fill first, in proportion to their capacity, up to it.
  // A negative total returns excess balanced width before characters share the remaining slack.
  const spaceShare = totalCapacity > 0 ? Math.min(1, slack / totalCapacity) : 1;
  const step = (slack - spaceShare * totalCapacity) / gaps;
  let shift = 0;
  const placed = pieces.map((piece, index) => {
    if (opens.has(index)) shift += step;
    shift += spaceShare * (gapCapacities.get(index) ?? 0);
    const moved = shift === 0 ? piece : { ...piece, box: { ...piece.box, x: piece.box.x + shift } };
    shift += spaceShare * (capacities.get(index) ?? 0);
    return moved;
  });
  for (let index = contentEnd; index < spans.length; index++) {
    const span = spans[index]!;
    placed.push({ ...span, box: { ...span.box, x: span.box.x + shift } });
  }
  return placed;
}
