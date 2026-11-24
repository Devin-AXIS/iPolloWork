// Line-break opportunities: Latin word boundaries and CJK ideographic breaking
// (UAX #14, minimal ideographic form).
//
// Latin scripts break at spaces, dashes and tabs — `wordBoundaries` below. CJK prose
// carries no spaces at all: a Chinese clause was one giant "word", wrapped only through
// the wider-than-empty-line chop, and any run or piece seam inside it became the only
// place a line could end (#526). UAX #14 gives ideographic characters (class ID) a break
// opportunity on BOTH sides instead, subject to the kinsoku prohibitions: a line must not
// START with a closing character (。，、」…) and must not END with an opening one (「（…).
//
// These helpers retain the inexpensive Latin fallback and conservative ideographic
// character tables. Production East Asian flow uses cjk-paragraph-breaks.ts: one
// paragraph-wide analysis protects graphemes and numeric groups across every run seam,
// handles mixed-script boundaries, and consumes the OOXML language/settings policy.
// cjk-spacing.ts owns compression and hanging punctuation; cjk-justify.ts distributes
// line slack as published geometry. Layout-owned field results remain atomic.

import { RIGHT_TO_LEFT_LETTER } from './rtl-letter.ts';
import { graphemeBoundaryEpoch, segmentGraphemes } from './grapheme.ts';
import { withoutLineEndWhitespace } from './trailing-spaces.ts';

/**
 * Whether the code point takes ideographic line breaking — a break opportunity on both
 * sides, before the kinsoku sets below veto one direction.
 *
 * Ranges: CJK radicals/Kangxi through symbols-and-punctuation and Kana (U+2E80–U+312F),
 * strokes/Katakana-ext through the unified block (U+31C0–U+9FFF), compatibility ideographs
 * (U+F900–U+FAFF), vertical/compat forms (U+FE30–U+FE4F), full-width forms and half-width
 * Katakana (U+FF01–U+FF9F), and supplementary ideographs (U+20000–U+323AF).
 */
export function isIdeographicForLineBreak(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x312f) ||
    (codePoint >= 0x31c0 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff9f) ||
    (codePoint >= 0x20000 && codePoint <= 0x323af)
  );
}

const codePointsOf = (text: string): ReadonlySet<number> =>
  new Set([...text].map((ch) => ch.codePointAt(0)!));

/**
 * Characters a line must not START with (kinsoku 行頭禁則): closing brackets and quotes,
 * CJK full stops and commas (their half-width forms too), sentence-final marks, the
 * ideographic space and middle dots, iteration and prolonged-sound marks, and small kana
 * (full- and half-width, with the half-width voicing marks that lean on the kana before
 * them). Every member sits at or above the first ideographic code unit, so Latin layout
 * cannot observe these sets.
 */
export const CJK_NO_BREAK_BEFORE: ReadonlySet<number> = codePointsOf(
  '。．，、；：？！」』）】〉》〕〗〙〛｝］＞％　・' +
    '｡｣､･ｰﾞﾟ' +
    '々〜ゝゞヽヾー' +
    'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ' +
    'ｧｨｩｪｫｬｭｮｯ'
);

/**
 * Characters a line must not END with (kinsoku 行末禁則): opening brackets and quotes,
 * and currency signs that prefix a figure. Also entirely above the Latin range.
 */
export const CJK_NO_BREAK_AFTER: ReadonlySet<number> =
  codePointsOf('「『（【〈《〔〖〘〚｛［＜｢＄￥');

/**
 * Whether a line may break between these two adjacent code points.
 *
 * Both sides must be ideographic — the minimal-scope rule above — and neither kinsoku set
 * may veto its direction. The closing and opening characters are themselves inside the
 * ideographic ranges, so 「 glues to the character after it and 。 to the one before,
 * while both still break freely on their permitted side.
 */
export function cjkBreakAllowedBetween(before: number, after: number): boolean {
  if (!isIdeographicForLineBreak(before) || !isIdeographicForLineBreak(after)) return false;
  if (CJK_NO_BREAK_AFTER.has(before)) return false;
  if (CJK_NO_BREAK_BEFORE.has(after)) return false;
  return true;
}

