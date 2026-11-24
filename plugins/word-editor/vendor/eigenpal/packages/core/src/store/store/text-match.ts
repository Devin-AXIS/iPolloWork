// What counts as a match, and how many of them are allowed to exist.
//
// Shared by the navigation pane's Find tab (`binding/document-search.ts`) and by the
// automation lane's story search, because a match reported by one and acted on by the other
// must be the same match. The limits are shared for the same reason they exist at all: a
// query is host input, a haystack is file content, and both are bounded HERE rather than at
// each caller's discretion.
//
// NO REGEX ON EITHER SIDE. The needle and the haystack are attacker-influenced, so a pattern
// built from either is a catastrophic-backtracking hazard. Scanning is `indexOf` only; the one
// regex in this module runs against a SINGLE character at a time for the whole-word test,
// where there is nothing to backtrack.

/**
 * Longest accepted query. A query is host input rather than file content, but the scan is
 * proportional to it and there is no legitimate find phrase this long.
 */
export const SEARCH_QUERY_MAX = 256;

/**
 * Most matches one search returns. A single-character query against a long document would
 * otherwise allocate an entry per character; the scan stops here instead. A caller showing a
 * count treats a full result as "at least this many".
 */
export const SEARCH_MATCH_LIMIT = 2000;

/**
 * A word character for the whole-word test: any Unicode letter or number, plus the
 * underscore. Applied to ONE character at a time.
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** How a text search is narrowed. Options the engine cannot honour are refused, never ignored. */
export interface TextMatchOptions {
  readonly matchCase?: boolean;
  readonly wholeWord?: boolean;
  /**
   * Report only matches lying wholly inside `[from, to)`.
   *
   * A WINDOW ON THE TEXT, not a slice of it: the whole-word test still reads the characters on
   * either side of the window, so scanning the first three characters of `category` for `cat`
   * finds nothing when whole words were asked for. Slicing first would answer a match, because
   * the `e` that disqualifies it would have been cut off — the window is where a caller is
   * looking, not what the paragraph says.
   */
  readonly from?: number;
  readonly to?: number;
}

/** One occurrence, as UTF-16 offsets into the text that was scanned. */
export interface TextOccurrence {
  readonly start: number;
  readonly length: number;
}

/** Where a phrase occurs in a story, as paragraph-plus-offset ranges. */
export interface TextOccurrences {
  readonly matches: readonly TextOccurrence[];
  /** The scan stopped at `limit` with occurrences still ahead of it. */
  readonly truncated: boolean;
}

/**
 * Lower-case `text` WITHOUT changing its length.
 *
 * `String.prototype.toLowerCase` can expand (Turkish dotted capital I lowercases to two code
 * units), and an expansion mid-paragraph would slide every offset after it — the match would
 * be reported at the wrong place. The per-unit fallback folds only the characters that stay
 * one unit, so an expanding character simply compares case-sensitively. That is a real
 * degradation and it is the safe direction: a missed case-insensitive match beats a match
 * reported at an offset an editor then selects.
 */
export function foldCase(text: string): string {
  const folded = text.toLowerCase();
  if (folded.length === text.length) return folded;
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const lower = char.toLowerCase();
    out += lower.length === 1 ? lower : char;
  }
  return out;
}

/** Whether a match at `[start, end)` in `text` stands alone as a word. */
export function isWholeWord(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : undefined;
  const after = end < text.length ? text[end] : undefined;
  if (before !== undefined && WORD_CHAR.test(before)) return false;
  if (after !== undefined && WORD_CHAR.test(after)) return false;
  return true;
}

/** Whether a query is one this module will scan for at all. */
export function isSearchableQuery(query: unknown): query is string {
  return typeof query === 'string' && query.length > 0 && query.length <= SEARCH_QUERY_MAX;
}

/**
 * Every occurrence of `query` in `text`, in order, NON-OVERLAPPING.
 *
 * Non-overlapping is what a find dialog counts: `aa` in `aaaa` is two, not three. `limit` is
 * the caller's remaining budget, so a caller scanning many paragraphs enforces ONE global cap
 * rather than one per paragraph.
 */
export function findOccurrences(
  text: string,
  query: string,
  limit: number,
  options: TextMatchOptions = {}
): TextOccurrences {
  const empty: TextOccurrences = { matches: [], truncated: false };
  if (!isSearchableQuery(query) || text.length === 0 || limit <= 0) return empty;

  const matchCase = options.matchCase === true;
  const wholeWord = options.wholeWord === true;
  const needle = matchCase ? query : foldCase(query);
  const haystack = matchCase ? text : foldCase(text);

  const from = Math.max(0, options.from ?? 0);
  const to = Math.min(text.length, options.to ?? text.length);

  const matches: TextOccurrence[] = [];
  let cursor = haystack.indexOf(needle, from);
  while (cursor >= 0) {
    const end = cursor + needle.length;
    if (end > to) return { matches, truncated: false };
    if (!wholeWord || isWholeWord(text, cursor, end)) {
      if (matches.length >= limit) return { matches, truncated: true };
      matches.push({ start: cursor, length: needle.length });
    }
    cursor = haystack.indexOf(needle, end);
  }
  return { matches, truncated: false };
}
