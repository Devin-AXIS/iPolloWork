// Minimum cuts can differ from the contextual segments used for unwrapped text.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { wordBoundaries } from './cjk-line-break.ts';
import { cjkParagraphBreaks, hasCjkText } from './cjk-paragraph-breaks.ts';
import {
  eastAsianLanguage,
  resolveCjkTypography,
  type CjkTypographySettings,
  type CjkParagraphTypography,
} from './cjk-typography.ts';
import { compressCjkPieces } from './cjk-spacing.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import type { ResolvedTabStops } from './paragraph-tabs.ts';
import { measureDisplayText, type ResolvedRunStyle } from './run-style.ts';
import { automaticTextGap, automaticTextSpacingAdvance } from './cjk-automatic-spacing.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { withoutLineEndWhitespace } from './trailing-spaces.ts';

/** CJK minimums use paragraph analysis; other scripts retain ordinary word cuts. */
export function cjkAutofitBreaks(
  pieces: readonly FieldAwarePiece[],
  {
    props,
    markRunProperties,
  }: {
    readonly props: readonly OoxmlProperty[];
    readonly markRunProperties?: readonly OoxmlProperty[];
  },
  measurer: TextMeasurer,
  styleCascade?: { readonly typography?: CjkTypographySettings }
) {
  const policy = resolveCjkTypography(props, styleCascade?.typography, markRunProperties);
  const visible = pieces.filter((piece) => !piece.style.hidden);
  if (
    !policy.characterWrap &&
    !visible.some((piece) => hasCjkText(piece.text) || eastAsianLanguage(piece.props))
  )
    return null;
  // This qualification selects the East Asian analysis, whose decisions ignore text context.
  // Ordinary cross-run dash cuts remain the caller's paragraphWordCuts, for both min and max.
  const breaks = cjkParagraphBreaks(visible, policy)!;
  const seams = punctuationSeams(visible, compressCjkPieces(visible, policy, measurer), measurer);
  // A seam whose mark ends the candidate waits for the next candidate in the same segment.
  let pending = 0;
  return {
    /**
     * The width a candidate gives back to compressed punctuation seams whose two marks both
     * fall in the open segment, as they share a line there. `continues` says that the
     * candidate extends a segment that already holds text.
     */
    shared(piece: FieldAwarePiece, from: number, to: number, continues: boolean): number {
      let saved = continues ? pending : 0;
      pending = 0;
      if (seams.size === 0) return saved;
      for (let at = from; at < to; at++) {
        const seam = seams.get(piece.start + at);
        if (!seam) continue;
        if (!seam.right) {
          if (at > from || continues) saved += seam.amount;
        } else if (at + seam.length < to) saved += seam.amount;
        else pending = seam.amount;
      }
      return saved;
    },
    /**
     * Adds the unwrapped line's punctuation seams to `extra`. Every seam shares the unwrapped
     * line with its neighbour, so each gives back its whole amount, as line layout draws it.
     */
    unwrappedAdvance(
      piece: FieldAwarePiece,
      extra: (from: number, to: number) => number
    ): (from: number, to: number) => number {
      if (seams.size === 0) return extra;
      return (from, to) => {
        let advance = extra(from, to);
        for (let at = from; at < to; at++) advance -= seams.get(piece.start + at)?.amount ?? 0;
        return advance;
      };
    },
    opens: (piece: FieldAwarePiece) => breaks.decision(piece, 0, '', piece.text) === 'opens',
    boundaries: (piece: FieldAwarePiece) =>
      breaks
        .boundaries(piece)
        .filter(
          (to) =>
            to === piece.text.length ||
            breaks.decision(piece, to, piece.text.slice(0, to), piece.text.slice(to)) === 'opens'
        ),
  };
}

interface PunctuationSeam {
  /** The width the mark gives up when its neighbour shares its line. */
  readonly amount: number;
  /** The mark gives up its right side to the next mark, not its left side to the previous one. */
  readonly right: boolean;
  readonly length: number;
}

/**
 * Adjacent full-width punctuation shares one half-em in line layout. Each compressed slice of
 * `compressed` maps, by source offset, to the width its mark gives up there.
 */
