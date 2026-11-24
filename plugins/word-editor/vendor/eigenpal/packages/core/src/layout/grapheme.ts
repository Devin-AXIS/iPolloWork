// Unicode grapheme segmentation for semantic positions (interactive-paginated-editing 3.3).
// Uses Intl.Segmenter through a small replaceable boundary — no hand-written splitter.

/**
 * One user-perceived character, and the UTF-16 range that encodes it.
 *
 * The unit a caret moves by. An emoji with a skin-tone modifier is ONE segment spanning several
 * UTF-16 code units, so stepping by code unit would put the caret inside it.
 */
export interface GraphemeSegment {
  readonly index: number;
  readonly text: string;
  readonly utf16From: number;
  readonly utf16To: number;
}

/**
 * The replaceable segmentation strategy.
 *
 * An explicit seam rather than a direct `Intl.Segmenter` call, so tests can install a
 * deterministic boundary and a runtime without `Intl.Segmenter` can be given one.
 */
export interface GraphemeBoundary {
  segment(text: string): readonly GraphemeSegment[];
}

/** Invariant locale for deterministic cross-runtime grapheme boundaries. */
export const GRAPHEME_SEGMENTER_LOCALE = 'und' as const;

type IntlSegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' }
) => { segment(input: string): Iterable<{ segment: string; index: number }> };

/** Whether this runtime provides `Intl.Segmenter`, which the default boundary requires. */
export function isIntlSegmenterAvailable(): boolean {
  return typeof (Intl as unknown as { Segmenter?: IntlSegmenterCtor }).Segmenter === 'function';
}

function requireIntlSegmenter(): IntlSegmenterCtor {
  const Seg = (Intl as unknown as { Segmenter?: IntlSegmenterCtor }).Segmenter;
  if (typeof Seg !== 'function') {
    throw new Error(
      `Intl.Segmenter is required for deterministic grapheme segmentation (locale: ${GRAPHEME_SEGMENTER_LOCALE})`
    );
  }
  return Seg;
}

function createIntlBoundary(): GraphemeBoundary {
  const segmenter = new (requireIntlSegmenter())(GRAPHEME_SEGMENTER_LOCALE, {
    granularity: 'grapheme',
  });
  return {
    segment(text: string): readonly GraphemeSegment[] {
      const out: GraphemeSegment[] = [];
      let index = 0;
      for (const part of segmenter.segment(text)) {
        const utf16From = part.index;
        const utf16To = utf16From + part.segment.length;
        out.push({ index, text: part.segment, utf16From, utf16To });
        index += 1;
      }
      return out;
    },
  };
}

/**
 * The default boundary, over `Intl.Segmenter` at the invariant `und` locale.
 *
 * Locale-invariant on purpose: grapheme boundaries must not vary with the user's locale, or the
 * same document would paginate differently for different readers.
 */
export const intlGraphemeBoundary: GraphemeBoundary = createIntlBoundary();

let activeBoundary: GraphemeBoundary = intlGraphemeBoundary;
/**
 * Bumped whenever the boundary implementation changes.
 *
 * Any cache whose value depends on segmentation must include this in its key, not
 * just clear its own entries. `horizontal-boundary.ts` keyed its geometry-trust
 * watermark on `(text, lineStart, metricsPort)` and independent review proved that
 * still stale: warmed under a per-code-unit boundary, `'ab<CJK>'` reported trusted
 * and KEPT reporting trusted after installing a grouping boundary, publishing
 * `navigable: true` for an edge whose advance is unprovable.
 */
let boundaryEpoch = 0;

/** Current boundary generation, for callers that cache segmentation-derived answers. */
export function graphemeBoundaryEpoch(): number {
  return boundaryEpoch;
}

/** Test hook: replace the grapheme boundary without changing call sites. */
let memoText: string | null = null;
let memoSegments: readonly GraphemeSegment[] | null = null;

/**
 * Secondary memo slot.
 *
 * ONE entry is not enough. Two different texts are interleaved on the hot path — a
 * paragraph's full text and the text of a painted slice within it — so a single slot
 * thrashes and every call is a full `Intl.Segmenter` pass. That is the same shape as
 * the round-3 defect (a token evicting the paragraph), and review measured it again
 * in `toDisplayPages`: segmented characters grew at exponent 2.00, reaching 3,202x
 * the paragraph length.
 *
 * Two slots with a move-to-front swap, not a Map: the keys are file-derived strings
 * of unbounded size, so a growing cache would trade a freeze for a leak.
 */
let memoText2: string | null = null;
let memoSegments2: readonly GraphemeSegment[] | null = null;

/**
 * Split text into graphemes through the active boundary.
 *
 * Memoized on the last texts seen, because paragraph layout asks about the same string
 * repeatedly and a full segmentation pass per call made layout quadratic in paragraph length.
 */
export function segmentGraphemes(text: string): readonly GraphemeSegment[] {
  if (memoText === text && memoSegments) return memoSegments;
  if (memoText2 === text && memoSegments2) {
    // Promote, so the two live texts stay resident whichever order they arrive in.
    const segments = memoSegments2;
    memoText2 = memoText;
    memoSegments2 = memoSegments;
    memoText = text;
    memoSegments = segments;
    return segments;
  }
  const segments = activeBoundary.segment(text);
  memoText2 = memoText;
  memoSegments2 = memoSegments;
  memoText = text;
  memoSegments = segments;
  return segments;
}

