// The East Asian code point blocks, shared by the run font reads and the font-pick check.

/**
 * Whether a code point resolves through `w:eastAsia`.
 *
 * The block set mirrors the East Asian scripts in `layout/script-itemization.ts` (Han,
 * Kana, Hangul, Bopomofo, their extensions, and full/half-width forms), which the binding
 * lane may not import. CJK-locale Office builds stamp a `w:eastAsia` theme face on nearly
 * every run, so without this gate a Latin-only document reports a CJK family as rendered.
 */
export function isEastAsianCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK radicals through Unified Ideographs
    (codePoint >= 0xa960 && codePoint <= 0xa97f) || // Hangul Jamo Extended-A
    (codePoint >= 0xac00 && codePoint <= 0xd7ff) || // Hangul Syllables + Jamo Extended-B
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK Compatibility Forms
    (codePoint >= 0xff00 && codePoint <= 0xffef) || // Full/half-width forms
    (codePoint >= 0x20000 && codePoint <= 0x3ffff) // CJK extension planes
  );
}
