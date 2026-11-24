// Pair kerning leaves full-width East Asian text alone. A run with `w:kern` keeps every kana at
// its own advance, while its Latin letters still kern. The fixture face kerns katakana pairs.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapingEnvironment,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { kernsText, unkernedTextRanges } from '../run-kerning.ts';
import { DEFAULT_RUN_STYLE } from '../run-style.ts';

await initializeHarfBuzz();

const bytes = new Uint8Array(
  readFileSync(new URL('./fixtures/fonts/NotoSansCJKjp-kana.subset.otf', import.meta.url))
);
const request = { family: 'Noto Sans CJK JP', weight: 400, style: 'normal' } as const;
const resolved = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [{ request, id: 'noto-cjk', bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
  validateFont: harfBuzzFontValidator,
}).resolve(request);
if (resolved instanceof FontResolutionError) throw resolved;
const font = resolved;
const shaper = createHarfBuzzTextShaper();

/** Glyph advances of `text` at 12 pt, with the `kern` feature on or off. */
function advances(text: string, kern: 0 | 1): number[] {
  const run = shaper.shape({
    text,
    fontSizeHalfPoints: 24,
    bidiLevel: 0,
    environment: createShapingEnvironment({
      font,
      variationAxes: {},
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      normalization: 'none',
      script: 'Kana',
      language: 'ja',
      direction: 'ltr',
      features: { kern },
      fallbackOrder: [],
      fixedPointScale: 64,
      roundingMode: 'halfAwayFromZero',
    }),
  });
  return run.glyphs.map((glyph) => glyph.advanceX);
}

describe('East Asian text keeps its advances under pair kerning', () => {
  test('katakana keep their full-width advances with kerning on', () => {
    const full = advances('アイウエオ', 0);
    expect(new Set(full).size).toBe(1);
    expect(advances('アイウエオ', 1)).toEqual(full);
  });

  test('hiragana and ideographs keep their advances with kerning on', () => {
    for (const text of ['あいうえお', '漢字国'])
      expect(advances(text, 1)).toEqual(advances(text, 0));
  });

  test('Latin letters still kern, also beside kana', () => {
    expect(advances('AVATo', 1)).not.toEqual(advances('AVATo', 0));
    const mixed = advances('アイAVウエ', 1);
    const plain = advances('アイAVウエ', 0);
    expect(mixed.slice(0, 2)).toEqual(plain.slice(0, 2));
    expect(mixed[2]).not.toBe(plain[2]);
    expect(mixed.slice(4)).toEqual(plain.slice(4));
  });

  test('whole-run renderers kern only text that holds something other than East Asian', () => {
    const kerned = { ...DEFAULT_RUN_STYLE, fontSizePt: 12, kerningMinPt: 1 };
    expect(kernsText(kerned, 'アイウエオ')).toBe(false);
    expect(kernsText(kerned, 'ＡＶ｡ｱ')).toBe(false);
    expect(kernsText(kerned, 'AVアイ')).toBe(true);
    expect(kernsText({ ...kerned, kerningMinPt: 0 }, 'AV')).toBe(false);
    expect(unkernedTextRanges('AVアイ To 漢')).toEqual([
      [2, 4],
      [8, 9],
    ]);
    expect(unkernedTextRanges('AVATo')).toEqual([]);
  });
});
