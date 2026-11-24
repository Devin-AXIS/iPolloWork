// Number formatters and `w:lvlText` placeholder expansion for OOXML lists.
//
// Pure, DOM-free, and strictly capped: hostile `lvlText` / counter values never allocate
// unbounded strings or run catastrophic regex.

import {
  formatArabicAbjad,
  formatArabicAlpha,
  formatHebrew1,
  formatHebrew2,
  formatHindiNumbers,
} from './numbering-format-scripts.ts';

/** Soft ceiling on an expanded marker string (codepoints). */
export const MAX_MARKER_TEXT_LENGTH = 64;

/** Soft ceiling on authored `w:lvlText` before expansion. */
export const MAX_LVL_TEXT_LENGTH = 64;

const ROMAN_TABLE: readonly { readonly value: number; readonly glyph: string }[] = [
  { value: 1000, glyph: 'M' },
  { value: 900, glyph: 'CM' },
  { value: 500, glyph: 'D' },
  { value: 400, glyph: 'CD' },
  { value: 100, glyph: 'C' },
  { value: 90, glyph: 'XC' },
  { value: 50, glyph: 'L' },
  { value: 40, glyph: 'XL' },
  { value: 10, glyph: 'X' },
  { value: 9, glyph: 'IX' },
  { value: 5, glyph: 'V' },
  { value: 4, glyph: 'IV' },
  { value: 1, glyph: 'I' },
];

/**
 * Largest list value a marker displays. Starts are capped at 9999, but a list counts on past
 * that one item at a time (`9999)` then `10000)`), so the display cap sits far above any count a
 * real document reaches. It still bounds every formatter below.
 */
export const MAX_LIST_VALUE = 999_999;

/** Clamp a list counter into a safe non-negative integer that every format can display. */
export function clampListValue(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const n = Math.trunc(value);
  if (n < 0) return 1;
  // Roman numerals stop at 3999 and letters cap their length in their own formatters.
  if (n > MAX_LIST_VALUE) return MAX_LIST_VALUE;
  return n;
}

/** `decimal` (§17.18.59). Clamped, because the counter derives from file-declared restarts. */
export function formatDecimal(value: number): string {
  return String(clampListValue(value));
}

