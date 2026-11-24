// Grapheme-safe chopping for an unbroken word that is wider than the line measure.

import { isCombiningMark, stacksNext } from './cjk-line-break.ts';
import { segmentGraphemes } from './grapheme.ts';
import { withoutLineEndWhitespace } from './trailing-spaces.ts';

export interface OversizedWordPrefix {
  readonly text: string;
  readonly modelStart: number;
  readonly width: number;
}

export interface OversizedWordRemainder extends OversizedWordPrefix {
  /** Whether chopping closed at least one line, so the caller can preserve word state. */
  readonly brokeLine: boolean;
  /** The remainder stays on the line, and its final mark hangs past the margin. */
  readonly finalMarkHangs?: true;
}

/**
 * Fill and close lines with the longest grapheme-safe prefix of an oversized word.
 *
 * The callbacks keep paragraph-owned geometry and span construction outside this focused
 * algorithm. Their values are read again after every close because floats can change the next
 * line's measure. At least one grapheme remains for ordinary placement; if one grapheme alone
 * is wider than an empty line, it is the indivisible unit that is allowed to overflow.
 */
/**
 * Move a grapheme-safe cut to one `cutAllowedAt` also accepts: shorter first, so the line
 * stays inside its measure; longer only when no shorter cut is left, pushing the offending
 * character out with its carrier. If no cut is accepted, return the whole remainder;
 * ordinary placement keeps it pending until the next piece's boundary is known.
 */
function acceptedCut(
  text: string,
  graphemes: readonly { readonly utf16To: number }[],
  graphemeFrom: number,
  fitTo: number,
  cutAllowedAt: ((text: string, utf16Index: number) => boolean) | undefined
): number {
  if (cutAllowedAt === undefined || cutAllowedAt(text, graphemes[fitTo - 1]!.utf16To)) return fitTo;
  for (let candidate = fitTo - 1; candidate > graphemeFrom; candidate -= 1) {
    if (cutAllowedAt(text, graphemes[candidate - 1]!.utf16To)) return candidate;
  }
  for (let candidate = fitTo + 1; candidate <= graphemes.length; candidate += 1) {
    if (cutAllowedAt(text, graphemes[candidate - 1]!.utf16To)) return candidate;
  }
  return graphemes.length;
}

