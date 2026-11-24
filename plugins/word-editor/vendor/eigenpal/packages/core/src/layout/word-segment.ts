// Unicode word segmentation for semantic double-click selection (interactive-paginated-editing 5.3).
// Uses Intl.Segmenter through an explicit replaceable boundary; fallback is bounded and grapheme-safe.

import { segmentGraphemes, utf16OffsetToGrapheme, type GraphemeSegment } from './grapheme.ts';

/**
 * One word-segmentation span. `wordLike` separates words from the whitespace and punctuation
 * between them, which is what double-click selection needs to skip.
 */
export interface WordSegment {
  readonly utf16From: number;
  readonly utf16To: number;
  readonly wordLike: boolean;
}

/**
 * The replaceable word-segmentation strategy.
 *
 * Falls back to a BOUNDED grapheme-safe splitter where `Intl.Segmenter` is absent — bounded
 * because the input is file-derived, and grapheme-safe so a fallback never splits inside an
 * emoji.
 */
export interface WordBoundary {
  segment(text: string): readonly WordSegment[];
}

/** Invariant locale for deterministic cross-runtime word boundaries. */
export const WORD_SEGMENTER_LOCALE = 'und' as const;

type IntlWordSegment = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

type IntlWordSegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity: 'word' }
) => { segment(input: string): Iterable<IntlWordSegment> };

/** Whether this runtime provides word-granularity `Intl.Segmenter`. */
export function isIntlWordSegmenterAvailable(): boolean {
  return typeof (Intl as unknown as { Segmenter?: IntlWordSegmenterCtor }).Segmenter === 'function';
}

function requireIntlWordSegmenter(): IntlWordSegmenterCtor {
  const Seg = (Intl as unknown as { Segmenter?: IntlWordSegmenterCtor }).Segmenter;
  if (typeof Seg !== 'function') {
    throw new Error(
      `Intl.Segmenter is required for word segmentation (locale: ${WORD_SEGMENTER_LOCALE})`
    );
  }
  return Seg;
}

/** Intl.Segmenter word boundary for the invariant locale. */
export function createIntlWordBoundary(): WordBoundary {
  const segmenter = new (requireIntlWordSegmenter())(WORD_SEGMENTER_LOCALE, {
    granularity: 'word',
  });
  return {
    segment(text: string): readonly WordSegment[] {
      const out: WordSegment[] = [];
      for (const part of segmenter.segment(text)) {
        const utf16From = part.index;
        const utf16To = utf16From + part.segment.length;
        out.push({ utf16From, utf16To, wordLike: part.isWordLike === true });
      }
      return out;
    },
  };
}

const WORD_CHAR = /^[\p{L}\p{N}']$/u;
const WHITESPACE = /^\s$/u;

function isWordGrapheme(text: string): boolean {
  return WORD_CHAR.test(text);
}

function isWhitespaceGrapheme(text: string): boolean {
  return WHITESPACE.test(text);
}

function segmentRange(
  graphemes: readonly GraphemeSegment[],
  fromIndex: number,
  toIndex: number,
  wordLike: boolean
): WordSegment {
  const first = graphemes[fromIndex]!;
  const last = graphemes[toIndex - 1]!;
  return {
    utf16From: first.utf16From,
    utf16To: last.utf16To,
    wordLike,
  };
}

/** Bounded deterministic fallback — not full UAX #29 word conformance. */
export function boundedFallbackWordSegments(text: string): readonly WordSegment[] {
  const graphemes = segmentGraphemes(text);
  if (graphemes.length === 0) return [];

  const out: WordSegment[] = [];
  let i = 0;
  while (i < graphemes.length) {
    const start = graphemes[i]!;
    if (isWhitespaceGrapheme(start.text)) {
      let j = i + 1;
      while (j < graphemes.length && isWhitespaceGrapheme(graphemes[j]!.text)) j += 1;
      out.push(segmentRange(graphemes, i, j, false));
      i = j;
      continue;
    }
    if (isWordGrapheme(start.text)) {
      let j = i + 1;
      while (j < graphemes.length && isWordGrapheme(graphemes[j]!.text)) j += 1;
      out.push(segmentRange(graphemes, i, j, true));
      i = j;
      continue;
    }
    out.push(segmentRange(graphemes, i, i + 1, false));
    i += 1;
  }
  return out;
}

/** Explicit bounded fallback boundary (grapheme-safe, narrower than Intl). */
export function createBoundedFallbackWordBoundary(): WordBoundary {
  return { segment: boundedFallbackWordSegments };
}

/** Injection points for {@link createDefaultWordBoundary}, so tests can force either path. */
export interface WordBoundaryResolverDeps {
  readonly isIntlAvailable?: () => boolean;
  readonly createIntlBoundary?: () => WordBoundary;
  readonly createFallbackBoundary?: () => WordBoundary;
}

/** Resolve production word boundary: Intl when available/construction succeeds, else bounded fallback. */
export function createDefaultWordBoundary(deps: WordBoundaryResolverDeps = {}): WordBoundary {
  const isIntlAvailable = deps.isIntlAvailable ?? isIntlWordSegmenterAvailable;
  const createIntlBoundary = deps.createIntlBoundary ?? createIntlWordBoundary;
  const createFallbackBoundary = deps.createFallbackBoundary ?? createBoundedFallbackWordBoundary;
  if (!isIntlAvailable()) return createFallbackBoundary();
  try {
    return createIntlBoundary();
  } catch {
    return createFallbackBoundary();
  }
}

let resolvedProductionBoundary: WordBoundary | undefined;

/** Cached immutable production boundary (first resolved instance only). */
export function resolveDefaultWordBoundary(): WordBoundary {
  resolvedProductionBoundary ??= createDefaultWordBoundary();
  return resolvedProductionBoundary;
}

/** Split text into word segments through the given boundary, or the resolved default. */
export function segmentWords(
  text: string,
  boundary: WordBoundary = resolveDefaultWordBoundary()
): readonly WordSegment[] {
  return boundary.segment(text);
}

/**
 * A word span expressed in GRAPHEME offsets rather than UTF-16 ones.
 *
 * What selection actually uses: a range whose ends are UTF-16 offsets could land inside a
 * grapheme, and selecting half an emoji is not a word.
 */
export interface GraphemeWordSegmentRecord {
  readonly graphemeFrom: number;
  readonly graphemeTo: number;
  readonly wordLike: boolean;
}

/** Map UTF-16 word segments to grapheme-safe half-open ranges within one paragraph. */
export function wordSegmentsToGraphemeRecords(
  text: string,
  segments: readonly WordSegment[]
): readonly GraphemeWordSegmentRecord[] {
  return segments.map((seg) => ({
    graphemeFrom: utf16OffsetToGrapheme(text, seg.utf16From),
    graphemeTo: utf16OffsetToGrapheme(text, seg.utf16To),
    wordLike: seg.wordLike,
  }));
}
