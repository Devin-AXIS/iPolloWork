import { describe, expect, test } from 'bun:test';
import { loadFixture } from './punctuation-kerning-fixture.ts';

// 24pt Yu Mincho with kerning in a 468pt column: a full-width character advances 24pt,
// and a shared punctuation bearing removes 12pt.
const H = (count: number) => '国'.repeat(count);
const LEFT = '<w:jc w:val="left"/>';
const JUSTIFIED = '<w:jc w:val="both"/>';

function lay(text: string, paragraphProperties = LEFT) {
  const { lines } = loadFixture({
    text,
    kern: 2,
    available: 468,
    language: 'ja-JP',
    paragraphProperties,
  });
  return lines.map((line) => {
    const chars: { char: string; x: number; width: number }[] = [];
    for (const span of line.spans) {
      const count = [...span.text].length;
      [...span.text].forEach((char, index) =>
        chars.push({
          char,
          x: span.box.x + (index * span.box.width) / count,
          width: span.box.width / count,
        })
      );
    }
    const last = line.spans.at(-1)!;
    return { text: chars.map((c) => c.char).join(''), chars, end: last.box.x + last.box.width };
  });
}
const texts = (lines: ReturnType<typeof lay>) => lines.map((line) => line.text);
const ends = (lines: ReturnType<typeof lay>) => lines.map((line) => line.end);

describe('punctuation pairs compress only within a line', () => {
  test.each([
    [15, [H(15) + '」「」「国', '国国'], [456, 48]],
    [16, [H(16) + '」「」', '「国国国'], [444, 96]],
    [17, [H(17) + '」「」', '「国国国'], [468, 96]],
    [18, [H(18) + '」', '「」「国国国'], [456, 132]],
    [19, [H(18), '国」「」「国国国'], [432, 168]],
  ])('%d ideographs before 」「」「国国国', (count, expected, widths) => {
    const lines = lay(H(count) + '」「」「国国国');
    expect(texts(lines)).toEqual(expected);
    expect(ends(lines)).toEqual(widths);
  });

  test('a closing bracket at the line end keeps its full advance', () => {
    const [first, second] = lay(H(18) + '」「」「国国国');
    expect(first!.chars.at(-1)).toEqual({ char: '」', x: 432, width: 24 });
    // The pair on the next line still shares one bearing.
    expect(second!.chars.slice(0, 3).map((c) => c.x)).toEqual([0, 24, 36]);
  });

  test.each([
    [H(18) + '。」「国', [H(18) + '。」', '「国'], [468, 48]],
    [H(17) + '」「国国', [H(17) + '」「国', '国'], [468, 24]],
    [H(18) + '」）国', [H(18) + '」）', '国'], [468, 24]],
    [H(19) + '。」国', [H(18), '国。」国'], [432, 84]],
  ])('%s', (text, expected, widths) => {
    const lines = lay(text);
    expect(texts(lines)).toEqual(expected);
    expect(ends(lines)).toEqual(widths);
  });

  test('a pair that a colon retry moves off the line end still compresses', () => {
    const lines = lay(H(13) + '：「'.repeat(4) + H(17) + '）（国');
    const last = lines.at(-1)!;
    expect(last.text).toBe('国）（国');
    expect(last.chars.map((c) => c.x)).toEqual([0, 24, 36, 60]);
  });

  test('right alignment places a line-final closing bracket at its full advance', () => {
    const [first] = lay(H(18) + '」「」「国国国', '<w:jc w:val="right"/>');
    expect(first!.text).toBe(H(18) + '」');
    expect(first!.chars[0]!.x).toBe(12);
    expect(first!.chars.at(-1)).toEqual({ char: '」', x: 444, width: 24 });
  });
});

describe('punctuation hangs past the margin only on justified lines', () => {
  test.each(['。', '、', '，', '．', '」', '）', '』', '！', '？', '：'])(
    'left-aligned %s moves with the previous character',
    (mark) => {
      expect(texts(lay(H(19) + mark + '国'))).toEqual([H(18), '国' + mark + '国']);
      expect(texts(lay(H(19) + mark + '国', '<w:overflowPunct/>'))).toEqual([
        H(18),
        '国' + mark + '国',
      ]);
    }
  );

  test.each(['center', 'right'])('%s alignment does not hang punctuation', (jc) => {
    expect(texts(lay(H(19) + '。国', `<w:jc w:val="${jc}"/>`))).toEqual([H(18), '国。国']);
  });

  test.each(['。', '、', '，', '．', '」', '）', '』', '】', '］', '｝'])(
    'justified %s hangs',
    (mark) => {
      const lines = lay(H(19) + mark + '国', JUSTIFIED);
      expect(texts(lines)).toEqual([H(19) + mark, '国']);
      expect(lines[0]!.chars.at(-1)!.x).toBeGreaterThanOrEqual(456);
    }
  );

  test('a justified line hangs its last closing bracket and keeps the inner pair', () => {
    const lines = lay(H(18) + '」「」「国国国', JUSTIFIED);
    expect(texts(lines)).toEqual([H(18) + '」「」', '「国国国']);
    expect(lines[0]!.chars.slice(-3).map((c) => c.x)).toEqual([432, 444, 468]);
    expect(texts(lay(H(19) + '」「」「国国国', JUSTIFIED))).toEqual([H(19) + '」', '「」「国国国']);
  });

  test('a justified paragraph without overflow punctuation does not hang', () => {
    const off = JUSTIFIED + '<w:overflowPunct w:val="0"/>';
    expect(texts(lay(H(19) + '。国', off))).toEqual([H(18), '国。国']);
    expect(texts(lay(H(19) + '」「」「国国国', off))).toEqual([H(18), '国」「」「国国国']);
  });
});
