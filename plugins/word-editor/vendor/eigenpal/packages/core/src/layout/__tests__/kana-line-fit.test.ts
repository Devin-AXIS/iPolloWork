// `compressPunctuationAndJapaneseKana`: kana compress to pull a line-start-prohibited character
// onto a full line. Punctuation blank sides go first, then kana by at most a sixteenth of an em
// each, in equal shares. A final closing mark gives its trailing half first only when that half
// alone fits the line, and last when kana cannot take the rest.
import { describe, expect, test } from 'bun:test';
import { loadFixture, type FixtureOptions } from './punctuation-kerning-fixture.ts';
import type { TextMeasurer } from '../semantic-records.ts';

// 24 pt text: every character is one em, so 39 characters fill a 936 pt measure.
const EM = 24;
const MEASURE = 39 * EM;
const OPENING = /^[「（]$/u;
const CLOSING = /^[、。」）]$/u;
const measurer: TextMeasurer = {
  measure: (text, style) => [...text].length * (style.fontSizePt + style.characterSpacingPt),
  lineMetrics: (style) => ({ height: style.fontSizePt * 1.2, baseline: style.fontSizePt }),
  // Closing marks ink their left half and opening marks their right half.
  inkBounds: (text, style) => {
    const em = style.fontSizePt;
    if (CLOSING.test(text)) return { left: em * 0.1, right: em * 0.4 };
    if (OPENING.test(text)) return { left: em * 0.6, right: em * 0.9 };
    return { left: em * 0.05, right: em * 0.95 };
  },
  hasResolvedFont: () => true,
};
const KANA = 'compressPunctuationAndJapaneseKana';

function lay(text: string, options: FixtureOptions = {}) {
  const result = loadFixture({
    text,
    available: MEASURE,
    language: 'ja-JP',
    compression: KANA,
    measurer,
    paragraphProperties: '<w:jc w:val="both"/>',
    ...options,
  });
  const first = result.lines[0]!;
  const widths = (character: string) =>
    first.spans.flatMap((span) =>
      [...span.text].filter((c) => c === character).map(() => span.box.width / span.text.length)
    );
  return {
    texts: result.lines.map((line) => line.spans.map((span) => span.text).join('')),
    widths,
    end: Math.max(...first.spans.map((span) => span.box.x + span.box.width)) - first.box.x,
  };
}

describe('kana compress to fit a line-start-prohibited character', () => {
  test('39 kana and 。: the kana share the overflow and 。 stays inside the margin', () => {
    const line = lay('あ'.repeat(39) + '。あいう');
    expect(line.texts[0]).toBe('あ'.repeat(39) + '。');
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 39, 6);
    expect(line.widths('。')).toEqual([EM]);
    expect(line.end).toBeCloseTo(MEASURE, 6);
  });

  for (const mark of [...'、）」゛']) {
    test(`kana fit ${mark} like 。`, () => {
      const line = lay('あ'.repeat(39) + mark + 'あいう');
      expect(line.texts[0]).toBe('あ'.repeat(39) + mark);
      for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 39, 6);
    });
  }

  test('kanji keep their advances; the final mark gives its half when kana fall short', () => {
    const line = lay('あ'.repeat(8) + '漢'.repeat(31) + '。あいう');
    expect(line.texts[0]).toBe('あ'.repeat(8) + '漢'.repeat(31) + '。');
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 16, 6);
    for (const width of line.widths('漢')) expect(width).toBeCloseTo(EM, 6);
    expect(line.widths('。')[0]).toBeCloseTo(EM / 2, 6);
  });

  test('12 kana share what the final half leaves', () => {
    const line = lay('あ'.repeat(12) + '漢'.repeat(27) + '。あいう');
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 24, 6);
    expect(line.widths('。')[0]).toBeCloseTo(EM / 2, 6);
  });

  test('too few kana fall back to hanging the mark', () => {
    const line = lay('あ'.repeat(6) + '漢'.repeat(33) + '。あいう');
    expect(line.texts[0]).toBe('あ'.repeat(6) + '漢'.repeat(33) + '。');
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM, 6);
    expect(line.end).toBeCloseTo(MEASURE + EM, 6);
  });

  test('mid-line punctuation gives its blank side before the kana', () => {
    const line = lay('あ'.repeat(19) + '、' + 'あ'.repeat(19) + '。あいう');
    expect(line.widths('、')[0]).toBeCloseTo(EM / 2, 6);
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 2 / 38, 6);
    expect(line.widths('。')).toEqual([EM]);
  });

  test('the final half alone fits a line that is half an em short', () => {
    const line = lay('あ'.repeat(39) + '。あいう', { available: MEASURE + EM / 2 });
    expect(line.texts[0]).toBe('あ'.repeat(39) + '。');
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM, 6);
    expect(line.widths('。')[0]).toBeCloseTo(EM / 2, 6);
  });

  test('without punctuation overflow the final half goes before the kana', () => {
    const line = lay('あ'.repeat(39) + '。あいう', {
      paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct w:val="0"/>',
    });
    expect(line.widths('。')[0]).toBeCloseTo(EM / 2, 6);
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 2 / 39, 6);
  });

  test('a kana that can start a line wraps without compression', () => {
    for (const text of ['あ'.repeat(40) + '。あいう', 'あ'.repeat(39) + 'ーあいう']) {
      const line = lay(text);
      expect(line.texts[0]).toBe('あ'.repeat(39));
      for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM, 6);
    }
  });

  test('a word before the prohibited character on a full line wraps without compression', () => {
    const line = lay('あ'.repeat(39) + 'a,あいう');
    expect(line.texts[0]).toBe('あ'.repeat(39));
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM, 6);
  });

  test('the prolonged sound mark does not compress', () => {
    const line = lay('ー'.repeat(39) + '。あいう');
    expect(line.texts[0]).toBe('ー'.repeat(39) + '。');
    for (const width of line.widths('ー')) expect(width).toBeCloseTo(EM, 6);
  });
});

