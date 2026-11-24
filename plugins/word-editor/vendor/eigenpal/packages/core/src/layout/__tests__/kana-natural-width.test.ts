import { expect, test } from 'bun:test';
import { loadFixture } from './punctuation-kerning-fixture.ts';

const K = 'アイ'.repeat(20);
const textOf = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
const modes = ['doNotCompress', 'compressPunctuation', 'compressPunctuationAndJapaneseKana'];

for (const compression of modes) {
  for (const count of [8, 19, 20, 40]) {
    test(`${compression}: ${count} kana keep natural cells before wrapping`, () => {
      const result = loadFixture({
        text: K.slice(0, count),
        available: 468,
        language: 'ja-JP',
        compression,
      });
      expect(textOf(result)).toEqual(
        count <= 19
          ? [K.slice(0, count)]
          : count === 20
            ? [K.slice(0, 19), K.slice(19, 20)]
            : [K.slice(0, 19), K.slice(19, 38), K.slice(38, 40)]
      );
      for (const line of result.lines)
        for (const span of line.spans) expect(span.style.characterSpacingPt).toBe(0);
    });
  }
}
for (const options of [
  { split: 9, bold: true },
  { split: 10, secondFace: 'Arial' },
  { tracking: 20 },
  { text: 'カ\u3099'.repeat(20) },
]) {
  test(`kana preserve authored run geometry: ${JSON.stringify(options)}`, () => {
    const base = { text: K.slice(0, 20), available: 468, language: 'ja-JP', ...options };
    const plain = loadFixture({ ...base, compression: 'doNotCompress' });
    const enabled = loadFixture({ ...base, compression: 'compressPunctuationAndJapaneseKana' });
    expect(textOf(enabled)).toEqual(textOf(plain));
    expect(
      enabled.lines.map((line) =>
        line.spans.map((span) => [
          span.text,
          span.box.x,
          span.box.width,
          span.style.characterSpacingPt,
        ])
      )
    ).toEqual(
      plain.lines.map((line) =>
        line.spans.map((span) => [
          span.text,
          span.box.x,
          span.box.width,
          span.style.characterSpacingPt,
        ])
      )
    );
  });
}