/** The final code point of the text, stepping back over a surrogate pair; undefined when empty. */
export function lastCodePointOf(text: string): number | undefined {
  if (text.length === 0) return undefined;
  const lastUnit = text.charCodeAt(text.length - 1);
  if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && text.length >= 2) {
    return text.codePointAt(text.length - 2)!;
  }
  return lastUnit;
}

/**
 * Dashes a line may break AFTER, the way Word wraps "ALPHA-PRIME" as "ALPHA-" / "PRIME":
 * hyphen-minus, hyphen, en dash, em dash. U+2011 NON-BREAKING HYPHEN is deliberately
 * absent — its whole meaning is "no wrap here".
 */
export const BREAK_AFTER_DASH: ReadonlySet<string> = new Set(['-', '‐', '–', '—']);

/**
 * Characters that normally join adjacent text. Run-boundary whitespace tests exclude
 * these characters. Ordinary spaces and oversized groups keep their existing behavior.
 */
export const NO_BREAK_CHARACTER = /[\u00a0\u2007\u202f\u2060\ufeff]/u;

/**
 * Whether the code point stacks the next consonant under the one before it: the Khmer coeng
 * (U+17D2) and the Myanmar virama (U+1039). Grapheme rules end a cluster after them, but a
 * line break there would tear a stacked consonant from its base, so no break follows them
 * before a letter (`stacksNext`).
 */
export const isStackingSign = (cp: number | undefined): boolean => cp === 0x17d2 || cp === 0x1039;

const LETTER = /^\p{L}$/u;

/**
 * Whether a stacking sign joins the next code point to its base: only a letter stacks. In
 * Zawgyi-encoded Myanmar U+1039 is the visible asat that ends a word, so a space after it
 * still breaks.
 */
export function stacksNext(before: number | undefined, after: number | undefined): boolean {
  return isStackingSign(before) && after !== undefined && LETTER.test(String.fromCodePoint(after));
}

const COMBINING_MARK = /^\p{M}$/u;

/**
 * Whether the code point is a combining mark (general category M, UAX #14 class CM), which
 * never starts a line. Grapheme rules end a cluster before some spacing marks, such as the
 * Myanmar vowel signs U+102B and U+102C and the visarga U+1038, but a line break there would
 * tear the vowel from its consonant (`လေ` + `း`, `သွ` + `ား`). Below U+0300 nothing is a
 * mark, so ASCII text skips the test.
 */
export function isCombiningMark(cp: number | undefined): boolean {
  return cp !== undefined && cp >= 0x0300 && COMBINING_MARK.test(String.fromCodePoint(cp));
}

/**
 * Whether a combining mark after this code unit continues the text before it, so no line
 * may break before the mark. After a breaking space or a zero-width space the mark starts a
 * new word instead (UAX #14 LB10), as in Zawgyi-encoded Myanmar, which stores the vowel sign
 * U+1031 before its consonant. After a tab or a dash that breaks after itself, the break
 * before the mark is kept. Undefined (a line start) continues nothing.
 */
export function marksContinue(before: number | undefined): boolean {
  if (before === undefined || before === 0x200b || before === 0x09) return false;
  const char = String.fromCharCode(before);
  return !ENDS_WITH_BREAKING_SPACE.test(char) && !BREAK_AFTER_DASH.has(char);
}

/** U+200B ZERO WIDTH SPACE: an invisible break opportunity, common in Thai and Khmer text. */
export const ZERO_WIDTH_SPACE = '\u200b';

// Whitespace that ends a word at a seam: every JavaScript `\s` except the no-break
// characters above, which `\s` also matches (U+2060 is not `\s`).
/** A breaking space at a run's end or start: the break opportunities a run seam offers. */
export const ENDS_WITH_BREAKING_SPACE = /[^\S\u00a0\u2007\u202f\ufeff]$/;
export const STARTS_WITH_BREAKING_SPACE = /^[^\S\u00a0\u2007\u202f\ufeff]/;

/** Every kinsoku member and every ideographic range sits at or above this code unit. */
const FIRST_IDEOGRAPHIC_UNIT = 0x2e80;
/** The first combining mark. No code point below it joins the cluster before it. */
const FIRST_CLUSTER_EXTENDER_UNIT = 0x0300;

