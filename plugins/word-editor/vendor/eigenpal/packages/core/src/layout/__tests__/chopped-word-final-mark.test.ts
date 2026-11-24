// A word wider than its line is cut at the last character that fits. When that cut would leave
// only the word's final mark, and the paragraph lets the mark hang, the mark stays on the line
// and hangs past the margin instead of opening a line alone. A mark inside the word still
// opens the next line.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// Every character is 24 pt, and 14 fit a 340 pt line. The word has no break opportunity: the
// first cut leaves 14 characters and the period for the second line.
const WORD = 'aa,'.repeat(10).slice(0, 28) + '.';
const load = (options: FixtureOptions = {}) =>
  loadFixture({
    text: WORD,
    available: 340,
    language: 'zh-CN',
    compatibility: 15,
    paragraphProperties: '<w:jc w:val="both"/>',
    ...options,
  });
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const caretX = (result: ReturnType<typeof loadFixture>, line: number, offset: number) =>
  caretAt(result.layout, { paragraphId: result.lines[line]!.range.paragraphId, offset }, measurer)!
    .x - result.lines[line]!.box.x;

describe('a chopped word keeps its final mark on the line', () => {
  test('the final period hangs past the margin', () => {
    const result = load();
    expect(texts(result)).toEqual([WORD.slice(0, 14), WORD.slice(14)]);
    // The period keeps its advance past the 340 pt margin.
    expect(caretX(result, 1, 28)).toBeLessThanOrEqual(340 + 1e-6);
    expect(caretX(result, 1, 29) - caretX(result, 1, 28)).toBeCloseTo(24, 6);
    expect(caretX(result, 1, 29)).toBeGreaterThan(340);
  });

  test('a comma inside the word still opens the next line', () => {
    expect(texts(load())[1]!.startsWith(',')).toBe(true);
  });

  test('a legacy mode hangs the period on a left-aligned line', () => {
    const result = load({ compatibility: 14, paragraphProperties: '<w:jc w:val="left"/>' });
    expect(texts(result)).toEqual([WORD.slice(0, 14), WORD.slice(14)]);
  });

  test('an English run in a Chinese document breaks as English text', () => {
    const result = load({ language: 'en-US', defaultLanguage: 'zh-CN' });
    expect(texts(result)).toEqual([WORD.slice(0, 14), WORD.slice(14, 28), '.']);
  });

  test('the period opens a line where it may not hang', () => {
    expect(texts(load({ language: 'en-US' }))).toEqual([
      WORD.slice(0, 14),
      WORD.slice(14, 28),
      '.',
    ]);
    expect(
      texts(load({ paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct w:val="0"/>' }))
    ).toEqual([WORD.slice(0, 14), WORD.slice(14, 28), '.']);
  });
});
