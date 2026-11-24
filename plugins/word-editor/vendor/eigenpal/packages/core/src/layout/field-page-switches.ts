// The switches a PAGE / NUMPAGES / SECTIONPAGES instruction may carry, and the number formats
// they select.
//
// Field instructions are attacker-controlled and never execute. This is a bounded, one-pass
// scanner over an instruction the caller has already length-capped and whitespace-collapsed:
// no regex, no backtracking, no recursion. It accepts exactly this grammar and returns null
// for anything else, which keeps the field inert (its cached result paints):
//
//   KEYWORD [\# picture] [\* format | \* MERGEFORMAT | \* CHARFORMAT]...
//
// - `\#` is the numeric picture. At most one, and it must come before every `\*` switch;
//   otherwise the field reports an error instead of a value, so it stays inert here.
// - `\* Arabic | roman | alphabetic | ArabicDash` select a number format. The keyword matches
//   in any case; for roman and alphabetic the FIRST character of the argument picks the
//   variant (`Roman` is upper case, `rOMAN` lower case). When several appear, the last wins.
//   A number format outranks a `\#` picture and the section's `w:pgNumType/@w:fmt`.
// - `\* MERGEFORMAT` and `\* CHARFORMAT` only concern result formatting, so they are inert.
// - Every other switch or argument (`\* Ordinal`, `\* Upper`, `\n`, a stray word, an empty or
//   unterminated argument) fails the parse.
//
// A switch may follow the previous argument with no space (`\*Arabic\*MERGEFORMAT`), and an
// argument may be quoted (`\* "roman"`).

import { formatDecimal } from './numbering-format.ts';

/** The number formats a page field's `\*` switch can select (ST_NumberFormat names). */
export type PageFieldNumberFormat =
  'decimal' | 'lowerRoman' | 'upperRoman' | 'lowerLetter' | 'upperLetter' | 'numberInDash';

/** How one page field renders its computed value. */
export interface PageFieldSwitches {
  /** The `\#` numeric picture. Absent when the field has none, or a number format outranks it. */
  readonly picture?: string;
  /** The `\*` number format. Absent when the field has none. */
  readonly numberFormat?: PageFieldNumberFormat;
}

/** One instruction split into its upper-cased keyword and its recognized switches. */
export interface ParsedPageFieldInstruction extends PageFieldSwitches {
  readonly keyword: string;
}

/**
 * Text a roman or alphabetic page field paints for a value that format cannot express.
 *
 * Painted instead of a guessed number or the stale cached result: the value is computed per
 * page, so the field cannot fall back to its cache for one page and refresh on the next.
 */
export const PAGE_FIELD_UNREPRESENTABLE =
  'Error! Number cannot be represented in specified format.';

/** The largest value a roman page field renders: thousands repeat `M`. */
const MAX_ROMAN_VALUE = 32767;
/** The largest value an alphabetic page field renders: 30 repeats of `Z`. */
const MAX_LETTER_VALUE = 780;

function numberFormatOf(argument: string): PageFieldNumberFormat | 'inert' | null {
  // ASCII letters only: Unicode case mapping folds other letters onto these names (`ı` → `I`).
  if (!/^[A-Za-z]+$/.test(argument)) return null;
  const upperCaseVariant = argument[0] === argument[0]!.toUpperCase();
  switch (argument.toUpperCase()) {
    case 'MERGEFORMAT':
    case 'CHARFORMAT':
      return 'inert';
    case 'ARABIC':
      return 'decimal';
    case 'ARABICDASH':
      return 'numberInDash';
    case 'ROMAN':
      return upperCaseVariant ? 'upperRoman' : 'lowerRoman';
    case 'ALPHABETIC':
      return upperCaseVariant ? 'upperLetter' : 'lowerLetter';
    default:
      return null;
  }
}

/**
 * Read one switch argument starting at `start`: quoted up to the closing quote, or bare up to
 * the next backslash (and, unless `spaces` allows them, the next space). Returns null for an
 * unterminated quote or a stray quote inside a bare argument.
 */
function readArgument(
  text: string,
  start: number,
  spaces: boolean
): { readonly value: string; readonly end: number; readonly quoted: boolean } | null {
  if (text[start] === '"') {
    const close = text.indexOf('"', start + 1);
    if (close < 0) return null;
    return { value: text.slice(start + 1, close), end: close + 1, quoted: true };
  }
  let end = start;
  while (end < text.length) {
    const char = text[end]!;
    if (char === '\\' || (char === ' ' && !spaces)) break;
    if (char === '"') return null;
    end += 1;
  }
  return { value: text.slice(start, end).trim(), end, quoted: false };
}

