// Word segmentation tests (interactive-paginated-editing 5.3).

import { describe, expect, test } from 'bun:test';
import {
  WORD_SEGMENTER_LOCALE,
  boundedFallbackWordSegments,
  createBoundedFallbackWordBoundary,
  createDefaultWordBoundary,
  createIntlWordBoundary,
  isIntlWordSegmenterAvailable,
  resolveDefaultWordBoundary,
  segmentWords,
  wordSegmentsToGraphemeRecords,
} from '../word-segment.ts';
import { graphemeCount, segmentGraphemes } from '../grapheme.ts';

function graphemeEndpoints(
  text: string,
  records: ReturnType<typeof wordSegmentsToGraphemeRecords>
) {
  const count = graphemeCount(text);
  const boundaries = new Set<number>();
  for (let g = 0; g <= count; g += 1) boundaries.add(g);
  return records.every(
    (seg) =>
      boundaries.has(seg.graphemeFrom) &&
      boundaries.has(seg.graphemeTo) &&
      seg.graphemeFrom < seg.graphemeTo
  );
}

function recordsFor(text: string, boundary = createIntlWordBoundary()) {
  return wordSegmentsToGraphemeRecords(text, segmentWords(text, boundary));
}

describe('Intl.Segmenter word boundary (task 5.3)', () => {
  test('uses invariant und locale and is available in this runtime', () => {
    expect(isIntlWordSegmenterAvailable()).toBe(true);
    expect(WORD_SEGMENTER_LOCALE).toBe('und');
  });

  test('segmentWords accepts an explicit boundary without global mutation', () => {
    const custom = { segment: () => [{ utf16From: 0, utf16To: 2, wordLike: true }] as const };
    expect(segmentWords('anything', custom)).toEqual([
      { utf16From: 0, utf16To: 2, wordLike: true },
    ]);
    expect(segmentWords('anything', createIntlWordBoundary()).length).toBeGreaterThan(0);
  });

  test('createDefaultWordBoundary auto-falls back when Intl is unavailable', () => {
    const fallback = createDefaultWordBoundary({
      isIntlAvailable: () => false,
      createFallbackBoundary: () => createBoundedFallbackWordBoundary(),
    });
    expect(fallback.segment('a—b')).toEqual(boundedFallbackWordSegments('a—b'));
    expect(isIntlWordSegmenterAvailable()).toBe(true);
  });

  test('createDefaultWordBoundary auto-falls back when Intl construction fails', () => {
    const fallback = createDefaultWordBoundary({
      isIntlAvailable: () => true,
      createIntlBoundary: () => {
        throw new Error('Intl construction failed');
      },
      createFallbackBoundary: () => createBoundedFallbackWordBoundary(),
    });
    expect(fallback.segment('hello')).toEqual(boundedFallbackWordSegments('hello'));
  });

  test('parallel explicit boundaries do not leak global production state', () => {
    const intlA = recordsFor('hello', createIntlWordBoundary());
    const fallbackB = recordsFor('a—b', createBoundedFallbackWordBoundary());
    const intlC = recordsFor('world', createIntlWordBoundary());
    expect(intlA.some((s) => s.wordLike)).toBe(true);
    expect(fallbackB).toEqual([
      { graphemeFrom: 0, graphemeTo: 1, wordLike: true },
      { graphemeFrom: 1, graphemeTo: 2, wordLike: false },
      { graphemeFrom: 2, graphemeTo: 3, wordLike: true },
    ]);
    expect(intlC.some((s) => s.wordLike)).toBe(true);
    expect(recordsFor('hello')).toEqual(intlA);
  });

  test('resolveDefaultWordBoundary returns a stable immutable instance', () => {
    const a = resolveDefaultWordBoundary();
    const b = resolveDefaultWordBoundary();
    expect(a).toBe(b);
  });

  test('Latin words, punctuation, and whitespace map to grapheme-safe ranges', () => {
    const text = 'hello, world!';
    const records = recordsFor(text);
    expect(records.some((s) => s.wordLike && s.graphemeFrom === 0)).toBe(true);
    expect(records.some((s) => !s.wordLike && s.graphemeTo - s.graphemeFrom === 1)).toBe(true);
    expect(graphemeEndpoints(text, records)).toBe(true);
  });

  test('contractions and combining marks stay within one word segment', () => {
    expect(recordsFor("don't")).toEqual([{ graphemeFrom: 0, graphemeTo: 5, wordLike: true }]);

    const composed = 'e\u0301té';
    const combining = recordsFor(composed);
    expect(combining).toHaveLength(1);
    expect(combining[0]).toMatchObject({ graphemeFrom: 0, graphemeTo: 3, wordLike: true });
    expect(segmentGraphemes(composed)).toHaveLength(3);
  });

  test('surrogate pairs, variation selectors, and ZWJ emoji use whole grapheme endpoints', () => {
    const emoji = '😀';
    expect(recordsFor(emoji)).toEqual([{ graphemeFrom: 0, graphemeTo: 1, wordLike: false }]);

    const heart = '❤️';
    expect(segmentGraphemes(heart)).toHaveLength(1);
    expect(recordsFor(heart)).toEqual([{ graphemeFrom: 0, graphemeTo: 1, wordLike: false }]);

    const zwj = '👨‍👩‍👧';
    expect(segmentGraphemes(zwj)).toHaveLength(1);
    expect(recordsFor(zwj)).toEqual([{ graphemeFrom: 0, graphemeTo: 1, wordLike: false }]);
    expect(graphemeEndpoints(zwj, recordsFor(zwj))).toBe(true);
  });

  test('RTL Arabic and Hebrew emit word-like segments without splitting graphemes', () => {
    for (const text of ['שלום', 'مرحبا']) {
      const records = recordsFor(text);
      expect(records).toEqual([
        { graphemeFrom: 0, graphemeTo: graphemeCount(text), wordLike: true },
      ]);
      expect(graphemeEndpoints(text, records)).toBe(true);
    }
  });

  test('CJK and mixed-script paragraphs stay grapheme-aligned', () => {
    const text = 'hello日本語';
    const records = recordsFor(text);
    expect(records.length).toBeGreaterThan(1);
    expect(graphemeEndpoints(text, records)).toBe(true);
  });

  test('bounded fallback is deterministic, grapheme-safe, and narrower than Intl', () => {
    const text = 'a—b';
    const intl = recordsFor(text, createIntlWordBoundary());
    const fallback = recordsFor(text, createBoundedFallbackWordBoundary());
    expect(fallback).toEqual([
      { graphemeFrom: 0, graphemeTo: 1, wordLike: true },
      { graphemeFrom: 1, graphemeTo: 2, wordLike: false },
      { graphemeFrom: 2, graphemeTo: 3, wordLike: true },
    ]);
    expect(intl.some((s) => s.wordLike && s.graphemeTo - s.graphemeFrom === 1)).toBe(true);
    expect(graphemeEndpoints(text, fallback)).toBe(true);
    expect(boundedFallbackWordSegments(text)).toEqual(boundedFallbackWordSegments(text));
  });
});
