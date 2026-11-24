// Grapheme boundary tests (interactive-paginated-editing 3.3).

import { describe, expect, test, afterEach } from 'bun:test';
import {
  GRAPHEME_SEGMENTER_LOCALE,
  graphemeCount,
  intlGraphemeBoundary,
  isIntlSegmenterAvailable,
  resetGraphemeBoundary,
  segmentGraphemes,
  setGraphemeBoundary,
  utf16OffsetToGrapheme,
} from '../grapheme.ts';

afterEach(() => resetGraphemeBoundary());

describe('Intl.Segmenter grapheme boundary', () => {
  test('uses invariant und locale and is available in this runtime', () => {
    expect(isIntlSegmenterAvailable()).toBe(true);
    expect(GRAPHEME_SEGMENTER_LOCALE).toBe('und');
  });

  test('replaceable boundary hook is used by segmentGraphemes', () => {
    setGraphemeBoundary({
      segment: () => [{ index: 0, text: 'X', utf16From: 0, utf16To: 1 }],
    });
    expect(graphemeCount('anything')).toBe(1);
    resetGraphemeBoundary();
    expect(graphemeCount('ab')).toBe(2);
  });

  test('default boundary segments combining marks and surrogate pairs as one grapheme', () => {
    expect(segmentGraphemes('e\u0301')).toHaveLength(1);
    expect(segmentGraphemes('😀')).toHaveLength(1);
    expect(intlGraphemeBoundary.segment('')).toEqual([]);
  });

  test('changing the boundary invalidates the utf16 index, not just the segment memo', () => {
    // Independent review proved this cache survived both boundary switches: with a
    // one-grapheme boundary warm, utf16OffsetToGrapheme('wxyz', 3) answered 0 and
    // KEPT answering 0 after resetGraphemeBoundary() instead of the correct 3 —
    // a wrong utf16<->grapheme mapping, i.e. wrong caret and selection offsets.
    setGraphemeBoundary({
      segment: (text: string) => [{ index: 0, text, utf16From: 0, utf16To: text.length }],
    });
    expect(utf16OffsetToGrapheme('wxyz', 3)).toBe(0);
    resetGraphemeBoundary();
    expect(utf16OffsetToGrapheme('wxyz', 3)).toBe(3);
  });

  test('the utf16 index maps astral text by grapheme, not by code unit', () => {
    expect(utf16OffsetToGrapheme('abcd', 3)).toBe(3);
    // A surrogate pair is two UTF-16 units but one grapheme, so offset 2 is grapheme 1.
    expect(utf16OffsetToGrapheme('\u{1F600}x', 2)).toBe(1);
  });
});
