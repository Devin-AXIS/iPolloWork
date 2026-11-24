// A line-end mark hangs past the margin only when the paragraph's line-start rules forbid it at
// a line start. Otherwise the mark may start the next line, and it does.
import { describe, expect, test } from 'bun:test';
import { loadFixture } from './punctuation-kerning-fixture.ts';

// 19 ideographs of 24 pt fill 456 pt of the 468 pt measure, so a 24 pt mark overflows.
const H = '国'.repeat(19);
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const hangs = (mark: string) => [H + mark, '国'];
const startsNextLine = (mark: string) => [H, mark + '国'];
const wrapsWithIdeograph = (mark: string) => [H.slice(1), '国' + mark + '国'];

describe('line-start rules decide hanging', () => {
  for (const jc of ['both', 'distribute']) {
    test(`${jc}: a paragraph with kinsoku off starts the next line with 。`, () => {
      const result = loadFixture({
        text: H + '。国',
        available: 468,
        language: 'ja-JP',
        paragraphProperties: `<w:jc w:val="${jc}"/><w:kinsoku w:val="0"/>`,
      });
      expect(texts(result)).toEqual(startsNextLine('。'));
    });

    for (const mark of [...'。、，．」.,']) {
      test(`${jc}: a custom Japanese list without ${mark} starts the next line with it`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'ja-JP',
          lineStartRule: { language: 'ja-JP', characters: '！' },
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual(startsNextLine(mark));
      });
    }

    test(`${jc}: a custom list keeps its own mark off the line start`, () => {
      const result = loadFixture({
        text: H + '！国',
        available: 468,
        language: 'zh-CN',
        lineStartRule: { language: 'zh-CN', characters: '！' },
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual(hangs('！'));
    });

    for (const mark of [...'・｡､']) {
      test(`${jc}: Simplified Chinese ${mark} starts the next line`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'zh-CN',
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual(startsNextLine(mark));
      });
    }

    for (const mark of [...'％°']) {
      test(`${jc}: Traditional Chinese ${mark} starts the next line`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'zh-TW',
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual(startsNextLine(mark));
      });

      test(`${jc}: Simplified Chinese ${mark} still hangs`, () => {
        const result = loadFixture({
          text: H + mark + '国',
          available: 468,
          language: 'zh-CN',
          paragraphProperties: `<w:jc w:val="${jc}"/>`,
        });
        expect(texts(result)).toEqual(hangs(mark));
      });
    }

    test(`${jc}: the Traditional Chinese half-width comma wraps with its ideograph`, () => {
      const result = loadFixture({
        text: H + '､国',
        available: 468,
        language: 'zh-TW',
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual(wrapsWithIdeograph('､'));
    });

    for (const mark of [...'.,']) {
      test(`${jc}: a paragraph with kinsoku off still hangs half-width ${mark}`, () => {
        const result = loadFixture({
          text: H + mark + '国国',
          available: 468,
          language: 'ja-JP',
          paragraphProperties: `<w:jc w:val="${jc}"/><w:kinsoku w:val="0"/>`,
        });
        expect(texts(result)[0]).toBe(H + mark);
      });
    }

    test(`${jc}: the default Japanese list still hangs 。`, () => {
      const result = loadFixture({
        text: H + '。国',
        available: 468,
        language: 'ja-JP',
        paragraphProperties: `<w:jc w:val="${jc}"/>`,
      });
      expect(texts(result)).toEqual(hangs('。'));
    });
  }
});