export function chopOversizedWord(
  text: string,
  modelStart: number,
  width: number,
  options: {
    readonly remainingLineWidth: () => number;
    readonly lineHasText: () => boolean;
    readonly measureText: (text: string) => number;
    readonly appendPrefix: (prefix: OversizedWordPrefix) => void;
    readonly closeLine: () => void;
    /** Closes a line that ends inside the word, after a cut. Defaults to `closeLine`. */
    readonly closeCutLine?: () => void;
    readonly overflowTolerancePt: number;
    /** @internal Observe actual width decisions without another room or measurement read. */
    readonly onWidthComparison?: (width: number, room: number, fits: boolean) => void;
    /** Advance after this candidate in the same cross-run grapheme. */
    readonly followingWidth?: number;
    /** Keep the leading fragment with the preceding text when their seam is protected. */
    readonly keepWithPrevious?: boolean;
    /**
     * Whether the cut at a UTF-16 index is allowed on top of grapheme safety: never before a
     * combining mark, a stacked consonant, or a zero-width space. The kinsoku sets do not veto
     * a cut here. A rejected cut shrinks to the nearest accepted one; when none is left inside
     * the measure it GROWS past it instead, pushing the protected seam out past the margin.
     */
    readonly cutAllowedAt?: (text: string, utf16Index: number) => boolean;
    /**
     * Whether `text`, the rest of the word at `width`, may stay on the current line with its
     * final mark hanging past the margin. Asked when a cut would leave only the word's final
     * grapheme for the next line; a mark that ends the word then hangs rather than open a line
     * alone. A mark inside the word still opens the next line.
     */
    readonly finalMarkHangs?: (text: string, width: number) => boolean;
  }
): OversizedWordRemainder {
  const initialWidth = width + (options.followingWidth ?? 0);
  const initialRoom = options.remainingLineWidth();
  const initialFits = initialWidth <= initialRoom + options.overflowTolerancePt;
  options.onWidthComparison?.(initialWidth, initialRoom, initialFits);
  if (initialFits) {
    return { text, modelStart, width, brokeLine: false };
  }
  const graphemes = segmentGraphemes(text);
  let graphemeFrom = 0;
  let utf16From = 0;
  let remainingWidth = width;
  let brokeLine = false;

  while (graphemeFrom < graphemes.length) {
    const testedWidth = remainingWidth + (options.followingWidth ?? 0);
    const room = options.remainingLineWidth();
    const overflows = testedWidth > room + options.overflowTolerancePt;
    options.onWidthComparison?.(testedWidth, room, !overflows);
    if (!overflows) break;
    const graphemesLeft = graphemes.length - graphemeFrom;
    if (graphemesLeft === 1) {
      if (options.lineHasText() && !(utf16From === 0 && options.keepWithPrevious)) {
        options.closeLine();
        brokeLine = true;
        continue;
      }
      break;
    }

    const available = options.remainingLineWidth();
    let low = graphemeFrom + 1;
    // Leave at least one whole grapheme for ordinary placement after the final chopped line.
    let high = graphemes.length - 1;
    let fitTo = graphemeFrom;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const utf16To = graphemes[mid - 1]!.utf16To;
      const prefixWidth = options.measureText(text.slice(utf16From, utf16To));
      const fits = prefixWidth <= available + options.overflowTolerancePt;
      options.onWidthComparison?.(prefixWidth, available, fits);
      if (fits) {
        fitTo = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (
      fitTo === graphemeFrom &&
      options.lineHasText() &&
      !(utf16From === 0 && options.keepWithPrevious)
    ) {
      options.closeLine();
      brokeLine = true;
      continue;
    }
    // Overflow by one whole grapheme when none fits an empty line or a protected seam
    // prevents moving it. The accepted cut also preserves clusters split across pieces.
    if (fitTo === graphemeFrom) fitTo += 1;
    const measuredFit = fitTo;
    fitTo = acceptedCut(text, graphemes, graphemeFrom, fitTo, options.cutAllowedAt);
    // A stacked consonant (after a Khmer coeng or Myanmar virama) or a combining mark that
    // would overflow a line with text on it moves to the next line with the letters before
    // it, rather than hanging past the measure as a kinsoku push-out does.
    if (
      fitTo > measuredFit &&
      options.lineHasText() &&
      !(utf16From === 0 && options.keepWithPrevious) &&
      (stacksNext(
        text.charCodeAt(graphemes[measuredFit - 1]!.utf16To - 1),
        text.codePointAt(graphemes[measuredFit - 1]!.utf16To)
      ) ||
        isCombiningMark(text.codePointAt(graphemes[measuredFit - 1]!.utf16To)))
    ) {
      options.closeLine();
      brokeLine = true;
      continue;
    }
    if (fitTo === graphemes.length - 1 && options.finalMarkHangs) {
      const rest = text.slice(utf16From);
      const restWidth = options.measureText(rest);
      if (options.finalMarkHangs(rest, restWidth))
        return {
          text: rest,
          modelStart: modelStart + utf16From,
          width: restWidth,
          brokeLine,
          finalMarkHangs: true,
        };
    }
    // The final group may continue in the next run. Keep it on the pending line;
    // only the caller can decide whether the next piece permits a line break.
    if (fitTo === graphemes.length) break;

    const utf16To = graphemes[fitTo - 1]!.utf16To;
    const prefixText = text.slice(utf16From, utf16To);
    // Spaces after the cut hang at this line's end; they never open the next line. Priced
    // like any line-end space: the ink plus whatever room the line has left.
    if (utf16To < text.length && withoutLineEndWhitespace(text).length <= utf16To) {
      const width = Math.max(options.measureText(prefixText), available);
      return { text: text.slice(utf16From), modelStart: modelStart + utf16From, width, brokeLine };
    }
    options.appendPrefix({
      text: prefixText,
      modelStart: modelStart + utf16From,
      width: options.measureText(prefixText),
    });
    (options.closeCutLine ?? options.closeLine)();
    brokeLine = true;
    graphemeFrom = fitTo;
    utf16From = utf16To;
    remainingWidth = options.measureText(text.slice(utf16From));
  }

  return {
    text: text.slice(utf16From),
    modelStart: modelStart + utf16From,
    width: remainingWidth,
    brokeLine,
  };
}