/**
 * UTF-16 positions where a grapheme cluster starts, for vetoing a cut inside one.
 *
 * Built lazily: the Latin boundary rules cut beside spaces, tabs and dashes, which are
 * cluster boundaries by construction, so only the ideographic pass pays for segmentation —
 * once per text, and only when it found a break to check. The oversized-word chop steps by
 * cluster already, so it needs only the seam vetoes (`cjkChopCutAllowedAt`).
 */
function clusterCutTester(text: string): (position: number) => boolean {
  let starts: Set<number> | null = null;
  return (position: number): boolean => {
    if (starts === null) {
      starts = new Set();
      for (const segment of segmentGraphemes(text)) starts.add(segment.utf16From);
      starts.add(text.length);
    }
    return starts.has(position);
  };
}

/** Merge two strictly-increasing, disjoint boundary lists. */
function mergeBoundaries(latin: readonly number[], cjk: readonly number[]): number[] {
  const merged: number[] = [];
  let latinAt = 0;
  let cjkAt = 0;
  while (latinAt < latin.length || cjkAt < cjk.length) {
    const nextLatin = latinAt < latin.length ? latin[latinAt]! : Number.POSITIVE_INFINITY;
    const nextCjk = cjkAt < cjk.length ? cjk[cjkAt]! : Number.POSITIVE_INFINITY;
    if (nextLatin < nextCjk) {
      merged.push(nextLatin);
      latinAt += 1;
    } else {
      merged.push(nextCjk);
      cjkAt += 1;
    }
  }
  return merged;
}

/**
 * Break points inside a piece: after each run of spaces (words stay whole) and each zero-width
 * space (never before one), after a dash
 * that sits between non-space text, with each tab as its own atom so tab-stop geometry can
 * size `\t` independently of neighbouring text — and, when `ideographic` allows it,
 * between ideographic characters, where UAX #14 allows a line to end (kinsoku vetoes
 * aside). Layout-owned pieces pass `ideographic: false`: every span they emit publishes
 * the piece's whole model range, so they are documented as staying whole, and a
 * per-ideograph split would wrap a field result mid-text with every line claiming the
 * same range.
 *
 * A dash run breaks only after its LAST dash, mirroring how a run of spaces is one
 * boundary; a dash beside a space adds nothing the space boundary does not already give.
 */
export function wordBoundaries(text: string, ideographic: boolean): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (ch === '\t') {
      if (index > 0 && boundaries[boundaries.length - 1] !== index) boundaries.push(index);
      boundaries.push(index + 1);
    } else if (ch === ' ' || ch === ZERO_WIDTH_SPACE) {
      // UAX #14 ZW SP* ÷: the break after a zero-width space comes after the spaces that
      // follow it, and there is no break before a zero-width space, even after a space. So a
      // run of spaces and zero-width spaces breaks once, at its end, and hangs as one.
      const next = text[index + 1];
      if (next !== ZERO_WIDTH_SPACE && !(ch === ZERO_WIDTH_SPACE && next === ' '))
        boundaries.push(index + 1);
    } else if (
      BREAK_AFTER_DASH.has(ch) &&
      index > 0 &&
      // A dash after a space opens its word ("-word") and stays with it, except before a
      // right-to-left letter: there the dash may end the line alone, as the reference
      // renders "... -word" in Arabic.
      (text[index - 1] !== ' ' || RIGHT_TO_LEFT_LETTER.test(text[index + 1] ?? '')) &&
      index + 1 < text.length &&
      text[index + 1] !== ' ' &&
      text[index + 1] !== ZERO_WIDTH_SPACE &&
      !BREAK_AFTER_DASH.has(text[index + 1]!)
    ) {
      boundaries.push(index + 1);
    }
  }
  // CJK pass, by code point so a supplementary-plane ideograph is never cut inside its
  // surrogate pair, filtered through the grapheme boundary so NFD text (か + U+3099) is
  // never cut inside a cluster either. Kept separate from the loop above so the Latin
  // rules stay byte-identical; both lists are strictly increasing and can never share a
  // position (every Latin cut borders a space, tab or dash, none of which is
  // ideographic), so an O(n) merge replaces them without a sort.
  let merged = boundaries;
  if (ideographic) {
    const cjk: number[] = [];
    const clusterCutAt = clusterCutTester(text);
    for (let index = 0; index < text.length;) {
      const before = text.codePointAt(index)!;
      const next = index + (before > 0xffff ? 2 : 1);
      if (next >= text.length) break;
      if (cjkBreakAllowedBetween(before, text.codePointAt(next)!) && clusterCutAt(next)) {
        cjk.push(next);
      }
      index = next;
    }
    if (cjk.length > 0) merged = mergeBoundaries(boundaries, cjk);
  }
  if (merged[merged.length - 1] !== text.length) merged.push(text.length);
  return merged;
}

