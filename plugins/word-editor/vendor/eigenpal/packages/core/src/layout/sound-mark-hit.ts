// Hit testing around combining kana sound marks that paint in a span of their own.
import { isSoundMark } from './sound-mark-spacing.ts';

/**
 * Move a hit that lands between a base and its sound mark to the nearer edge of the cluster.
 *
 * A spaced mark paints as its own span (`sound-mark-pieces.ts`), so the in-span grapheme snap
 * can return the offset between the base and the mark. Caret movement steps over the whole
 * cluster, and text typed there would separate the mark from its base. `characterAt` reads
 * the model character at an offset on the line, and `xAt` gives the caret x of an offset.
 */
export function snapToSoundMarkCluster<Hit extends { readonly offset: number; readonly x: number }>(
  hit: Hit,
  x: number,
  lineStart: number,
  characterAt: (offset: number) => string | null,
  xAt: (offset: number) => number
): Hit {
  const markAt = (offset: number) => {
    const character = characterAt(offset);
    return character !== null && isSoundMark(character);
  };
  if (hit.offset <= lineStart || !markAt(hit.offset)) return hit;
  let start = hit.offset - 1;
  while (start > lineStart && markAt(start)) start -= 1;
  let end = hit.offset + 1;
  while (markAt(end)) end += 1;
  const startX = xAt(start);
  const endX = xAt(end);
  // The nearer edge; the earlier one on a tie.
  return Math.abs(x - startX) <= Math.abs(endX - x)
    ? { ...hit, offset: start, x: startX }
    : { ...hit, offset: end, x: endX };
}
