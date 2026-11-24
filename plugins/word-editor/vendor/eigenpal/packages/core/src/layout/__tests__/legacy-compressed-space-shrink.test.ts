// In a legacy compatibility mode that compresses punctuation, in a document whose defaults name
// an East Asian face, a line at any alignment shrinks its inter-word spaces down to half the
// average character width of their face to keep one more word, with no other test. A face with
// no known average width gives up a fifth of each space. A final half-width mark stays inside
// when the spaces make room for it, and hangs beside spaces at that limit.
// With `w:balanceSingleByteDoubleByteWidth`, each space shrinks down to a quarter of its font size.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { caretAt } from '../semantic-interaction.ts';

// Every character, a space too, is 24 pt, in a face with no known average width. Six words and
// their spaces take 432 pt; at a fifth of 24 pt, the six spaces lend 28.8 pt, so the seventh
// word (48 pt) joins from 451.2 pt.
const WORDS = 'aa aa aa aa aa aa aa aa';
const SEVEN = 'aa aa aa aa aa aa aa ';
const SIX = 'aa aa aa aa aa aa ';
const load = (text: string, available: number, options: FixtureOptions = {}) =>
  loadFixture({
    text,
    available,
    language: 'zh-CN',
    compatibility: 14,
    compression: 'compressPunctuation',
    paragraphProperties: '<w:jc w:val="left"/>',
    ...options,
  });
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const caretX = (result: ReturnType<typeof loadFixture>, offset: number) => {
  const line = result.lines[0]!;
  return (
    caretAt(result.layout, { paragraphId: line.range.paragraphId, offset }, measurer)!.x -
    line.box.x
  );
};

describe('a legacy mode that compresses punctuation shrinks spaces', () => {
  for (const jc of ['left', 'both', 'distribute']) {
    test(`a ${jc} line keeps the word and fills the measure`, () => {
      const result = load(WORDS, 452, { paragraphProperties: `<w:jc w:val="${jc}"/>` });
      expect(texts(result)[0]).toBe(SEVEN);
      // The seventh word ends at the margin: each space gave up 4 pt.
      expect(caretX(result, 20)).toBeCloseTo(452, 6);
    });
  }

  test('kana compression shrinks the spaces too', () => {
    const result = load(WORDS, 452, { compression: 'compressPunctuationAndJapaneseKana' });
    expect(texts(result)[0]).toBe(SEVEN);
  });

  test('the word wraps when the spaces would give up more than their limit', () => {
    expect(texts(load(WORDS, 450))[0]).toBe(SIX);
  });

  test('without punctuation compression the spaces keep their advance', () => {
    expect(texts(load(WORDS, 452, { compression: 'doNotCompress' }))[0]).toBe(SIX);
  });

  test('without an East Asian face in the document defaults the spaces keep their advance', () => {
    expect(texts(load(WORDS, 452, { defaultFace: null }))[0]).toBe(SIX);
  });

  test('a modern mode keeps natural spaces on a left-aligned line', () => {
    expect(texts(load(WORDS, 452, { compatibility: 15 }))[0]).toBe(SIX);
  });
});

describe('a final half-width mark beside shrinking spaces', () => {
  const COMMA = 'aa aa aa aa aa aa aa, aa';

  test('the mark stays inside when the spaces make room for it', () => {
    // `aa,` needs 28 pt of the 28.8 pt the spaces lend.
    const result = load(COMMA, 476);
    expect(texts(result)).toEqual(['aa aa aa aa aa aa aa, ', 'aa']);
    expect(caretX(result, 21)).toBeCloseTo(476, 6);
  });

  test('the mark hangs when only the text before it fits', () => {
    const result = load(COMMA, 460);
    expect(texts(result)).toEqual(['aa aa aa aa aa aa aa, ', 'aa']);
    expect(caretX(result, 20)).toBeCloseTo(460, 6);
    expect(caretX(result, 21)).toBeCloseTo(484, 6);
  });

  test('the word wraps when even the text before the mark needs more than the limit', () => {
    expect(texts(load(COMMA, 450))[0]).toBe(SIX);
  });
});