/**
 * Split a page-field instruction into its keyword and switches, or null when any part falls
 * outside the grammar above.
 *
 * `instruction` must already be length-capped, whitespace-collapsed and trimmed. The keyword is
 * upper-cased for matching; the picture keeps its case, because it may hold literal text.
 */
export function parsePageFieldInstruction(instruction: string): ParsedPageFieldInstruction | null {
  let index = 0;
  while (index < instruction.length && instruction[index] !== ' ') index += 1;
  const keyword = instruction.slice(0, index).toUpperCase();
  if (keyword.length === 0 || keyword.includes('\\')) return null;

  let picture: string | undefined;
  let sawPicture = false;
  let sawFormatSwitch = false;
  let numberFormat: PageFieldNumberFormat | undefined;

  while (index < instruction.length) {
    if (instruction[index] === ' ') {
      index += 1;
      continue;
    }
    if (instruction[index] !== '\\') return null;
    const kind = instruction[index + 1];
    if (kind !== '#' && kind !== '*') return null;
    index += 2;
    while (instruction[index] === ' ') index += 1;
    const argument = readArgument(instruction, index, kind === '#');
    if (argument === null) return null;
    index = argument.end;
    if (kind === '#') {
      // A second picture, or a picture after any `\*` switch, is an error result: inert.
      if (sawPicture || sawFormatSwitch) return null;
      // A bare `\#` with nothing after it has no argument; `\# ""` states an empty picture.
      if (argument.value.length === 0 && !argument.quoted) return null;
      sawPicture = true;
      if (argument.value.length > 0) picture = argument.value;
      continue;
    }
    if (argument.value.length === 0) return null;
    const format = numberFormatOf(argument.value);
    if (format === null) return null;
    sawFormatSwitch = true;
    if (format !== 'inert') numberFormat = format;
  }

  if (numberFormat !== undefined) return { keyword, numberFormat };
  return picture === undefined ? { keyword } : { keyword, picture };
}

const ROMAN_HUNDREDS = ['', 'C', 'CC', 'CCC', 'CD', 'D', 'DC', 'DCC', 'DCCC', 'CM'];
const ROMAN_TENS = ['', 'X', 'XX', 'XXX', 'XL', 'L', 'LX', 'LXX', 'LXXX', 'XC'];
const ROMAN_UNITS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

function romanBelowThousand(value: number): string {
  return (
    ROMAN_HUNDREDS[Math.floor(value / 100)]! +
    ROMAN_TENS[Math.floor(value / 10) % 10]! +
    ROMAN_UNITS[value % 10]!
  );
}

const PAGE_FIELD_NUMBER_FORMATS: ReadonlySet<string> = new Set<PageFieldNumberFormat>([
  'decimal',
  'lowerRoman',
  'upperRoman',
  'lowerLetter',
  'upperLetter',
  'numberInDash',
]);

/** True when an ST_NumberFormat name is one {@link formatPageFieldNumber} renders. */
export function isPageFieldNumberFormat(format: string): format is PageFieldNumberFormat {
  return PAGE_FIELD_NUMBER_FORMATS.has(format);
}

/**
 * Render a page-field value through a `\*` number format.
 *
 * Roman numerals repeat `M` for each thousand up to 32767; letters repeat one letter
 * (`27` → `aa`, `52` → `zz`) up to 780. Zero renders as a single space in both, and a value
 * past either limit renders {@link PAGE_FIELD_UNREPRESENTABLE}. Both limits bound the output
 * length, and the repeat counts below never exceed 32 and 30. Arabic renders decimal digits
 * whatever the section format is, and ArabicDash puts a dash and a space on each side.
 */
export function formatPageFieldNumber(value: number, format: PageFieldNumberFormat): string {
  if (!Number.isFinite(value) || value < 0) return '';
  const n = Math.floor(value);
  switch (format) {
    case 'decimal':
      return formatDecimal(n);
    case 'numberInDash':
      return `- ${formatDecimal(n)} -`;
    case 'upperRoman':
    case 'lowerRoman': {
      if (n === 0) return ' ';
      if (n > MAX_ROMAN_VALUE) return PAGE_FIELD_UNREPRESENTABLE;
      const roman = 'M'.repeat(Math.floor(n / 1000)) + romanBelowThousand(n % 1000);
      return format === 'upperRoman' ? roman : roman.toLowerCase();
    }
    case 'upperLetter':
    case 'lowerLetter': {
      if (n === 0) return ' ';
      if (n > MAX_LETTER_VALUE) return PAGE_FIELD_UNREPRESENTABLE;
      const letter = String.fromCharCode(65 + ((n - 1) % 26));
      const text = letter.repeat(Math.floor((n - 1) / 26) + 1);
      return format === 'upperLetter' ? text : text.toLowerCase();
    }
  }
}
