// A justified line in a modern compatibility mode shrinks its inter-word spaces before a
// half-width final mark hangs past the margin. The mark stays inside the measure when the
// spaces can make room for it; it hangs only when the spaces reach their shrink floor first.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// Every character, a space too, is 24 pt. Four spaces of 24 pt can shrink by 6 pt each (to
// 75 percent), so the line lends 24 pt. `aa aa aa aa aa,` is 360 pt at its natural width.
const TEXT = 'aa aa aa aa aa, aa';
const FIRST = 'aa aa aa aa aa, ';

const load = (available: number, options: Parameters<typeof loadFixture>[0] = {}) =>
  loadFixture({
    text: TEXT,
    available,
    language: 'zh-CN',
    compatibility: 15,
    paragraphProperties: '<w:jc w:val="both"/>',
    ...options,
  });
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
/** The caret x of `offset` on the first line, from the line's left edge. */
const caretX = (result: ReturnType<typeof loadFixture>, offset: number) => {
  const line = result.lines[0]!;
  return (
    caretAt(result.layout, { paragraphId: line.range.paragraphId, offset }, measurer)!.x -
    line.box.x
  );
};

describe('a justified line shrinks its spaces before a final mark hangs', () => {
  for (const language of ['zh-CN', 'zh-TW', 'ja-JP']) {
    test(`${language}: the comma stays inside when the spaces make room for it`, () => {
      // 3 pt short: the text before the comma fits at its natural width, so the comma could
      // hang, but the spaces shrink by 0.75 pt each instead.
      const result = load(357, { language });
      expect(texts(result)).toEqual([FIRST, 'aa']);
      expect(caretX(result, 0)).toBeCloseTo(0, 6);
      expect(caretX(result, 15)).toBeCloseTo(357, 6);
    });
  }

  test('the comma hangs when the spaces reach their floor before it fits', () => {
    // 30 pt short: the spaces lend at most 24 pt, which fits the text before the comma only.
    const result = load(330);
    expect(texts(result)).toEqual([FIRST, 'aa']);
    expect(caretX(result, 14)).toBeCloseTo(330, 6);
    expect(caretX(result, 15)).toBeCloseTo(354, 6);
  });

  test('the word wraps when the shorter line would stretch less than twice the shrink', () => {
    // 45 pt short: the text before the comma fits within the floor, but the shrink the whole
    // word needs is more than half the stretch of the line without it.
    const result = load(315);
    expect(texts(result)).toEqual(['aa aa aa aa ', 'aa, aa']);
  });

  test('a full-width mark keeps hanging without shrinking the spaces', () => {
    const result = load(357, { text: 'aa aa aa aa aa，aa' });
    expect(texts(result)[0]).toBe('aa aa aa aa aa，');
    expect(caretX(result, 14)).toBeCloseTo(357, 6);
  });

  test('a legacy compatibility mode hangs the comma without shrinking the spaces', () => {
    const result = load(357, { compatibility: 14 });
    expect(texts(result)[0]).toStartWith('aa aa aa aa aa,');
    expect(caretX(result, 14)).toBeCloseTo(357, 6);
  });

  test('a distributed line keeps the comma inside when the spaces make room for it', () => {
    const result = load(357, { paragraphProperties: '<w:jc w:val="distribute"/>' });
    expect(texts(result)).toEqual([FIRST, 'aa']);
    expect(caretX(result, 15)).toBeCloseTo(357, 6);
  });

  test('a distributed line hangs the comma beside spaces at their floor', () => {
    // The text before the comma fits within the floor, and its shrink costs less than a third
    // of the stretch the line without the word would take.
    const result = load(330, { paragraphProperties: '<w:jc w:val="distribute"/>' });
    expect(texts(result)).toEqual([FIRST, 'aa']);
    expect(caretX(result, 14)).toBeCloseTo(330, 6);
    expect(caretX(result, 15)).toBeCloseTo(354, 6);
  });

  test('a left-aligned line neither hangs the comma nor shrinks its spaces', () => {
    const result = load(357, { paragraphProperties: '<w:jc w:val="left"/>' });
    expect(texts(result)).toEqual(['aa aa aa aa ', 'aa, aa']);
  });
});