// Letters are one em wide; a space takes its face's real share of the em. The floor is half the
// face's recorded average character width: Times New Roman 821, Century 951, Calibri 1067, and
// Courier New 1229 of a 2048-unit em.
const SPACE_EM: Record<string, number> = {
  'Times New Roman': 0.25,
  Century: 0.278,
  Calibri: 0.2263,
  'Courier New': 0.6,
};
const faceMeasurer: TextMeasurer = {
  measure: (text, style) =>
    [...text].reduce(
      (sum, c) =>
        sum +
        (c === ' '
          ? style.fontSizePt * (SPACE_EM[style.fontFamily ?? ''] ?? 0.25) +
            (style.shaping?.wordSpacingPt ?? 0)
          : style.fontSizePt),
      0
    ),
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt }),
};
const inFace = (face: string, available: number, options: FixtureOptions = {}) =>
  loadFixture({
    text: WORDS,
    available,
    language: 'zh-CN',
    compatibility: 14,
    compression: 'compressPunctuation',
    paragraphProperties: '<w:jc w:val="left"/>',
    face,
    measurer: faceMeasurer,
    ...options,
  });
const lineEnd = (result: ReturnType<typeof loadFixture>) => {
  const line = result.lines[0]!;
  const last = line.spans.at(-1)!;
  return last.box.x + last.box.width - line.box.x;
};

describe('a space shrinks down to half its face average character width', () => {
  // Six words and their spaces, then a seventh word of 48 pt.
  const natural = (face: string) => 7 * 48 + 6 * 24 * SPACE_EM[face]!;
  const floor = (average: number) => (24 * average) / 2048 / 2;

  test('Times New Roman: about a fifth of each space', () => {
    // 6 pt spaces, 4.81 pt floor: the six spaces lend 7.14 pt.
    const lend = 6 * (6 - floor(821));
    expect(texts(inFace('Times New Roman', natural('Times New Roman') - lend + 0.5))[0]).toBe(
      SEVEN
    );
    expect(texts(inFace('Times New Roman', natural('Times New Roman') - lend - 0.5))[0]).toBe(SIX);
  });

  test('Century: less than a fifth', () => {
    // 6.67 pt spaces, 5.57 pt floor: each space lends 1.10 pt, about 16 percent.
    const lend = 6 * (24 * 0.278 - floor(951));
    expect(lend / (6 * 24 * 0.278)).toBeLessThan(0.17);
    expect(texts(inFace('Century', natural('Century') - lend + 0.5))[0]).toBe(SEVEN);
    expect(texts(inFace('Century', natural('Century') - lend - 0.5))[0]).toBe(SIX);
  });

  test('Calibri: the floor is wider than the space, so spaces keep their advance', () => {
    expect(floor(1067)).toBeGreaterThan(24 * 0.2263);
    expect(texts(inFace('Calibri', natural('Calibri') - 0.5))[0]).toBe(SIX);
  });

  test('Courier New: half of each space, and the line still fills the measure', () => {
    // 14.4 pt spaces, 7.2 pt floor: a word that needs 40 percent of the spaces joins.
    const available = natural('Courier New') - 0.4 * 6 * 14.4;
    const result = inFace('Courier New', available);
    expect(texts(result)[0]).toBe(SEVEN);
    expect(lineEnd(result)).toBeCloseTo(available, 4);
    expect(texts(inFace('Courier New', natural('Courier New') - 6 * 7.2 - 0.5))[0]).toBe(SIX);
  });
});