describe('which paragraphs fit kana', () => {
  const full = 'あ'.repeat(39) + '。あいう';
  const compressed = (line: ReturnType<typeof lay>) =>
    line.widths('あ').every((width) => Math.abs(width - (EM - EM / 39)) < 1e-6);

  test('compressPunctuation hangs the mark instead', () => {
    const line = lay(full, { compression: 'compressPunctuation' });
    expect(compressed(line)).toBe(false);
    expect(line.end).toBeCloseTo(MEASURE + EM, 6);
  });

  test('mode 15 left-aligned text wraps; mode 14 left-aligned text fits', () => {
    const left = '<w:jc w:val="left"/>';
    expect(compressed(lay(full, { compatibility: 15, paragraphProperties: left }))).toBe(false);
    expect(compressed(lay(full, { compatibility: 14, paragraphProperties: left }))).toBe(true);
  });

  test('without East Asian defaults only distributed text fits', () => {
    expect(compressed(lay(full, { defaultFace: null }))).toBe(false);
    const distributed = '<w:jc w:val="distribute"/>';
    expect(compressed(lay(full, { defaultFace: null, paragraphProperties: distributed }))).toBe(
      true
    );
  });

  test('Korean text does not fit kana', () => {
    expect(compressed(lay(full, { language: 'ko-KR' }))).toBe(false);
  });
});

describe('kinsoku off: the line-start list still decides the kana fit', () => {
  const full = 'あ'.repeat(39) + '。あいう';
  const off = '<w:jc w:val="both"/><w:kinsoku w:val="0"/>';
  // 38 kana leave 8 pt of the measure, so 」 overflows by 16 pt and the kana take it.
  const roomy = { available: 38 * EM + 8, paragraphProperties: off };

  for (const compatibility of [14, 15] as const) {
    test(`mode ${compatibility}: kana fit 」 on a line with room left`, () => {
      const line = lay('あ'.repeat(38) + '」あいう', { ...roomy, compatibility });
      expect(line.texts[0]).toBe('あ'.repeat(38) + '」');
      for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - 16 / 38, 6);
      expect(line.end).toBeCloseTo(38 * EM + 8, 6);
    });
  }

  test('mode 15: a full line keeps its kana and 。 starts the next line', () => {
    const line = lay(full, { compatibility: 15, paragraphProperties: off });
    expect(line.texts.slice(0, 2)).toEqual(['あ'.repeat(39), '。あいう']);
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM, 6);
  });

  test('mode 14: a full line fits 。 whatever the switch', () => {
    const line = lay(full, { compatibility: 14, paragraphProperties: off });
    expect(line.texts[0]).toBe('あ'.repeat(39) + '。');
    for (const width of line.widths('あ')) expect(width).toBeCloseTo(EM - EM / 39, 6);
  });
});
