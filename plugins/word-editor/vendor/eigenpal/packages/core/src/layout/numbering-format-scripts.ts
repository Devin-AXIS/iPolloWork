// Hebrew, Arabic and Devanagari `w:numFmt` sequences (§17.18.59).
//
// The sequences, the joiner characters and the wrap past 392 are the reference renderer's own
// list strings, read value by value; the standard names the formats but not their text.

/** Values past this restart from 1 in the four letter sequences below. */
const LETTER_SEQUENCE_PERIOD = 392;

const HEBREW_ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const HEBREW_TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HEBREW_HUNDREDS = ['', 'ק', 'ר', 'ש'];
const HEBREW_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת';
const ARABIC_ALPHA = 'أبتثجحخدذرزسشصضطظعغفقكلمنهوي';
const ARABIC_ABJAD = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ';
const DEVANAGARI_DIGITS = '०१२३४५६७८९';
const RLM = '‏';
const ZWNJ = '‌';

/** 1..392, wrapping larger values; 0 has no letter form. */
function wrapped(value: number): number {
  return value < 1 ? 0 : ((value - 1) % LETTER_SEQUENCE_PERIOD) + 1;
}

/** `hebrew1`: Hebrew numerals, 15 and 16 written טו and טז. */
export function formatHebrew1(value: number): string {
  const n = wrapped(value);
  if (n === 0) return String(value);
  const hundreds = HEBREW_HUNDREDS[Math.floor(n / 100)]!;
  const rest = n % 100;
  if (rest === 15) return `${hundreds}טו`;
  if (rest === 16) return `${hundreds}טז`;
  return hundreds + HEBREW_TENS[Math.floor(rest / 10)]! + HEBREW_ONES[rest % 10]!;
}

/** `hebrew2`: the 22 letters, then ת repeated before them, after a right-to-left mark. */
export function formatHebrew2(value: number): string {
  const n = wrapped(value);
  if (n === 0) return String(value);
  const letters = [...HEBREW_LETTERS];
  const last = letters[letters.length - 1]!;
  return (
    RLM + last.repeat(Math.floor((n - 1) / letters.length)) + letters[(n - 1) % letters.length]!
  );
}

/** One letter repeated once per pass through a 28-letter sequence, each copy with a joiner. */
function repeatedLetter(value: number, sequence: string, joinerAfter: boolean): string {
  const n = wrapped(value);
  if (n === 0) return String(value);
  const letters = [...sequence];
  const letter = letters[(n - 1) % letters.length]!;
  const copy = joinerAfter ? letter + ZWNJ : ZWNJ + letter;
  return copy.repeat(Math.floor((n - 1) / letters.length) + 1);
}

/** `arabicAlpha`: alphabetical order, a zero-width non-joiner after each letter. */
export function formatArabicAlpha(value: number): string {
  return repeatedLetter(value, ARABIC_ALPHA, true);
}

/** `arabicAbjad`: abjad order, a zero-width non-joiner before each letter. */
export function formatArabicAbjad(value: number): string {
  return repeatedLetter(value, ARABIC_ABJAD, false);
}

/** `hindiNumbers`: the decimal value in Devanagari digits. */
export function formatHindiNumbers(decimal: string): string {
  return decimal.replace(/[0-9]/g, (digit) => DEVANAGARI_DIGITS[Number(digit)]!);
}
