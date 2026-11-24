import { lineOpenDecisionAt, wordBoundaries } from './cjk-line-break.ts';
import { measureDisplayText } from './run-style.ts';
import { styleForFontSlot } from './script-itemization.ts';
import type { FieldAwarePiece } from './field-pieces.ts';
import type { TextMeasurer } from './semantic-records.ts';
import { isSpaceShrinkWordPiece } from './space-shrink-piece.ts';

/** Measure a complete word and stable body citations before testing its opening fragment.
 * Source-run seams retain their styles and model ranges. Cached tails make a word split
 * across many runs linear in its piece count, including tails that cannot borrow space.
 */
export function spaceShrinkWordTail(pieces: readonly FieldAwarePiece[], measurer: TextMeasurer) {
  const cache = new Map<number, number | undefined>();
  const continues = (left: FieldAwarePiece, right: FieldAwarePiece) =>
    isSpaceShrinkWordPiece(left) &&
    isSpaceShrinkWordPiece(right) &&
    right.text.length > 0 &&
    lineOpenDecisionAt(left.text, right.text, false) === 'continues';
  return (pieceIndex: number, boundary: number): number | undefined => {
    const piece = pieces[pieceIndex]!;
    const next = pieces[pieceIndex + 1];
    if (boundary !== piece.text.length || !next || !continues(piece, next)) return undefined;
    const start = pieceIndex + 1;
    if (cache.has(start)) return cache.get(start);
    const pending: { index: number; width: number }[] = [];
    let tail: number | undefined;
    for (let index = start; index < pieces.length; index += 1) {
      if (cache.has(index)) {
        tail = cache.get(index);
        break;
      }
      const current = pieces[index]!;
      const space = current.text.search(/\s/u);
      const word = space < 0 ? current.text : current.text.slice(0, space);
      if (
        !isSpaceShrinkWordPiece(current) ||
        !/^[\p{Script=Latin}\p{Script=Cyrillic}\p{N}\p{P}]+$/u.test(word) ||
        wordBoundaries(word, true).length !== 1
      ) {
        cache.set(index, undefined);
        break;
      }
      pending.push({
        index,
        width: measureDisplayText(
          word,
          styleForFontSlot(current.style, current.fontSlot),
          measurer
        ),
      });
      if (space >= 0) {
        // A tab or a text-wrapping break ends the line's last word as a space does.
        tail = [' ', '\t', '\n'].includes(current.text[space]!) ? 0 : undefined;
        break;
      }
      const following = pieces[index + 1];
      if (!following) {
        tail = 0;
        break;
      }
      if (isSpaceShrinkWordPiece(following) && following.text.startsWith(' ')) {
        tail = 0;
        break;
      }
      if (!continues(current, following)) break;
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const entry = pending[index]!;
      if (tail !== undefined) tail += entry.width;
      cache.set(entry.index, tail);
    }
    return cache.get(start);
  };
}
