// Space compression adapted from PR #707's paragraph-justify.ts (2ce89f6e7).
// Publish spacing in Core so PDF, browser paint, and caret measurement agree.
// Justified lines (`w:jc`, ECMA-376 Part 1 §17.3.1.13 and §17.18.44): the format's producers
// use a 75% space floor and prefer expansion near natural spacing.
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import { fitTextGroupOf } from './fit-text-groups.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { StyleSpanRecord, TextMeasurer } from './semantic-records.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import { isSpaceShrinkWordPiece } from './space-shrink-piece.ts';
import type { SpaceShrinkFloor, SpaceShrinkRule } from './space-shrink-rule.ts';
import { withoutTrailingZeroWidthSpaces } from './trailing-spaces.ts';
import { authoredCjkGapMetric } from './cjk-auto-spacing-metric-port.ts';
import { knownFamilyReverseGap } from './authored-average-widths.ts';
import { opensWithWidenedSpaces } from './balanced-line-start.ts';
import { isBalancedSpace } from './balanced-space-widths.ts';
import { balancedStretchRatio } from './balanced-space-stretch.ts';

// No-break spaces join their neighbours into one word. They have width, never break the
// line, and never hang, so the word-shape tests read them as word characters.
const WORD_CHARACTER = String.raw`[\S\u00a0\u2007\u202f]`;
// A span holding U+00A0 lends none of its space: screen paint applies `word-spacing` to
// U+00A0 as well, so its shrink would be painted twice. The narrow forms are unaffected.
const SPACED_SPAN = /^[\S\u2007\u202f]* \u200b*$/u;
const SPACED_WORD = new RegExp(`^${WORD_CHARACTER}+ \u200b*$`, 'u');
const BARE_WORD = new RegExp(`^${WORD_CHARACTER}+$`, 'u');

/**
 * The text before its space slot: the final U+0020 and any zero-width spaces after it. A
 * zero-width space after the space takes no room, so the space still lends, and the word
 * before it is still a spaced word.
 */
const withoutSpaceSlot = (text: string): string =>
  withoutTrailingZeroWidthSpaces(text).slice(0, -1);

/**
 * Whether a candidate ends at the break after a hyphen inside a word ("well-" of
 * "well-known"). That fragment can borrow inter-word space as a whole word does.
 */
export function endsAtHyphenBreak(candidate: string): boolean {
  return /\p{L}[-‐]$/u.test(candidate);
}

/**
 * Probe the current passage of a left-to-right paragraph without borrowing spaces across a
 * float. Right-to-left runs inside the paragraph do not change the passage; only a
 * right-to-left paragraph keeps its existing alignment path across floats.
 */
export function createShrinkProbe<Zone>(
  zones: () => readonly Zone[],
  intervals: (
    zones: readonly Zone[]
  ) => readonly { readonly start: number; readonly end: number }[],
  paragraphRtl: boolean
): (penX: number) => number | undefined {
  return (penX) => {
    const active = zones();
    if (active.length === 0) return undefined;
    if (paragraphRtl) return Infinity;
    return (
      intervals(active).find(
        (interval) => penX >= interval.start - 0.001 && penX <= interval.end + 0.001
      )?.start ?? Infinity
    );
  };
}

/**
 * The first span whose space can shrink. Only the text after a line's last tab is
 * justified; a tab and everything before it keep their positions.
 */
function firstShrinkSlot(spans: readonly StyleSpanRecord[]): number {
  for (let index = spans.length - 1; index >= 0; index -= 1)
    if (spans[index]!.text.includes('\t')) return index + 1;
  return 0;
}

/**
 * What the space closing `span` can give up: `limit` of its natural advance, or with a `floor`
 * everything above it.
 */
