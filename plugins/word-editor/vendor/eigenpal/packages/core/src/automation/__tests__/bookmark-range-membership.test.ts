// Which bookmarks a range holds, for `Range.getBookmarks`. Positions are (paragraph, offset).

import { describe, expect, test } from 'bun:test';
import { bookmarkInRange } from '../plan-bookmarks.ts';

const at = (offset: number, paragraph = 0) => [paragraph, offset] as const;
const span = (start: number, end: number) => ({ start: at(start), end: at(end) });
const holds = (range: [number, number], bookmark: [number, number], adjacent = false) =>
  bookmarkInRange(span(...range), span(...bookmark), adjacent);

describe('bookmarkInRange', () => {
  test('a non-empty range holds the bookmarks it shares text with', () => {
    expect(holds([4, 7], [4, 7])).toBe(true);
    expect(holds([5, 6], [4, 7])).toBe(true);
    expect(holds([2, 5], [4, 7])).toBe(true);
    expect(holds([0, 4], [4, 7])).toBe(false);
    expect(holds([7, 9], [4, 7])).toBe(false);
  });

  test('a point bookmark counts when it is inside the range or at its start', () => {
    expect(holds([11, 13], [12, 12])).toBe(true);
    expect(holds([12, 14], [12, 12])).toBe(true);
    expect(holds([10, 12], [12, 12])).toBe(false);
  });

  test('an empty range holds the bookmark around it, counting the start but not the end', () => {
    expect(holds([4, 4], [4, 7])).toBe(true);
    expect(holds([5, 5], [4, 7])).toBe(true);
    expect(holds([7, 7], [4, 7])).toBe(false);
    expect(holds([12, 12], [12, 12])).toBe(true);
  });

  test('adjacent bookmarks touch one end of the range', () => {
    expect(holds([0, 4], [4, 7], true)).toBe(true);
    expect(holds([7, 9], [4, 7], true)).toBe(true);
    expect(holds([10, 12], [12, 12], true)).toBe(true);
    expect(holds([0, 3], [4, 7], true)).toBe(false);
  });

  test('positions compare across paragraphs', () => {
    const range = { start: at(5, 0), end: at(2, 1) };
    expect(bookmarkInRange(range, { start: at(0, 1), end: at(1, 1) }, false)).toBe(true);
    expect(bookmarkInRange(range, { start: at(3, 1), end: at(4, 1) }, false)).toBe(false);
  });
});
