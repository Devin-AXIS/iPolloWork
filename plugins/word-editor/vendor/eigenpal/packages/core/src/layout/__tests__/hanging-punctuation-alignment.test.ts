// Which paragraphs hang line-end punctuation past the margin. Modern compatibility modes hang
// in justified and distributed paragraphs; legacy modes hang at every alignment. Document
// defaults that name no East Asian face leave only distributed paragraphs hanging.
import { describe, expect, test } from 'bun:test';
import { loadFixture, measurer } from './punctuation-kerning-fixture.ts';
import { caretAt } from '../semantic-interaction.ts';

// 19 ideographs of 24 pt fill 456 pt of the 468 pt measure, so a 24 pt mark overflows.
const H = '国'.repeat(19);
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

describe('legacy compatibility modes hang at every alignment', () => {
  for (const jc of ['left', 'center', 'right']) {
    for (const mark of [...'。、）']) {
      test(`mode 14 ${jc}: ${mark} hangs and the text before it fills the measure`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'ja-JP',
          compatibility: 14,
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual([H + mark, '国']);
        expect(caretX(result, 0)).toBeCloseTo(0, 6);
        expect(caretX(result, 19)).toBeCloseTo(468, 6);
      });
    }

    test(`mode 15 ${jc}: 。 wraps with the ideograph before it`, () => {
      const result = loadFixture({
        text: H + '。国',
        available: 468,
        language: 'ja-JP',
        compatibility: 15,
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual([H.slice(1), '国。国']);
    });

    test(`mode 14 ${jc}: a mark that never hangs still wraps`, () => {
      const result = loadFixture({
        text: H + '！国',
        available: 468,
        language: 'ja-JP',
        compatibility: 14,
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual([H.slice(1), '国！国']);
    });
  }

  test('mode 14: 。 hangs although the paragraph turns kinsoku off', () => {
    const result = loadFixture({
      text: H + '。国',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      paragraphProperties: '<w:jc w:val="left"/><w:kinsoku w:val="0"/>',
    });
    expect(texts(result)).toEqual([H + '。', '国']);
  });

  test('mode 14: a custom list without 。 starts the next line with it', () => {
    const result = loadFixture({
      text: H + '。国',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      lineStartRule: { language: 'ja-JP', characters: '！' },
      paragraphProperties: '<w:jc w:val="left"/>',
    });
    expect(texts(result)).toEqual([H, '。国']);
  });

  test('mode 14 left: no hang without East Asian document defaults', () => {
    const result = loadFixture({
      text: H + '。国',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      defaultFace: null,
      paragraphProperties: '<w:jc w:val="left"/>',
    });
    expect(texts(result)).toEqual([H.slice(1), '国。国']);
  });
});

describe('Korean paragraph-final marks in legacy modes', () => {
  const K = '가'.repeat(19);
  for (const compression of ['compressPunctuation', 'compressPunctuationAndJapaneseKana']) {
    for (const jc of ['left', 'both']) {
      test(`${compression}, ${jc}: a final ! starts the next line by itself`, () => {
        const result = loadFixture({
          text: K + '!',
          available: 468,
          language: 'ko-KR',
          compatibility: 14,
          compression,
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual([K, '!']);
      });
    }
  }

  test('without compression a final ! hangs', () => {
    const result = loadFixture({
      text: K + '!',
      available: 468,
      language: 'ko-KR',
      compatibility: 14,
      paragraphProperties: '<w:jc w:val="left"/>',
    });
    expect(texts(result)).toEqual([K + '!']);
  });
});

describe('distributed paragraphs hang without East Asian document defaults', () => {
  for (const compatibility of [14, 15] as const) {
    for (const mark of [...'。、）']) {
      test(`mode ${compatibility}: a distributed paragraph hangs ${mark}`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'ja-JP',
          compatibility,
          defaultFace: null,
          paragraphProperties: '<w:jc w:val="distribute"/>',
        });
        expect(texts(result)).toEqual([H + mark, '国']);
        expect(caretX(result, 19)).toBeCloseTo(468, 6);
      });
    }

    test(`mode ${compatibility}: the spacing voiced mark wraps with its ideograph`, () => {
      const result = loadFixture({
        text: H + '゛国',
        available: 468,
        language: 'ja-JP',
        compatibility,
        defaultFace: null,
        paragraphProperties: '<w:jc w:val="distribute"/>',
      });
      expect(texts(result)[0]).toBe(H.slice(1));
    });

    test(`mode ${compatibility}: a justified paragraph does not hang`, () => {
      const result = loadFixture({
        text: H + '。国',
        available: 468,
        language: 'ja-JP',
        compatibility,
        defaultFace: null,
        paragraphProperties: '<w:jc w:val="both"/>',
      });
      expect(texts(result)).toEqual([H.slice(1), '国。国']);
    });
  }
});