// With `w:balanceSingleByteDoubleByteWidth`, the floor is a quarter of the font size, 6 pt here,
// whatever the face's average width.
describe('balanced single-byte and double-byte widths: a space shrinks down to a quarter em', () => {
  const natural = (face: string) => 7 * 48 + 6 * 24 * SPACE_EM[face]!;
  const balanced = (face: string, available: number, jc = 'left') =>
    texts(
      inFace(face, available, {
        balanceWidths: true,
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      })
    )[0];

  for (const jc of ['left', 'both']) {
    test(`Courier New, ${jc}: each space lends all but 6 pt, more than half`, () => {
      // 14.4 pt spaces lend 8.4 pt each, 50.4 pt in all; half the average width would lend 43.2.
      expect(balanced('Courier New', natural('Courier New') - 50.4 + 0.5, jc)).toBe(SEVEN);
      expect(balanced('Courier New', natural('Courier New') - 50.4 - 0.5, jc)).toBe(SIX);
    });
  }

  test('spaces beside Hangul lend as other spaces do', () => {
    // The Courier New line above, in Hangul words of the same advance.
    const korean = (available: number) =>
      texts(
        inFace('Courier New', available, {
          text: WORDS.replaceAll('aa', '가가'),
          language: 'ko-KR',
          balanceWidths: true,
        })
      )[0];
    expect(korean(natural('Courier New') - 50.4 + 0.5)).toBe(SEVEN.replaceAll('aa', '가가'));
    expect(korean(natural('Courier New') - 50.4 - 0.5)).toBe(SIX.replaceAll('aa', '가가'));
  });

  test('Century: each space lends less than half the average width would', () => {
    // 6.67 pt spaces lend 0.67 pt each, 4.03 pt in all; half the average width would lend 6.6.
    expect(balanced('Century', natural('Century') - 4.03 + 0.4)).toBe(SEVEN);
    expect(balanced('Century', natural('Century') - 5)).toBe(SIX);
    expect(texts(inFace('Century', natural('Century') - 5))[0]).toBe(SEVEN);
  });

  test('with w:useWord97LineBreakRules as well, a proportional face keeps its spaces', () => {
    const result = inFace('Century', natural('Century') - 4.03 + 0.4, {
      balanceWidths: true,
      word97LineBreaks: true,
    });
    expect(texts(result)[0]).toBe(SIX);
  });

  test('a line that opens with spaces keeps natural spaces', () => {
    // The same Century line that joins its seventh word, behind three spaces of 6.67 pt.
    const lead = 3 * 24 * SPACE_EM['Century']!;
    const opened = (options: FixtureOptions) =>
      texts(
        inFace('Century', natural('Century') + lead - 4.03 + 0.4, {
          text: `   ${WORDS}`,
          ...options,
        })
      )[0];
    expect(opened({ balanceWidths: true })).toBe(`   ${SIX}`);
    // Half the average width, without balanced widths, still shrinks such a line.
    expect(opened({})).toBe(`   ${SEVEN}`);
  });

  test('a Courier New line that opens with spaces still shrinks: its space is over half an em', () => {
    const lead = 3 * 24 * SPACE_EM['Courier New']!;
    const line = texts(
      inFace('Courier New', natural('Courier New') + lead - 50.4 + 0.5, {
        text: `   ${WORDS}`,
        balanceWidths: true,
      })
    )[0];
    expect(line).toBe(`   ${SEVEN}`);
  });

  test('a line that opens with spaces does not hang its final mark', () => {
    // The period overflows by half its advance; the spaces cannot make that room, so it hangs.
    const lead = 3 * 24 * SPACE_EM['Century']!;
    const text = 'aa aa aa aa aa aa aa. aa';
    const available = 7 * 48 + 24 + 6 * 24 * SPACE_EM['Century']! - 12;
    const line = (prefix: string) =>
      texts(
        inFace('Century', available + (prefix ? lead : 0), {
          text: prefix + text,
          balanceWidths: true,
        })
      )[0];
    expect(line('')).toBe('aa aa aa aa aa aa aa. ');
    expect(line('   ')).toBe(`   ${SIX}`);
  });

  test('Times New Roman: a space of a quarter em keeps its advance', () => {
    expect(balanced('Times New Roman', natural('Times New Roman') - 0.1)).toBe(SIX);
  });

  test('without punctuation compression the spaces keep their advance', () => {
    const result = inFace('Courier New', natural('Courier New') - 20, {
      balanceWidths: true,
      compression: 'doNotCompress',
    });
    expect(texts(result)[0]).toBe(SIX);
  });
});

// Courier New letters are 24 pt, spaces 14.4 pt, and each space lends 7.2 pt. Ten words and their
// spaces take 384 pt; the tenth word ends at 369.6 pt.
describe('one word per line joins by shrinking spaces', () => {
  const LETTERS = 'a a a a a a a a a a a a';
  const courier = (available: number) =>
    loadFixture({
      text: LETTERS,
      available,
      language: 'zh-CN',
      compatibility: 14,
      compression: 'compressPunctuation',
      paragraphProperties: '<w:jc w:val="left"/>',
      face: 'Courier New',
      measurer: faceMeasurer,
    });
  const gaps = (result: ReturnType<typeof loadFixture>, words: number) =>
    Array.from(
      { length: words - 1 },
      (_, i) => caretX(result, 2 * i + 2) - caretX(result, 2 * i + 1)
    );

  test('a space cut at the margin takes its advance back and shrinks with the others', () => {
    // The tenth space ends past 375 pt. The eleventh word joins, and all ten spaces lend 3.3 pt.
    const result = courier(375);
    expect(texts(result)[0]).toBe('a '.repeat(11));
    for (const gap of gaps(result, 11)) expect(gap).toBeCloseTo(11.1, 4);
    expect(caretX(result, 21)).toBeCloseTo(375, 4);
  });

  test('after a word joins, the next word opens a line even when the spaces could still lend', () => {
    // The tenth word joins with 9.6 pt from its nine spaces. The eleventh would need 48 pt of
    // the 72 pt that ten spaces lend, but it wraps.
    const result = courier(360);
    expect(texts(result)[0]).toBe('a '.repeat(10));
  });
});