/** `decimalZero` (§17.18.59): single digits zero-padded to two. */
export function formatDecimalZero(value: number): string {
  const n = clampListValue(value);
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `upperRoman` (§17.18.59). Saturates at 3999, the largest value classical Roman numerals
 * express — beyond it there is nothing correct to emit, so it stops rather than inventing
 * notation.
 */
export function formatUpperRoman(value: number): string {
  let n = clampListValue(value);
  if (n > 3999) n = 3999;
  let out = '';
  for (const { value: unit, glyph } of ROMAN_TABLE) {
    while (n >= unit) {
      out += glyph;
      n -= unit;
      if (out.length >= MAX_MARKER_TEXT_LENGTH) return out.slice(0, MAX_MARKER_TEXT_LENGTH);
    }
  }
  return out || 'I';
}

/** `lowerRoman` (§17.18.59). */
export function formatLowerRoman(value: number): string {
  return formatUpperRoman(value).toLowerCase();
}

/**
 * Excel-style letter sequence: 1→A … 26→Z, 27→AA.
 * Caps length so a hostile counter cannot grow without bound.
 */
export function formatUpperLetter(value: number): string {
  let n = clampListValue(value);
  let out = '';
  while (n > 0 && out.length < 8) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out || 'A';
}

/** `lowerLetter` (§17.18.59): the {@link formatUpperLetter} sequence, lower-cased. */
export function formatLowerLetter(value: number): string {
  return formatUpperLetter(value).toLowerCase();
}

/** `ordinal` (§17.18.59): 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function formatOrdinal(value: number): string {
  const n = clampListValue(value);
  const tens = n % 100;
  const ones = n % 10;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : ones === 1
        ? 'st'
        : ones === 2
          ? 'nd'
          : ones === 3
            ? 'rd'
            : 'th';
  return `${n}${suffix}`;
}

/** `hex` (§17.18.59): uppercase hexadecimal, the spelling Word writes. */
export function formatHex(value: number): string {
  return clampListValue(value).toString(16).toUpperCase();
}

/**
 * `chicago` (§17.18.59): the Chicago-manual note sequence `*`, `†`, `‡`, `§`, then the same
 * four doubled, tripled, …
 *
 * The repeat count comes from a counter, so it is capped rather than trusted: a hostile
 * `w:start` must not build a long string.
 */
export function formatChicago(value: number): string {
  const glyphs = ['*', '†', '‡', '§'];
  const n = clampListValue(value);
  if (n <= 0) return glyphs[0]!;
  const index = (n - 1) % glyphs.length;
  const repeat = Math.min(Math.floor((n - 1) / glyphs.length) + 1, MAX_CHICAGO_REPEAT);
  return glyphs[index]!.repeat(repeat);
}

/** Hard ceiling on a repeated `chicago` glyph — never a file-derived repeat count. */
const MAX_CHICAGO_REPEAT = 8;

const CARDINAL_ONES: readonly string[] = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const CARDINAL_TENS: readonly string[] = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

/** English words for 0…999999, the whole range `clampListValue` admits, so never unbounded. */
function cardinalWords(value: number): string {
  const n = clampListValue(value);
  if (n < 20) return CARDINAL_ONES[n]!;
  if (n < 100) {
    const rest = n % 10;
    return CARDINAL_TENS[Math.floor(n / 10)]! + (rest === 0 ? '' : `-${CARDINAL_ONES[rest]!}`);
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${CARDINAL_ONES[Math.floor(n / 100)]!} hundred${rest === 0 ? '' : ` ${cardinalWords(rest)}`}`;
  }
  const rest = n % 1000;
  return `${cardinalWords(Math.floor(n / 1000))} thousand${rest === 0 ? '' : ` ${cardinalWords(rest)}`}`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** `cardinalText` (§17.18.59): One, Two, Twenty-three, One hundred one. */
export function formatCardinalText(value: number): string {
  return capitalize(cardinalWords(value));
}

// A Map, not an object literal: the key comes from our own word table, but a lookup that
// cannot reach `__proto__` / `constructor` is the cheaper habit to keep.
const ORDINAL_WORDS: ReadonlyMap<string, string> = new Map([
  ['zero', 'zeroth'],
  ['one', 'first'],
  ['two', 'second'],
  ['three', 'third'],
  ['five', 'fifth'],
  ['eight', 'eighth'],
  ['nine', 'ninth'],
  ['twelve', 'twelfth'],
]);

/** Ordinal form of ONE cardinal word: `twenty` → `twentieth`, `four` → `fourth`. */
function ordinalWord(word: string): string {
  const known = ORDINAL_WORDS.get(word);
  if (known !== undefined) return known;
  if (word.endsWith('y')) return `${word.slice(0, -1)}ieth`;
  return `${word}th`;
}

/** `ordinalText` (§17.18.59): First, Second, Twenty-third, One hundred first. */
export function formatOrdinalText(value: number): string {
  const words = cardinalWords(value);
  // Only the LAST word takes the ordinal ending: "one hundred twenty-third".
  const cut = Math.max(words.lastIndexOf(' '), words.lastIndexOf('-'));
  const head = cut < 0 ? '' : words.slice(0, cut + 1);
  return capitalize(head + ordinalWord(words.slice(cut + 1)));
}

/**
 * Format one counter for a `w:numFmt` value (ST_NumberFormat, §17.18.59).
 *
 * `none` prints NOTHING — it is the format Word uses for a level that contributes only
 * literal text, and formatting it as decimal invents a number the document never had.
 * `bullet` is not formatted here — callers use the literal `lvlText`.
 *
 * The remaining enumerants (`japaneseCounting`, `thaiNumbers`, `ganada`, …) are
 * per-script numeral sequences we do not carry glyph tables for. They fall back to decimal
 * deliberately: the ORDINAL is still the authored one, only the script differs, which reads
 * as a number in the wrong alphabet rather than as a missing or wrong marker.
 */
export function formatNumFmt(numFmt: string, value: number): string {
  switch (numFmt) {
    case 'decimal':
      return formatDecimal(value);
    case 'decimalZero':
      return formatDecimalZero(value);
    case 'upperRoman':
      return formatUpperRoman(value);
    case 'lowerRoman':
      return formatLowerRoman(value);
    case 'upperLetter':
      return formatUpperLetter(value);
    case 'lowerLetter':
      return formatLowerLetter(value);
    case 'ordinal':
      return formatOrdinal(value);
    case 'cardinalText':
      return formatCardinalText(value);
    case 'ordinalText':
      return formatOrdinalText(value);
    case 'hex':
      return formatHex(value);
    case 'chicago':
      return formatChicago(value);
    // `numberInDash` brackets the number with dashes: 1 → "- 1 -".
    case 'numberInDash':
      return `- ${formatDecimal(value)} -`;
    case 'hebrew1':
      return formatHebrew1(clampListValue(value));
    case 'hebrew2':
      return formatHebrew2(clampListValue(value));
    case 'arabicAlpha':
      return formatArabicAlpha(clampListValue(value));
    case 'arabicAbjad':
      return formatArabicAbjad(clampListValue(value));
    case 'hindiNumbers':
      return formatHindiNumbers(formatDecimal(value));
    case 'none':
    case 'bullet':
      return '';
    default:
      return formatDecimal(value);
  }
}

/**
 * Expand `w:lvlText` placeholders `%1`…`%9` using per-level counters and formats.
 *
 * `formats[i]` / `counters[i]` correspond to ilvl `i`. Missing slots use decimal / 1.
 * Literal percent signs that are not `%1`…`%9` are kept. Output is hard-capped.
 */
export function expandLvlText(
  lvlText: string,
  counters: readonly number[],
  formats: readonly string[]
): string {
  const source =
    lvlText.length > MAX_LVL_TEXT_LENGTH ? lvlText.slice(0, MAX_LVL_TEXT_LENGTH) : lvlText;
  let out = '';
  for (let index = 0; index < source.length; index += 1) {
    if (out.length >= MAX_MARKER_TEXT_LENGTH) break;
    const ch = source[index]!;
    if (ch === '%' && index + 1 < source.length) {
      const digit = source[index + 1]!;
      if (digit >= '1' && digit <= '9') {
        const level = Number(digit) - 1;
        const fmt = formats[level] ?? 'decimal';
        const value = counters[level] ?? 1;
        const piece = fmt === 'bullet' ? '' : formatNumFmt(fmt, value);
        for (const glyph of piece) {
          if (out.length >= MAX_MARKER_TEXT_LENGTH) break;
          out += glyph;
        }
        index += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}