/** Whether a cut between two adjacent code points is legal under the kinsoku sets. */
export function cjkCutAllowedBetween(
  before: number | undefined,
  after: number | undefined
): boolean {
  if (after !== undefined && CJK_NO_BREAK_BEFORE.has(after)) return false;
  if (before !== undefined && CJK_NO_BREAK_AFTER.has(before)) return false;
  return true;
}

/**
 * Whether the oversized-word chop may cut `text` at `index`.
 *
 * The chop runs only for a word or protected group wider than its whole line. Such a group is
 * cut at its last fitting character even where the kinsoku sets forbid the break: at a
 * one-character measure 天。地。人。 sets every character on its own line, and a strict small
 * kana after a figure (`3ヵ`) leaves the figure at the line end. Grapheme and surrogate
 * safety is the chop's own (it steps by cluster), so only the seams no emergency cut may take
 * are vetoed here.
 */
export function cjkChopCutAllowedAt(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  // No line starts with a zero-width space or a combining mark, even after an emergency cut,
  // nor right after a stacking sign before a letter, nor with a space that ink follows. A cut where only
  // line-end whitespace remains hangs that whitespace.
  const next = text.charCodeAt(index);
  if (
    next === 0x200b ||
    (isCombiningMark(text.codePointAt(index)) && marksContinue(text.charCodeAt(index - 1))) ||
    stacksNext(text.charCodeAt(index - 1), text.codePointAt(index))
  )
    return false;
  return !(next === 0x20 && withoutLineEndWhitespace(text).length > index);
}

/**
 * Whether a cluster boundary exists between two adjacent code points, under the active
 * grapheme boundary, memoized by the pair.
 *
 * Asked at a piece seam whose second code point is at or above U+0300. ASCII seams never
 * reach it.
 */
const clusterBreakCache = new Map<number, boolean>();
let clusterBreakEpoch = -1;
function clusterBreaksBetween(before: number, after: number): boolean {
  const epoch = graphemeBoundaryEpoch();
  if (clusterBreakEpoch !== epoch || clusterBreakCache.size >= 2048) {
    clusterBreakCache.clear();
    clusterBreakEpoch = epoch;
  }
  const key = before * 0x110000 + after;
  const cached = clusterBreakCache.get(key);
  if (cached !== undefined) return cached;
  let count = 0;
  for (const _segment of segmentGraphemes(String.fromCodePoint(before, after))) count += 1;
  const breaks = count > 1;
  clusterBreakCache.set(key, breaks);
  return breaks;
}

/** Why a candidate may or may not open a line. */
export type LineOpenDecision =
  /** A real break opportunity: the line may end before this candidate. */
  | 'opens'
  /** No opportunity here — mid-word, as a Latin word split across runs is. */
  | 'continues'
  /**
   * An opportunity the kinsoku sets forbid: 。 at a line start, （ at a line end, a strict
   * small kana, an authored `w:noLineBreaksBefore`/`w:noLineBreaksAfter` character. No line
   * opens here, but a group wider than its whole line is cut here as an over-long word is.
   */
  | 'kinsoku'
  /** A seam no cut may take: inside a grapheme cluster, before a zero-width space, or glue. */
  | 'forbidden';