function punctuationSeams(
  visible: readonly FieldAwarePiece[],
  compressed: readonly FieldAwarePiece[],
  measurer: TextMeasurer
): ReadonlyMap<number, PunctuationSeam> {
  const seams = new Map<number, PunctuationSeam>();
  if (compressed === visible) return seams;
  // Compression keeps piece order: an unchanged piece passes through, a changed one is sliced.
  let index = 0;
  for (const slice of compressed) {
    const original = visible[index]!;
    if (slice === original || slice.end >= original.end) index++;
    if (slice.style === original.style) continue;
    const amount =
      measureDisplayText(
        slice.text,
        styleForFontSlot(original.style, original.fontSlot),
        measurer
      ) - measureDisplayText(slice.text, styleForFontSlot(slice.style, slice.fontSlot), measurer);
    if (amount > 0)
      seams.set(slice.start, {
        amount,
        right: slice.glyphOffsetPt === 0,
        length: slice.text.length,
      });
  }
  return seams;
}

/** The next unwrapped stop, excluding stops reserved for the numbering marker. */
export function nextAutofitTabStop(tabs: ResolvedTabStops, at: number): number {
  for (const stop of tabs.stops)
    if (!stop.numberingOnly && stop.positionPt > at + 1e-6) return stop.positionPt;
  const interval = tabs.defaultIntervalPt;
  return (Math.floor(at / interval + 1e-6) + 1) * interval;
}

/** Preserve upstream contextual word cuts, including paragraph-wide dash boundaries. */
export function measureUnwrappedAutofitText(
  text: string,
  boundaries: readonly number[] | undefined,
  measure: (text: string) => number,
  start: number,
  nextTabStop: (at: number) => number,
  extraAdvance?: (from: number, to: number) => number
): { width: number; trailing: number } {
  let width = 0;
  let trailing = 0;
  let from = 0;
  for (const to of boundaries ?? wordBoundaries(text, false)) {
    const startOffset = from;
    const candidate = text.slice(from, to);
    from = to;
    if (candidate.length === 0) continue;
    let advance: number;
    let spaces = 0;
    if (candidate === '\t') {
      advance = Math.max(0, nextTabStop(start + width) - (start + width));
    } else {
      const ink = withoutLineEndWhitespace(candidate);
      const natural = measure(candidate);
      advance = natural + (extraAdvance?.(startOffset, to) ?? 0);
      if (ink.length < candidate.length) spaces = natural - (ink ? measure(ink) : 0);
    }
    width += advance;
    trailing = spaces < advance ? spaces : trailing + spaces;
  }
  return { width, trailing };
}

interface AutomaticAutofitTextSpacing {
  readonly previousText: Parameters<typeof automaticTextSpacingAdvance>[0];
  minimum(at: number, continues: boolean): number;
  extraAdvance(from: number, to: number): number;
}

type AutomaticAutofitSpacingPricer = (
  piece: FieldAwarePiece,
  boundaries: readonly number[],
  style: ResolvedRunStyle,
  previous: Parameters<typeof automaticTextSpacingAdvance>[0]
) => AutomaticAutofitTextSpacing;

/** Price automatic gaps once, without losing a kept token's internal advances at a minimum cut. */
export function automaticAutofitSpacing(
  typography: CjkParagraphTypography,
  measurer: TextMeasurer
): AutomaticAutofitSpacingPricer {
  return (piece, boundaries, style, previous) => {
    const gaps = new Map<number, { before: number; internal: number }>();
    let previousText = previous;
    let from = 0;
    for (const to of boundaries) {
      const text = piece.text.slice(from, to);
      if (text === '\t') previousText = undefined;
      else if (text.length > 0) {
        const current = { ...piece, start: piece.start + from, end: piece.start + to, text, style };
        const internal = automaticTextSpacingAdvance(undefined, current, typography, measurer);
        const before =
          previousText?.end === current.start
            ? automaticTextGap(previousText, current, typography, measurer)
            : 0;
        if (before > 0 || internal > 0) gaps.set(from, { before, internal });
        previousText = current;
      }
      from = to;
    }
    const entries = [...gaps];
    let index = 0;
    return {
      previousText,
      minimum(at: number, continues: boolean): number {
        const gap = gaps.get(at);
        return gap ? gap.internal + (continues ? gap.before : 0) : 0;
      },
      extraAdvance(from: number, to: number): number {
        let advance = 0;
        while (index < entries.length && entries[index]![0] < to) {
          const [at, gap] = entries[index++]!;
          if (at >= from) advance += gap.before + gap.internal;
        }
        return advance;
      },
    };
  };
}
