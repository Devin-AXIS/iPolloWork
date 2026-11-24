import { PAGE_BREAK_CHAR } from '@docx-editor.dev/core/store';
import type { StyleSpanRecord } from './semantic-records.ts';
import { withoutLineEndWhitespace } from './trailing-spaces.ts';
import { measuredWidth } from './optional-hyphen-joining.ts';
import type { TextMeasurer } from './semantic-records.ts';
import type { FontSlot } from './script-itemization.ts';
import { isRunKerningEnabled } from './run-kerning.ts';
import type { ResolvedRunStyle } from './run-style.ts';

/**
 * Spaces that may hang/clip at a line end instead of wrapping onto a new line. Zero-width
 * spaces among them hang too, but zero-width spaces alone are not spaces.
 */
export function isCollapsibleLineEndWhitespace(text: string): boolean {
  let space = false;
  for (const char of text) {
    if (char === ' ' || char === '\u3000') space = true;
    else if (char !== '\u200b') return false;
  }
  return space;
}

/**
 * Whether the space that opens `pieces[index]` is the trailing space of the word before the
 * ignored page breaks in front of it. A table cell lays its text out as though the breaks
 * were absent, and then the word and its space are one candidate with one style, so the
 * space hangs only when it overflows, not because it ends the paragraph.
 */
export function endsWordAcrossIgnoredBreaks(
  pieces: readonly { readonly text: string; readonly style: object }[],
  index: number,
  candidate: string,
  lastEmitted: string
): boolean {
  if (candidate !== ' ' || !/\S$/u.test(lastEmitted)) return false;
  let before = index - 1;
  while (pieces[before]?.text === PAGE_BREAK_CHAR) before--;
  return before < index - 1 && pieces[before]?.style === pieces[index]!.style;
}

interface ClippedWordEnd {
  readonly length: number;
  readonly visibleWidth: number;
  readonly width: number;
}

/** The advance of a word without its trailing spaces; undefined when it has none, or no ink. */
export function wordInkWidth(text: string, measure: (text: string) => number): number | undefined {
  const ink = withoutLineEndWhitespace(text);
  return ink.length === 0 || ink.length === text.length ? undefined : measure(ink);
}

/** Price only the ink when a word fits but its trailing separator crosses the margin. */
export function clipWordEnd(
  text: string,
  width: number,
  remaining: number,
  measure: (text: string) => number,
  tolerance: number
): ClippedWordEnd | undefined {
  if (width <= remaining + tolerance) return undefined;
  // U+3000 participates in kinsoku groups; leave those authored groups to the CJK breaker.
  // A zero-width space after a space hangs with it.
  const length = withoutLineEndWhitespace(text).length;
  if (length === 0 || length === text.length) return undefined;
  const visibleWidth = measure(text.slice(0, length));
  if (visibleWidth > remaining + tolerance) return undefined;
  return { length, visibleWidth, width: Math.max(visibleWidth, remaining) };
}

/** Only the fill receives the clipping flag; alignment still sees the whole visible word. */
export function appendWordEnd(
  spans: StyleSpanRecord[],
  span: StyleSpanRecord,
  clipped: ClippedWordEnd | undefined
): void {
  if (!clipped) {
    spans.push(span);
    return;
  }
  const split = span.range.start + clipped.length;
  spans.push(
    {
      ...span,
      text: span.text.slice(0, clipped.length),
      range: { ...span.range, end: split },
      box: { ...span.box, width: clipped.visibleWidth },
    },
    {
      ...span,
      text: span.text.slice(clipped.length),
      range: { ...span.range, start: split },
      box: {
        ...span.box,
        x: span.box.x + clipped.visibleWidth,
        width: Math.max(0, span.box.width - clipped.visibleWidth),
      },
      lineEndWhitespace: true,
    }
  );
}

/**
 * Whether the spaces that end a paragraph take room on its last line instead of hanging. They
 * hang only when their run has the paragraph's direction, which is also where alignment puts
 * them (`bidi-trailing-spaces.ts`).
 */
function endSpacesTakeRoom(style: StyleSpanRecord['style'], paragraphRtl: boolean): boolean {
  const direction = style.shaping?.runDirection;
  return direction !== undefined && (direction === 'rtl') !== paragraphRtl;
}

/**
 * The paragraph-end spaces after a candidate that ends at `offset` in `pieces[index]`.
 * `takesRoom`: only spaces follow, and the candidate's own run keeps them on the line, so they
 * neither hang nor clip. `room`: the advance of the following spaces that take room, which the
 * last word must fit together with, or the line keeps a word that wraps. Both are off when
 * anything else follows the candidate.
 */
export function paragraphEndSpacesOf<
  P extends {
    readonly text: string;
    readonly style: StyleSpanRecord['style'];
    readonly fontSlot?: FontSlot;
  },
>(
  pieces: readonly P[],
  paragraphRtl: boolean,
  measurer: TextMeasurer
): (index: number, offset: number, candidate: string, lineWidth: number) => EndSpaces {
  // The paragraph's last visible character, found once: only spaces follow a position at or
  // past it, so each candidate's test is a comparison and a long space run stays linear.
  let lastIndex = -1;
  let lastOffset = -1;
  for (let at = pieces.length - 1; at >= 0 && lastIndex < 0; at--) {
    const text = pieces[at]!.text;
    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (char !== ' ' && char !== '\u3000' && char !== '\u200b') {
        lastIndex = at;
        lastOffset = i;
        break;
      }
    }
  }
  return (index, offset, candidate, lineWidth) => {
    if (index < lastIndex || (index === lastIndex && offset <= lastOffset)) return NO_END_SPACES;
    const takesRoom = endSpacesTakeRoom(pieces[index]!.style, paragraphRtl);
    // Only the last word needs the room; a space candidate is itself one of the spaces.
    if (isCollapsibleLineEndWhitespace(candidate)) return takesRoom ? TAKES_ROOM : NO_END_SPACES;
    let room = 0;
    for (let at = index; at < pieces.length; at++) {
      const text = at === index ? pieces[at]!.text.slice(offset) : pieces[at]!.text;
      if (text.length > 0 && endSpacesTakeRoom(pieces[at]!.style, paragraphRtl))
        room += measuredWidth(text, pieces[at]!.style, pieces[at]!.fontSlot, measurer);
    }
    // Spaces wider than a whole line hang on any line, so they ask the last word for nothing.
    return { takesRoom, room: room < lineWidth ? room : 0 };
  };
}

interface EndSpaces {
  readonly takesRoom: boolean;
  readonly room: number;
}

const TAKES_ROOM = { takesRoom: true, room: 0 } as const;
const NO_END_SPACES = { takesRoom: false, room: 0 } as const;

/**
 * The kerning pair between a word's trailing space and the first letter of the next word of
 * the same run, in points (negative tightens). Words are measured one at a time, so a pair
 * whose first glyph is a space never reaches the shaper. Measured in the reference with a
 * `w:kern` run at 48pt bold: the space before an "A" advanced by the font's space-A pair.
 * Zero when the run does not kern.
 */
export function spaceKern(
  previous: string,
  next: string,
  style: ResolvedRunStyle,
  measure: (text: string) => number
): number {
  if (!previous.endsWith(' ') || next.length === 0 || !isRunKerningEnabled(style)) return 0;
  const first = String.fromCodePoint(next.codePointAt(0)!);
  return measure(` ${first}`) - measure(' ') - measure(first);
}