/**
 * Whether a candidate may OPEN a line — the decision the placement loop and the
 * anchor-line probe must share, or their predicted line starts diverge — and, when it may
 * not, WHY.
 *
 * A candidate is a break opportunity at any `wordBoundaries` cut inside its piece
 * (`afterIntraPieceCut`). The FIRST candidate of a piece continues whatever the previous
 * piece ended with, so it is one only if that ended in breaking whitespace (never a
 * `NO_BREAK_CHARACTER`, on either side of the seam) — or in a dash or an
 * ideograph, which stay break opportunities across run boundaries (a tracked change can
 * split "ALPHA-" and "PRIME" into different runs without gluing them, and a CJK clause
 * split across runs must not wrap at the seam instead of the margin, #526). The kinsoku
 * sets then veto the whole decision: no opportunity ever puts 。，、」 at a line start or
 * leaves 「（ at a line end — a space or a run seam directly before a closing mark would
 * otherwise create one. A tab outranks the veto: a tab is a hard break opportunity whose
 * following text must be able to open a line, or an overflow takes the mid-word carry
 * path and re-lays the tab with a stale advance that no longer reaches its stop.
 *
 * `continues`, `kinsoku` and `forbidden` are all "may not open", and the caller must tell
 * them apart. A Latin word wider than its line has no legal cut of its own, so it is CHOPPED
 * at the margin. A kinsoku group wider than its whole line is chopped the same way, at its
 * last fitting character, this seam included. Only a `forbidden` seam is never cut: the
 * group is pushed out past the measure there instead.
 */
export function lineOpenDecisionAt(
  lastEmitted: string,
  candidate: string,
  afterIntraPieceCut: boolean
): LineOpenDecision {
  const opportunity =
    afterIntraPieceCut ||
    lastEmitted === '' ||
    ENDS_WITH_BREAKING_SPACE.test(lastEmitted) ||
    lastEmitted.endsWith(ZERO_WIDTH_SPACE) ||
    STARTS_WITH_BREAKING_SPACE.test(candidate) ||
    (BREAK_AFTER_DASH.has(lastEmitted[lastEmitted.length - 1]!) &&
      !BREAK_AFTER_DASH.has(candidate[0]!));
  // Both seam units below the first ideographic range: no CJK rule can observe the seam,
  // so the pre-ideographic decision above is final. This is the hot path for pure-Latin
  // text — no decode, no set lookups. (A surrogate unit is above the threshold.)
  const lastUnit = lastEmitted.length === 0 ? 0 : lastEmitted.charCodeAt(lastEmitted.length - 1);
  const firstUnit = candidate.charCodeAt(0);
  // UAX #14 LB7: never break before a zero-width space, even after a space.
  if ((firstUnit === 0x200b && lastUnit !== 0) || stacksNext(lastUnit, candidate.codePointAt(0)))
    return 'forbidden';
  // A combining mark never opens a line, even where grapheme rules end a cluster before it.
  if (marksContinue(lastUnit || undefined) && isCombiningMark(candidate.codePointAt(0)))
    return 'forbidden';
  if (lastUnit < FIRST_IDEOGRAPHIC_UNIT && firstUnit < FIRST_IDEOGRAPHIC_UNIT) {
    // A run seam can split a combining mark, tone mark, or vowel sign from its base. Below
    // U+0300 no code point extends a cluster, so ASCII seams skip the check.
    // After a breaking space, a zero-width space, or a tab a mark starts a word, though
    // grapheme rules join it to the space.
    if (
      marksContinue(lastUnit || undefined) &&
      firstUnit >= FIRST_CLUSTER_EXTENDER_UNIT &&
      !clusterBreaksBetween(lastUnit, firstUnit)
    )
      return 'forbidden';
    return opportunity ? 'opens' : 'continues';
  }
  if (lastUnit === 0x09) return 'opens';
  const previous = lastCodePointOf(lastEmitted);
  const first = candidate.codePointAt(0)!;
  // A grapheme cluster SPLIT ACROSS PIECES has no single text for `wordBoundaries` to
  // segment, so the two code points around the seam are segmented on their own: NFD kana
  // (か in one run, U+3099 in the next) would otherwise orphan its voicing mark, the
  // combining marks being inside the ideographic ranges and outside the kinsoku sets.
  if (previous !== undefined && !clusterBreaksBetween(previous, first)) return 'forbidden';
  if (!cjkCutAllowedBetween(previous, first)) return 'kinsoku';
  if (opportunity) return 'opens';
  return previous !== undefined && cjkBreakAllowedBetween(previous, first) ? 'opens' : 'continues';
}

/** `lineOpenDecisionAt` for callers that need only the yes/no. */
export function wordOpensAt(
  lastEmitted: string,
  candidate: string,
  afterIntraPieceCut: boolean
): boolean {
  return lineOpenDecisionAt(lastEmitted, candidate, afterIntraPieceCut) === 'opens';
}