function capacity(
  span: StyleSpanRecord,
  measurer: TextMeasurer,
  limit: number,
  floorKind?: SpaceShrinkFloor
): number {
  // The spaces of a fitted group keep the group's own spacing.
  if (span.lineEndWhitespace || span.equation || fitTextGroupOf(span) !== undefined) return 0;
  const style = styleForFontSlot(span.style, span.fontSlot);
  // A face whose space is no wider than its floor lends nothing: answer before the text
  // tests, so a line in such a face pays one lookup per span.
  const floor = floorKind ? spaceFloor(style, measurer, floorKind) : undefined;
  if (floor?.noRoom) return 0;
  if (
    (!span.style.shaping &&
      !/^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\p{P}\p{Sc}\p{Sm} \u2007\u202f\u200b]*$/u.test(
        span.text
      )) ||
    !SPACED_SPAN.test(span.text)
  )
    return 0;
  const space = Math.max(
    0,
    span.box.width - measureDisplayText(withoutSpaceSlot(span.text), style, measurer)
  );
  if (floor?.value !== undefined) return Math.max(0, space - floor.value);
  return space * limit;
}

/**
 * What the space closing `span` can give up. With `keepsBalancedSpaces`, a space at the
 * balanced width keeps it and gives up nothing.
 */
function lendingCapacity(
  span: StyleSpanRecord,
  space: number,
  keepsBalancedSpaces: boolean
): number {
  return keepsBalancedSpaces && space > 0 && isBalancedSpace(span) ? 0 : space;
}

/** Space floors by face style and kind; one style serves every span and line that uses it. */
const spaceFloors = new WeakMap<
  ResolvedRunStyle,
  Partial<Record<SpaceShrinkFloor, { value: number | undefined; noRoom: boolean }>>
>();

/**
 * The narrowest a space of `style` may become, and whether it is at least the face's plain
 * space, so that no space of the style can shrink. Half the face's average character width
 * is the same metric as the reverse automatic gap; a quarter em is a quarter of the font size.
 */
function spaceFloor(
  style: ResolvedRunStyle,
  measurer: TextMeasurer,
  kind: SpaceShrinkFloor
): { value: number | undefined; noRoom: boolean } {
  let byKind = spaceFloors.get(style);
  if (!byKind) spaceFloors.set(style, (byKind = {}));
  let known = byKind[kind];
  if (!known) {
    const value =
      kind === 'quarterEm'
        ? style.fontSizePt / 4
        : (authoredCjkGapMetric(measurer, style) ?? knownFamilyReverseGap(style));
    const plain = !style.shaping?.wordSpacingPt && !style.characterSpacingPt;
    known = {
      value,
      noRoom:
        value !== undefined && plain && measureDisplayText(' ', style, measurer) <= value + 1e-9,
    };
    byKind[kind] = known;
  }
  return known;
}

/**
 * The spaces clipped at the margin just before span `end`, each at its natural advance and
 * without its line-end mark, with its index. A word that joins the line stands after them, so
 * they are inside the line again.
 */
function clippedSpacesBefore(
  spans: readonly StyleSpanRecord[],
  end: number,
  first: number,
  measurer: TextMeasurer
): (StyleSpanRecord & { readonly index: number })[] {
  const restored: (StyleSpanRecord & { readonly index: number })[] = [];
  for (let index = end - 1; index >= first && spans[index]!.lineEndWhitespace; index -= 1) {
    const { lineEndWhitespace: _clipped, ...span } = spans[index]!;
    const style = styleForFontSlot(span.style, span.fontSlot);
    const width = Math.max(span.box.width, measureDisplayText(span.text, style, measurer));
    restored.push({ ...span, index, box: { ...span.box, width } });
  }
  return restored;
}

/**
 * Mark a line that kept a word under the legacy rule as one that compresses its spaces. The
 * spaces clipped at the margin before span `end` take their natural advance back, as the word
 * now stands after them, so that they shrink with the line's other spaces. Later spans move
 * right by the same amount. Answers the width the line gains.
 */
