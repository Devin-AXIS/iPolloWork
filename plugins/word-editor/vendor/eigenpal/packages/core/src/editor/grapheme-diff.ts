// The part of a text that a fix changes, cut at grapheme boundaries.
//
// A common start and a common end measured in code units can end inside a cluster: "cafe"
// written with a combining acute and fixed to a combining grave shares "cafe", and editing
// only the mark would leave a base letter and a mark in different edits. Both cuts move
// outward until they sit on a grapheme boundary of the old text and of the new text.

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** A test for grapheme boundaries of `text`; without `Intl.Segmenter`, code point boundaries. */
function boundariesOf(text: string): (at: number) => boolean {
  if (segmenter) {
    const starts = new Set<number>([text.length]);
    for (const { index } of segmenter.segment(text)) starts.add(index);
    return (at) => starts.has(at);
  }
  return (at) =>
    at <= 0 ||
    at >= text.length ||
    !(isHighSurrogate(text.charCodeAt(at - 1)) && isLowSurrogate(text.charCodeAt(at)));
}

/**
 * The part of `before` that differs from `after`: the common start and the common end are left
 * out, and neither cut splits a grapheme. Offsets are in `before`.
 */
export function differingRange(
  before: string,
  after: string
): { readonly from: number; readonly to: number; readonly text: string } {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (prefix > 0 || suffix > 0) {
    const inBefore = boundariesOf(before);
    const inAfter = boundariesOf(after);
    while (prefix > 0 && !(inBefore(prefix) && inAfter(prefix))) prefix -= 1;
    while (suffix > 0 && !(inBefore(before.length - suffix) && inAfter(after.length - suffix))) {
      suffix -= 1;
    }
  }
  return {
    from: prefix,
    to: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

/** One edit in `before` offsets: replace `[from, to)` with `text`. */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

const OBJECT = '￼';

/**
 * The edits that turn `before` into `after`, in order. When both hold the same number of
 * U+FFFC objects, each stretch between objects is compared on its own, so the objects stay
 * where they are and only the letters around them change. Otherwise the whole text is one
 * comparison. Edits that change nothing are left out.
 */
export function textEdits(before: string, after: string): TextEdit[] {
  const olds = before.split(OBJECT);
  const news = after.split(OBJECT);
  const pairs: [string, string][] =
    olds.length === news.length ? olds.map((old, index) => [old, news[index]!]) : [[before, after]];
  const edits: TextEdit[] = [];
  let offset = 0;
  for (const [old, next] of pairs) {
    const diff = differingRange(old, next);
    if (diff.from !== diff.to || diff.text.length > 0) {
      edits.push({ from: offset + diff.from, to: offset + diff.to, text: diff.text });
    }
    offset += old.length + OBJECT.length;
  }
  return edits;
}
