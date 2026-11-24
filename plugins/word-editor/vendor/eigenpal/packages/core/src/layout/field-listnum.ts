// LISTNUM fields (§17.16.5.33): a list number placed anywhere in a paragraph.
//
// The field states an optional list name and the switches `\l` (level, 1-9) and `\s` (the
// value this field takes). Its number comes from the document's own list definitions and the
// counting that numbered paragraphs share, never from the instruction running: the
// instruction is attacker-controlled and NEVER executes. Recognition is one bounded tokenize
// pass. A `\l` or `\s` without a whole number fails the parse, and the field keeps its
// previous rendering. Other switches do not change the number and are ignored.
//
// A name that matches a `w:abstractNum` `w:name` (case-insensitive) counts on that list, so
// the field and the list's numbered paragraphs continue each other. Every other name, and
// the built-in names `NumberDefault`, `OutlineDefault` and `LegalDefault`, count on ONE
// built-in list whose level formats the name selects. See `list-resolve-listnum.ts` for the
// list and level a field without a name or without `\l` takes.
//
// The number is computed at display time, so a saved result does not decide what the field
// shows. Save behavior: the field's stored runs stay untouched.

import { normalizeFieldInstruction } from './field-instruction.ts';

/** The highest value `\s` may set; a larger one clamps here, as a list level's start does. */
const MAX_LISTNUM_START = 9_999;
/** Longest list name compared. */
const MAX_LISTNUM_NAME_CHARS = 255;

/** One recognized LISTNUM instruction. */
export interface ListNumFieldSpec {
  /** The list name as written, without quotes, or null when the field names no list. */
  readonly name: string | null;
  /** Zero-based level from `\l` (clamped to 0-8), or null when the field states none. */
  readonly level: number | null;
  /** The value from `\s`, or null when the field states none. */
  readonly start: number | null;
}

/** Split an instruction into tokens, keeping a double-quoted name as one token. */
function tokenize(raw: string): string[] | null {
  const tokens: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const ch = raw[index]!;
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    if (ch === '"') {
      const close = raw.indexOf('"', index + 1);
      if (close < 0) return null;
      tokens.push(raw.slice(index, close + 1));
      index = close + 1;
      continue;
    }
    let end = index;
    while (end < raw.length && !/\s/.test(raw[end]!)) end += 1;
    tokens.push(raw.slice(index, end));
    index = end;
  }
  return tokens;
}

function wholeNumber(token: string | undefined): number | null {
  if (token === undefined || !/^\d{1,9}$/.test(token)) return null;
  return Number(token);
}

/**
 * Recognize `LISTNUM ["name"] [\l n] [\s n]`, or null for anything else. Other switches,
 * `\* MERGEFORMAT` included, are read past.
 */
export function parseListNumInstruction(raw: string): ListNumFieldSpec | null {
  // The shared normalizer bounds the length; the tokens below are read from the raw text so
  // a quoted name keeps its spelling.
  if (normalizeFieldInstruction(raw) === null) return null;
  const tokens = tokenize(raw);
  if (!tokens || tokens[0]?.toUpperCase() !== 'LISTNUM') return null;
  let name: string | null = null;
  let level: number | null = null;
  let start: number | null = null;
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith('\\')) {
      // Only the first bare token names the list; a stray word after a switch is ignored.
      if (index === 1) {
        const unquoted = token.startsWith('"') ? token.slice(1, -1) : token;
        if (unquoted.length > MAX_LISTNUM_NAME_CHARS) return null;
        name = unquoted.length > 0 ? unquoted : null;
      }
      continue;
    }
    const switchName = token.toLowerCase();
    if (switchName === '\\l' || switchName === '\\s') {
      const value = wholeNumber(tokens[index + 1]);
      if (value === null) return null;
      index += 1;
      if (switchName === '\\l') level = Math.min(8, Math.max(0, value - 1));
      else start = Math.min(MAX_LISTNUM_START, value);
      continue;
    }
    // `\*` takes an argument; a general format does not change a LISTNUM number.
    if (switchName === '\\*') index += 1;
  }
  return { name, level, start };
}

/** What counting and displaying one level needs. */
export interface ListNumLevel {
  readonly start: number;
  readonly numFmt: string;
  readonly lvlText: string;
  readonly lvlRestart?: number;
  readonly isLgl?: boolean;
  readonly vanish?: boolean;
}

function builtInLevels(texts: readonly string[], formats: readonly string[]): ListNumLevel[] {
  return texts.map((lvlText, index) => ({ start: 1, numFmt: formats[index]!, lvlText }));
}

const ROMAN_CYCLE = ['decimal', 'lowerLetter', 'lowerRoman'];
const NUMBER_DEFAULT = builtInLevels(
  ['%1)', '%2)', '%3)', '(%4)', '(%5)', '(%6)', '%7.', '%8.', '%9.'],
  [...ROMAN_CYCLE, ...ROMAN_CYCLE, ...ROMAN_CYCLE]
);
const OUTLINE_DEFAULT = builtInLevels(
  ['%1.', '%2.', '%3.', '%4)', '(%5)', '(%6)', '(%7)', '(%8)', '(%9)'],
  ['upperRoman', 'upperLetter', 'decimal', 'lowerLetter', 'decimal', 'lowerLetter'].concat([
    'lowerRoman',
    'lowerLetter',
    'lowerRoman',
  ])
);
const LEGAL_DEFAULT = builtInLevels(
  Array.from({ length: 9 }, (_, level) =>
    Array.from({ length: level + 1 }, (__, part) => `%${part + 1}.`).join('')
  ),
  Array.from({ length: 9 }, () => 'decimal')
);

/**
 * The levels of the built-in list a name selects. Every built-in name, and every name the
 * document does not define, counts on one shared counter; the name picks only the formats.
 */
export function builtInListNumLevels(name: string | null): readonly ListNumLevel[] {
  switch (name?.toLowerCase()) {
    case 'outlinedefault':
      return OUTLINE_DEFAULT;
    case 'legaldefault':
      return LEGAL_DEFAULT;
    default:
      return NUMBER_DEFAULT;
  }
}