export function compressLineSpaces(
  line: { spans: StyleSpanRecord[]; width: number; compressesSpaces?: SpaceShrinkFloor },
  end: number,
  measurer: TextMeasurer,
  floor: SpaceShrinkFloor
): number {
  line.compressesSpaces = floor;
  const spans = line.spans;
  let gained = 0;
  const restored = clippedSpacesBefore(spans, end, 0, measurer).reverse();
  if (restored.length === 0) return 0;
  for (let index = restored[0]!.index; index < spans.length; index += 1) {
    const span = spans[index]!;
    const space = restored.find((candidate) => candidate.index === index);
    const box = { ...span.box, x: span.box.x + gained };
    if (space) {
      const { index: _index, ...plain } = space;
      gained += space.box.width - span.box.width;
      spans[index] = { ...plain, box: { ...box, width: space.box.width } };
    } else spans[index] = { ...span, box };
  }
  line.width += gained;
  return gained;
}

/** The word that overflows a line, for {@link spaceShrinkFit}. */
export interface ShrinkWord {
  /** The overflowing candidate, with its own trailing space when it has one. */
  readonly text: string;
  readonly style: ResolvedRunStyle;
  /** The line width before the candidate, an automatic gap before it included. */
  readonly lineWidth: number;
  readonly available: number;
  /** Where the word began, when it opened on an earlier piece: a span index and line width. */
  readonly wordStart?: number;
  readonly wordStartWidth?: number;
  /** A space or only hanging spaces follow, so a candidate without its own space is a word. */
  readonly wordEnds?: boolean;
  /** The rest of the same word in later plain-text pieces. */
  readonly followingWidth?: number;
  /** The start of the line's current float passage; earlier passages keep their spaces. */
  readonly passageStart?: number;
  /** The advance of a final half-width mark that may hang, or 0. */
  readonly hangingMarkAdvance?: number;
}

/**
 * How the word that overflows a line joins it by shrinking the line's inter-word spaces under
 * `rule`:
 * - `inside`: the whole word, its final mark too, fits between the margins.
 * - `hangs`: the word joins, and its final mark hangs past the margin.
 * - `false`: the word does not join the line.
 *
 * Only an ordinary word followed by a space, or the paragraph's last word, can borrow
 * existing inter-word space. Each space gives up at most `rule.limit` of its advance, a space
 * at the balanced width nothing under `rule.keepsBalancedSpaces`, and the shrink must pass the
 * rule's cost test against the stretch of the line without the word. A word whose final mark
 * may hang (`hangingMarkAdvance` is its advance) joins when the spaces reach their limit
 * before the mark fits, as long as they fit the text before the mark and the rule hangs marks.
 * Its mark then hangs.
 *
 * A word that straddles a source-run seam (a quoted bold term, a semicolon left in the next
 * run) overflows on a later piece than the one that opened it. The kept line still runs to
 * `lineWidth`, but the line without the word ends where the word began, so `wordStart` and
 * `wordStartWidth` describe that alternative. Their defaults are the values the caller
 * already holds when the overflowing candidate opens the word.
 *
 * `wordEnds` says the next character is a space, in this run or at the start of the next one,
 * or that only hanging spaces remain in the paragraph. A candidate without its own space is
 * then a complete word: a space in its own run, or one split off by East Asian break rules,
 * hangs at the line end exactly as a space inside the candidate would, and the paragraph's
 * last word borrows space as any other word does. `followingWidth` measures the remainder of
 * that same word in later plain-text pieces, so an overflowing opening fragment uses the
 * complete word's fit decision.
 */
