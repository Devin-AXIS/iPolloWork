/** Word characters for motion purposes: letters, digits and the marks that join them. */
const WORD_CHARACTER = /[\p{L}\p{N}_'\u2019]/u;

/**
 * The next word boundary from `offset`, in `direction`.
 *
 * Word-LEFT skips any whitespace immediately behind the caret and then the word behind that,
 * which makes repeated presses walk words rather than alternate with the preceding space.
 *
 * `stops` are offsets a word may not run THROUGH even when the characters either side are
 * word characters. They exist because the text this walks is what the VIEW is showing, and a
 * view can show two versions of the document side by side: struck text and the text proposed
 * to replace it abut with no separator, so `ALL CAPS` deleted and `fsdfsd` inserted read as
 * the single word `CAPSfsdfsd`. Those characters are never adjacent in any one version, and a
 * double-click that took both selected across a decision the reader had not made. See
 * `deletedTextBoundaries`.
 */
export function wordBoundary(
  text: string,
  offset: number,
  direction: -1 | 1,
  stops: ReadonlySet<number> = EMPTY_STOPS
): number {
  const isWord = (index: number): boolean => {
    const character = text[index];
    return character !== undefined && WORD_CHARACTER.test(character);
  };
  let index = Math.max(0, Math.min(offset, text.length));
  // Tested AFTER the step, never before it. A walk that starts ON a stop — which every
  // double-click inside a struck half does, since the click resolves to a position beside its
  // edge — has to be able to leave it, or the word comes back empty.
  if (direction === -1) {
    while (index > 0 && !isWord(index - 1)) {
      index -= 1;
      if (stops.has(index)) return index;
    }
    while (index > 0 && isWord(index - 1)) {
      index -= 1;
      if (stops.has(index)) return index;
    }
    return index;
  }
  while (index < text.length && !isWord(index)) {
    index += 1;
    if (stops.has(index)) return index;
  }
  while (index < text.length && isWord(index)) {
    index += 1;
    if (stops.has(index)) return index;
  }
  return index;
}

/** No stops. Shared so the common call allocates nothing. */
const EMPTY_STOPS: ReadonlySet<number> = new Set<number>();
