// A line is admitted to a narrow passage beside a float when it opens with a zero-width
// character, or when it continues a word the line before cut because it did not fit. The line
// breaker reports that cut; the text before the line cannot tell it, since a line also ends
// legally after a CJK character, a slash, or a dash.

import { describe, expect, test } from 'bun:test';
import { admittedToNarrowPassage } from '../pending-line.ts';

const pieces = (text: string) => [{ start: 0, text }];

describe('admittedToNarrowPassage', () => {
  test('a line that continues a cut word is admitted', () => {
    expect(admittedToNarrowPassage(pieces('abcdef'), 3, true)).toBe(true);
  });

  test('legal breaks after CJK, a slash, or a dash do not admit the next line', () => {
    for (const text of ['日本語文', 'and/or', 'one—two', 'one–two']) {
      expect(admittedToNarrowPassage(pieces(text), text.length - 2, false)).toBe(false);
    }
  });

  test('a zero-width opener admits the line; a combining mark does not', () => {
    expect(admittedToNarrowPassage(pieces('a​b'), 1, false)).toBe(true);
    expect(admittedToNarrowPassage(pieces('éx'), 1, false)).toBe(false);
  });
});