export function spaceShrinkFit(
  spans: readonly StyleSpanRecord[],
  measurer: TextMeasurer,
  word: ShrinkWord,
  rule: SpaceShrinkRule
): 'inside' | 'hangs' | false {
  const { text: candidate, style, lineWidth, available, passageStart } = word;
  const wordStart = word.wordStart ?? spans.length;
  const wordStartWidth = word.wordStartWidth ?? lineWidth;
  const followingWidth = word.followingWidth ?? 0;
  const mark = word.hangingMarkAdvance ?? 0;
  const ownSpace = SPACED_WORD.test(candidate);
  // Earlier passages own their spaces. The pen can already have stepped over a
  // float while this passage still has no spans, so an empty suffix cannot lend.
  const passageFirst =
    passageStart === undefined ? 0 : spans.findIndex((span) => span.box.x >= passageStart - 0.001);
  if (
    !(ownSpace || (word.wordEnds && BARE_WORD.test(candidate))) ||
    // With balanced widths, spaces that open a line take half an em each, which leaves a
    // proportional face no room; such a line keeps natural spaces.
    (rule.floor === 'quarterEm' && opensWithWidenedSpaces(spans, measurer)) ||
    passageFirst < 0 ||
    wordStart < passageFirst ||
    spans.some(
      (span, index) =>
        index >= passageFirst &&
        (span.equation ||
          ((passageStart === undefined || index > passageFirst) && span.wrapAdvanceBefore))
    )
  )
    return false;
  const first = Math.max(passageFirst, firstShrinkSlot(spans));
  const visible = measureDisplayText(
    ownSpace ? withoutSpaceSlot(candidate) : candidate,
    style,
    measurer
  );
  let needed = lineWidth + visible + followingWidth - available;
  if (needed <= 0) return false;
  // The alternative line stops before the overflowing word, so only the spans ahead
  // of it carry its stretch, and the space in front of it is the one that hangs.
  // One capacity per span serves the budget, the hanging space and the spaces ahead of the
  // word, each summed in span order; reading every span again measured each word again.
  // A space at the balanced width lends nothing, but the shorter line still stretches it, and
  // it still hangs at full width after the last word.
  const keepsBalancedSpaces = rule.keepsBalancedSpaces === true;
  const beforeEnd = Math.max(first, Math.min(wordStart, spans.length));
  const capacities: number[] = [];
  let budget = 0;
  for (let index = first; index < spans.length; index += 1) {
    const space = capacity(spans[index]!, measurer, rule.limit, rule.floor);
    capacities.push(space);
    budget += lendingCapacity(spans[index]!, space, keepsBalancedSpaces);
  }
  if (rule.everyAlignment)
    for (const space of clippedSpacesBefore(spans, beforeEnd, first, measurer)) {
      // Inside the line again, the space takes back its natural advance and lends as any other.
      needed += space.box.width - spans[space.index]!.box.width;
      budget += capacity(space, measurer, rule.limit, rule.floor);
    }
  // The spaces shrink to at most their limit: past it, only a mark that hangs can make room.
  const markInside = needed <= budget + 0.001;
  if (!markInside && (!rule.hangsMarks || mark <= 0 || needed - mark > budget + 0.001))
    return false;
  if (rule.cost <= 0) return markInside ? 'inside' : 'hangs';
  const spaceWidth = budget / rule.limit;
  // Every space after the last word hangs there: a run of spaces as well as the word's own.
  let terminalSpace = 0;
  let terminalSpans = 0;
  for (let index = beforeEnd - 1; index >= first; index -= 1) {
    terminalSpace += capacities[index - first]! / rule.limit;
    terminalSpans += 1;
    if (!/^ +$/.test(spans[index]!.text)) break;
  }
  let beforeSpaces = 0;
  for (let index = first; index < beforeEnd; index += 1) {
    beforeSpaces += capacities[index - first]! / rule.limit;
  }
  const existingSpaces = beforeSpaces - terminalSpace;
  if (existingSpaces <= 0) return false;
  const shorterSlack = Math.max(0, available - wordStartWidth + terminalSpace);
  // With balanced spaces, the shorter line widens its narrower spaces first.
  const expansion =
    (keepsBalancedSpaces
      ? balancedStretchRatio(
          balancedSlots(spans, capacities, first, beforeEnd - terminalSpans, rule.limit),
          shorterSlack
        )
      : undefined) ?? 1 + shorterSlack / existingSpaces;
  // The word joins the line when each space loses at most 1/cost of what the shorter line
  // would add to it.
  const shrink = (needed - mark * (1 - (rule.markCost ?? 1))) / spaceWidth;
  if (rule.cost * shrink > expansion - 1 + 1e-9) return false;
  return markInside ? 'inside' : 'hangs';
}

