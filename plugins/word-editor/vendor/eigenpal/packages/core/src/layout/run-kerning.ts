import type { ResolvedRunStyle } from './run-style.ts';

/** A positive kern threshold opts in; zero disables inherited kerning. */
export function isRunKerningEnabled(style: ResolvedRunStyle): boolean {
  return (
    (style.kerningEnabled ?? style.kerningMinPt > 0) &&
    style.kerningMinPt > 0 &&
    style.fontSizePt >= style.kerningMinPt
  );
}

/**
 * Full-width East Asian text that pair kerning never moves: kana, ideographs, CJK symbols and
 * punctuation, and full-width and half-width forms. Each keeps its own advance when a run
 * turns kerning on. Latin text in the same faces still kerns. Adjacent East Asian punctuation
 * is compressed by its own rule (`compressCjkPieces`), not by the font's kerning pairs.
 * Hangul syllables (U+AC00 to U+D7A3) are not in the list and keep the font's pairs; common
 * Korean faces carry no Hangul kerning pairs.
 */
const UNKERNED_CLASS =
  '[\\u2e80-\\u9fff\\uf900-\\ufaff\\ufe30-\\ufe4f\\uff00-\\uffef\\u{20000}-\\u{3ffff}]';
const UNKERNED_EAST_ASIAN = new RegExp(UNKERNED_CLASS, 'u');
const UNKERNED_EAST_ASIAN_RUNS = new RegExp(`${UNKERNED_CLASS}+`, 'gu');
const ALL_UNKERNED_EAST_ASIAN = new RegExp(`^${UNKERNED_CLASS}+$`, 'u');

/**
 * The UTF-16 ranges of `text` that kerning leaves alone, as `[start, end)` pairs, or an
 * empty list when none does. A shaper turns its `kern` feature off over each range.
 */
export function unkernedTextRanges(text: string): readonly (readonly [number, number])[] {
  // Every unkerned character has a code unit at U+2E80 or above: most text leaves here.
  let wide = false;
  for (let index = 0; index < text.length && !wide; index++)
    wide = text.charCodeAt(index) >= 0x2e80;
  if (!wide || !UNKERNED_EAST_ASIAN.test(text)) return [];
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(UNKERNED_EAST_ASIAN_RUNS))
    ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

/**
 * Whether a renderer that kerns a whole text run at once (a canvas or a DOM span) kerns
 * `text` in `style`. Text made only of unkerned East Asian characters never kerns.
 */
export function kernsText(style: ResolvedRunStyle, text: string): boolean {
  return isRunKerningEnabled(style) && !ALL_UNKERNED_EAST_ASIAN.test(text);
}
