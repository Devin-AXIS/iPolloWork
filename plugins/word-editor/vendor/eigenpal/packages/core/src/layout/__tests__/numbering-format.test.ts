import { describe, expect, test } from 'bun:test';
import {
  MAX_MARKER_TEXT_LENGTH,
  expandLvlText,
  formatDecimal,
  formatDecimalZero,
  formatLowerLetter,
  formatLowerRoman,
  formatNumFmt,
  formatUpperLetter,
  formatUpperRoman,
} from '../numbering-format.ts';

describe('numbering formatters', () => {
  test('decimal and decimalZero', () => {
    expect(formatDecimal(0)).toBe('0');
    expect(formatDecimal(1)).toBe('1');
    expect(formatDecimalZero(0)).toBe('00');
    expect(formatDecimalZero(1)).toBe('01');
    expect(formatDecimalZero(12)).toBe('12');
  });

  test('roman numerals', () => {
    expect(formatUpperRoman(1)).toBe('I');
    expect(formatUpperRoman(4)).toBe('IV');
    expect(formatUpperRoman(9)).toBe('IX');
    expect(formatLowerRoman(14)).toBe('xiv');
  });

  test('letters', () => {
    expect(formatUpperLetter(1)).toBe('A');
    expect(formatLowerLetter(2)).toBe('b');
    expect(formatUpperLetter(27)).toBe('AA');
  });

  test('per-script sequences we carry no glyphs for fall back to decimal', () => {
    // Same ordinal, different script — a legible number beats a missing marker.
    expect(formatNumFmt('japaneseCounting', 3)).toBe('3');
    expect(formatNumFmt('thaiNumbers', 3)).toBe('3');
    expect(formatNumFmt('not-a-format', 3)).toBe('3');
  });

  test('hostile counters clamp', () => {
    expect(formatDecimal(-5)).toBe('1');
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe('1');
    expect(formatUpperRoman(50_000).length).toBeLessThanOrEqual(MAX_MARKER_TEXT_LENGTH);
    expect(formatDecimal(5_000_000)).toBe('999999');
  });

  test('a list that counts past 9999 shows the whole number', () => {
    expect(formatDecimal(10_000)).toBe('10000');
    expect(formatNumFmt('decimalZero', 10_001)).toBe('10001');
    expect(formatNumFmt('ordinal', 10_001)).toBe('10001st');
    expect(formatNumFmt('hex', 10_000)).toBe('2710');
    expect(formatNumFmt('cardinalText', 10_000)).toBe('Ten thousand');
    expect(formatNumFmt('cardinalText', 10_001)).toBe('Ten thousand one');
    expect(formatNumFmt('ordinalText', 21_000)).toBe('Twenty-one thousandth');
  });
});

describe('lvlText expansion', () => {
  test('expands %1..%9 with per-level formats', () => {
    expect(expandLvlText('%1.%2)', [1, 2, 1], ['decimal', 'lowerLetter', 'lowerRoman'])).toBe(
      '1.b)'
    );
    expect(expandLvlText('%1.', [3], ['upperRoman'])).toBe('III.');
  });

  test('literal bullet text without placeholders is unchanged by expand', () => {
    expect(expandLvlText('•', [1], ['bullet'])).toBe('•');
  });

  test('caps oversized lvlText and output', () => {
    const huge = '%1'.repeat(100);
    const out = expandLvlText(huge, [1], ['decimal']);
    expect(out.length).toBeLessThanOrEqual(MAX_MARKER_TEXT_LENGTH);
  });
});