/**
 * Whether the candidate ending at `boundary` of `pieces[pieceIndex]` is the paragraph's
 * last word: only plain U+0020 spaces follow it, and they hang at the line end.
 *
 * One backward scan finds where that closing run of spaces begins. Any other piece (a
 * field result, positional tab, drawing, equation, reserved note mark or anchor) ends the scan
 * after itself, so no word before it is last. A tab, hard break or page break in plain
 * text is not a space either, and ends the scan the same way. Stable body citations
 * can complete the last word while retaining their atomic model ranges.
 */
export function paragraphEndAt(
  pieces: readonly FieldAwarePiece[]
): (pieceIndex: number, boundary: number) => boolean {
  let tailPiece = 0;
  let tailOffset = 0;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index]!;
    if (!isSpaceShrinkWordPiece(piece)) {
      tailPiece = index + 1;
      break;
    }
    let offset = piece.text.length;
    while (offset > 0 && piece.text[offset - 1] === ' ') offset -= 1;
    if (offset > 0) {
      tailPiece = index;
      tailOffset = offset;
      break;
    }
  }
  return (pieceIndex, boundary) =>
    pieceIndex > tailPiece || (pieceIndex === tailPiece && boundary >= tailOffset);
}

/**
 * Whether the candidate ending at `boundary` of `pieces[pieceIndex]` ends its line: it is the
 * paragraph's last word ({@link paragraphEndAt}), or only plain U+0020 spaces stand between it
 * and a text-wrapping break or a tab. The line compresses its spaces to keep that word, as the
 * paragraph's last line does; a tab that no longer fits then opens the next line.
 */
export function lineEndAt(
  pieces: readonly FieldAwarePiece[]
): (pieceIndex: number, boundary: number) => boolean {
  const endsParagraph = paragraphEndAt(pieces);
  const breakAhead = new Array<Uint8Array>(pieces.length);
  let follows = 0;
  for (let index = pieces.length - 1; index >= 0; index -= 1) {
    const piece = pieces[index]!;
    const ahead = new Uint8Array(piece.text.length + 1);
    const plain = isSpaceShrinkWordPiece(piece);
    ahead[piece.text.length] = plain ? follows : 0;
    for (let offset = piece.text.length - 1; offset >= 0; offset -= 1) {
      const ch = piece.text[offset];
      ahead[offset] = !plain
        ? 0
        : ch === '\n' || ch === '\t'
          ? 1
          : ch === ' '
            ? ahead[offset + 1]!
            : 0;
    }
    breakAhead[index] = ahead;
    follows = ahead[0]!;
  }
  return (pieceIndex, boundary) =>
    endsParagraph(pieceIndex, boundary) || breakAhead[pieceIndex]?.[boundary] === 1;
}

/**
 * True when `piece` opens with a U+0020 that can hang at a line end. Only a plain text
 * piece splits into candidates; a projected field result, positional tab, or reserved
 * measure is laid out whole, so its leading space would open the next line instead.
 */
export function opensWithHangingSpace(piece: FieldAwarePiece | undefined): boolean {
  return (
    piece !== undefined &&
    piece.text[0] === ' ' &&
    !piece.projected &&
    !piece.positionalTab &&
    piece.measureText === undefined &&
    piece.end - piece.start === piece.text.length
  );
}

/**
 * Compress eligible spaces evenly, respecting every face's minimum space advance.
 * Only spans before `slotEnd` are slots: the span there ends the content and its space hangs.
 */