/**
 * Install a different segmentation strategy, invalidating the memo.
 *
 * For tests and for runtimes lacking `Intl.Segmenter`. Call {@link resetGraphemeBoundary} to
 * restore the default.
 */
export function setGraphemeBoundary(boundary: GraphemeBoundary): void {
  activeBoundary = boundary;
  clearGraphemeMemo();
}

/** Restore the default `Intl.Segmenter` boundary and clear the memo. */
export function resetGraphemeBoundary(): void {
  activeBoundary = intlGraphemeBoundary;
  clearGraphemeMemo();
}

/** Whether the default boundary is active, so callers may assume its Unicode grapheme rules. */
export function isDefaultGraphemeBoundary(): boolean {
  return activeBoundary === intlGraphemeBoundary;
}

/**
 * Single-entry memo at the source.
 *
 * Segmentation is a full `Intl.Segmenter` pass over the whole paragraph, and
 * several layout probes call it once per character — `utf16AtGraphemeBoundary`,
 * the boundary tests, `semanticHorizontalBoundaries`. Memoizing each caller
 * separately kept missing one, so the memo lives here where every caller
 * benefits. One entry, not a Map: the keys are file-derived strings of unbounded
 * size, and a growing cache would trade a freeze for a leak.
 *
 * Safe to cache because segmentation is a pure function of the text and the
 * active boundary implementation; `setGraphemeBoundary` clears it.
 */
/**
 * Drop every memo — required whenever the boundary implementation changes.
 *
 * This used to clear only `memoText`/`memoSegments`, leaving the utf16->grapheme
 * index below alive across `setGraphemeBoundary` and `resetGraphemeBoundary`.
 * Independent review proved the consequence: with a one-grapheme-per-string
 * boundary installed, `utf16OffsetToGrapheme('wxyz', 3)` returns 0, and after
 * `resetGraphemeBoundary()` it still returned 0 instead of 3 — a wrong
 * utf16<->grapheme mapping, i.e. wrong caret and selection offsets, and a cache
 * able to mask a regression in the very boundary under test.
 */
function clearGraphemeMemo(): void {
  boundaryEpoch += 1;
  memoText = null;
  memoSegments = null;
  memoText2 = null;
  memoSegments2 = null;
  indexedText = null;
  indexedOffsets = null;
  indexedCount = 0;
}

/** How many user-perceived characters the text holds. */
export function graphemeCount(text: string): number {
  return segmentGraphemes(text).length;
}

/**
 * Single-entry memo of the utf16 -> grapheme index for one text.
 *
 * `utf16OffsetToGrapheme` is called once per character during paragraph layout,
 * and it previously ran a full `Intl.Segmenter` pass AND a linear scan on every
 * call, making layout quadratic in paragraph length. Independent review measured
 * a single 20,000-character paragraph — a ~20 KB .docx, no capsule, no crafted
 * markup — freezing the main thread for 117 seconds on open: 600 chars 132 ms,
 * 2,400 chars 1.85 s, 10,000 chars 29.1 s.
 *
 * The hot loop asks about the same text repeatedly, so one cached entry collapses
 * the segmentation to once per text and the scan to an O(1) array read. One entry
 * rather than a Map, because the keys here are file-derived strings of unbounded
 * size and an unbounded cache would just trade a freeze for a leak.
 */
let indexedText: string | null = null;
let indexedOffsets: Int32Array | null = null;
let indexedCount = 0;

function graphemeIndexFor(text: string): { offsets: Int32Array; count: number } {
  if (indexedText === text && indexedOffsets) {
    return { offsets: indexedOffsets, count: indexedCount };
  }
  const segments = segmentGraphemes(text);
  // offsets[i] is the grapheme index containing utf16 offset i; one extra slot
  // holds the end position, so a clamped offset never reads out of range.
  const offsets = new Int32Array(text.length + 1);
  for (const seg of segments) {
    for (let i = seg.utf16From; i < seg.utf16To && i < text.length; i += 1) {
      offsets[i] = seg.index;
    }
  }
  offsets[text.length] = segments.length;
  indexedText = text;
  indexedOffsets = offsets;
  indexedCount = segments.length;
  return { offsets, count: segments.length };
}

/**
 * The grapheme index containing a UTF-16 offset. Clamps rather than throwing.
 *
 * Backed by a single-entry index cache: this runs once per character during paragraph layout, and
 * re-segmenting per call is what made a 20,000-character paragraph take minutes to open. One
 * entry rather than a map, because the keys are file-derived strings of unbounded size.
 */
export function utf16OffsetToGrapheme(text: string, utf16Offset: number): number {
  const clamped = Math.max(0, Math.min(utf16Offset, text.length));
  const { offsets } = graphemeIndexFor(text);
  return offsets[clamped]!;
}

/** The UTF-16 offset a grapheme index starts at. Clamps rather than throwing. */
export function graphemeOffsetToUtf16(text: string, graphemeOffset: number): number {
  const segments = segmentGraphemes(text);
  if (segments.length === 0) return 0;
  const clamped = Math.max(0, Math.min(graphemeOffset, segments.length));
  if (clamped >= segments.length) return text.length;
  return segments[clamped]!.utf16From;
}
