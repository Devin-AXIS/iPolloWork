// The w:rFonts slot and shaping script of each code point. Layout itemizes text with it, and
// the equation lane picks the face of a math run with it, so both read one table.

/**
 * Which `w:rFonts` slot a character resolves its face through.
 *
 * OOXML gives a run up to four faces and picks between them by SCRIPT, so one run of mixed Latin
 * and CJK text uses two different fonts without saying so anywhere in its properties.
 */
export type FontSlot = 'ascii' | 'hAnsi' | 'eastAsia' | 'cs';

/** The slot and the shaping script of one strong code point. */
export interface FontSlotClass {
  readonly slot: FontSlot;
  readonly script:
    | 'Zyyy'
    | 'Latn'
    | 'Grek'
    | 'Cyrl'
    | 'Hani'
    | 'Hebr'
    | 'Arab'
    | 'Deva'
    | 'Beng'
    | 'Thai'
    | 'Khmr';
}

const inRange = (value: number, from: number, to: number): boolean => value >= from && value <= to;

// Punctuation that takes the hAnsi face without an East Asian hint, even beside Han text.
const HANSI_PUNCTUATION: ReadonlySet<number> = new Set([
  0x00b7, // middle dot
  0x2013, // en dash
  0x2014, // em dash
  0x2018, // left single quotation mark
  0x2019, // right single quotation mark
  0x201a, // single low-9 quotation mark
  0x201c, // left double quotation mark
  0x201d, // right double quotation mark
  0x201e, // double low-9 quotation mark
  0x2026, // horizontal ellipsis
]);
const isHAnsiPunctuation = (codePoint: number): boolean => HANSI_PUNCTUATION.has(codePoint);

/**
 * Explicit, deterministic Unicode-range policy for the `w:rFonts` slot of one code point.
 * Common and inherited characters return null; they take the slot of a strong neighbour.
 * Scripts outside the policy return undefined.
 */
export function classifyFontSlot(codePoint: number): FontSlotClass | null | undefined {
  // MS-OI29500 2.1.88: curly quotes, low quotes, en and em dashes, the ellipsis and the
  // middle dot use hAnsi without an East Asian hint. They keep the Common script, but never
  // inherit a neighbouring Han font slot.
  // eastAsiaRunsOfSegments applies an explicit hint before this default classification.
  if (isHAnsiPunctuation(codePoint)) {
    return { slot: 'hAnsi', script: 'Zyyy' };
  }
  // Full-width forms draw in the East Asian face, letters and digits included. The letters
  // keep their Latin script for shaping; the rest are punctuation, symbols and digits.
  if (inRange(codePoint, 0xff21, 0xff3a) || inRange(codePoint, 0xff41, 0xff5a)) {
    return { slot: 'eastAsia', script: 'Latn' };
  }
  if (inRange(codePoint, 0xff01, 0xff65) || inRange(codePoint, 0xffe0, 0xffe6)) {
    return { slot: 'eastAsia', script: 'Zyyy' };
  }
  if (inRange(codePoint, 0x0590, 0x05ff) || inRange(codePoint, 0xfb1d, 0xfb4f)) {
    return { slot: 'cs', script: 'Hebr' };
  }
  if (
    inRange(codePoint, 0x0600, 0x06ff) ||
    inRange(codePoint, 0x0750, 0x077f) ||
    inRange(codePoint, 0x0870, 0x089f) ||
    inRange(codePoint, 0x08a0, 0x08ff) ||
    inRange(codePoint, 0xfb50, 0xfdff) ||
    inRange(codePoint, 0xfe70, 0xfeff) ||
    inRange(codePoint, 0x1ee00, 0x1eeff)
  ) {
    return { slot: 'cs', script: 'Arab' };
  }
  if (
    inRange(codePoint, 0x1100, 0x11ff) ||
    inRange(codePoint, 0x2e80, 0x303f) ||
    inRange(codePoint, 0x3040, 0x30ff) ||
    inRange(codePoint, 0x3100, 0x318f) ||
    inRange(codePoint, 0x31f0, 0x31ff) ||
    inRange(codePoint, 0x3400, 0x4dbf) ||
    inRange(codePoint, 0x4e00, 0x9fff) ||
    inRange(codePoint, 0xac00, 0xd7af) ||
    inRange(codePoint, 0xf900, 0xfaff) ||
    inRange(codePoint, 0xff66, 0xff9d) ||
    inRange(codePoint, 0xffa0, 0xffdc) ||
    inRange(codePoint, 0x20000, 0x3134f)
  ) {
    return { slot: 'eastAsia', script: 'Hani' };
  }
  if (inRange(codePoint, 0x0900, 0x097f) || inRange(codePoint, 0xa8e0, 0xa8ff)) {
    return { slot: 'cs', script: 'Deva' };
  }
  if (inRange(codePoint, 0x0980, 0x09ff)) {
    return { slot: 'cs', script: 'Beng' };
  }
  if (inRange(codePoint, 0x0370, 0x03ff) || inRange(codePoint, 0x1f00, 0x1fff)) {
    return { slot: 'hAnsi', script: 'Grek' };
  }
  if (
    inRange(codePoint, 0x0400, 0x052f) ||
    inRange(codePoint, 0x1c80, 0x1c8f) ||
    inRange(codePoint, 0x2de0, 0x2dff) ||
    inRange(codePoint, 0xa640, 0xa69f)
  ) {
    return { slot: 'hAnsi', script: 'Cyrl' };
  }
  if (inRange(codePoint, 0x0e00, 0x0e7f)) {
    return { slot: 'cs', script: 'Thai' };
  }
  if (inRange(codePoint, 0x1780, 0x17ff) || inRange(codePoint, 0x19e0, 0x19ff)) {
    return { slot: 'cs', script: 'Khmr' };
  }
  if (
    inRange(codePoint, 0x0300, 0x036f) ||
    inRange(codePoint, 0x1ab0, 0x1aff) ||
    inRange(codePoint, 0x1dc0, 0x1dff) ||
    inRange(codePoint, 0x20d0, 0x20ff) ||
    inRange(codePoint, 0x2000, 0x206f) ||
    inRange(codePoint, 0xfe20, 0xfe2f) ||
    codePoint <= 0x002f ||
    inRange(codePoint, 0x003a, 0x0040) ||
    inRange(codePoint, 0x005b, 0x0060) ||
    inRange(codePoint, 0x007b, 0x00bf)
  ) {
    return null;
  }
  if (
    codePoint === 0x1680 ||
    inRange(codePoint, 0x2000, 0x2bff) ||
    inRange(codePoint, 0xfe00, 0xfe0f) ||
    inRange(codePoint, 0xff00, 0xff65) ||
    inRange(codePoint, 0xff9e, 0xff9f) ||
    inRange(codePoint, 0xffdd, 0xffff) ||
    inRange(codePoint, 0x1f000, 0x1faff) ||
    inRange(codePoint, 0xe0100, 0xe01ef)
  ) {
    return null;
  }
  if (codePoint <= 0x007f) return { slot: 'ascii', script: 'Latn' };
  if (
    inRange(codePoint, 0x00c0, 0x02af) ||
    inRange(codePoint, 0x1d00, 0x1d7f) ||
    inRange(codePoint, 0x1d80, 0x1dbf) ||
    inRange(codePoint, 0x1e00, 0x1eff) ||
    inRange(codePoint, 0x2c60, 0x2c7f) ||
    inRange(codePoint, 0xa720, 0xa7ff) ||
    inRange(codePoint, 0xab30, 0xab6f)
  ) {
    return { slot: 'hAnsi', script: 'Latn' };
  }
  return undefined;
}
