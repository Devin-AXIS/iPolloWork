import { describe, expect, test } from 'bun:test';
import { expandLvlText, formatNumFmt } from '../numbering-format.ts';

// Expected strings are the reference renderer's own list strings for these values.
const RLM = '‏';
const ZWNJ = '‌';

describe('Hebrew, Arabic and Devanagari numbering formats', () => {
  test('`hebrew1` writes Hebrew numerals, with 15 and 16 as טו and טז', () => {
    const cases: [number, string][] = [
      [1, 'א'],
      [10, 'י'],
      [11, 'יא'],
      [15, 'טו'],
      [16, 'טז'],
      [17, 'יז'],
      [40, 'מ'],
      [99, 'צט'],
      [101, 'קא'],
      [115, 'קטו'],
      [116, 'קטז'],
      [272, 'רעב'],
      [301, 'שא'],
    ];
    for (const [value, text] of cases) expect(formatNumFmt('hebrew1', value)).toBe(text);
  });

  test('`hebrew2` repeats the last letter past the alphabet', () => {
    expect(formatNumFmt('hebrew2', 1)).toBe(`${RLM}א`);
    expect(formatNumFmt('hebrew2', 22)).toBe(`${RLM}ת`);
    expect(formatNumFmt('hebrew2', 23)).toBe(`${RLM}תא`);
    expect(formatNumFmt('hebrew2', 32)).toBe(`${RLM}תי`);
    expect(formatNumFmt('hebrew2', 98)).toBe(`${RLM}תתתתי`);
  });

  test('`arabicAlpha` and `arabicAbjad` repeat the letter each pass', () => {
    expect(formatNumFmt('arabicAlpha', 1)).toBe(`أ${ZWNJ}`);
    expect(formatNumFmt('arabicAlpha', 28)).toBe(`ي${ZWNJ}`);
    expect(formatNumFmt('arabicAlpha', 29)).toBe(`أ${ZWNJ}أ${ZWNJ}`);
    expect(formatNumFmt('arabicAbjad', 3)).toBe(`${ZWNJ}ج`);
    expect(formatNumFmt('arabicAbjad', 28)).toBe(`${ZWNJ}غ`);
    expect(formatNumFmt('arabicAbjad', 30)).toBe(`${ZWNJ}ب${ZWNJ}ب`);
  });

  test('the letter sequences restart after 392', () => {
    expect(formatNumFmt('hebrew1', 398)).toBe('ו');
    expect(formatNumFmt('hebrew1', 998)).toBe('ריד');
    expect(formatNumFmt('hebrew2', 498)).toBe(`${RLM}תתתתצ`);
    expect(formatNumFmt('arabicAlpha', 398)).toBe(`ح${ZWNJ}`);
    expect(formatNumFmt('arabicAbjad', 398)).toBe(`${ZWNJ}و`);
  });

  test('`hindiNumbers` writes the decimal value in Devanagari digits', () => {
    expect(formatNumFmt('hindiNumbers', 7)).toBe('७');
    expect(formatNumFmt('hindiNumbers', 1001)).toBe('१००१');
  });

  test('a hostile counter stays within the marker cap', () => {
    expect(expandLvlText('%1%1%1%1%1%1', [298], ['arabicAlpha']).length).toBeLessThanOrEqual(64);
  });
});
