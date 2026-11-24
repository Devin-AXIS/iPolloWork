// Kana compression (`compressPunctuationAndJapaneseKana`) pulls a kana and a sound mark that
// its face draws in a cell of its own onto a full justified line: the spaced mark is the
// spacing mark that the line-start rules forbid at a line start. The mark first gives a
// sixteenth of its em, then the kana share the rest; the base gives its share through its mark.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  createFixedMeasurer,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  createShapedMeasurer,
  harfBuzzFontValidator,
  initializeHarfBuzz,
  sha256FontBytes,
} from '../index.ts';
import { loadFixture, type FixtureOptions } from './punctuation-kerning-fixture.ts';

await initializeHarfBuzz();

const shaper = createHarfBuzzTextShaper();
function measurer(file: string) {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/fonts/${file}`, import.meta.url)));
  const request = { family: file, weight: 400, style: 'normal' } as const;
  const font = createFontResourceSnapshot({
    epoch: 1,
    maxFontBytes: 100_000,
    resources: [{ request, id: file, bytes, hash: sha256FontBytes(bytes), faceIndex: 0 }],
    validateFont: harfBuzzFontValidator,
  }).resolve(request);
  if (font instanceof FontResolutionError) throw font;
  return createShapedMeasurer({
    shaper,
    resolveFont: () => font,
    fallback: createFixedMeasurer(),
    environment: {
      shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
      unicodeDataVersion: '16.0.0',
      documentLigatures: false,
      script: 'Hira',
      language: 'ja',
      variationAxes: {},
      features: {},
      normalization: 'none',
      fixedPointScale: 64,
      roundingMode: 'halfAwayFromZero',
    },
  });
}
const spacing = measurer('sound-mark-spacing.ttf');
const joining = measurer('sound-mark-joining.ttf');

// Every glyph is 24 pt. Eighteen kana, a kana and its spaced mark take 20 cells, 480 pt.
const A = 'あ'.repeat(18);
const load = (text: string, available: number, options: FixtureOptions = {}) =>
  loadFixture({
    text,
    available,
    language: 'ja-JP',
    compatibility: 15,
    compression: 'compressPunctuationAndJapaneseKana',
    paragraphProperties: '<w:jc w:val="both"/>',
    measurer: spacing,
    ...options,
  });
const texts = (result: ReturnType<typeof loadFixture>) =>
  result.lines.map((line) => line.spans.map((span) => span.text).join(''));
/** The x of each span's end on the first line, from the line's left edge. */
const ends = (result: ReturnType<typeof loadFixture>) => {
  const line = result.lines[0]!;
  return line.spans.map((span) => ({
    text: span.text,
    end: span.box.x + span.box.width - line.box.x,
  }));
};

describe('a kana and its spaced sound mark stay on a full line', () => {
  test('the kana compress and the pair keeps its base advance', () => {
    // 20 pt short: the mark gives 1.5 pt, then 19 shares of 18.5 / 19 pt each.
    const result = load(A + 'か\u3099あ', 460);
    expect(texts(result)).toEqual([A + 'か\u3099', 'あ']);
    const share = 18.5 / 19;
    const spans = ends(result);
    const base = spans.find((span) => span.text === 'か')!;
    expect(base.end).toBeCloseTo(18 * (24 - share) + 24, 4);
    expect(spans.at(-1)!).toEqual({ text: '\u3099', end: expect.closeTo(460, 4) });
  });

  test('a mark in a run of its own stays with its base too', () => {
    const result = load(A + 'か\u3099あ', 460, { split: 19 });
    expect(texts(result)).toEqual([A + 'か\u3099', 'あ']);
  });

  test('the pair counts as one kana in the capacity of the line', () => {
    // 19 kana, the pair among them, admit 19 x 1.5 = 28.5 pt.
    expect(texts(load(A + 'か\u3099あ', 452))).toEqual([A + 'か\u3099', 'あ']);
    expect(texts(load(A + 'か\u3099あ', 451))).toEqual([A, 'か\u3099あ']);
  });

  test('a left-aligned line in a modern mode keeps the kana advances', () => {
    const result = load(A + 'か\u3099あ', 460, { paragraphProperties: '<w:jc w:val="left"/>' });
    expect(texts(result)).toEqual([A, 'か\u3099あ']);
  });

  test('a face that joins the pair in one cell gives the line no mark to keep', () => {
    // The composed pair is not a line-start-prohibited character, so it wraps.
    const result = load('あ'.repeat(19) + 'か\u3099あ', 460, { measurer: joining });
    expect(texts(result)).toEqual(['あ'.repeat(19), 'か\u3099あ']);
  });
});