export function shrinkJustifiedSpans(
  spans: readonly StyleSpanRecord[],
  needed: number,
  measurer: TextMeasurer,
  slotEnd: number = spans.length - 1,
  floor?: SpaceShrinkFloor,
  paragraphRtl = false,
  keepsBalancedSpaces = false
): readonly StyleSpanRecord[] {
  const first = firstShrinkSlot(spans);
  // Admission kept `needed` within the paragraph's rule; equal shares never pass a quarter.
  const capacities = spans.map((span, index) =>
    index >= first && index < slotEnd
      ? lendingCapacity(span, capacity(span, measurer, 0.25, floor), keepsBalancedSpaces)
      : 0
  );
  if (needed <= 0 || needed > capacities.reduce((a, b) => a + b, 0) + 0.001) return spans;
  const amounts = capacities.map(() => 0);
  let remaining = needed;
  for (let pass = 0; pass < capacities.length && remaining > 0.001; pass++) {
    const active = capacities
      .map((cap, index) => (cap - amounts[index]! > 0.001 ? index : -1))
      .filter((i) => i >= 0);
    if (!active.length) break;
    const step = remaining / active.length;
    for (const index of active) {
      const take = Math.min(step, capacities[index]! - amounts[index]!);
      amounts[index] += take;
      remaining -= take;
    }
  }
  // Bidi places a shaped or right-to-left line again from its span widths, so there the shrink
  // narrows the span and its style carries it as negative word spacing.
  if (paragraphRtl || spans.some((span) => span.style.shaping))
    return shrinkSpanStyles(spans, amounts);
  // Otherwise a shrink is geometry only, like a stretch: each span keeps its style and its
  // natural box, and the spans after a shrunk space move left. The gap after that space is
  // negative, and paint draws it inside the span as negative word spacing.
  let shift = 0;
  return spans.map((span, index) => {
    const result = shift ? { ...span, box: { ...span.box, x: span.box.x - shift } } : span;
    shift += amounts[index]!;
    return result;
  });
}

/** Shrink each span's closing space by its amount in its box width and its style. */
function shrinkSpanStyles(
  spans: readonly StyleSpanRecord[],
  amounts: readonly number[]
): readonly StyleSpanRecord[] {
  const shrunkStyle = (style: ResolvedRunStyle, amount: number): ResolvedRunStyle => ({
    ...style,
    shaping: {
      script: 'Latn',
      direction: 'ltr' as const,
      level: 0,
      baseLevel: 0,
      ...style.shaping,
      wordSpacingPt: (style.shaping?.wordSpacingPt ?? 0) - amount,
    },
  });
  let shift = 0;
  return spans.map((span, index) => {
    const amount = amounts[index]!;
    const result =
      shift || amount
        ? {
            ...span,
            box: { ...span.box, x: span.box.x - shift, width: span.box.width - amount },
            ...(amount ? { style: shrunkStyle(span.style, amount) } : {}),
          }
        : span;
    shift += amount;
    return result;
  });
}

/**
 * The space runs of `spans[first, end)` for {@link balancedStretchRatio}: each span's closing
 * spaces, from its capacity at `limit`, and whether they lend.
 */
function balancedSlots(
  spans: readonly StyleSpanRecord[],
  capacities: readonly number[],
  first: number,
  end: number,
  limit: number
): { spaces: number; width: number; lends: boolean }[] {
  const slots: { spaces: number; width: number; lends: boolean }[] = [];
  for (let index = first; index < end; index += 1) {
    const total = capacities[index - first]! / limit;
    if (total <= 0) continue;
    const text = spans[index]!.text;
    let spaces = 0;
    while (spaces < text.length && text[text.length - 1 - spaces] === ' ') spaces += 1;
    slots.push({
      spaces: Math.max(1, spaces),
      width: total / Math.max(1, spaces),
      lends: !isBalancedSpace(spans[index]!),
    });
  }
  return slots;
}
